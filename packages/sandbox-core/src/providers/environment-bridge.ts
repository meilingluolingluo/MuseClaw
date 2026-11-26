import type { WebSocket } from 'ws';
export { WebSocketServer } from 'ws';
import { AsyncPushQueue } from './async-queue.ts';
import type {
  AgentRuntimeEvent,
  ApprovalDecision,
  EnvironmentInfo,
  ProviderInstanceConfig,
  ProviderSnapshot,
  TurnRunParams
} from './types.ts';

export interface RpcMessage {
  jsonrpc: '2.0';
  id?: string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message: string };
}

interface RemoteEnvEntry {
  environmentId: string;
  label: string;
  hostname: string;
  platform: string;
  arch: string;
  userId?: string;
  status: 'online' | 'offline';
  connectedAt: number;
  lastSeenAt: number;
  snapshots: ProviderSnapshot[];
  socket?: WebSocket;
  pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>;
  activeTurnQueues: Map<string, AsyncPushQueue<AgentRuntimeEvent>>;
}

/**
 * 双向 WebSocket JSON-RPC 远程计算环境桥接器 (EnvironmentBridge)
 * 管理通过持久 WebSocket 接入的个人电脑节点，支持实时状态推送、按需探测、
 * 有序流式事件转发、交互式工具审批与执行中途中断。
 */
export class EnvironmentBridge {
  private environments = new Map<string, RemoteEnvEntry>();
  private turnToEnv = new Map<string, string>();
  private approvalToEnv = new Map<string, string>();
  private heartbeatTimer: NodeJS.Timeout;

