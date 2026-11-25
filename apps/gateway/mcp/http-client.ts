import { scrubSecrets } from './redact.ts';
import type { McpErrorKind, McpServerInfo, McpToolSchema, McpTransportType } from './types.ts';

const PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const;
const MAX_REMOTE_MCP_BYTES = 32 * 1024 * 1024;

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRpc {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: NodeJS.Timeout;
}

interface SseEvent {
  event: string;
  data: string;
}

export class McpHttpError extends Error {
  public readonly kind: McpErrorKind;
  public readonly status?: number;
  public readonly wwwAuthenticate?: string;

  constructor(kind: McpErrorKind, message: string, status?: number, wwwAuthenticate?: string) {
    super(message);
    this.name = 'McpHttpError';
    this.kind = kind;
    this.status = status;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRpcPayload(text: string): JsonRpcMessage[] {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(isRecord);
    if (isRecord(parsed)) return [parsed];
    return [];
  } catch {
    return [];
  }
}

function unwrapRpcMessage(msg: JsonRpcMessage): unknown {
  if (msg.error !== undefined) {
    const errObj = isRecord(msg.error) ? msg.error : null;
    const message =
      errObj && typeof errObj.message === 'string'
        ? errObj.message
        : JSON.stringify(msg.error);
    throw new McpHttpError('protocol', `MCP RPC error: ${message}`);
  }
  return msg.result;
}

function parseSseBlock(block: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let val = colon === -1 ? '' : line.slice(colon + 1);
    if (val.startsWith(' ')) val = val.slice(1);
    if (field === 'event') event = val;
    else if (field === 'data') dataLines.push(val);
  }
  return dataLines.length > 0 ? { event, data: dataLines.join('\n') } : null;
}

