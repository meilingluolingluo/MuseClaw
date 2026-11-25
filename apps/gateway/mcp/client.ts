import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '../../../packages/sandbox-core/src/loop.ts';
import {
  MASK_PLACEHOLDER,
  estimateToolTokens,
  maskSecretRecord,
  normalizeToolCallResult,
  sanitizeToolName,
  scrubSecrets
} from './redact.ts';
import { McpHttpClient, McpHttpError, connectRemoteMcpClient } from './http-client.ts';
import { MCP_CATALOG, detectMcpRuntimes } from './catalog.ts';
import { parseMcpPaste, slugifyServerName } from './parser.ts';
import type {
  McpErrorKind,
  McpLogEntry,
  McpProbeResult,
  McpRiskLevel,
  McpServerConfig,
  McpServerInfo,
  McpServerSnapshot,
  McpServerStatus,
  McpToolCallResult,
  McpToolPolicy,
  McpToolSchema,
  McpToolView,
  McpTransportType
} from './types.ts';

export type { McpServerConfig, McpToolSchema };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_SERVER_LOGS = 200;
const DEFAULT_CONNECT_TIMEOUT_MS = 20000;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_RESULT_BYTES = 65536;
const PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: NodeJS.Timeout;
}

export interface McpStdioClientOptions {
  onLog?: (level: McpLogEntry['level'], message: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

/**
 * 单个 MCP Stdio 服务器连接实例
 */
export class McpStdioClient {
  public readonly name: string;
  private config: McpServerConfig;
  private options: McpStdioClientOptions;
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private requestId = 1;
  private tools: McpToolSchema[] = [];
  private serverInfo: McpServerInfo | undefined;
  private protocolVersion: string | null = null;
  private stopping = false;

  constructor(name: string, config: McpServerConfig, options: McpStdioClientOptions = {}) {
    this.name = name;
    this.config = config;
    this.options = options;
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
    this.stopping = false;

    if (!this.config.command) {
      throw new Error(`MCP Stdio 服务 [${this.name}] 缺少 command 启动命令`);
    }

    const secretValues = Object.values(this.config.env || {});
    const env = { ...process.env, ...(this.config.env || {}) };
    const spawnOpts: Parameters<typeof spawn>[2] = {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(this.config.cwd ? { cwd: this.config.cwd } : {})
    };
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.config.command)) {
      spawnOpts.shell = true;
    }

    const child = spawn(this.config.command, this.config.args || [], spawnOpts);
    this.process = child;

    let spawnError: Error | null = null;

    const rl = readline.createInterface({
      input: child.stdout!,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        // 响应服务端主动发起的 ping
        if (typeof msg.method === 'string' && msg.id !== undefined) {
          if (msg.method === 'ping') {
            this.sendRaw({ jsonrpc: '2.0', id: msg.id, result: {} });
          } else {
            this.sendRaw({
              jsonrpc: '2.0',
              id: msg.id,
              error: { code: -32601, message: 'Method not supported by client' }
            });
          }
          return;
        }

        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const { resolve, reject, timer } = this.pendingRequests.get(msg.id)!;
          clearTimeout(timer);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            const errMsg = scrubSecrets(msg.error.message || JSON.stringify(msg.error), secretValues);
            reject(new Error(`[MCP:${this.name}] ${errMsg}`));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // 忽略非 JSON 标准输出日志行
      }
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk);
      for (const rawLine of text.split(/\r?\n/)) {
        const clean = scrubSecrets(rawLine.trim(), secretValues);
        if (clean) {
          this.options.onLog?.('stderr', clean);
        }
      }
    });

    child.on('error', (err) => {
      spawnError = err;
      const safeMsg = scrubSecrets(err.message, secretValues);
      this.options.onLog?.('error', `进程启动错误: ${safeMsg}`);
      this.rejectAllPending(new Error(`[MCP:${this.name}] 进程错误: ${safeMsg}`));
    });

    child.on('exit', (code, signal) => {
      rl.close();
      if (!this.stopping) {
        const msg = `子进程已退出 (code=${code ?? 'null'}, signal=${signal ?? 'none'})`;
        this.options.onLog?.('warn', msg);
        this.rejectAllPending(new Error(`[MCP:${this.name}] ${msg}`));
        if (this.process === child) {
          this.process = null;
          this.options.onExit?.(code, signal);
        }
      }
    });

    const connectTimeout = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    if (spawnError) {
      throw spawnError;
    }

    // 1. 发送 initialize 握手（兼容不同协议版本）
    let initRes: any;
    let initErr: unknown;
    for (const ver of PROTOCOL_VERSIONS) {
      try {
        initRes = await this.sendRequest(
          'initialize',
          {
            protocolVersion: ver,
            capabilities: {},
            clientInfo: { name: 'MuseClaw', version: '0.1.0' }
          },
          connectTimeout
        );
        this.protocolVersion = typeof initRes?.protocolVersion === 'string' ? initRes.protocolVersion : ver;
        if (initRes?.serverInfo && typeof initRes.serverInfo === 'object') {
          this.serverInfo = {
            name: typeof initRes.serverInfo.name === 'string' ? initRes.serverInfo.name : undefined,
            version: typeof initRes.serverInfo.version === 'string' ? initRes.serverInfo.version : undefined
          };
        }
        break;
      } catch (err) {
        initErr = err;
        if (!this.process) break;
      }
    }

    if (!initRes) {
      this.stop();
      throw initErr instanceof Error ? initErr : new Error('MCP Stdio 握手失败');
    }

    // 2. 发送 notifications/initialized
    this.sendNotification('notifications/initialized', {});

    // 3. 探索工具列表（支持 cursor 分页）
    const collected: McpToolSchema[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const toolsRes = await this.sendRequest('tools/list', cursor ? { cursor } : {}, connectTimeout);
      const batch = Array.isArray(toolsRes?.tools) ? toolsRes.tools : [];
      collected.push(...batch);
      cursor = typeof toolsRes?.nextCursor === 'string' && toolsRes.nextCursor ? toolsRes.nextCursor : undefined;
      pages += 1;
    } while (cursor && pages < 20);

    this.tools = collected;
    this.options.onLog?.('info', `Stdio 握手成功，挂载 ${this.tools.length} 个工具`);
    console.log(`📡 [MCP:${this.name}] 连接就绪，已挂载 ${this.tools.length} 个工具`);
    return this.tools;
  }

  public async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await this.callToolDetailed(toolName, args);
    return res?.content || res;
  }

  public async callToolDetailed(toolName: string, args: Record<string, unknown>): Promise<any> {
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return this.sendRequest(
      'tools/call',
      {
        name: toolName,
        arguments: args || {}
      },
      timeoutMs
    );
  }

  public stop(): void {
    this.stopping = true;
    this.rejectAllPending(new Error('MCP Client stopped'));
    if (this.process) {
      try {
        this.process.kill();
      } catch {}
      this.process = null;
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(err);
      this.pendingRequests.delete(id);
    }
  }

  private sendRaw(payloadObj: Record<string, unknown>): void {
    if (!this.process || !this.process.stdin || this.process.stdin.destroyed) return;
    this.process.stdin.write(JSON.stringify(payloadObj) + '\n');
  }

  private sendRequest(method: string, params: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin || this.process.stdin.destroyed) {
        return reject(new Error(`MCP server [${this.name}] 未就绪`));
      }

      const id = this.requestId++;
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP 调用超时 (${timeoutMs}ms): ${method}`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.sendRaw({ jsonrpc: '2.0', id, method, params });
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process || !this.process.stdin || this.process.stdin.destroyed) return;
    this.sendRaw({ jsonrpc: '2.0', method, params });
  }
}

interface ManagedServerState {
  name: string;
  config: McpServerConfig;
  client: McpStdioClient | McpHttpClient | null;
  status: McpServerStatus;
  tools: McpToolSchema[];
  serverInfo?: McpServerInfo;
  protocolVersion?: string;
  connectedAt?: number;
  lastProbeAt?: number;
  lastLatencyMs?: number;
  error?: string;
  errorKind?: McpErrorKind;
  logs: McpLogEntry[];
}

function inferTransport(config: McpServerConfig): McpTransportType {
  if (config.transport === 'stdio' || config.transport === 'http' || config.transport === 'sse') {
    return config.transport;
  }
  if (config.command) return 'stdio';
  if (config.url && /\/sse(\?|$)/i.test(config.url)) return 'sse';
  if (config.url) return 'http';
  return 'stdio';
}

function classifyErrorKind(err: unknown): McpErrorKind {
  if (err instanceof McpHttpError) return err.kind;
  const msg = String((err as any)?.message || err || '').toLowerCase();
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('认证')) return 'auth';
  if (msg.includes('timeout') || msg.includes('超时')) return 'timeout';
  if (msg.includes('enoent') || msg.includes('spawn') || msg.includes('进程')) return 'process';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed')) return 'unreachable';
  return 'protocol';
}

function mergeMaskedSecrets(
  incoming: Record<string, string> | undefined,
  existing: Record<string, string> | undefined,
  preserveSecrets: boolean
): Record<string, string> | undefined {
  if (incoming === undefined) return preserveSecrets ? existing : undefined;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(incoming)) {
    const k = key.trim();
    if (!k) continue;
    if (preserveSecrets && val === MASK_PLACEHOLDER && existing && k in existing) {
      result[k] = existing[k];
    } else {
      result[k] = String(val ?? '');
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * 全局 MCP 管理器：管理多协议 MCP 服务器连接、配置持久化、工具治理与诊断日志
 */
export class McpClientManager {
  private servers = new Map<string, ManagedServerState>();
  private configPath: string;
  private isDefaultConfigPath: boolean;

  constructor(configPath?: string) {
    this.isDefaultConfigPath = !configPath;
    this.configPath = configPath || path.resolve(__dirname, '../data/mcp_servers.json');
    this.loadPersistedStates();
  }

  public async init(): Promise<void> {
    if (this.isDefaultConfigPath) {
      this.seedFromWorkspaceMcpJson();
    }
    this.loadPersistedStates();

    const targets = Array.from(this.servers.values()).filter((s) => s.config.enabled !== false);
    if (targets.length === 0) return;

    await Promise.allSettled(
      targets.map(async (state) => {
        try {
          await this.connectState(state);
        } catch (err: any) {
          console.warn(`[MCP] 启动服务器 [${state.name}] 失败: ${err.message}`);
        }
      })
    );
  }

  /**
   * 向后兼容接口：添加并立即连接服务，失败时抛出错误
   */
  public async addServer(name: string, config: McpServerConfig): Promise<ToolDefinition[]> {
    const snapshot = await this.upsertServer(name, { ...config, enabled: true }, { connectNow: true, preserveSecrets: false });
    if (snapshot.status === 'error' || snapshot.status === 'auth_required') {
      throw new Error(snapshot.error || `MCP 服务器 [${name}] 启动失败`);
    }
    return this.getToolDefinitions();
  }

  /**
   * 写入或更新 MCP 服务配置并按需建立连接（配置始终持久化，不因连接暂时失败丢失）
   */
  public async upsertServer(
    rawName: string,
    incomingConfig: McpServerConfig,
    options: { connectNow?: boolean; preserveSecrets?: boolean } = {}
  ): Promise<McpServerSnapshot> {
    const name = slugifyServerName(rawName);
    const existing = this.servers.get(name);
    const preserveSecrets = options.preserveSecrets !== false;

    const mergedEnv = mergeMaskedSecrets(incomingConfig.env, existing?.config.env, preserveSecrets);
    const mergedHeaders = mergeMaskedSecrets(incomingConfig.headers, existing?.config.headers, preserveSecrets);

    const normalized: McpServerConfig = {
      ...existing?.config,
      ...incomingConfig,
      transport: inferTransport(incomingConfig.command || incomingConfig.url ? incomingConfig : { ...existing?.config, ...incomingConfig }),
      enabled: incomingConfig.enabled !== undefined ? incomingConfig.enabled : (existing?.config.enabled ?? true),
      timeoutMs: incomingConfig.timeoutMs ?? existing?.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      connectTimeoutMs: incomingConfig.connectTimeoutMs ?? existing?.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      maxResultBytes: incomingConfig.maxResultBytes ?? existing?.config.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
      risk: incomingConfig.risk ?? existing?.config.risk ?? 'moderate',
      everyBot: incomingConfig.everyBot !== undefined ? incomingConfig.everyBot : (existing?.config.everyBot ?? true),
      assignedBots: incomingConfig.assignedBots ?? existing?.config.assignedBots ?? [],
      disabledTools: incomingConfig.disabledTools ?? existing?.config.disabledTools ?? [],
      toolPolicies: incomingConfig.toolPolicies ?? existing?.config.toolPolicies ?? {},
      env: mergedEnv,
      headers: mergedHeaders
    };

    if (normalized.transport === 'stdio') {
      delete normalized.url;
      delete normalized.headers;
    } else {
      delete normalized.command;
      delete normalized.args;
      delete normalized.cwd;
    }

    if (existing?.client) {
      existing.client.stop();
    }

    const state: ManagedServerState = existing || {
      name,
      config: normalized,
      client: null,
      status: normalized.enabled === false ? 'disabled' : 'disconnected',
      tools: [],
      logs: []
    };
    state.config = normalized;
    state.client = null;
    state.error = undefined;
    state.errorKind = undefined;

    this.servers.set(name, state);
    this.saveAllConfigs();

    if (normalized.enabled === false) {
      state.status = 'disabled';
      this.appendLog(state, 'info', '服务已设为禁用状态');
      return this.toSnapshot(state);
    }

    if (options.connectNow !== false) {
      try {
        await this.connectState(state);
      } catch {
        // 状态已记录在 state.error / state.status 中
      }
    }

    return this.toSnapshot(state);
  }

  public async updateServer(
    name: string,
    patch: Partial<McpServerConfig> & { reconnect?: boolean }
  ): Promise<McpServerSnapshot | null> {
    const state = this.servers.get(name);
    if (!state) return null;

    const transportChanged =
      patch.command !== undefined ||
      patch.args !== undefined ||
      patch.cwd !== undefined ||
      patch.env !== undefined ||
      patch.url !== undefined ||
      patch.headers !== undefined ||
      patch.transport !== undefined ||
      patch.enabled !== undefined;

    return this.upsertServer(
      name,
      { ...state.config, ...patch },
      { connectNow: Boolean(patch.reconnect ?? transportChanged), preserveSecrets: true }
    );
  }

  public async setServerEnabled(name: string, enabled: boolean): Promise<McpServerSnapshot | null> {
    const state = this.servers.get(name);
    if (!state) return null;
    state.config.enabled = enabled;
    this.saveAllConfigs();

    if (!enabled) {
      if (state.client) {
        state.client.stop();
        state.client = null;
      }
      state.status = 'disabled';
      state.error = undefined;
      state.errorKind = undefined;
      this.appendLog(state, 'info', '已手动停用该 MCP 服务');
      return this.toSnapshot(state);
    }

    try {
      await this.connectState(state);
    } catch {
      // 错误状态记录在快照中
    }
    return this.toSnapshot(state);
  }

  public async reconnectServer(name: string): Promise<McpServerSnapshot | null> {
    const state = this.servers.get(name);
    if (!state) return null;
    if (state.config.enabled === false) {
      state.config.enabled = true;
      this.saveAllConfigs();
    }
    try {
      await this.connectState(state);
    } catch {
      // 错误信息已写入快照与日志
    }
    return this.toSnapshot(state);
  }

  /**
   * 移除服务（无论当前是否运行中都会清理配置与实例）
   */
  public async removeServer(name: string): Promise<boolean> {
    const state = this.servers.get(name);
    if (!state) return false;
    if (state.client) {
      state.client.stop();
      state.client = null;
    }
    this.servers.delete(name);
    this.saveAllConfigs();
    return true;
  }

  /**
   * 实时探测已保存服务或草稿配置的握手连通性与工具列表
   */
  public async probeServer(target: string | McpServerConfig): Promise<McpProbeResult> {
    const start = Date.now();
    let name = 'probe';
    let config: McpServerConfig;
    let savedState: ManagedServerState | undefined;

    if (typeof target === 'string') {
      savedState = this.servers.get(target);
      if (!savedState) {
        return {
          ok: false,
          transport: 'stdio',
          latencyMs: 0,
          tools: [],
          toolCount: 0,
          estimatedTokens: 0,
          error: `MCP 服务 [${target}] 不存在`,
          errorKind: 'config'
        };
      }
      name = savedState.name;
      config = savedState.config;
    } else {
      config = {
        ...target,
        env: target.env,
        headers: target.headers
      };
    }

    const transport = inferTransport(config);
    const secrets = this.collectSecretValues(config);
    let tempClient: McpStdioClient | McpHttpClient | null = null;

    try {
      let tools: McpToolSchema[] = [];
      let serverInfo: McpServerInfo | undefined;
      let protocolVersion: string | undefined;
      let resolvedTransport = transport;

      if (transport === 'stdio') {
        tempClient = new McpStdioClient(`${name}-probe`, config);
        tools = await tempClient.start();
        serverInfo = tempClient.getServerInfo();
        protocolVersion = tempClient.getProtocolVersion() || undefined;
      } else {
        if (!config.url) {
          throw new McpHttpError('config', '远程 MCP 服务缺少 url 参数');
        }
        const connected = await connectRemoteMcpClient(`${name}-probe`, {
          transport,
          url: config.url,
          headers: config.headers,
          connectTimeoutMs: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
          timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS
        });
        tempClient = connected.client;
        tools = connected.tools;
        resolvedTransport = connected.resolvedTransport;
        serverInfo = connected.client.getServerInfo();
        protocolVersion = connected.client.getProtocolVersion() || undefined;
      }

      const latencyMs = Math.max(1, Date.now() - start);
      const estimatedTokens = tools.reduce((acc, t) => acc + estimateToolTokens(t), 0);

      if (savedState) {
        savedState.tools = tools;
        savedState.lastProbeAt = Date.now();
        savedState.lastLatencyMs = latencyMs;
        savedState.serverInfo = serverInfo;
        savedState.protocolVersion = protocolVersion;
        savedState.error = undefined;
        savedState.errorKind = undefined;
        if (savedState.config.enabled !== false && !savedState.client) {
          // 复用探测不留孤儿进程，若尚未连接则保留快照结果并由 connectState 托管
          savedState.status = 'connected';
        }
        this.appendLog(savedState, 'info', `连通性探测通过 (${latencyMs}ms，发现 ${tools.length} 个工具)`);
      }

      return {
        ok: true,
        transport: resolvedTransport,
        latencyMs,
        tools,
        toolCount: tools.length,
        estimatedTokens,
        serverInfo,
        protocolVersion
      };
    } catch (err: any) {
      const latencyMs = Math.max(1, Date.now() - start);
      const errorKind = classifyErrorKind(err);
      const message = scrubSecrets(err?.message || 'MCP 探测失败', secrets);

      if (savedState) {
        savedState.lastProbeAt = Date.now();
        savedState.lastLatencyMs = latencyMs;
        savedState.error = message;
        savedState.errorKind = errorKind;
        savedState.status = errorKind === 'auth' ? 'auth_required' : 'error';
        this.appendLog(savedState, 'error', `连通性探测失败: ${message}`);
      }

      return {
        ok: false,
        transport,
        latencyMs,
        tools: [],
        toolCount: 0,
        estimatedTokens: 0,
        authRequired: errorKind === 'auth',
        error: message,
        errorKind
      };
    } finally {
      if (tempClient) {
        tempClient.stop();
      }
    }
  }

  /**
   * 试运行或执行指定 MCP 服务的工具，并返回耗时与预算裁剪信息
   */
  public async callServerTool(
    name: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    const state = this.servers.get(name);
    if (!state) {
      return {
        ok: false,
        server: name,
        tool: toolName,
        fullName: sanitizeToolName(name, toolName),
        durationMs: 0,
        outputText: `MCP 服务 [${name}] 不存在`,
        truncated: false,
        originalBytes: 0,
        isError: true,
        error: `MCP 服务 [${name}] 不存在`
      };
    }

    if (!state.client) {
      if (state.config.enabled === false) {
        return {
          ok: false,
          server: name,
          tool: toolName,
          fullName: sanitizeToolName(name, toolName),
          durationMs: 0,
          outputText: `MCP 服务 [${name}] 当前处于停用状态`,
          truncated: false,
          originalBytes: 0,
          isError: true,
          error: `MCP 服务 [${name}] 当前处于停用状态`
        };
      }
      await this.connectState(state);
    }

    const client = state.client!;
    const maxBytes = state.config.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
    const secrets = this.collectSecretValues(state.config);
    const start = Date.now();

    try {
      const rawRes = await client.callToolDetailed(toolName, args || {});
      const durationMs = Math.max(1, Date.now() - start);
      const normalized = normalizeToolCallResult(rawRes, maxBytes);
      const scrubbedOutput = scrubSecrets(normalized.text, secrets);

      this.appendLog(
        state,
        normalized.isError ? 'warn' : 'info',
        `调用工具 ${toolName} (${durationMs}ms, ${normalized.originalBytes}B${normalized.truncated ? ', 已截断' : ''})`
      );

      return {
        ok: !normalized.isError,
        server: name,
        tool: toolName,
        fullName: sanitizeToolName(name, toolName),
        durationMs,
        outputText: scrubbedOutput,
        raw: rawRes,
        truncated: normalized.truncated,
        originalBytes: normalized.originalBytes,
        isError: normalized.isError,
        ...(normalized.isError ? { error: scrubbedOutput } : {})
      };
    } catch (err: any) {
      const durationMs = Math.max(1, Date.now() - start);
      const msg = scrubSecrets(err?.message || '工具执行失败', secrets);
      this.appendLog(state, 'error', `调用工具 ${toolName} 异常: ${msg}`);
      return {
        ok: false,
        server: name,
        tool: toolName,
        fullName: sanitizeToolName(name, toolName),
        durationMs,
        outputText: msg,
        truncated: false,
        originalBytes: Buffer.byteLength(msg, 'utf8'),
        isError: true,
        error: msg
      };
    }
  }

  public toggleTool(name: string, toolName: string, enabled: boolean): McpServerSnapshot | null {
    const state = this.servers.get(name);
    if (!state) return null;

    const disabled = new Set(state.config.disabledTools || []);
    if (enabled) disabled.delete(toolName);
    else disabled.add(toolName);
    state.config.disabledTools = Array.from(disabled);

    if (!state.config.toolPolicies) state.config.toolPolicies = {};
    state.config.toolPolicies[toolName] = {
      ...state.config.toolPolicies[toolName],
      enabled
    };

    this.saveAllConfigs();
    return this.toSnapshot(state);
  }

  public setAllToolsEnabled(name: string, enabled: boolean): McpServerSnapshot | null {
    const state = this.servers.get(name);
    if (!state) return null;

    if (enabled) {
      state.config.disabledTools = [];
    } else {
      state.config.disabledTools = state.tools.map((t) => t.name);
    }

    if (!state.config.toolPolicies) state.config.toolPolicies = {};
    for (const tool of state.tools) {
      state.config.toolPolicies[tool.name] = {
        ...state.config.toolPolicies[tool.name],
        enabled
      };
    }

    this.saveAllConfigs();
    return this.toSnapshot(state);
  }

  public setToolPolicy(name: string, toolName: string, policy: McpToolPolicy): McpServerSnapshot | null {
    const state = this.servers.get(name);
    if (!state) return null;

    if (!state.config.toolPolicies) state.config.toolPolicies = {};
    state.config.toolPolicies[toolName] = {
      ...state.config.toolPolicies[toolName],
      ...policy
    };

    if (policy.enabled !== undefined) {
      const disabled = new Set(state.config.disabledTools || []);
      if (policy.enabled) disabled.delete(toolName);
      else disabled.add(toolName);
      state.config.disabledTools = Array.from(disabled);
    }

    this.saveAllConfigs();
    return this.toSnapshot(state);
  }

  /**
   * 向后兼容接口：返回简明运行中服务列表
   */
  public listServers(): Array<{ name: string; toolCount: number; tools: string[] }> {
    return Array.from(this.servers.values())
      .filter((s) => s.status === 'connected' && s.config.enabled !== false)
      .map((s) => ({
        name: s.name,
        toolCount: s.tools.length,
        tools: s.tools.map((t) => t.name)
      }));
  }

  public getServerSnapshots(): McpServerSnapshot[] {
    return Array.from(this.servers.values()).map((s) => this.toSnapshot(s));
  }

  public getServerSnapshot(name: string): McpServerSnapshot | null {
    const state = this.servers.get(name);
    return state ? this.toSnapshot(state) : null;
  }

  public getLogs(name?: string): McpLogEntry[] {
    if (name) {
      return [...(this.servers.get(name)?.logs || [])];
    }
    const all: McpLogEntry[] = [];
    for (const s of this.servers.values()) {
      for (const entry of s.logs) {
        all.push({ ...entry, message: `[${s.name}] ${entry.message}` });
      }
    }
    return all.sort((a, b) => a.ts - b.ts).slice(-300);
  }

  public clearLogs(name?: string): void {
    if (name) {
      const s = this.servers.get(name);
      if (s) s.logs = [];
      return;
    }
    for (const s of this.servers.values()) {
      s.logs = [];
    }
  }

  public parsePaste(text: string) {
    return parseMcpPaste(text, Array.from(this.servers.keys()));
  }

  public async importBatch(
    entries: Array<{ name: string; config: McpServerConfig }>,
    options: { connectNow?: boolean } = {}
  ): Promise<McpServerSnapshot[]> {
    const snapshots: McpServerSnapshot[] = [];
    for (const item of entries) {
      const snap = await this.upsertServer(item.name, item.config, {
        connectNow: options.connectNow !== false,
        preserveSecrets: true
      });
      snapshots.push(snap);
    }
    return snapshots;
  }

  public getCatalog() {
    return {
      catalog: MCP_CATALOG,
      runtimes: detectMcpRuntimes(),
      installedNames: Array.from(this.servers.keys())
    };
  }

  public exportMcpJson(): string {
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const state of this.servers.values()) {
      const cfg = state.config;
      const entry: Record<string, unknown> = {};
      const transport = inferTransport(cfg);
      entry.transport = transport;
      if (transport === 'stdio') {
        if (cfg.command) entry.command = cfg.command;
        if (cfg.args && cfg.args.length > 0) entry.args = cfg.args;
        if (cfg.cwd) entry.cwd = cfg.cwd;
        if (cfg.env && Object.keys(cfg.env).length > 0) {
          entry.env = maskSecretRecord(cfg.env);
        }
      } else {
        if (cfg.url) entry.url = cfg.url;
        if (cfg.headers && Object.keys(cfg.headers).length > 0) {
          entry.headers = maskSecretRecord(cfg.headers);
        }
      }
      if (cfg.enabled === false) entry.enabled = false;
      if (cfg.description) entry.description = cfg.description;
      if (cfg.category) entry.category = cfg.category;
      if (cfg.timeoutMs && cfg.timeoutMs !== DEFAULT_TIMEOUT_MS) entry.timeoutMs = cfg.timeoutMs;
      if (cfg.maxResultBytes && cfg.maxResultBytes !== DEFAULT_MAX_RESULT_BYTES) entry.maxResultBytes = cfg.maxResultBytes;
      if (cfg.risk && cfg.risk !== 'moderate') entry.risk = cfg.risk;
      mcpServers[state.name] = entry;
    }
    return JSON.stringify({ mcpServers }, null, 2);
  }

  public async applyMcpJson(rawJson: string): Promise<McpServerSnapshot[]> {
    let parsed: any;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('mcp.json 语法错误，请检查 JSON 格式');
    }

    const serverMap =
      parsed && typeof parsed === 'object' && parsed.mcpServers && typeof parsed.mcpServers === 'object'
        ? parsed.mcpServers
        : parsed && typeof parsed === 'object' && parsed.servers && typeof parsed.servers === 'object'
          ? parsed.servers
          : null;

    if (!serverMap || Array.isArray(serverMap)) {
      throw new Error('JSON 顶层必须包含 "mcpServers" 对象');
    }

    const nextNames = new Set(Object.keys(serverMap).map((k) => slugifyServerName(k)));
    for (const existingName of Array.from(this.servers.keys())) {
      if (!nextNames.has(existingName)) {
        await this.removeServer(existingName);
      }
    }

    const results: McpServerSnapshot[] = [];
    for (const [rawName, rawCfg] of Object.entries(serverMap)) {
      if (!rawCfg || typeof rawCfg !== 'object' || Array.isArray(rawCfg)) continue;
      const snap = await this.upsertServer(rawName, rawCfg as McpServerConfig, {
        connectNow: (rawCfg as McpServerConfig).enabled !== false,
        preserveSecrets: true
      });
      results.push(snap);
    }

    return results;
  }

  /**
   * 返回所有被标记为 sensitive 的 MCP 工具全名，供 Sentinel 门禁强制审批
   */
  public getSensitiveToolNames(): string[] {
    const sensitiveNames: string[] = [];
    for (const state of this.servers.values()) {
      if (state.config.enabled === false || state.status !== 'connected') continue;
      const defaultRisk = state.config.risk || 'moderate';
      const disabledSet = new Set(state.config.disabledTools || []);
      for (const tool of state.tools) {
        const policy = state.config.toolPolicies?.[tool.name];
        const isEnabled = policy?.enabled !== undefined ? policy.enabled : !disabledSet.has(tool.name);
        if (!isEnabled) continue;
        const risk = policy?.risk || defaultRisk;
        if (risk === 'sensitive') {
          sensitiveNames.push(sanitizeToolName(state.name, tool.name));
        }
      }
    }
    return sensitiveNames;
  }

  /**
   * 将所有运行中且已启用 MCP 服务器的工具转换为 MuseClaw ToolDefinition
   */
  public getToolDefinitions(options?: { botId?: string }): ToolDefinition[] {
    const toolDefs: ToolDefinition[] = [];
    const botId = options?.botId;

    for (const state of this.servers.values()) {
      if (state.config.enabled === false || state.status !== 'connected' || !state.client) continue;
      if (botId && state.config.everyBot === false) {
        const assigned = state.config.assignedBots || [];
        if (!assigned.includes(botId)) continue;
      }

      const disabledSet = new Set(state.config.disabledTools || []);
      const maxBytes = state.config.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
      const secrets = this.collectSecretValues(state.config);
      const client = state.client;

      for (const t of state.tools) {
        const policy = state.config.toolPolicies?.[t.name];
        const isEnabled = policy?.enabled !== undefined ? policy.enabled : !disabledSet.has(t.name);
        if (!isEnabled) continue;

        const fullToolName = sanitizeToolName(state.name, t.name);
        toolDefs.push({
          name: fullToolName,
          description: `[MCP:${state.name}] ${t.description || t.name}`,
          parameters: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
          execute: async (args: Record<string, unknown>) => {
            const rawRes = await client.callToolDetailed(t.name, args || {});
            const normalized = normalizeToolCallResult(rawRes, maxBytes);
            const cleanText = scrubSecrets(normalized.text, secrets);
            if (normalized.isError) {
              throw new Error(cleanText);
            }
            if (normalized.truncated) {
              return [{ type: 'text', text: cleanText }];
            }
            return rawRes?.content || [{ type: 'text', text: cleanText }];
          }
        });
      }
    }

    return toolDefs;
  }

  public stopAll(): void {
    for (const state of this.servers.values()) {
      if (state.client) {
        state.client.stop();
        state.client = null;
      }
    }
  }

  private async connectState(state: ManagedServerState): Promise<void> {
    if (state.client) {
      state.client.stop();
      state.client = null;
    }

    const transport = inferTransport(state.config);
    const secrets = this.collectSecretValues(state.config);
    const start = Date.now();

    state.status = 'connecting';
    state.error = undefined;
    state.errorKind = undefined;
    this.appendLog(state, 'info', `正在通过 ${transport.toUpperCase()} 建立连接...`);

    try {
      if (transport === 'stdio') {
        const client = new McpStdioClient(state.name, state.config, {
          onLog: (level, msg) => this.appendLog(state, level, msg),
          onExit: () => {
            if (state.client === client && state.config.enabled !== false) {
              state.client = null;
              if (state.status === 'connected') {
                state.status = 'error';
                state.error = 'MCP 子进程意外退出';
                state.errorKind = 'process';
              }
            }
          }
        });
        const tools = await client.start();
        state.client = client;
        state.tools = tools;
        state.serverInfo = client.getServerInfo();
        state.protocolVersion = client.getProtocolVersion() || undefined;
      } else {
        if (!state.config.url) {
          throw new McpHttpError('config', '远程 MCP 服务未配置 url');
        }
        const connected = await connectRemoteMcpClient(state.name, {
          transport,
          url: state.config.url,
          headers: state.config.headers,
          connectTimeoutMs: state.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
          timeoutMs: state.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          onLog: (level, msg) => this.appendLog(state, level, msg)
        });
        state.client = connected.client;
        state.tools = connected.tools;
        state.config.transport = connected.resolvedTransport;
        state.serverInfo = connected.client.getServerInfo();
        state.protocolVersion = connected.client.getProtocolVersion() || undefined;
      }

      state.status = 'connected';
      state.connectedAt = Date.now();
      state.lastLatencyMs = Math.max(1, Date.now() - start);
      state.error = undefined;
      state.errorKind = undefined;
    } catch (err: any) {
      const errorKind = classifyErrorKind(err);
      const message = scrubSecrets(err?.message || '连接失败', secrets);
      state.client = null;
      state.status = errorKind === 'auth' ? 'auth_required' : 'error';
      state.error = message;
      state.errorKind = errorKind;
      state.lastLatencyMs = Math.max(1, Date.now() - start);
      this.appendLog(state, 'error', `连接失败 (${errorKind}): ${message}`);
      throw err;
    }
  }

  private toSnapshot(state: ManagedServerState): McpServerSnapshot {
    const cfg = state.config;
    const disabledSet = new Set(cfg.disabledTools || []);
    const defaultRisk: McpRiskLevel = cfg.risk || 'moderate';

    const tools: McpToolView[] = state.tools.map((t) => {
      const policy = cfg.toolPolicies?.[t.name];
      const enabled = policy?.enabled !== undefined ? policy.enabled : !disabledSet.has(t.name);
      const risk = policy?.risk || defaultRisk;
      return {
        name: t.name,
        fullName: sanitizeToolName(state.name, t.name),
        description: t.description || t.name,
        inputSchema: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
        enabled,
        risk,
        estimatedTokens: estimateToolTokens(t)
      };
    });

    const enabledTools = tools.filter((t) => t.enabled);
    const estimatedTokens = enabledTools.reduce((sum, t) => sum + t.estimatedTokens, 0);

    return {
      name: state.name,
      transport: inferTransport(cfg),
      enabled: cfg.enabled !== false,
      status: cfg.enabled === false ? 'disabled' : state.status,
      description: cfg.description || '',
      category: cfg.category || 'custom',
      docs: cfg.docs,
      command: cfg.command,
      args: cfg.args,
      cwd: cfg.cwd,
      url: cfg.url,
      envMasked: maskSecretRecord(cfg.env),
      headersMasked: maskSecretRecord(cfg.headers),
      envKeys: Object.keys(cfg.env || {}),
      headerKeys: Object.keys(cfg.headers || {}),
      timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      connectTimeoutMs: cfg.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      maxResultBytes: cfg.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
      risk: defaultRisk,
      everyBot: cfg.everyBot !== false,
      assignedBots: cfg.assignedBots || [],
      serverInfo: state.serverInfo,
      protocolVersion: state.protocolVersion,
      connectedAt: state.connectedAt,
      lastProbeAt: state.lastProbeAt,
      lastLatencyMs: state.lastLatencyMs,
      error: state.error,
      errorKind: state.errorKind,
      toolCount: tools.length,
      enabledToolCount: enabledTools.length,
      estimatedTokens,
      tools,
      source: cfg.source || 'managed'
    };
  }

  private collectSecretValues(config: McpServerConfig): string[] {
    return [
      ...Object.values(config.env || {}),
      ...Object.values(config.headers || {})
    ].filter((v) => typeof v === 'string' && v.length >= 6);
  }

  private appendLog(state: ManagedServerState, level: McpLogEntry['level'], message: string): void {
    state.logs.push({ ts: Date.now(), level, message });
    if (state.logs.length > MAX_SERVER_LOGS) {
      state.logs.splice(0, state.logs.length - MAX_SERVER_LOGS);
    }
  }

  private loadPersistedStates(): void {
    const configs = this.loadConfigs();
    for (const [name, cfg] of Object.entries(configs)) {
      if (!this.servers.has(name)) {
        this.servers.set(name, {
          name,
          config: cfg,
          client: null,
          status: cfg.enabled === false ? 'disabled' : 'disconnected',
          tools: [],
          logs: []
        });
      }
    }
  }

  private seedFromWorkspaceMcpJson(): void {
    const rootMcpJson = path.resolve(__dirname, '../../../mcp.json');
    if (!fs.existsSync(rootMcpJson)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(rootMcpJson, 'utf-8'));
      const workspaceServers = parsed?.mcpServers;
      if (!workspaceServers || typeof workspaceServers !== 'object') return;
      const persisted = this.loadConfigs();
      let changed = false;
      for (const [rawName, rawCfg] of Object.entries(workspaceServers)) {
        const name = slugifyServerName(rawName);
        if (!persisted[name] && rawCfg && typeof rawCfg === 'object') {
          persisted[name] = {
            ...(rawCfg as McpServerConfig),
            enabled: false,
            source: 'workspace'
          };
          changed = true;
        }
      }
      if (changed) {
        this.saveConfigs(persisted);
      }
    } catch {
      // 忽略无效的工作区 mcp.json
    }
  }

  private loadConfigs(): Record<string, McpServerConfig> {
    if (!fs.existsSync(this.configPath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private saveAllConfigs(): void {
    const out: Record<string, McpServerConfig> = {};
    for (const [name, state] of this.servers.entries()) {
      out[name] = state.config;
    }
    this.saveConfigs(out);
  }

  private saveConfigs(configs: Record<string, McpServerConfig>): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(configs, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[MCP] 保存配置失败:', err.message);
    }
  }
}
