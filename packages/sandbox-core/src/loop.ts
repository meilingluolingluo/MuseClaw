import type { MuseEvent, TrajectoryStep, ApprovalRequest } from '@museclaw/protocol';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface SentinelHook {
  evaluateToolCall: (name: string, args: Record<string, unknown>) => {
    isDangerous: boolean;
    reason?: string;
  };
  waitForApproval: (request: ApprovalRequest) => Promise<boolean>;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export type LLMCaller = (messages: LLMMessage[], tools: ToolDefinition[]) => Promise<{
  content: string;
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
  context: { sessionId: string; userId: string; botId: string; maxSteps?: number }
): AsyncGenerator<MuseEvent, TrajectoryStep[], void> {
  const trajectory: TrajectoryStep[] = [];
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userGoal }
  ];

  const maxSteps = context.maxSteps ?? 10;
  let step = 0;

  yield { type: 'agent:state', botId: context.botId, state: 'running' };

  while (step < maxSteps) {
    step++;

    // 1. 调用大模型进行下一步推理
    const response = await callLLM(messages, tools);

    if (response.content) {
      yield { type: 'stream:text-delta', text: response.content };
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

    // 2. 遍历并执行工具调用
    for (const call of response.toolCalls) {
      const toolDef = tools.find((t) => t.name === call.name);
      if (!toolDef) {
        throw new Error(`Tool not found: ${call.name}`);
      }

      yield { type: 'tool:call_start', toolName: call.name, input: call.args };

      // 3. Sentinel 确定性安全拦截门禁
      const check = sentinel.evaluateToolCall(call.name, call.args);
      if (check.isDangerous) {
        const approvalReq: ApprovalRequest = {
          approvalId: `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          sessionId: context.sessionId,
          botId: context.botId,
          userId: context.userId,
          riskLevel: 'high_risk',
          actionSummary: `准备执行高危操作: ${call.name} (${check.reason || '可能导致数据修改或外部影响'})`,
          targetDetails: { parameters: call.args },
          status: 'pending',
          requestedAt: Date.now()
        };

        yield { type: 'sentinel:approval_needed', request: approvalReq };
        yield { type: 'agent:state', botId: context.botId, state: 'paused' };

        // 挂起等待人类通过 Web 或企微/飞书进行确认
        const approved = await sentinel.waitForApproval(approvalReq);
        if (!approved) {
          yield { type: 'tool:call_end', toolName: call.name, output: '操作已被用户或管理员拒绝', durationMs: 0 };
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: 'User rejected the action' })
          });
          continue;
        }

        yield { type: 'agent:state', botId: context.botId, state: 'running' };
      }

      // 4. 执行具体工具
      const startTime = Date.now();
      let output: unknown;
      try {
        output = await toolDef.execute(call.args);
      } catch (err: unknown) {
        output = { error: err instanceof Error ? err.message : String(err) };
      }
      const durationMs = Date.now() - startTime;

      yield { type: 'tool:call_end', toolName: call.name, output, durationMs };

      // 5. 记录执行结果并注入上下文
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: [{ id: call.id, function: { name: call.name, arguments: JSON.stringify(call.args) } }]
      });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof output === 'string' ? output : JSON.stringify(output)
      });

      // 6. 记录轨迹 (用于后续微调数据集沉淀)
      trajectory.push({
        stepIndex: step,
        role: 'tool',
        toolCalls: [{ name: call.name, args: call.args }],
        observation: output
      });
    }
  }

  yield { type: 'agent:state', botId: context.botId, state: 'idle' };
  return trajectory;
}