async function readSseStream(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: SseEvent) => 'stop' | void,
  flushTailOnEof = false
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new McpHttpError('protocol', 'SSE 响应体为空');

  const decoder = new TextDecoder();
  let buffer = '';
  let afterCr = false;
  let bytes = 0;

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (flushTailOnEof) {
          const tail = (buffer + decoder.decode()).trim();
          if (tail) {
            const ev = parseSseBlock(tail);
            if (ev) onEvent(ev);
          }
        }
        return;
      }

      bytes += value.byteLength;
      if (bytes > MAX_REMOTE_MCP_BYTES) {
        throw new McpHttpError('protocol', 'MCP SSE 响应体超出安全上限');
      }

      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        const start = afterCr && chunk.startsWith('\n') ? 1 : 0;
        afterCr = chunk.endsWith('\r');
        buffer += chunk.slice(start).replace(/\r\n?/g, '\n');
      }

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const ev = parseSseBlock(block);
        if (ev && onEvent(ev) === 'stop') {
          return;
        }
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_REMOTE_MCP_BYTES) {
        throw new McpHttpError('protocol', 'MCP 响应体超出安全上限');
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function drainResponse(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

export interface McpHttpClientOptions {
  transport: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  connectTimeoutMs?: number;
  timeoutMs?: number;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

/**
 * 远程 MCP 客户端：支持 Streamable HTTP 与 Legacy SSE 两种传输协议
 */
export class McpHttpClient {
  public readonly name: string;
  public readonly transport: 'http' | 'sse';
  public readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly connectTimeoutMs: number;
  private readonly timeoutMs: number;
  private readonly onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;

  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private serverInfo: McpServerInfo | undefined;
  private tools: McpToolSchema[] = [];
  private requestId = 1;
  private closed = false;
  private pending = new Map<number, PendingRpc>();
  private sseEndpointPromise: Promise<string> | null = null;
  private sseStreamAbort: AbortController | null = null;

  constructor(name: string, options: McpHttpClientOptions) {
    this.name = name;
    this.transport = options.transport;
    this.url = options.url;
    this.headers = options.headers || {};
    this.connectTimeoutMs = options.connectTimeoutMs ?? 20000;
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.onLog = options.onLog;
  }

  public getTools(): McpToolSchema[] {
    return this.tools;
  }

  public getServerInfo(): McpServerInfo | undefined {
    return this.serverInfo;
  }

  public getProtocolVersion(): string | null {
    return this.protocolVersion;
  }

  public async start(): Promise<McpToolSchema[]> {
    this.stop();
    this.closed = false;

    const secretValues = Object.values(this.headers);
    let initRes: any;
    let lastError: unknown;

    for (const ver of PROTOCOL_VERSIONS) {
      try {
        initRes = await this.sendRequest(
          'initialize',
          {
            protocolVersion: ver,
            capabilities: {},
            clientInfo: { name: 'MuseClaw', version: '0.1.0' }
          },
          this.connectTimeoutMs
        );
        this.protocolVersion =
          isRecord(initRes) && typeof initRes.protocolVersion === 'string'
            ? initRes.protocolVersion
            : ver;
        if (isRecord(initRes) && isRecord(initRes.serverInfo)) {
          this.serverInfo = {
            name: typeof initRes.serverInfo.name === 'string' ? initRes.serverInfo.name : undefined,
            version: typeof initRes.serverInfo.version === 'string' ? initRes.serverInfo.version : undefined
          };
        }
        break;
      } catch (err) {
        lastError = err;
        if (err instanceof McpHttpError && (err.kind === 'auth' || err.kind === 'unreachable' || err.kind === 'timeout')) {
          throw err;
        }
        // 协议版本不兼容时重置会话尝试下一版本
        this.sessionId = null;
      }
    }

    if (!initRes) {
      throw lastError instanceof Error
        ? lastError
        : new McpHttpError('protocol', scrubSecrets(String(lastError || '初始化失败'), secretValues));
    }

    await this.sendNotification('notifications/initialized', {});

    const collected: McpToolSchema[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const params = cursor ? { cursor } : {};
      const listRes = await this.sendRequest('tools/list', params, this.connectTimeoutMs);
      const batch = Array.isArray(listRes?.tools) ? listRes.tools : [];
      collected.push(...batch);
      cursor = typeof listRes?.nextCursor === 'string' && listRes.nextCursor ? listRes.nextCursor : undefined;
      pages += 1;
    } while (cursor && pages < 20);

    this.tools = collected;
    this.onLog?.('info', `${this.transport.toUpperCase()} 握手成功，挂载 ${this.tools.length} 个工具`);
    return this.tools;
  }

  public async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await this.callToolDetailed(toolName, args);
    return res?.content || res;
  }

  public async callToolDetailed(toolName: string, args: Record<string, unknown>): Promise<any> {
    return this.sendRequest(
      'tools/call',
      {
        name: toolName,
        arguments: args || {}
      },
      this.timeoutMs
    );
  }

  public stop(): void {
    if (this.closed) return;
    this.closed = true;

    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new McpHttpError('unreachable', 'MCP HTTP 客户端已停止'));
      this.pending.delete(id);
    }

    if (this.sseStreamAbort) {
      this.sseStreamAbort.abort();
      this.sseStreamAbort = null;
    }
    this.sseEndpointPromise = null;

    if (this.sessionId && this.transport === 'http') {
      const headers = this.buildHeaders();
      const sid = this.sessionId;
      this.sessionId = null;
      headers.set('mcp-session-id', sid);
      void fetch(this.url, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(2000)
      })
        .then(drainResponse)
        .catch(() => {});
    }
  }

  private buildHeaders(extra?: Record<string, string>): Headers {
    const h = new Headers();
    for (const [k, v] of Object.entries(this.headers)) {
      if (k && v !== undefined) h.set(k, v);
    }
    h.set('accept', 'application/json, text/event-stream');
    if (this.sessionId) h.set('mcp-session-id', this.sessionId);
    if (this.protocolVersion) h.set('mcp-protocol-version', this.protocolVersion);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) h.set(k, v);
    }
    return h;
  }

  private async postFrame(targetUrl: string, frame: unknown, signal: AbortSignal): Promise<Response> {
    const secretValues = Object.values(this.headers);
    const headers = this.buildHeaders({ 'content-type': 'application/json' });
    let response: Response;
    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(frame),
        signal
      });
    } catch (err: any) {
      if (signal.aborted) {
        if (err?.name === 'TimeoutError' || String(signal.reason || '').includes('timeout')) {
          throw new McpHttpError('timeout', `请求超时 (${this.url})`);
        }
        throw new McpHttpError('timeout', '请求已取消或超时');
      }
      throw new McpHttpError('unreachable', scrubSecrets(err?.message || '网络不可达', secretValues));
    }

    if (!response.ok) {
      const wwwAuth = response.headers.get('www-authenticate') || undefined;
      drainResponse(response);
      if (response.status === 401 || response.status === 403) {
        throw new McpHttpError(
          'auth',
          `认证未通过 (HTTP ${response.status})，请检查 Token 或 Authorization Header`,
          response.status,
          wwwAuth
        );
      }
      throw new McpHttpError(
        'protocol',
        `MCP 服务端返回 HTTP ${response.status} ${response.statusText}`,
        response.status,
        wwwAuth
      );
    }

    const sid = response.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    return response;
  }

  private async sendRequest(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
    if (this.closed) {
      throw new McpHttpError('unreachable', 'MCP HTTP 客户端已关闭');
    }
    const id = this.requestId++;
    const frame = { jsonrpc: '2.0', id, method, params };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);

    try {
      if (this.transport === 'sse') {
        return await this.sendSseRequest(id, frame, controller.signal, timeoutMs);
      }
      return await this.sendStreamableRequest(id, frame, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    if (this.closed) return;
    const frame = { jsonrpc: '2.0', method, params };
    const signal = AbortSignal.timeout(5000);
    try {
      if (this.transport === 'sse') {
        const endpoint = await this.openSseStream(signal);
        const res = await this.postFrame(endpoint, frame, signal);
        drainResponse(res);
      } else {
        const res = await this.postFrame(this.url, frame, signal);
        drainResponse(res);
      }
    } catch {
      // 通知失败不阻塞握手
    }
  }

  private async sendStreamableRequest(id: number, frame: unknown, signal: AbortSignal): Promise<any> {
    const response = await this.postFrame(this.url, frame, signal);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      const bodyText = await readBoundedText(response);
      const msgs = parseJsonRpcPayload(bodyText);
      this.handleIncomingMessages(msgs);
      const reply = msgs.find((m) => m.id === id && (Object.hasOwn(m, 'result') || Object.hasOwn(m, 'error')));
      if (!reply) {
        throw new McpHttpError('protocol', 'HTTP JSON 响应中缺少匹配的 RPC 结果');
      }
      return unwrapRpcMessage(reply);
    }

    if (contentType.includes('text/event-stream')) {
      let matched: JsonRpcMessage | undefined;
      await readSseStream(
        response,
        signal,
        (event) => {
          if (event.event !== 'message') return;
          const msgs = parseJsonRpcPayload(event.data);
          this.handleIncomingMessages(msgs);
          const reply = msgs.find((m) => m.id === id && (Object.hasOwn(m, 'result') || Object.hasOwn(m, 'error')));
          if (reply) {
            matched = reply;
            return 'stop';
          }
        },
        true
      );
      if (!matched) {
        throw new McpHttpError('protocol', 'SSE 事件流结束但未返回匹配的 RPC 结果');
      }
      return unwrapRpcMessage(matched);
    }

    drainResponse(response);
    throw new McpHttpError('protocol', `不支持的响应类型: ${contentType || 'unknown'}`);
  }

  private openSseStream(signal: AbortSignal): Promise<string> {
    if (this.sseEndpointPromise) return this.sseEndpointPromise;
    const streamAbort = new AbortController();
    this.sseStreamAbort = streamAbort;
    const secretValues = Object.values(this.headers);

    this.sseEndpointPromise = new Promise<string>((resolveEndpoint, rejectEndpoint) => {
      let settled = false;
      const failAll = (err: Error) => {
        if (!settled) {
          settled = true;
          rejectEndpoint(err);
        }
        for (const [pid, entry] of this.pending.entries()) {
          clearTimeout(entry.timer);
          entry.reject(err);
          this.pending.delete(pid);
        }
        this.sseEndpointPromise = null;
      };

      const openingAbort = new AbortController();
      const onOpenAbort = () => openingAbort.abort(signal.reason);
      signal.addEventListener('abort', onOpenAbort, { once: true });
      if (signal.aborted) onOpenAbort();

      const headers = this.buildHeaders();
      headers.set('accept', 'text/event-stream');

      fetch(this.url, {
        method: 'GET',
        headers,
        signal: AbortSignal.any([openingAbort.signal, streamAbort.signal])
      })
        .then(async (response) => {
          if (!response.ok) {
            const wwwAuth = response.headers.get('www-authenticate') || undefined;
            drainResponse(response);
            if (response.status === 401 || response.status === 403) {
              throw new McpHttpError('auth', `SSE 认证失败 (HTTP ${response.status})`, response.status, wwwAuth);
            }
            throw new McpHttpError('protocol', `SSE 连接失败 (HTTP ${response.status})`, response.status, wwwAuth);
          }

          await readSseStream(response, streamAbort.signal, (event) => {
            if (event.event === 'endpoint') {
              if (!settled) {
                settled = true;
                signal.removeEventListener('abort', onOpenAbort);
                try {
                  resolveEndpoint(new URL(event.data.trim(), this.url).toString());
                } catch {
                  rejectEndpoint(new McpHttpError('protocol', 'SSE endpoint 事件 URL 非法'));
                }
              }
              return;
            }

            if (event.event !== 'message') return;
            const msgs = parseJsonRpcPayload(event.data);
            this.handleIncomingMessages(msgs);
            for (const msg of msgs) {
              if (typeof msg.id !== 'number') continue;
              if (!Object.hasOwn(msg, 'result') && !Object.hasOwn(msg, 'error')) continue;
              const entry = this.pending.get(msg.id);
              if (!entry) continue;
              clearTimeout(entry.timer);
              this.pending.delete(msg.id);
              try {
                entry.resolve(unwrapRpcMessage(msg));
              } catch (err) {
                entry.reject(err);
              }
            }
          });

          if (!this.closed) {
            failAll(new McpHttpError('unreachable', 'SSE 事件流已断开'));
          }
        })
        .catch((err: any) => {
          if (this.closed) return;
          if (err instanceof McpHttpError) {
            failAll(err);
          } else {
            failAll(new McpHttpError('unreachable', scrubSecrets(err?.message || 'SSE 连接失败', secretValues)));
          }
        })
        .finally(() => {
          signal.removeEventListener('abort', onOpenAbort);
        });
    });

    return this.sseEndpointPromise;
  }

  private async sendSseRequest(id: number, frame: unknown, signal: AbortSignal, timeoutMs: number): Promise<any> {
    const endpoint = await this.openSseStream(signal);
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new McpHttpError('timeout', `MCP SSE 调用超时 (${timeoutMs}ms)`));
        }
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.postFrame(endpoint, frame, signal)
        .then(drainResponse)
        .catch((err) => {
          if (this.pending.has(id)) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(err);
          }
        });
    });
  }

  private handleIncomingMessages(msgs: JsonRpcMessage[]): void {
    for (const msg of msgs) {
      if (typeof msg.method !== 'string') continue;
      if (msg.id !== undefined && (typeof msg.id === 'number' || typeof msg.id === 'string')) {
        if (msg.method === 'ping') {
          const pong = { jsonrpc: '2.0', id: msg.id, result: {} };
          if (this.transport === 'sse' && this.sseEndpointPromise) {
            void this.sseEndpointPromise
              .then((ep) => this.postFrame(ep, pong, AbortSignal.timeout(5000)).then(drainResponse))
              .catch(() => {});
          } else {
            void this.postFrame(this.url, pong, AbortSignal.timeout(5000)).then(drainResponse).catch(() => {});
          }
        }
      }
    }
  }
}

