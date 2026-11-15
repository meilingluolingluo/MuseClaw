import type { SessionTrajectory } from '@museclaw/protocol';

/**
 * 将 MuseClaw 执行轨迹导出为标准 ShareGPT 格式（供 SFT / RL 微调使用）
 */
export function exportToShareGPT(trajectory: SessionTrajectory) {
  const conversations: Array<{ from: 'human' | 'gpt'; value: string }> = [];

  // 1. 用户初始目标
  conversations.push({
    from: 'human',
    value: trajectory.taskGoal
  });

  // 2. 依次映射 Agent 内部思考与工具交互
  for (const step of trajectory.steps) {
    if (step.thought) {
      conversations.push({
        from: 'gpt',
        value: `<thought>\n${step.thought}\n</thought>`
      });
    }

    if (step.toolCalls && step.toolCalls.length > 0) {
      const call = step.toolCalls[0];
      conversations.push({
        from: 'gpt',
        value: `<tool_call>\n{"name": "${call.name}", "arguments": ${JSON.stringify(call.args)}}\n</tool_call>`
      });

      if (step.observation) {
        conversations.push({
          from: 'human',
          value: `<tool_response>\n${typeof step.observation === 'string' ? step.observation : JSON.stringify(step.observation)}\n</tool_response>`
        });
      }
    }
  }

  return {
    id: trajectory.sessionId,
    botId: trajectory.botId,
    timestamp: trajectory.timestamp,
    is_successful: trajectory.isSuccessful,
    conversations
  };
}
