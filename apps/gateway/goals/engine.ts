import type { GoalStore } from './store.ts';
import type { Goal, GoalStep, GoalArtifact, GoalAdvanceResult } from './types.ts';
import { computeNextCheckIn } from './cadence.ts';
import { runAgentLoop, type ToolDefinition, type LLMCaller } from '../../../packages/sandbox-core/src/loop.ts';
import { MicroSandbox } from '../../../packages/sandbox-core/src/micro-sandbox.ts';
import type { SentinelPolicyManager } from '../../sentinel/src/guard.ts';
import type { BotRegistry, BotMemoryManager, SessionStore } from '../bots/index.ts';
import type { Session, WidgetPayload } from '@museclaw/protocol';

export interface GoalEngineOptions {
  store: GoalStore;
  sentinel: SentinelPolicyManager;
  tools: ToolDefinition[];
  callLLM: LLMCaller;
  botRegistry?: BotRegistry;
  botMemory?: BotMemoryManager;
  sessionStore?: SessionStore;
  onGoalCheckInCompleted?: (result: GoalAdvanceResult, goal: Goal) => Promise<void>;
}

function clipGoalToolOutput(value: unknown, max = 2000): unknown {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text || text.length <= max) return value;
  return `${text.slice(0, max)}\n…（输出过长，已截断，共 ${text.length} 字符）`;
}

