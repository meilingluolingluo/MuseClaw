import fs from 'node:fs';
import type { LLMCaller, LLMMessage, ToolDefinition } from './loop.js';

export interface DeepSeekOptions {
  apiKey?: string;
  keyPath?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * 创建基于 DeepSeek 原生 Function Calling 的标准 LLMCaller
 */
export function createDeepSeekCaller(options?: DeepSeekOptions): LLMCaller {
  let apiKey = options?.apiKey || process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    const keyPath = options?.keyPath || '/home/mll/workspace/.envkey.local';
    try {
      if (fs.existsSync(keyPath)) {
        apiKey = fs.readFileSync(keyPath, 'utf-8').trim();
      }
    } catch {
      // 忽略文件读取错误
    }
  }

  if (!apiKey) {
    throw new Error('未找到 DEEPSEEK_API_KEY，请在环境变量配置或提供 key 文件。');
  }

  const baseUrl = options?.baseUrl || 'https://api.deepseek.com/chat/completions';
  const model = options?.model || 'deepseek-chat';

  return async (messages: LLMMessage[], tools: ToolDefinition[]) => {
    // 转换为 OpenAI 兼容格式
    const formattedTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: m.tool_call_id,
            content: m.content || ''
          };
        }
        if (m.role === 'assistant' && m.tool_calls) {
          return {
            role: 'assistant',
            content: m.content || '',
            tool_calls: m.tool_calls.map((c) => ({
              id: c.id,
              type: 'function',
              function: c.function
            }))
          };
        }
        return {
          role: m.role,
          content: m.content || ''
        };
      })
    };

    if (formattedTools.length > 0) {
      body.tools = formattedTools;
    }

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepSeek API 请求失败 [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0]?.message;

    if (!choice) {
      return { content: '' };
    }

    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    if (choice.tool_calls && Array.isArray(choice.tool_calls)) {
      for (const call of choice.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments || '{}');
        } catch {
          parsedArgs = { raw: call.function.arguments };
        }
        toolCalls.push({
          id: call.id,
          name: call.function.name,
          args: parsedArgs
        });
      }
    }

    return {
      content: choice.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  };
}
