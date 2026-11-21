import type { GoalStore } from './store.ts';
import type { Goal, GoalStep, GoalAdvanceResult } from './types.ts';
import { computeNextCheckIn } from './cadence.ts';
import { runAgentLoop, type ToolDefinition, type LLMCaller } from '../../../packages/sandbox-core/src/loop.ts';
import { MicroSandbox } from '../../../packages/sandbox-core/src/micro-sandbox.ts';
import type { SentinelPolicyManager } from '../../sentinel/src/guard.ts';
import type { BotRegistry, BotMemoryManager } from '../bots/index.ts';

export interface GoalEngineOptions {
  store: GoalStore;
  sentinel: SentinelPolicyManager;
  tools: ToolDefinition[];
  callLLM: LLMCaller;
  botRegistry?: BotRegistry;
  botMemory?: BotMemoryManager;
  onGoalCheckInCompleted?: (result: GoalAdvanceResult, goal: Goal) => Promise<void>;
}

export class GoalEngine {
  private store: GoalStore;
  private sentinel: SentinelPolicyManager;
  private tools: ToolDefinition[];
  private callLLM: LLMCaller;
  private botRegistry?: BotRegistry;
  private botMemory?: BotMemoryManager;
  private timer: NodeJS.Timeout | null = null;
  private options: GoalEngineOptions;
  private sandbox: MicroSandbox;

  constructor(options: GoalEngineOptions) {
    this.options = options;
    this.store = options.store;
    this.sentinel = options.sentinel;
    this.tools = options.tools;
    this.callLLM = options.callLLM;
    this.botRegistry = options.botRegistry;
    this.botMemory = options.botMemory;
    this.sandbox = new MicroSandbox({ workspaceDir: process.cwd() });
  }