  constructor() {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const env of this.environments.values()) {
        if (env.status === 'online' && env.socket) {
          if (now - env.lastSeenAt > 60_000) {
            this.markOffline(env.environmentId);
          } else {
            try {
              env.socket.ping();
            } catch {
              this.markOffline(env.environmentId);
            }
          }
        }
      }
    }, 20_000);
    this.heartbeatTimer.unref();
  }

  public handleConnection(
    socket: WebSocket,
    meta: { environmentId?: string; userId?: string; hostname?: string; platform?: string; arch?: string }
  ): void {
    const fallbackId =
      meta.environmentId ||
      `env_${Buffer.from(`${meta.userId || 'anon'}:${meta.hostname || Date.now()}`).toString('hex').slice(0, 10)}`;
    let boundId = fallbackId;

    const ensureEntry = (id: string, info?: Partial<RemoteEnvEntry>): RemoteEnvEntry => {
      const existing = this.environments.get(id);
      if (existing) {
        if (existing.socket && existing.socket !== socket) {
          try {
            existing.socket.close();
          } catch {}
        }
        existing.socket = socket;
        existing.status = 'online';
        existing.lastSeenAt = Date.now();
        if (info?.hostname) existing.hostname = info.hostname;
        if (info?.label) existing.label = info.label;
        if (info?.platform) existing.platform = info.platform;
        if (info?.arch) existing.arch = info.arch;
        if (info?.userId) existing.userId = info.userId;
        if (info?.snapshots) existing.snapshots = info.snapshots;
        return existing;
      }

      const created: RemoteEnvEntry = {
        environmentId: id,
        label: info?.label || info?.hostname || id,
        hostname: info?.hostname || 'Remote Host',
        platform: info?.platform || 'linux',
        arch: info?.arch || 'x64',
        userId: info?.userId,
        status: 'online',
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        snapshots: info?.snapshots || [],
        socket,
        pendingRequests: new Map(),
        activeTurnQueues: new Map()
      };
      this.environments.set(id, created);
      return created;
    };

    ensureEntry(boundId, {
      hostname: meta.hostname,
      platform: meta.platform,
      arch: meta.arch,
      userId: meta.userId
    });

    socket.on('pong', () => {
      const env = this.environments.get(boundId);
      if (env) env.lastSeenAt = Date.now();
    });

    socket.on('message', (raw) => {
      const env = this.environments.get(boundId);
      if (env) env.lastSeenAt = Date.now();

      let msg: RpcMessage;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }

      // 响应来自远端节点的 RPC 结果
      if (msg.id && !msg.method && env) {
        const pending = env.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          env.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message || 'Remote RPC error'));
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }

      // 处理来自远端节点的请求/通知
      if (msg.method === 'env.register') {
        const p = msg.params || {};
        boundId = p.environmentId || boundId;
        const entry = ensureEntry(boundId, {
          label: p.label || p.hostname,
          hostname: p.hostname,
          platform: p.platform,
          arch: p.arch,
          userId: meta.userId || p.userId,
          snapshots: Array.isArray(p.snapshots) ? p.snapshots : []
        });
        if (msg.id) {
          this.sendRaw(socket, { jsonrpc: '2.0', id: msg.id, result: { ok: true, environmentId: entry.environmentId } });
        }
        return;
      }

      if (msg.method === 'env.snapshots.push' && env) {
        const snapshots = msg.params?.snapshots;
        if (Array.isArray(snapshots)) {
          env.snapshots = snapshots;
        }
        if (msg.id) {
          this.sendRaw(socket, { jsonrpc: '2.0', id: msg.id, result: { ok: true } });
        }
        return;
      }

      if (msg.method === 'env.turn.event' && env) {
        const { turnId, event } = msg.params || {};
        const queue = turnId ? env.activeTurnQueues.get(turnId) : undefined;
        if (queue && event) {
          if (event.type === 'approval.request' && event.requestId) {
            this.approvalToEnv.set(event.requestId, env.environmentId);
          }
          queue.push(event as AgentRuntimeEvent);
          if (
            event.type === 'turn.completed' ||
            event.type === 'turn.failed' ||
            event.type === 'turn.interrupted'
          ) {
            queue.close();
            env.activeTurnQueues.delete(turnId);
          }
        }
      }
    });

    socket.on('close', () => {
      this.markOffline(boundId);
    });

    socket.on('error', () => {
      this.markOffline(boundId);
    });
  }

  private markOffline(environmentId: string): void {
    const env = this.environments.get(environmentId);
    if (!env) return;
    env.status = 'offline';
    env.socket = undefined;
    for (const [reqId, pending] of env.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      env.pendingRequests.delete(reqId);
      pending.reject(new Error(`远程环境 (${env.label}) 连接已断开`));
    }
    for (const [turnId, queue] of env.activeTurnQueues.entries()) {
      env.activeTurnQueues.delete(turnId);
      queue.push({ type: 'turn.failed', error: `远程环境 (${env.label}) 连接意外断开` });
      queue.close();
    }
  }

  private sendRaw(socket: WebSocket, payload: RpcMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  private callRpc<T = any>(
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs = 20_000
  ): Promise<T> {
    const env = this.environments.get(environmentId);
    if (!env || env.status !== 'online' || !env.socket || env.socket.readyState !== env.socket.OPEN) {
      return Promise.reject(new Error(`远程环境 ${environmentId} 不在线`));
    }

    const id = `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        env.pendingRequests.delete(id);
        reject(new Error(`远程环境 RPC (${method}) 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      env.pendingRequests.set(id, { resolve, reject, timer });
      this.sendRaw(env.socket!, { jsonrpc: '2.0', id, method, params });
    });
  }

  public canUserAccess(environmentId: string, userId?: string): boolean {
    const env = this.environments.get(environmentId);
    if (!env) return false;
    if (!env.userId || env.userId === 'default-mesh-token' || env.userId === 'user_web' || env.userId === 'admin') {
      return true;
    }
    return Boolean(userId && env.userId === userId);
  }

  public listEnvironments(userId?: string): EnvironmentInfo[] {
    return Array.from(this.environments.values())
      .filter((env) => !userId || this.canUserAccess(env.environmentId, userId))
      .map((env) => ({
        environmentId: env.environmentId,
        label: env.label,
        kind: 'remote' as const,
        hostname: env.hostname,
        platform: env.platform,
        arch: env.arch,
        status: env.status,
        connectedAt: env.connectedAt,
        lastSeenAt: env.lastSeenAt,
        snapshots: env.snapshots
      }));
  }

  public getEnvironment(environmentId: string): EnvironmentInfo | undefined {
    const env = this.environments.get(environmentId);
    if (!env) return undefined;
    return {
      environmentId: env.environmentId,
      label: env.label,
      kind: 'remote',
      hostname: env.hostname,
      platform: env.platform,
      arch: env.arch,
      status: env.status,
      connectedAt: env.connectedAt,
      lastSeenAt: env.lastSeenAt,
      snapshots: env.snapshots
    };
  }

  public async probeInstance(instance: ProviderInstanceConfig): Promise<ProviderSnapshot> {
    const env = this.environments.get(instance.environmentId);
    if (!env || env.status !== 'online') {
      return {
        instanceId: instance.instanceId,
        driver: instance.driver,
        displayName: instance.displayName,
        enabled: instance.enabled,
        installed: false,
        status: 'not_found',
        version: null,
        auth: { status: 'unknown' },
        models: [],
        checkedAt: Date.now(),
        environmentId: instance.environmentId,
        environmentLabel: env?.label || instance.environmentId,
        message: '目标远程环境当前离线'
      };
    }

    const res = await this.callRpc<{ snapshot: ProviderSnapshot }>(
      instance.environmentId,
      'env.probe',
      { instance },
      25_000
    );
    return res.snapshot;
  }

  public async *runTurn(params: TurnRunParams): AsyncGenerator<AgentRuntimeEvent, void, void> {
    const envId = params.instance.environmentId;
    const env = this.environments.get(envId);
    if (!env || env.status !== 'online') {
      yield {
        type: 'turn.failed',
        error: `远程环境 (${env?.label || envId}) 当前不在线，请先在对应终端保持伴侣连接。`
      };
      return;
    }

    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const queue = new AsyncPushQueue<AgentRuntimeEvent>();
    env.activeTurnQueues.set(turnId, queue);
    this.turnToEnv.set(params.sessionKey, envId);

    const onAbort = () => {
      void this.interruptTurn(params.sessionKey);
    };
    params.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await this.callRpc(
        envId,
        'env.turn.start',
        {
          turnId,
          sessionKey: params.sessionKey,
          instance: params.instance,
          prompt: params.prompt,
          systemPrompt: params.systemPrompt,
          cwd: params.cwd,
          model: params.model,
          effort: params.effort,
          permissionMode: params.permissionMode,
          resumeSessionId: params.resumeSessionId
        },
        15_000
      );

      for await (const ev of queue) {
        yield ev;
      }
    } catch (err: any) {
      env.activeTurnQueues.delete(turnId);
      yield { type: 'turn.failed', error: err?.message || String(err) };
    } finally {
      params.signal?.removeEventListener('abort', onAbort);
      env.activeTurnQueues.delete(turnId);
      if (this.turnToEnv.get(params.sessionKey) === envId) {
        this.turnToEnv.delete(params.sessionKey);
      }
    }
  }

  public async interruptTurn(sessionKey: string): Promise<void> {
    const envId = this.turnToEnv.get(sessionKey);
    if (!envId) return;
    await this.callRpc(envId, 'env.turn.interrupt', { sessionKey }, 5000).catch(() => {});
  }

  public async respondApproval(requestId: string, decision: ApprovalDecision): Promise<boolean> {
    const envId = this.approvalToEnv.get(requestId);
    if (!envId) return false;
    this.approvalToEnv.delete(requestId);
    const res = await this.callRpc<{ ok: boolean }>(
      envId,
      'env.approval.respond',
      { requestId, decision },
      5000
    ).catch(() => ({ ok: false }));
    return Boolean(res?.ok);
  }

  public async closeSession(sessionKey: string, environmentId?: string): Promise<void> {
    const envId = environmentId || this.turnToEnv.get(sessionKey);
    if (!envId) return;
    await this.callRpc(envId, 'env.session.close', { sessionKey }, 5000).catch(() => {});
  }

  public dispose(): void {
    clearInterval(this.heartbeatTimer);
    for (const env of this.environments.values()) {
      try {
        env.socket?.close();
      } catch {}
    }
    this.environments.clear();
  }
}

export const globalEnvironmentBridge = new EnvironmentBridge();
