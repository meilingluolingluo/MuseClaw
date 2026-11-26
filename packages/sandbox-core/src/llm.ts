import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LLMCaller, LLMMessage, ToolDefinition } from './loop.ts';
import { saysNoImages, withoutImages } from './vision.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  isStdioLocalAgent,
  type LocalAgentAuthInfo,
  type LocalAgentStatus
} from './local-agent-prober.ts';
import { testLocalAgent } from './local-agent-runner.ts';

export interface ModelProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  candidateModels?: string[];
  customModels?: string[];
  enabled?: boolean;
  isCustom?: boolean;
  isLocalAgent?: boolean;
  category?: 'local_agent' | 'cloud_api' | 'intranet_agent';
  installed?: boolean;
  isAvailable?: boolean;
  status?: LocalAgentStatus;
  statusMessage?: string;
  auth?: LocalAgentAuthInfo;
  version?: string;
  executablePath?: string;
  binaryPath?: string;
  configDir?: string;
  cwd?: string;
  extraArgs?: string;
  env?: Record<string, string>;
  protocol?: string;
  description?: string;
  source?: 'local' | 'remote';
  machineName?: string;
  installCommand?: string;
  docUrl?: string;
  checkedAt?: number;
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
 * 解析模型原生 DSML (DeepSeek Markup Language) 标记块并提取为标准 ToolCall 结构
 * 兼容全角管道符 <｜｜DSML｜｜ 与半角管道符 <||DSML||，支持闭合与未闭合容错
 */
