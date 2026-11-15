import type { GoalStore } from './store.ts';
import type { Goal, GoalStep, GoalAdvanceResult } from './types.ts';
import { computeNextCheckIn } from './cadence.ts';
import { runAgentLoop, type ToolDefinition, type LLMCaller } from '../../../packages/sandbox-core/src/loop.ts';
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

  constructor(options: GoalEngineOptions) {
    this.options = options;
    this.store = options.store;
    this.sentinel = options.sentinel;
    this.tools = options.tools;
    this.callLLM = options.callLLM;
    this.botRegistry = options.botRegistry;
    this.botMemory = options.botMemory;
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
   * 针对指定目标，向前推进当前执行步骤
   */
  public async advanceGoal(
    goalId: string,
    override?: { stepId?: string; mockOutput?: string }
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
        blockedReason: '存在等待用户审批的计划修订提案 (Pending Proposal)，需先审批',
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
      // 所有步骤均已完成，将目标置为 done
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
      isBlocked = output.includes('[BLOCKED]');
      if (isBlocked) {
        blockedReason = output.replace(/.*\[BLOCKED\]\s*/, '').trim() || '执行被阻塞';
      }
    } else {
      // 组装 Bot 设定与 Agent Loop 上下文
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
        bot = { ...bot, memory: this.botMemory.getMemory(bot.id) };
      }

      const prompt = `【长周期目标自驱推进任务】
目标名称: ${goal.title}
目标描述: ${goal.description}
当前执行步骤: [${activeStep.id}] ${activeStep.title}
步骤详情与预期: ${activeStep.description || activeStep.title}
完整步骤链条:
${goal.steps.map((s) => `- [${s.status}] ${s.id}: ${s.title}`).join('\n')}

执行要求：
1. 专注完成当前步骤的具体要求；
2. 完成时明确输出阶段性成果总结；
3. 若遭遇外部依赖缺失、权限不足或客观环境阻碍，请在输出中包含 "[BLOCKED]" 并详细说明阻塞原因，同时给出建议的后续步骤修订方案。`;

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

      isBlocked = output.includes('[BLOCKED]');
      if (isBlocked) {
        blockedReason = output.replace(/.*\[BLOCKED\]\s*/, '').trim() || '执行被阻塞';
      }
    }

    let proposalRaised = false;

    if (isBlocked) {
      // 标记当前步骤为 blocked
      this.store.advanceStep(goalId, activeStep.id, 'blocked', { blockedReason });

      // 提取后续步骤提议或自动生成修订提案（严禁静默乱改原有规划）
      const remainingSteps = goal.steps.filter((s) => s.id !== activeStep!.id && s.status !== 'done');
      const proposedSteps: GoalStep[] = [
        ...goal.steps.filter((s) => s.status === 'done'),
        {
          id: `${activeStep.id}_unblock`,
          title: `解决阻碍: ${blockedReason.slice(0, 30)}`,
          description: `申请相应权限或修复环境依赖 (${blockedReason})`,
          status: 'pending',
          updatedAt: Date.now()
        },
        {
          ...activeStep,
          id: `${activeStep.id}_retry`,
          status: 'pending',
          blockedReason: undefined,
          updatedAt: Date.now()
        },
        ...remainingSteps
      ];

      this.store.proposeReplan(goalId, `步骤 [${activeStep.title}] 被阻塞: ${blockedReason}`, proposedSteps);
      proposalRaised = true;
    } else {
      // 成功推进并完成当前步骤
      this.store.advanceStep(goalId, activeStep.id, 'done', { result: output });
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
      proposalRaised,
      goalCompleted: updatedGoal.status === 'done'
    };
  }
}