  /**
   * 启动后台自主巡检 Check-in 调度器
   */
  public startScheduler(intervalMs = 60000): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        await this.checkInDueGoals();
      } catch (err: any) {
        console.error(`[GoalEngine:Scheduler] 巡检推进异常: ${err.message}`);
      }
    }, intervalMs);
    console.log(`[GoalEngine:Scheduler] 长周期目标自主推进调度器已启动 (间隔: ${intervalMs}ms)`);
  }

  public stopScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log(`[GoalEngine:Scheduler] 调度器已停止`);
    }
  }

  /**
   * 扫描并自驱推进所有已到达 Check-in 时间节点的目标
   */
  public async checkInDueGoals(): Promise<GoalAdvanceResult[]> {
    const now = Date.now();
    const activeGoals = this.store.list({ status: 'active' });
    const dueGoals = activeGoals.filter((g) => g.nextCheckInAt <= now);
    const results: GoalAdvanceResult[] = [];

    for (const goal of dueGoals) {
      console.log(`[GoalEngine:CheckIn] 到达巡检周期: 目标 "${goal.title}" (Bot: ${goal.botId})`);
      const result = await this.advanceGoal(goal.id);
      results.push(result);
      if (this.options.onGoalCheckInCompleted) {
        await this.options.onGoalCheckInCompleted(result, goal);
      }
    }
    return results;
  }

  /**
   * 针对指定目标，向前自驱推演当前执行步骤
   */
  public async advanceGoal(
    goalId: string,
    override?: { stepId?: string; mockOutput?: string; guidance?: string }
  ): Promise<GoalAdvanceResult> {
    const goal = this.store.get(goalId);
    if (!goal) {
      return { goalId, status: 'blocked', blockedReason: '目标不存在' };
    }

    if (goal.status === 'done') {
      return { goalId, status: 'done', goalCompleted: true, output: '目标已全部达成' };
    }

    if (goal.status === 'paused' || goal.status === 'cancelled') {
      return { goalId, status: 'blocked', blockedReason: `目标处于 ${goal.status} 状态` };
    }

    // 检查是否有等待审批的修订提案
    if (goal.proposal && goal.proposal.status === 'pending') {
      return {
        goalId,
        status: 'blocked',
        blockedReason: '存在等待用户审批的计划修订提案 (Pending Proposal)，需先审批或处理',
        proposalRaised: true
      };
    }

    // 寻找当前活跃步骤
    let activeStep: GoalStep | undefined;
    if (override?.stepId) {
      activeStep = goal.steps.find((s) => s.id === override.stepId);
    } else {
      activeStep = goal.steps.find((s) => s.status === 'in_progress') ||
        goal.steps.find((s) => s.status === 'pending');
    }

    if (!activeStep) {
      goal.status = 'done';
      goal.updatedAt = Date.now();
      this.store.save();
      return { goalId, status: 'done', goalCompleted: true, output: '目标所有步骤均已完成' };
    }

    // 步骤置为 in_progress
    activeStep.status = 'in_progress';
    activeStep.updatedAt = Date.now();
    this.store.save();

    let output = '';
    let isBlocked = false;
    let blockedReason = '';

    if (override?.mockOutput !== undefined) {
      output = override.mockOutput;
      const blockMatch = output.match(/(?:^|\n)\s*\[BLOCKED\]:?\s*([^\n]+)/);
      isBlocked = !!blockMatch;
      if (isBlocked) {
        blockedReason = blockMatch[1].trim() || '执行被阻塞';
      }
    } else {
      let bot = this.botRegistry?.get(goal.botId);
      if (!bot) {
        bot = {
          id: goal.botId,
          name: goal.botId,
          system_prompt: '你是一个专注推进企业长周期任务的数字员工。',
          tool_allowlist: ['*'],
          memory_ns: `bots/${goal.botId}`,
          enabled: true,
          created_at: Date.now(),
          updated_at: Date.now()
        };
      }

      if (this.botMemory) {
        bot = { ...bot, memory: this.botMemory.getMemory(bot.id, goal.userId) };
      }

      let prompt = `【长周期目标自驱推进任务】
目标名称: ${goal.title}
目标描述: ${goal.description}
当前执行步骤: [${activeStep.id}] ${activeStep.title}
步骤详情与预期: ${activeStep.description || activeStep.title}
完整步骤链条:
${goal.steps.map((s) => `- [${s.status}] ${s.id}: ${s.title}${s.verificationCommand ? ` (需通过验收脚本: ${s.verificationCommand})` : ''}`).join('\n')}`;

      if (override?.guidance) {
        prompt += `\n\n【用户人工补充指引 / 修正要求】:\n${override.guidance}`;
      }

      prompt += `\n\n执行要求：
1. 专注完成当前步骤的具体要求；
2. 完成时明确输出阶段性成果总结；
3. 若遭遇外部依赖缺失、权限不足或客观环境阻碍确实无法继续，请在输出单独一行中以 "[BLOCKED]: 具体卡点原因" 开头，并详细说明阻塞原因与建议的后续调整方案。正常未受阻时切勿以 [BLOCKED] 开头。`;

      const sessionId = `goal_${goal.id}_${activeStep.id}_${Date.now()}`;
      const loop = runAgentLoop(
        bot.system_prompt,
        prompt,
        this.tools,
        this.sentinel,
        this.callLLM,
        {
          sessionId,
          userId: goal.userId,
          botId: goal.botId,
          profile: bot,
          maxSteps: 6
        }
      );

      for await (const event of loop) {
        if (event.type === 'stream:text-delta') {
          output += event.text;
        }
      }

      const blockMatch = output.match(/(?:^|\n)\s*\[BLOCKED\]:?\s*([^\n]+)/);
      isBlocked = !!blockMatch;
      if (isBlocked) {
        blockedReason = blockMatch[1].trim() || '执行被阻塞';
      }
    }

    let verificationOutput: string | undefined;

    // 确定性验收脚本机制：若当前步骤配置了 verificationCommand 且未发生逻辑阻断，必须通过脚本验收才允许放行
    if (!isBlocked && activeStep.verificationCommand) {
      console.log(`[GoalEngine:Verification] 运行步骤 [${activeStep.id}] 自动化验收命令: ${activeStep.verificationCommand}`);
      try {
        const vRes = await this.sandbox.execute(activeStep.verificationCommand, { timeoutMs: 30000 });
        verificationOutput = (vRes.stdout || vRes.stderr).trim();
        if (vRes.exitCode !== 0) {
          isBlocked = true;
          blockedReason = `自动化验收命令执行未通过 (退出码: ${vRes.exitCode}): ${(vRes.stderr || vRes.stdout || '执行失败').trim()}`;
          console.warn(`[GoalEngine:Verification] 验收命令失败: ${blockedReason}`);
        } else {
          console.log(`[GoalEngine:Verification] 验收命令顺利通过 (exitCode: 0)`);
        }
      } catch (err: any) {
        isBlocked = true;
        blockedReason = `自动化验收命令执行异常: ${err.message}`;
      }
    }

    let proposalRaised = false;

    if (isBlocked) {
      this.store.updateStep(goalId, activeStep.id, 'blocked', { blockedReason, verificationOutput });

      // 自动生成结构化修订提案（向人类发起）
      const remainingSteps = goal.steps.filter((s) => s.id !== activeStep!.id && s.status !== 'done');
      const proposedSteps: GoalStep[] = [
        {
          id: `${activeStep.id}_unblock`,
          idx: activeStep.idx,
          title: `解决阻碍: ${blockedReason.slice(0, 30)}`,
          description: `申请相应权限、修正环境或补充依赖 (${blockedReason})`,
          status: 'pending',
          updatedAt: Date.now()
        },
        {
          ...activeStep,
          id: `${activeStep.id}_retry`,
          idx: activeStep.idx + 1,
          status: 'pending',
          blockedReason: undefined,
          updatedAt: Date.now()
        },
        ...remainingSteps
      ];

      this.store.proposeReplan(goalId, `步骤 [${activeStep.title}] 被阻塞: ${blockedReason}`, proposedSteps);
      proposalRaised = true;
    } else {
      this.store.updateStep(goalId, activeStep.id, 'done', {
        result: output,
        note: output.slice(0, 300),
        verificationOutput
      });
      const summary = output.trim().split('\n')[0].slice(0, 100) || '步骤执行完成';
      this.store.appendNote(goalId, `步骤 [${activeStep.title}] 推进达成: ${summary}`);
    }

    // 更新 Check-in 时钟与下次巡检时间
    const updatedGoal = this.store.get(goalId)!;
    updatedGoal.lastCheckInAt = Date.now();
    updatedGoal.nextCheckInAt = computeNextCheckIn(updatedGoal.cadence);
    this.store.save();

    return {
      goalId,
      stepId: activeStep.id,
      stepTitle: activeStep.title,
      status: isBlocked ? 'blocked' : 'done',
      output,
      blockedReason: isBlocked ? blockedReason : undefined,
      verificationOutput,
      proposalRaised,
      goalCompleted: updatedGoal.status === 'done'
    };
  }

  /**
   * 现场补充指导并在当前步骤重试 (Retry with Guidance)
   */
  public async retryGoal(
    goalId: string,
    options?: { stepId?: string; guidance?: string }
  ): Promise<GoalAdvanceResult> {
    this.store.retryStep(goalId, options?.stepId);
    return this.advanceGoal(goalId, { stepId: options?.stepId, guidance: options?.guidance });
  }

  /**
   * 退回指定历史步骤返工 (Rollback to Step)
   */
  public async rollbackGoal(
    goalId: string,
    targetStepId: string,
    reason?: string
  ): Promise<{ success: boolean; goal?: Goal }> {
    const updated = this.store.rollbackStep(goalId, targetStepId, reason);
    return { success: !!updated, goal: updated };
  }
}