export class GoalEngine {
  private store: GoalStore;
  private sentinel: SentinelPolicyManager;
  private tools: ToolDefinition[];
  private callLLM: LLMCaller;
  private botRegistry?: BotRegistry;
  private botMemory?: BotMemoryManager;
  private sessionStore?: SessionStore;
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
    this.sessionStore = options.sessionStore;
    this.sandbox = new MicroSandbox({ workspaceDir: process.cwd() });
  }

  /**
   * 为目标获取或自动新建专属旁聊会话，并将 sessionId 绑定到目标记录
   */
  private ensureGoalSession(goal: Goal): { session: Session; userId: string } | undefined {
    if (!this.sessionStore) return undefined;
    const userId = goal.userId || 'user_web';
    const botId = goal.botId || 'muse';
    const targetSessionId = goal.sessionId || `sess_goal_${goal.id}`;

    let session = this.sessionStore.get(targetSessionId, userId);
    if (!session) {
      session = this.sessionStore.create(
        targetSessionId,
        botId,
        `[目标] ${goal.title.slice(0, 24)}`,
        userId,
        'side'
      );
    }
    if (goal.sessionId !== session.id) {
      this.store.bindSession(goal.id, session.id);
    }
    return { session, userId };
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
      if ((goal.mode || 'delivery') === 'portfolio' && goal.steps.length === 0) {
        return {
          goalId,
          status: 'done',
          goalCompleted: false,
          output: '沉淀型目标无待办步骤，可继续追加成果或归档总结'
        };
      }
      goal.status = 'done';
      goal.updatedAt = Date.now();
      this.store.save();
      return { goalId, status: 'done', goalCompleted: true, output: '目标所有步骤均已完成' };
    }

    // 若步骤归属人工确认且未传入人工补充输入，安全停机等待人工介入
    if (activeStep.owner === 'human' && !override?.guidance && override?.mockOutput === undefined) {
      if (activeStep.status !== 'in_progress') {
        activeStep.status = 'in_progress';
        activeStep.updatedAt = Date.now();
        this.store.save();
      }
      return {
        goalId,
        stepId: activeStep.id,
        stepTitle: activeStep.title,
        status: 'in_progress',
        awaitingHuman: true,
        output: `步骤 [${activeStep.title}] 需要人工确认或补充输入`
      };
    }

    // 确保目标拥有专属旁聊会话，用于承载上下文与执行过程
    const boundSession = this.ensureGoalSession(goal);
    const turnStartedAt = Date.now();
    const userMsgId = `msg_goal_u_${turnStartedAt}_${Math.random().toString(36).slice(2, 6)}`;
    const assistantMsgId = `msg_goal_a_${turnStartedAt}_${Math.random().toString(36).slice(2, 6)}`;

    // 步骤置为 in_progress
    activeStep.status = 'in_progress';
    activeStep.updatedAt = turnStartedAt;
    this.store.save();

    const triggerSummary = `【目标推进 · 步骤 ${activeStep.idx}】${activeStep.title}${
      override?.guidance ? `\n补充指引：${override.guidance}` : ''
    }`;
    const priorMessages = boundSession ? [...(boundSession.session.messages || [])] : [];
    if (boundSession) {
      if (!boundSession.session.messages) boundSession.session.messages = [];
      boundSession.session.messages.push({
        id: userMsgId,
        timestamp: turnStartedAt,
        role: 'user',
        content: triggerSummary
      });
      this.sessionStore?.save(boundSession.session, boundSession.userId);
    }

    const artifactCountBefore = (this.store.get(goalId)?.artifacts || []).length;

    let output = '';
    let reasoningText = '';
    const toolCalls: any[] = [];
    const widgets: WidgetPayload[] = [];
    let isBlocked = false;
    let blockedReason = '';

    if (override?.mockOutput !== undefined) {
      output = override.mockOutput;
      const blockMatch = output.match(/(?:^|\n)\s*\[BLOCKED\]:?\s*([^\n]+)/);
      isBlocked = !!blockMatch;
      if (isBlocked) {
        blockedReason = blockMatch[1].trim().slice(0, 300) || '执行被阻塞';
      }
    } else {
      const executorBotId = activeStep.assigneeBotId || goal.botId;
      let bot = this.botRegistry?.get(executorBotId);
      if (!bot) {
        bot = {
          id: executorBotId,
          name: executorBotId,
          system_prompt: '你是一个专注推进目标落地与交付的数字员工。',
          tool_allowlist: ['*'],
          memory_ns: `bots/${executorBotId}`,
          enabled: true,
          created_at: Date.now(),
          updated_at: Date.now()
        };
      }

      if (this.botMemory) {
        bot = { ...bot, memory: this.botMemory.getMemory(bot.id, goal.userId) };
      }

      const recentDone = goal.steps
        .filter((s) => s.status === 'done' && (s.note || s.result))
        .slice(-3)
        .map((s) => `- ${s.title}: ${(s.note || s.result || '').slice(0, 160)}`);
      const artifactList = (goal.artifacts || []).slice(-6).map((a) => `- [${a.kind}] ${a.title}${a.ref ? ` (${a.ref})` : ''}`);

      const modeLabel = goal.mode === 'watch' ? '追踪观察' : goal.mode === 'portfolio' ? '长期沉淀' : '阶段交付';
      let prompt = `【目标自驱推进任务 (${modeLabel})】
目标名称: ${goal.title}
目标描述: ${goal.description}`;
      if (goal.successCriteria) {
        prompt += `\n终局验收标准: ${goal.successCriteria}`;
      }
      if (goal.metric) {
        prompt += `\n量化指标: ${goal.metric.label} (当前 ${goal.metric.current} -> 目标 ${goal.metric.target}${goal.metric.unit ? ` ${goal.metric.unit}` : ''})`;
      }
      prompt += `\n当前执行步骤: [${activeStep.id}] ${activeStep.title}
步骤详情与预期: ${activeStep.description || activeStep.title}
完整步骤链条:
${goal.steps.map((s) => `- [${s.status}${s.owner === 'human' ? '/人工' : ''}] ${s.id}: ${s.title}${s.verificationCommand ? ` (需通过验收脚本: ${s.verificationCommand})` : ''}`).join('\n')}`;

      if (recentDone.length > 0) {
        prompt += `\n\n已完成阶段摘要:\n${recentDone.join('\n')}`;
      }
      if (artifactList.length > 0) {
        prompt += `\n\n已沉淀成果清单:\n${artifactList.join('\n')}`;
      }
      if (override?.guidance) {
        prompt += `\n\n【用户人工补充指引 / 修正要求】:\n${override.guidance}`;
      }

      prompt += `\n\n执行要求：
1. 专注完成当前步骤的具体要求，产出可验证的实际结果（如有结构化报告、文档或文件产出，请调用 goals 工具 add_artifact 登记成果并传入 artifact_content）；
2. 完成时明确输出阶段性成果总结；
3. 若遭遇外部依赖缺失、权限不足或客观环境阻碍确实无法继续，请在输出单独一行中以 "[BLOCKED]: 具体卡点原因" 开头，并说明阻塞原因与建议调整方案。正常未受阻时切勿以 [BLOCKED] 开头。`;

      const historyMessages = priorMessages
        .slice(-12)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: (m.content || '').slice(0, 3000)
        }))
        .filter((m) => m.content.length > 0);

      const sessionId = boundSession?.session.id || `goal_${goal.id}_${activeStep.id}_${Date.now()}`;
      const loop = runAgentLoop(
        bot.system_prompt,
        prompt,
        this.tools,
        this.sentinel,
        this.callLLM,
        {
          sessionId,
          userId: goal.userId,
          botId: executorBotId,
          profile: bot,
          historyMessages,
          maxSteps: 6
        }
      );

      for await (const event of loop) {
        if (event.type === 'stream:text-delta') {
          output += event.text;
        }
        if ((event as any).type === 'stream:reasoning-delta') {
          reasoningText += (event as any).text || '';
        }
        if (event.type === 'ui:widget' && event.widget) {
          const existingIdx = widgets.findIndex((w) => w.id === event.widget.id);
          if (existingIdx >= 0) {
            widgets[existingIdx] = event.widget;
          } else {
            widgets.push(event.widget);
          }
        }
        if (event.type === 'tool:call_start') {
          toolCalls.push({
            tool: event.toolName,
            params: event.input,
            status: 'running',
            startedAt: Date.now()
          });
        }
        if (event.type === 'tool:call_end') {
          const running = [...toolCalls]
            .reverse()
            .find((t) => t.tool === event.toolName && t.status === 'running');
          if (running) {
            const rejected = String(event.output || '').includes('拒绝');
            let isError = rejected;
            if (typeof event.output === 'object' && event.output !== null) {
              const outObj = event.output as any;
              if (outObj.error || (outObj.exitCode !== undefined && outObj.exitCode !== 0)) {
                isError = true;
              }
            }
            running.status = isError ? (rejected ? 'rejected' : 'failed') : 'done';
            running.ok = !isError;
            running.durationMs = event.durationMs || 0;
            running.result = clipGoalToolOutput(event.output);
          }
        }
      }

      const blockMatch = output.match(/(?:^|\n)\s*\[BLOCKED\]:?\s*([^\n]+)/);
      isBlocked = !!blockMatch;
      if (isBlocked) {
        blockedReason = blockMatch[1].trim().slice(0, 300) || '执行被阻塞';
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
    let createdArtifact: GoalArtifact | undefined;

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

      // 若步骤顺利完成且执行过程未主动登记新工件，将本步骤产出自动归档至工件目录
      const currentArtifacts = this.store.get(goalId)?.artifacts || [];
      if (currentArtifacts.length <= artifactCountBefore && output.trim().length > 0) {
        const autoSummary = output
          .trim()
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 2)
          .join(' ')
          .slice(0, 180);
        const afterArtGoal = this.store.addArtifact(goalId, {
          title: `${activeStep.title}（阶段成果）`,
          kind: 'report',
          summary: autoSummary,
          content: output.trim(),
          stepId: activeStep.id
        });
        createdArtifact = afterArtGoal?.artifacts?.[afterArtGoal.artifacts.length - 1];
      } else if (currentArtifacts.length > artifactCountBefore) {
        createdArtifact = currentArtifacts[currentArtifacts.length - 1];
      }
    }

    // 将执行过程与产物链接完整持久化至目标绑定的旁聊会话
    if (boundSession) {
      const turnFinishedAt = Date.now();
      for (const tc of toolCalls) {
        if (tc.status === 'running') {
          tc.status = 'done';
          tc.durationMs = tc.durationMs || Math.max(0, turnFinishedAt - (Number(tc.startedAt) || turnFinishedAt));
        }
      }
      let assistantContent = isBlocked
        ? `⚠️ **步骤 [${activeStep.title}] 执行受阻**：${blockedReason}${output ? `\n\n${output}` : ''}`
        : output || `已完成步骤 [${activeStep.title}]。`;
      if (createdArtifact?.url) {
        assistantContent += `\n\n---\n📦 **已归档交付工件**：[${createdArtifact.title}](${createdArtifact.url})`;
      }
      boundSession.session.messages.push({
        id: assistantMsgId,
        timestamp: turnFinishedAt,
        durationMs: Math.max(0, turnFinishedAt - turnStartedAt),
        role: 'assistant',
        content: assistantContent,
        ...(reasoningText.trim() ? { reasoning: reasoningText.trim() } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(widgets.length > 0 ? { widgets } : {})
      });
      this.sessionStore?.save(boundSession.session, boundSession.userId);
    }

    // 更新 Check-in 时钟与下次巡检时间
    const updatedGoal = this.store.get(goalId)!;
    updatedGoal.lastCheckInAt = Date.now();
    updatedGoal.nextCheckInAt = updatedGoal.cadence ? computeNextCheckIn(updatedGoal.cadence) : 0;
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
      goalCompleted: updatedGoal.status === 'done',
      sessionId: boundSession?.session.id,
      artifact: createdArtifact
    };
  }

  /**
   * 连续多轮自驱推进目标，直到达成、遇到人工步骤、阻塞或达到轮次上限
   */
  public async runGoal(
    goalId: string,
    options?: { maxRounds?: number; guidance?: string; mockOutputs?: string[] }
  ): Promise<GoalAdvanceResult> {
    const maxRounds = Math.min(Math.max(options?.maxRounds ?? 4, 1), 8);
    let lastResult: GoalAdvanceResult = { goalId, status: 'blocked', blockedReason: '未执行任何轮次' };
    let roundsExecuted = 0;
    let stoppedReason = 'max_rounds';

    for (let i = 0; i < maxRounds; i++) {
      const mockOutput = options?.mockOutputs ? options.mockOutputs[i] : undefined;
      const res = await this.advanceGoal(goalId, {
        guidance: i === 0 ? options?.guidance : undefined,
        mockOutput
      });
      roundsExecuted += 1;
      lastResult = res;

      if (res.goalCompleted) {
        stoppedReason = 'goal_completed';
        break;
      }
      if (res.awaitingHuman) {
        stoppedReason = 'awaiting_human';
        break;
      }
      if (res.status === 'blocked' || res.proposalRaised) {
        stoppedReason = 'blocked';
        break;
      }
      if (res.status !== 'done') {
        stoppedReason = 'no_progress';
        break;
      }
    }

    return {
      ...lastResult,
      roundsExecuted,
      stoppedReason
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