/**
 * 连接远程 MCP 服务端；当配置为 Streamable HTTP 且遭遇 404/405/非协议头时自动回退至 Legacy SSE
 */
export async function connectRemoteMcpClient(
  name: string,
  options: Omit<McpHttpClientOptions, 'transport'> & { transport?: 'http' | 'sse' }
): Promise<{ client: McpHttpClient; tools: McpToolSchema[]; resolvedTransport: McpTransportType }> {
  const preferred = options.transport === 'sse' ? 'sse' : 'http';
  const primary = new McpHttpClient(name, { ...options, transport: preferred });
  try {
    const tools = await primary.start();
    return { client: primary, tools, resolvedTransport: preferred };
  } catch (err) {
    primary.stop();
    const shouldFallbackToSse =
      preferred === 'http' &&
      err instanceof McpHttpError &&
      err.kind !== 'auth' &&
      (err.status === 404 || err.status === 405 || err.kind === 'protocol');

    if (!shouldFallbackToSse) {
      throw err;
    }

    options.onLog?.('warn', `Streamable HTTP 握手未通过 (${err.message})，自动回退尝试 Legacy SSE`);
    const fallback = new McpHttpClient(name, { ...options, transport: 'sse' });
    try {
      const tools = await fallback.start();
      return { client: fallback, tools, resolvedTransport: 'sse' };
    } catch (fallbackErr) {
      fallback.stop();
      throw fallbackErr;
    }
  }
}
