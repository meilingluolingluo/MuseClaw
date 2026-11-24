import type { MuseEvent, TrajectoryStep, ApprovalRequest, AgentProfile, WidgetPayload } from '@museclaw/protocol';
import { defaultVault } from './vault.ts';
import { keepNewestImages } from './vision.ts';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown>;
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

export type LLMContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export type LLMMessageContent = string | LLMContentPart[];

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: LLMMessageContent;
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
  userGoal: string | LLMMessageContent,
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
    skills?: Array<{ name: string; description: string; category?: string; channel?: string }>;
    historyMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string | LLMMessageContent }>;
    triggeredIntents?: Array<{ id: string; description: string }>;
  }
): AsyncGenerator<MuseEvent, TrajectoryStep[], void> {
  const trajectory: TrajectoryStep[] = [];

  // 0. 追踪会话污点状态 (Taint Tracking)
  let isTainted = context.isTainted || sentinel.isSessionTainted?.(context.sessionId) || false;

  // 1. 按 profile 注入 system_prompt 与 memory_ns / memory
  let effectivePrompt = context.profile?.system_prompt || context.profile?.systemPrompt || systemPrompt;
  if (context.profile?.memory) {
    effectivePrompt += `\n\n[Bot Memory & Preferences]:\n【系统受控长期记忆库 (Persistent Long-Term Memory)】\n以下内容来自系统为你与当前员工持久化存储的长期记忆事实、画像偏好与业务准则（来自 MEMORY.md，跨会话永久生效）。你已知晓并应直接遵循这些事实与偏好；若需检索细节或沉淀新事实，可调用 memory 工具：\n${context.profile.memory}`;
  } else if (context.profile?.memory_ns) {
    effectivePrompt += `\n[Memory Workspace: ${context.profile.memory_ns}]`;
  }

  // 1.1 动态注入当前 Bot 启用的技能清单索引 (Agent Skills Index)
  if (context.skills && context.skills.length > 0) {
    const skillsList = context.skills.map((s) => `- ${s.name} [${s.category || 'general'}]: ${s.description}`).join('\n');
    effectivePrompt += `\n\n[Available Skills (Agent 技能规程库)]:\n当用户需求与下列预置技能匹配时，第一步请调用 skills(action="use", name="<name>") 获取完整执行指导、配套脚本与步骤；在解决复杂业务后，亦可调用 skills(action="learn", ...) 自主学习沉淀到工坊，或 skills(action="save", ...) 创建新技能。\n${skillsList}`;
  }

  // 1.2 注入本轮命中的前瞻性事件意图提醒
  if (context.triggeredIntents && context.triggeredIntents.length > 0) {
    const intentLines = context.triggeredIntents.map((item) => `- (${item.id}) ${item.description}`).join('\n');
    effectivePrompt += `\n\n[Triggered Standing Intents (命中的前瞻事件提醒)]:\n用户当前发言命中了预先登记的事件提醒条件，请在本次回复中自然、明确地完成以下提醒或检查：\n${intentLines}`;
  }

  // 2. 按 profile 过滤 tool_allowlist
  let effectiveTools = tools;
  const allowlist = context.profile?.tool_allowlist || context.profile?.defaultTools;
  if (allowlist && allowlist.length > 0 && !allowlist.includes('*')) {
    effectiveTools = tools.filter((t) => allowlist.includes(t.name));
  }

  // 2.1 若当前员工可用 show_widget，补充智能交互界面引导
  if (effectiveTools.some((t) => t.name === 'show_widget')) {
    effectivePrompt +=
      '\n\n[Interactive UI (智能交互界面能力)]:\n当用户询问需要逐层拆解的结构/原理图、可调参数实时重算的计算器/清单、动态图表或交互式对比演示时，优先调用 show_widget 工具直接在对话流中生成自包含的交互式 HTML/SVG 组件（并使用宿主 CSS 变量 --om-bg / --om-surface / --om-surface-2 / --om-border / --om-fg / --om-muted / --om-accent 适配明暗主题，附带 fallback_text 摘要），再用简短文字做补充说明。';
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: effectivePrompt }
  ];

  // 2.1 注入多轮会话历史 (Multi-Turn History Messages)，保证上下文连贯与意图记忆
  if (Array.isArray(context.historyMessages) && context.historyMessages.length > 0) {
    for (const hm of context.historyMessages) {
      if (!hm || !hm.content) continue;
      messages.push({
        role: hm.role === 'assistant' ? 'assistant' : 'user',
        content: hm.content
      });
    }
  }

  // 注入本轮用户目标 / 最新指令
  messages.push({ role: 'user', content: userGoal });

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

    const callPromise = callLLM(keepNewestImages(messages, 2), effectiveTools, onDelta)
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

    // 4. 规范注入 Assistant 消息与工具声明（遵循 OpenAI/DeepSeek 协议要求 tool 前必有 assistant tool_calls）
    messages.push({
      role: 'assistant',
      content: response.content || '',
      reasoning_content: response.reasoning_content ?? '',
      tool_calls: response.toolCalls.map((c) => ({
        id: c.id,
        function: { name: c.name, arguments: JSON.stringify(c.args) }
      }))
    });

    // 5. 遍历并执行工具调用
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

      // 6. 执行具体工具 (自动还原 {{vault:KEY}} 凭据占位符，支持透传执行上下文)
      const startTime = Date.now();
      let output: unknown;
      try {
        const resolvedArgs = defaultVault.resolve(call.args);
        output = await toolDef.execute(resolvedArgs, context);
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

      if (
        call.name === 'show_widget' &&
        sanitizedOutput &&
        typeof sanitizedOutput === 'object' &&
        (sanitizedOutput as Record<string, unknown>).__widget
      ) {
        yield {
          type: 'ui:widget',
          widget: (sanitizedOutput as Record<string, unknown>).__widget as WidgetPayload,
          bot_id: context.botId,
          session_id: context.sessionId
        };
      }

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

      // 7. 记录具体工具执行结果并注入上下文
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

  // 9. 若执行到达最大步数且最后一条消息是工具执行结果（尚未产出最终结论），进行最后一轮无工具的纯文本总结输出
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === 'tool') {
    try {
      messages.push({
        role: 'user',
        content: '请根据前面所有工具的调用与数据排查结果，总结并输出完整的执行结论与建议。'
      });
      const finalResp = await callLLM(messages, []);
      if (finalResp?.content) {
        yield { type: 'stream:text-delta', text: `\n\n${finalResp.content}`, bot_id: context.botId, session_id: context.sessionId };
      }
    } catch {
      // 容错处理
    }
  }

  yield { type: 'agent:state', botId: context.botId, bot_id: context.botId, session_id: context.sessionId, state: 'idle' };
  return trajectory;
}
