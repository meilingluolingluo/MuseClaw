import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LLMCaller, LLMMessage, ToolDefinition } from './loop.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { testLocalAgent } from './local-agent-runner.ts';

export interface ModelProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  candidateModels?: string[];
  enabled?: boolean;
  isCustom?: boolean;
  isLocalAgent?: boolean;
  installed?: boolean;
  version?: string;
  executablePath?: string;
  protocol?: string;
  description?: string;
}

export interface DeepSeekOptions {
  apiKey?: string;
  keyPath?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * 标准化 OpenAI Chat Completions 端点路径
 */
export function normalizeChatCompletionsUrl(url: string): string {
  const clean = url.trim().replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) {
    return clean;
  }
  if (clean.endsWith('/v1')) {
    return `${clean}/chat/completions`;
  }
  // 如果是 Ollama 基础端口且未带 /v1
  if (clean.includes(':11434') && !clean.includes('/v1')) {
    return `${clean}/v1/chat/completions`;
  }
  return `${clean}/chat/completions`;
}

/**
 * 探测环境凭证 fallback (优先环境变量与本地 .env / .env.local)
 */
export function resolveApiKey(explicitKey?: string, providerId?: string): string {
  if (explicitKey && explicitKey.trim()) {
    return explicitKey.trim();
  }

  // 针对特定 Provider 的专用环境变量检查
  if (providerId === 'deepseek' && process.env.DEEPSEEK_API_KEY) {
    return process.env.DEEPSEEK_API_KEY.trim();
  }
  if (providerId === 'openai' && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY.trim();
  }
  if (providerId === 'siliconflow' && process.env.SILICONFLOW_API_KEY) {
    return process.env.SILICONFLOW_API_KEY.trim();
  }
  if (providerId === 'moonshot' && process.env.MOONSHOT_API_KEY) {
    return process.env.MOONSHOT_API_KEY.trim();
  }

  // 本地 Ollama 默认不需要实际 Key
  if (providerId === 'ollama') {
    return 'ollama';
  }

  // 兜底扫描常见候选本地文件
  const candidatePaths = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../../.env.local'),
    path.resolve(__dirname, '../../../.env'),
    '/home/mll/workspace/.envkey.local'
  ];

  for (const keyPath of candidatePaths) {
    try {
      if (fs.existsSync(keyPath)) {
        const raw = fs.readFileSync(keyPath, 'utf-8').trim();
        if (providerId === 'deepseek') {
          if (raw.startsWith('sk-') && !raw.includes('=')) {
            return raw;
          }
          const match = raw.match(/DEEPSEEK_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
          if (match && match[1]) return match[1].trim();
        }
        if (providerId === 'openai') {
          const match = raw.match(/OPENAI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
          if (match && match[1]) return match[1].trim();
        }
      }
    } catch {
      // 继续探测后续候选路径
    }
  }

  return '';
}

/**
 * 创建通用 OpenAI 兼容协议 LLMCaller (通吃 DeepSeek, OpenAI, Ollama, Kimi, Qwen, SiliconFlow 等)
 */
export function createOpenAICompatibleCaller(config: ModelProviderConfig): LLMCaller {
  const targetUrl = normalizeChatCompletionsUrl(config.baseUrl);
  const modelName = config.model;

  return async (messages: LLMMessage[], tools: ToolDefinition[], onChunk?: (delta: string) => void) => {
    const effectiveKey = resolveApiKey(config.apiKey, config.id);

    // 格式化 Function Calling 工具集
    const formattedTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const body: Record<string, unknown> = {
      model: modelName,
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

    if (onChunk) {
      body.stream = true;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (effectiveKey) {
      const cleanKey = effectiveKey.replace(/[^\x00-\x7F]/g, '').trim();
      if (cleanKey) {
        headers.Authorization = `Bearer ${cleanKey}`;
      }
    }

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[${config.name || config.id}] API 请求失败 (HTTP ${res.status}): ${errText}`);
    }

    if (onChunk && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedContent = '';
      const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const choice = data.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (delta?.content) {
                accumulatedContent += delta.content;
                onChunk(delta.content);
              }

              if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const existing = toolCallMap.get(idx) || { id: tc.id || '', name: tc.function?.name || '', args: '' };
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                  toolCallMap.set(idx, existing);
                }
              }
            } catch {
              // 容错处理
            }
          }
        }
      }

      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
      for (const item of toolCallMap.values()) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(item.args || '{}');
        } catch {
          parsedArgs = { raw: item.args };
        }
        toolCalls.push({
          id: item.id || `call_${Date.now()}`,
          name: item.name,
          args: parsedArgs
        });
      }

      return {
        content: accumulatedContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      };
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

/**
 * 测试模型服务连通性探针 (Ping / Test Connection)
 */
export async function testProviderConnection(config: ModelProviderConfig): Promise<{
  ok: boolean;
  latencyMs: number;
  model?: string;
  error?: string;
}> {
  if (config.isLocalAgent || ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(config.id)) {
    const res = await testLocalAgent(config.id);
    return {
      ok: res.ok,
      latencyMs: res.latencyMs,
      model: res.version || config.model,
      error: res.error
    };
  }

  const start = Date.now();
  const targetUrl = normalizeChatCompletionsUrl(config.baseUrl);
  const effectiveKey = resolveApiKey(config.apiKey, config.id);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (effectiveKey) {
      const cleanKey = effectiveKey.replace(/[^\x00-\x7F]/g, '').trim();
      if (cleanKey) {
        headers.Authorization = `Bearer ${cleanKey}`;
      }
    }

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5
      })
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        latencyMs,
        error: `HTTP ${res.status}: ${text.slice(0, 160)}`
      };
    }

    const data = await res.json();
    const replyModel = data.model || config.model;

    let models: string[] = [];
    try {
      const modelsRes = await fetchRemoteModels(config.baseUrl, effectiveKey, 3000);
      if (modelsRes.ok && modelsRes.models.length > 0) {
        models = modelsRes.models;
      }
    } catch {
      // 容错处理
    }

    return {
      ok: true,
      latencyMs,
      model: replyModel,
      models: models.length > 0 ? models : undefined
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err.message || '网络连接超时或无法解析主机'
    };
  }
}

/**
 * 从 OpenAI 兼容的 Base URL 动态拉取实际可用的模型列表
 */
export async function fetchRemoteModels(
  baseUrl: string,
  apiKey?: string,
  timeoutMs = 6000
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  if (!baseUrl || !baseUrl.trim()) {
    return { ok: false, models: [], error: 'Base URL 不能为空' };
  }

  const clean = baseUrl.trim().replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
  const candidateUrls: string[] = [];
  if (clean.endsWith('/v1')) {
    candidateUrls.push(`${clean}/models`);
  } else {
    candidateUrls.push(`${clean}/models`);
    candidateUrls.push(`${clean}/v1/models`);
  }

  const headers: Record<string, string> = {};
  if (apiKey && apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

  let lastError = '';
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${res.statusText}`;
        continue;
      }

      const json: any = await res.json();
      let list: string[] = [];
      if (Array.isArray(json?.data)) {
        list = json.data.map((m: any) => m.id || m.name).filter(Boolean);
      } else if (Array.isArray(json?.models)) {
        list = json.models.map((m: any) => m.name || m.id || m.model).filter(Boolean);
      } else if (Array.isArray(json)) {
        list = json.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
      }

      if (list.length > 0) {
        return { ok: true, models: Array.from(new Set(list)) };
      }
    } catch (err: any) {
      lastError = err.message || '网络连接超时';
    }
  }

  return { ok: false, models: [], error: lastError || '未返回有效模型列表' };
}

/**
 * 探测本地 Ollama 实例及其已拉取的模型清单
 */
export async function probeOllamaModels(baseUrl = 'http://localhost:11434'): Promise<{
  ok: boolean;
  models: string[];
  error?: string;
}> {
  const cleanOrigin = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  const tagsUrl = `${cleanOrigin}/api/tags`;

  try {
    const res = await fetch(tagsUrl, { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return { ok: false, models: [], error: `Ollama 响应 HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data && Array.isArray(data.models)) {
      const modelNames = data.models
        .map((m: any) => m.name || m.model)
        .filter((n: any): n is string => typeof n === 'string' && Boolean(n));
      return { ok: true, models: modelNames };
    }
    return { ok: true, models: [] };
  } catch (err: any) {
    return { ok: false, models: [], error: err.message || '未检测到本地正在运行的 Ollama 服务' };
  }
}

/**
 * 保持向前兼容的 DeepSeek 原生工厂函数
 */
export function createDeepSeekCaller(options?: DeepSeekOptions): LLMCaller {
  const providerConfig: ModelProviderConfig = {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: options?.baseUrl || 'https://api.deepseek.com/chat/completions',
    apiKey: options?.apiKey,
    model: options?.model || 'deepseek-chat'
  };
  return createOpenAICompatibleCaller(providerConfig);
}