export function parseDSML(text: string): {
  cleanedContent: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
} {
  const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  if (!text) {
    return { cleanedContent: '', toolCalls };
  }

  // 匹配闭合或未闭合的 <｜｜DSML｜｜ calls> ... </｜｜DSML｜｜ calls>
  const dsmlBlockRegex = /<[｜|]{2}DSML[｜|]{2}\s*calls>([\s\S]*?)(?:<\/[｜|]{2}DSML[｜|]{2}\s*calls>|$)/gi;

  const cleanedContent = text.replace(dsmlBlockRegex, (_, innerBlock: string) => {
    // 匹配每个 invoke: <｜｜DSML｜｜ invoke name="..."> ... </｜｜DSML｜｜ invoke>
    const invokeRegex = /<[｜|]{2}DSML[｜|]{2}\s*invoke\s+name=["']([^"']+)["']>([\s\S]*?)(?:<\/[｜|]{2}DSML[｜|]{2}\s*invoke>|$)/gi;
    let invMatch: RegExpExecArray | null;

    while ((invMatch = invokeRegex.exec(innerBlock)) !== null) {
      const toolName = invMatch[1].trim();
      const paramsInner = invMatch[2];
      const args: Record<string, unknown> = {};

      // 匹配每个 parameter: <｜｜DSML｜｜ parameter name="..." ...>value</｜｜DSML｜｜ parameter>
      const paramRegex = /<[｜|]{2}DSML[｜|]{2}\s*parameter\s+name=["']([^"']+)["'](?:\s+[^>]*)?>([\s\S]*?)(?:<\/[｜|]{2}DSML[｜|]{2}\s*parameter>|$)/gi;
      let pMatch: RegExpExecArray | null;

      while ((pMatch = paramRegex.exec(paramsInner)) !== null) {
        const paramName = pMatch[1].trim();
        const rawVal = pMatch[2].trim();
        let parsedVal: unknown = rawVal;

        if (
          (rawVal.startsWith('{') && rawVal.endsWith('}')) ||
          (rawVal.startsWith('[') && rawVal.endsWith(']'))
        ) {
          try {
            parsedVal = JSON.parse(rawVal);
          } catch {
            parsedVal = rawVal;
          }
        } else if (rawVal === 'true') {
          parsedVal = true;
        } else if (rawVal === 'false') {
          parsedVal = false;
        } else if (/^-?\d+(\.\d+)?$/.test(rawVal) && !isNaN(Number(rawVal))) {
          if (!rawVal.startsWith('0') || rawVal === '0' || rawVal.startsWith('0.')) {
            parsedVal = Number(rawVal);
          }
        }

        args[paramName] = parsedVal;
      }

      toolCalls.push({
        id: `call_dsml_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: toolName,
        args
      });
    }

    return '';
  }).trim();

  return { cleanedContent, toolCalls };
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
  if ((providerId === 'google' || providerId === 'gemini') && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
    return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)!.trim();
  }
  if (providerId === 'moonshot' && process.env.MOONSHOT_API_KEY) {
    return process.env.MOONSHOT_API_KEY.trim();
  }
  if (providerId === 'ollama' && process.env.OLLAMA_API_KEY) {
    return process.env.OLLAMA_API_KEY.trim();
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
        if (providerId === 'google' || providerId === 'gemini') {
          const match = raw.match(/(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*["']?([^"'\r\n]+)["']?/);
          if (match && match[1]) return match[1].trim();
        }
        if (providerId === 'siliconflow') {
          const match = raw.match(/SILICONFLOW_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/);
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

    const formatMessageList = (msgList: LLMMessage[]) =>
      msgList.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: m.tool_call_id,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
          };
        }
        if (m.role === 'assistant' && m.tool_calls) {
          const item: Record<string, unknown> = {
            role: 'assistant',
            content: typeof m.content === 'string' ? m.content : (m.content ? JSON.stringify(m.content) : ''),
            tool_calls: m.tool_calls.map((c) => ({
              id: c.id,
              type: 'function',
              function: c.function
            }))
          };
          if (m.reasoning_content !== undefined) {
            item.reasoning_content = m.reasoning_content;
          }
          return item;
        }
        return {
          role: m.role,
          content: Array.isArray(m.content) ? m.content : (m.content || '')
        };
      });

    const body: Record<string, unknown> = {
      model: modelName,
      messages: formatMessageList(messages)
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

    let res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    // 若端点因为接收到图片 content parts 而报错拒绝，自动降级为纯文本重试一次
    if (!res.ok) {
      const errText = await res.text();
      const hadMultimodal = messages.some((m) => Array.isArray(m.content));
      if (hadMultimodal && saysNoImages(errText)) {
        const textOnlyMessages = withoutImages(messages);
        body.messages = formatMessageList(textOnlyMessages);
        res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });
      }
      if (!res.ok) {
        const finalErr = res === undefined || res.bodyUsed ? errText : await res.text();
        throw new Error(`[${config.name || config.id}] API 请求失败 (HTTP ${res.status}): ${finalErr}`);
      }
    }

    if (onChunk && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedContent = '';
      let accumulatedReasoning = '';
      let streamedLength = 0;
      const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

      const flushChunks = () => {
        // 判断 accumulatedContent 中是否有 DSML 标签
        const dsmlStart = accumulatedContent.search(/<[｜|]{2}DSML/i);
        if (dsmlStart === -1) {
          // 没有检测到 DSML 标签，检查末尾是否含有未完成的 '<' 潜在标签前缀
          const lastTagOpen = accumulatedContent.lastIndexOf('<');
          let safeEnd = accumulatedContent.length;
          if (lastTagOpen !== -1 && accumulatedContent.length - lastTagOpen < 15) {
            safeEnd = lastTagOpen;
          }
          if (safeEnd > streamedLength) {
            onChunk(accumulatedContent.slice(streamedLength, safeEnd));
            streamedLength = safeEnd;
          }
        } else {
          // 有 DSML，先将 DSML 之前的文本输出
          if (dsmlStart > streamedLength) {
            onChunk(accumulatedContent.slice(streamedLength, dsmlStart));
            streamedLength = dsmlStart;
          }
          // 查找当前 DSML block 是否已闭合
          const callsEndRegex = /<\/[｜|]{2}DSML[｜|]{2}\s*calls>/gi;
          callsEndRegex.lastIndex = dsmlStart;
          const endMatch = callsEndRegex.exec(accumulatedContent);
          if (endMatch) {
            const dsmlEnd = endMatch.index + endMatch[0].length;
            if (dsmlEnd > streamedLength) {
              streamedLength = dsmlEnd;
            }
            if (accumulatedContent.length > streamedLength) {
              onChunk(accumulatedContent.slice(streamedLength));
              streamedLength = accumulatedContent.length;
            }
          }
        }
      };

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
              if (delta?.reasoning_content) {
                accumulatedReasoning += delta.reasoning_content;
                if (onChunk) {
                  onChunk('', delta.reasoning_content);
                }
              }
              if (delta?.content) {
                accumulatedContent += delta.content;
                flushChunks();
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

      // 流全部接收完毕后，解析 DSML 并剥除 DSML 标记块
      const { cleanedContent, toolCalls: dsmlToolCalls } = parseDSML(accumulatedContent);
      accumulatedContent = cleanedContent;

      // 如果有遗留且非 DSML 的普通文本，输出兜底
      if (accumulatedContent.length > streamedLength && dsmlToolCalls.length === 0) {
        onChunk(accumulatedContent.slice(streamedLength));
        streamedLength = accumulatedContent.length;
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

      for (const dsmlCall of dsmlToolCalls) {
        toolCalls.push(dsmlCall);
      }

      return {
        content: accumulatedContent,
        reasoning_content: accumulatedReasoning || undefined,
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

    let finalContent = choice.content || '';
    const { cleanedContent, toolCalls: dsmlToolCalls } = parseDSML(finalContent);
    finalContent = cleanedContent;
    for (const dsmlCall of dsmlToolCalls) {
      toolCalls.push(dsmlCall);
    }

    return {
      content: finalContent,
      reasoning_content: choice.reasoning_content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  };
}

/**
 * 测试模型服务连通性探针 (Ping / Test Connection)
 */
export async function testProviderConnection(config: ModelProviderConfig & { userId?: string }): Promise<{
  ok: boolean;
  latencyMs: number;
  model?: string;
  version?: string;
  auth?: LocalAgentAuthInfo;
  replyPreview?: string;
  diagnosticCode?: string;
  models?: string[];
  error?: string;
}> {
  if ((config.isLocalAgent && config.id !== 'ollama') || isStdioLocalAgent(config.id)) {
    const res = await testLocalAgent(config.id, config.model, config.userId, {
      binaryPath: config.binaryPath,
      configDir: config.configDir,
      cwd: config.cwd,
      extraArgs: config.extraArgs,
      env: config.env,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey
    });
    return {
      ok: res.ok,
      latencyMs: res.latencyMs,
      model: res.version || config.model,
      version: res.version,
      auth: res.auth,
      replyPreview: res.replyPreview,
      diagnosticCode: res.diagnosticCode,
      error: res.error
    };
  }

  if (config.id === 'ollama') {
    const probe = await probeOllamaModels(config.baseUrl || 'http://localhost:11434');
    if (!probe.ok) {
      return {
        ok: false,
        latencyMs: 0,
        error: probe.error || '未检测到本地正在运行的 Ollama 服务 (端口 11434 未响应)'
      };
    }
  }

  if (config.id === 'google') {
    const start = Date.now();
    const effectiveKey = resolveApiKey(config.apiKey, config.id);
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveKey}`);
      const latencyMs = Date.now() - start;
      if (resp.ok) {
        return {
          ok: true,
          latencyMs,
          model: config.model || 'imagen-3.0-generate-002'
        };
      } else {
        const text = await resp.text();
        return {
          ok: false,
          latencyMs,
          error: `Google API 认证或请求失败 (${resp.status}): ${text.slice(0, 160)}`
        };
      }
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `连接 Google 服务异常: ${err.message}`
      };
    }
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
    const errorMsg = (err.message && err.message !== 'fetch failed')
      ? err.message
      : '未检测到本地正在运行的 Ollama 服务 (端口 11434 未响应)';
    return { ok: false, models: [], error: errorMsg };
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
