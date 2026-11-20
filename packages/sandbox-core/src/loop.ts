import type { MuseEvent, TrajectoryStep, ApprovalRequest, AgentProfile } from '@museclaw/protocol';
import { defaultVault } from './vault.ts';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface SentinelHook {
  evaluateToolCall: (
    name: string,
    args: Record<string, unknown>,
    context?: { approval_level?: string; botId?: string; sessionId?: string; isTainted?: boolean }
  ) => {
    isDangerous: boolean;
    reason?: string;
    isTaintedEgress?: boolean;
    channelLadder?: { channel: any; rung: number; reason?: string };
  };
  waitForApproval: (request: ApprovalRequest) => Promise<boolean>;
  isSessionTainted?: (sessionId?: string) => boolean;
  taintSession?: (sessionId: string, reason?: string) => void;
  untaintSession?: (sessionId: string) => void;
  isTaintSource?: (
    name: string,
    args: Record<string, unknown>,
    output?: unknown
  ) => { isSource: boolean; reason?: string };
  isEgressAction?: (name: string, args: Record<string, unknown>) => { isEgress: boolean; target?: string };
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export type LLMCaller = (
  messages: LLMMessage[],
  tools: ToolDefinition[],
  onChunk?: (delta: string) => void
) => Promise<{
  content: string;
  reasoning_content?: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}>;

/**
 * Thin-Core Agent Loop
 * 核心极简状态机：思考 -> Sentinel 门禁 -> 执行 -> 观察 -> 轨迹留存
 */
export async function* runAgentLoop(
  systemPrompt: string,
  userGoal: string,
  tools: ToolDefinition[],
  sentinel: SentinelHook,
  callLLM: LLMCaller,
  context: {
    sessionId: string;
    userId: string;
    botId: string;
    maxSteps?: number;
    profile?: AgentProfile;
    isTainted?: boolean;
  }
): AsyncGenerator<MuseEvent, TrajectoryStep[], void> {
  const trajectory: TrajectoryStep[] = [];

  // 0. 追踪会话污点状态 (Taint Tracking)
  let isTainted = context.isTainted || sentinel.isSessionTainted?.(context.sessionId) || false;

  // 1. 按 profile 注入 system_prompt 与 memory_ns / memory
  let effectivePrompt = context.profile?.system_prompt || context.profile?.systemPrompt || systemPrompt;
  if (context.profile?.memory) {
    effectivePrompt += `\n\n[Bot Memory & Preferences]:\n${context.profile.memory}`;
  } else if (context.profile?.memory_ns) {
    effectivePrompt += `\n[Memory Workspace: ${context.profile.memory_ns}]`;
  }

  // 2. 按 profile 过滤 tool_allowlist
  let effectiveTools = tools;
  const allowlist = context.profile?.tool_allowlist || context.profile?.defaultTools;
  if (allowlist && allowlist.length > 0 && !allowlist.includes('*')) {
    effectiveTools = tools.filter((t) => allowlist.includes(t.name));
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: effectivePrompt },
    { role: 'user', content: userGoal }
  ];

  const maxSteps = context.maxSteps ?? 10;
  let step = 0;

  // Loop Guard 循环守卫：防无意义重复动作与连续相同报错停滞
  let lastActionSig = '';
  let sameActionCount = 0;
  let lastErrorSig = '';
  let sameErrorCount = 0;
  let isLoopGuarded = false;

  yield { type: 'agent:state', botId: context.botId, bot_id: context.botId, session_id: context.sessionId, state: 'running' };

  while (step < maxSteps) {
    if (isLoopGuarded) break;
    step++;

    // 3. 调用大模型进行下一步推理 (支持真流式 SSE 逐 token 实时推送)
    const chunkQueue: string[] = [];
    let notifyChunk: (() => void) | null = null;
    let isFinished = false;
    let callerError: any = null;
    let streamedChunkCount = 0;

    const onDelta = (delta: string) => {
      if (!delta) return;
      chunkQueue.push(delta);
      if (notifyChunk) {
        notifyChunk();
        notifyChunk = null;
      }
    };

    const callPromise = callLLM(messages, effectiveTools, onDelta)
      .then((res) => {
        isFinished = true;
        if (notifyChunk) {
          notifyChunk();
          notifyChunk = null;
        }
        return res;
      })
      .catch((err) => {
        callerError = err;
        isFinished = true;
        if (notifyChunk) {
          notifyChunk();
          notifyChunk = null;
        }
      });

    while (!isFinished || chunkQueue.length > 0) {
      if (chunkQueue.length > 0) {
        const text = chunkQueue.shift()!;
        streamedChunkCount++;
        yield { type: 'stream:text-delta', text, bot_id: context.botId, session_id: context.sessionId };
      } else if (!isFinished) {
        await new Promise<void>((resolve) => {
          notifyChunk = resolve;
        });
      }
    }

    if (callerError) {
      throw callerError;
    }

    const response = await callPromise;
    if (!response) {
      break;
    }

    // 若底座模型未接入流式回调，保底产出完整内容
    if (response.content && streamedChunkCount === 0) {
      yield { type: 'stream:text-delta', text: response.content, bot_id: context.botId, session_id: context.sessionId };
    }

    // 没有工具调用，说明任务思考结束或直接回答完毕
    if (!response.toolCalls || response.toolCalls.length === 0) {
      trajectory.push({
        stepIndex: step,
        role: 'assistant',
        thought: response.content
      });
      break;
    }

    // 4. 遍历并执行工具调用
    for (const call of response.toolCalls) {
      const toolDef = effectiveTools.find((t) => t.name === call.name);
      if (!toolDef) {
        throw new Error(`Tool not found or not permitted: ${call.name}`);
      }

      // Loop Guard 检查 A: 防连续重复动作
      const actionSig = `${call.name}:${JSON.stringify(call.args)}`;
      if (actionSig === lastActionSig) {
        sameActionCount++;
      } else {
        lastActionSig = actionSig;
        sameActionCount = 1;
      }

      if (sameActionCount >= 3) {
        const guardMsg = `[Loop Guard: 检测到连续 3 次重复调用相同动作 (${call.name})，已触发自动熔断保护算力]`;
        yield { type: 'stream:text-delta', text: `\n${guardMsg}`, bot_id: context.botId, session_id: context.sessionId };
        isLoopGuarded = true;
        break;
      }

      yield { type: 'tool:call_start', toolName: call.name, input: call.args, bot_id: context.botId, session_id: context.sessionId };

      // 5. Sentinel 确定性安全拦截门禁 (支持 Bot 差异化审批级别与双向污点外发阻断)
      const check = sentinel.evaluateToolCall(call.name, call.args, {
        approval_level: context.profile?.approval_level,
        botId: context.botId,
        sessionId: context.sessionId,
        isTainted
      });
      if (check.isDangerous) {
        const approvalId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const approvalReq: ApprovalRequest = {
          approvalId,
          approval_id: approvalId,
          sessionId: context.sessionId,
          session_id: context.sessionId,
          botId: context.botId,
          bot_id: context.botId,
          userId: context.userId,
          user_id: context.userId,
          riskLevel: 'high_risk',
          isTainted,
          channelLadder: check.channelLadder,
          actionSummary: `准备执行高危操作: ${call.name} (${check.reason || '可能导致数据修改或外部影响'})`,
          targetDetails: { parameters: call.args, command: call.args.command ? String(call.args.command) : undefined },
          status: 'pending',
          requestedAt: Date.now()
        };

        yield { type: 'sentinel:approval_needed', request: approvalReq, bot_id: context.botId, session_id: context.sessionId };
        yield { type: 'agent:state', botId: context.botId, bot_id: context.botId, session_id: context.sessionId, state: 'paused' };

        // 挂起等待人类通过 Web 或企微/飞书进行确认
        const approved = await sentinel.waitForApproval(approvalReq);
        if (!approved) {
          yield { type: 'tool:call_end', toolName: call.name, output: '操作已被用户或管理员拒绝', durationMs: 0, bot_id: context.botId, session_id: context.sessionId };
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: 'User rejected the action' })
          });
          continue;
        }

        yield { type: 'agent:state', botId: context.botId, bot_id: context.botId, session_id: context.sessionId, state: 'running' };
      }

      // 6. 执行具体工具 (自动还原 {{vault:KEY}} 凭据占位符)
      const startTime = Date.now();
      let output: unknown;
      try {
        const resolvedArgs = defaultVault.resolve(call.args);
        output = await toolDef.execute(resolvedArgs);
      } catch (err: unknown) {
        output = { error: err instanceof Error ? err.message : String(err) };
      }
      const durationMs = Date.now() - startTime;

      // 工具输出全局脱敏 (Redact): 杜绝敏感 Key / Secret 在日志或前端泄露
      const rawOutputStr = typeof output === 'string' ? output : JSON.stringify(output);
      const redactedOutputStr = defaultVault.redact(rawOutputStr);
      let sanitizedOutput: unknown = output;
      try {
        sanitizedOutput = typeof output === 'string' ? redactedOutputStr : JSON.parse(redactedOutputStr);
      } catch {
        sanitizedOutput = redactedOutputStr;
      }

      yield { type: 'tool:call_end', toolName: call.name, output: sanitizedOutput, durationMs, bot_id: context.botId, session_id: context.sessionId };

      // 7. 动态污点识别：检查当前工具是否为污点源 (Taint Source)
      // 若读取了敏感文件、内网数据库或凭据，立即将当前会话置为受污染 (Tainted) 状态
      const taintCheck = sentinel.isTaintSource?.(call.name, call.args, output);
      if (taintCheck?.isSource) {
        const taintReason = taintCheck.reason || `调用了敏感数据源 [${call.name}]`;
        isTainted = true;
        sentinel.taintSession?.(context.sessionId, taintReason);
        yield {
          type: 'sentinel:taint_updated',
          sessionId: context.sessionId,
          session_id: context.sessionId,
          isTainted: true,
          reason: taintReason,
          bot_id: context.botId
        };
      }

      // Loop Guard 检查 B: 防连续相同错误导致无进展停滞
      const outputStr = defaultVault.redact(typeof output === 'string' ? output : JSON.stringify(output));
      const isError = Boolean((output as any)?.error || (output as any)?.exitCode !== 0);
      if (isError) {
        const errDetail = (output as any)?.error || (output as any)?.stderr || outputStr;
        const errorSig = `${call.name}:${(output as any)?.exitCode ?? 1}:${String(errDetail).trim()}`;
        if (errorSig === lastErrorSig) {
          sameErrorCount++;
        } else {
          lastErrorSig = errorSig;
          sameErrorCount = 1;
        }

        if (sameErrorCount >= 2) {
          const guardMsg = `[Loop Guard: 检测到工具调用连续出现相同错误，任务已停滞，已自动中断熔断]`;
          yield { type: 'stream:text-delta', text: `\n${guardMsg}`, bot_id: context.botId, session_id: context.sessionId };
          isLoopGuarded = true;
          break;
        }
      } else {
        sameErrorCount = 0;
        lastErrorSig = '';
      }

      // 7. 记录执行结果并注入上下文
      messages.push({
        role: 'assistant',
        content: response.content,
        reasoning_content: response.reasoning_content ?? '',
        tool_calls: [{ id: call.id, function: { name: call.name, arguments: JSON.stringify(call.args) } }]
      });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof output === 'string' ? output : JSON.stringify(output)
      });

      // 8. 记录轨迹 (用于后续微调数据集沉淀)
      trajectory.push({
        stepIndex: step,
        role: 'tool',
        toolCalls: [{ name: call.name, args: call.args }],
        observation: output
      });
    }
  }

  yield { type: 'agent:state', botId: context.botId, bot_id: context.botId, session_id: context.sessionId, state: 'idle' };
  return trajectory;
}
