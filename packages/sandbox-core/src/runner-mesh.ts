import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { LocalAgentInfo } from './local-agent-prober.ts';
import type { LocalAgentRunResult } from './local-agent-runner.ts';

export interface RemoteRunnerRuntime {
  id: string;
  name: string;
  version?: string;
  executablePath?: string;
  models: string[];
  defaultModel: string;
  protocol?: string;
}

export interface RunnerMachine {
  id: string;
  hostname: string;
  platform: string;
  arch: string;
  ip?: string;
  token?: string;
  userId?: string;
  status: 'online' | 'offline';
  registeredAt: number;
  lastHeartbeat: number;
  runtimes: RemoteRunnerRuntime[];
  activeTaskCount: number;
}

export interface RunnerTask {
  taskId: string;
  agentId: string;
  model?: string;
  prompt: string;
  timeoutMs: number;
  createdAt: number;
}

interface PendingTaskDispatcher {
  task: RunnerTask;
  machineId: string;
  resolve: (res: LocalAgentRunResult) => void;
  reject: (err: Error) => void;
  onChunk?: (chunk: string) => void;
  timer: NodeJS.Timeout;
}

/**
 * 远程计算节点 Mesh 管理中心 (RunnerMeshManager)
 * 统一管理通过反向 HTTP/长轮询连接到云端 Gateway 的用户个人计算节点，
 * 负责机器上下线感知、健康心跳保活、任务分发路由与流式分块中继。
 */
export class RunnerMeshManager extends EventEmitter {
  private machines = new Map<string, RunnerMachine>();
  private pollWaiters = new Map<string, (task: RunnerTask | null) => void>();
  private pendingTasks = new Map<string, PendingTaskDispatcher>();
  private taskQueues = new Map<string, RunnerTask[]>();
  private persistPath: string;

  constructor(customPersistPath?: string) {
    super();
    this.persistPath = customPersistPath || path.resolve(process.cwd(), 'data', 'runner-mesh.json');
    this.loadPersistentState();
    this.startHeartbeatSweep();
    this.on('machine:offline', (machine: RunnerMachine) => {
      for (const [taskId, pending] of this.pendingTasks.entries()) {
        if (pending.machineId === machine.id) {
          clearTimeout(pending.timer);
          this.pendingTasks.delete(taskId);
          pending.resolve({
            ok: false,
            text: '',
            latencyMs: 0,
            error: `远程计算节点 (${machine.hostname}) 意外离线断开连接`
          });
        }
      }
    });
  }

  private savePersistentState(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.machines.values());
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf8');
    } catch {}
  }

  private loadPersistentState(): void {
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = fs.readFileSync(this.persistPath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const m of list) {
            if (m && m.id) {
              this.machines.set(m.id, {
                ...m,
                status: 'offline',
                activeTaskCount: 0
              });
              if (!this.taskQueues.has(m.id)) {
                this.taskQueues.set(m.id, []);
              }
            }
          }
        }
      }
    } catch {}
  }

  public getMachine(machineId: string): RunnerMachine | undefined {
    return this.machines.get(machineId);
  }

  /**
   * 注册或更新远程计算节点
   */
  public registerMachine(input: {
    machineId?: string;
    hostname?: string;
    platform?: string;
    arch?: string;
    ip?: string;
    token?: string;
    userId?: string;
    runtimes?: RemoteRunnerRuntime[];
  }): { success: boolean; machineId: string; heartbeatIntervalMs: number } {
    const id = input.machineId || `node_${Math.random().toString(36).slice(2, 10)}`;
    const now = Date.now();
    const existing = this.machines.get(id);

    const userId = input.userId || existing?.userId || (input.token ? input.token.trim() : undefined);

    const machine: RunnerMachine = {
      id,
      hostname: input.hostname || existing?.hostname || 'Unknown Host',
      platform: input.platform || existing?.platform || 'darwin',
      arch: input.arch || existing?.arch || 'arm64',
      ip: input.ip || existing?.ip || '127.0.0.1',
      token: input.token || existing?.token,
      userId,
      status: 'online',
      registeredAt: existing?.registeredAt || now,
      lastHeartbeat: now,
      runtimes: input.runtimes || existing?.runtimes || [],
      activeTaskCount: existing?.activeTaskCount || 0
    };

    this.machines.set(id, machine);
    if (!this.taskQueues.has(id)) {
      this.taskQueues.set(id, []);
    }

    this.savePersistentState();
    this.emit('machine:registered', machine);
    return { success: true, machineId: id, heartbeatIntervalMs: 15000 };
  }

  /**
   * 记录机器心跳保活
   */
  public heartbeat(machineId: string): boolean {
    const machine = this.machines.get(machineId);
    if (!machine) return false;
    machine.lastHeartbeat = Date.now();
    machine.status = 'online';
    return true;
  }

  /**
   * 远程 Runner 长轮询获取派发任务
   */
  public async pollTask(machineId: string, timeoutMs = 25000): Promise<RunnerTask | null> {
    const machine = this.machines.get(machineId);
    if (machine) {
      machine.lastHeartbeat = Date.now();
      machine.status = 'online';
    }

    const queue = this.taskQueues.get(machineId) || [];
    if (queue.length > 0) {
      const task = queue.shift()!;
      if (machine) machine.activeTaskCount++;
      return task;
    }

    return new Promise<RunnerTask | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pollWaiters.delete(machineId);
        resolve(null);
      }, timeoutMs);

      this.pollWaiters.set(machineId, (task) => {
        clearTimeout(timer);
        this.pollWaiters.delete(machineId);
        if (task && machine) machine.activeTaskCount++;
        resolve(task);
      });
    });
  }

  /**
   * 接收远程 Runner 传回的执行流式分块
   */
  public streamTaskChunk(taskId: string, chunk: string): boolean {
    const pending = this.pendingTasks.get(taskId);
    if (!pending) return false;
    if (pending.onChunk) {
      pending.onChunk(chunk);
    }
    return true;
  }

  /**
   * 接收远程 Runner 提交的任务最终结果
   */
  public completeTask(
    taskId: string,
    result: { ok: boolean; text: string; error?: string; latencyMs?: number }
  ): boolean {
    const pending = this.pendingTasks.get(taskId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingTasks.delete(taskId);

    const machine = this.machines.get(pending.machineId);
    if (machine && machine.activeTaskCount > 0) {
      machine.activeTaskCount--;
    }

    pending.resolve({
      ok: result.ok,
      text: result.text || '',
      latencyMs: result.latencyMs || 0,
      error: result.error
    });
    return true;
  }

  /**
   * 寻找具备指定 Agent 运行时的在线计算节点 (优先匹配指定用户专属节点)
   */
  public findAvailableRunnerForAgent(agentId: string, userId?: string): RunnerMachine | null {
    const candidates: RunnerMachine[] = [];
    const now = Date.now();

    for (const machine of this.machines.values()) {
      if (machine.status === 'online' && now - machine.lastHeartbeat <= 45000) {
        // 多租户隔离：若指定了用户，且机器已明确绑定其他具体用户，则跳过
        if (
          userId &&
          machine.userId &&
          machine.userId !== userId &&
          machine.userId !== 'default-mesh-token' &&
          machine.userId !== 'user_web'
        ) {
          continue;
        }
        if (machine.runtimes.some((r) => r.id === agentId)) {
          candidates.push(machine);
        }
      }
    }

    if (candidates.length === 0) return null;

    // 优先分配当前用户的专属计算节点
    if (userId) {
      const userOwned = candidates.filter((m) => m.userId === userId);
      if (userOwned.length > 0) {
        userOwned.sort((a, b) => a.activeTaskCount - b.activeTaskCount);
        return userOwned[0];
      }
    }

    candidates.sort((a, b) => a.activeTaskCount - b.activeTaskCount);
    return candidates[0];
  }

  /**
   * 向指定或自动匹配的远程计算节点分发 Agent 执行请求
   */
  public async dispatchTask(
    agentId: string,
    prompt: string,
    options: {
      model?: string;
      timeoutMs?: number;
      targetMachineId?: string;
      userId?: string;
      onChunk?: (chunk: string) => void;
    } = {}
  ): Promise<LocalAgentRunResult> {
    const target = options.targetMachineId
      ? this.machines.get(options.targetMachineId)
      : this.findAvailableRunnerForAgent(agentId, options.userId);

    if (!target) {
      const userHint = options.userId ? ` (所属用户: ${options.userId})` : '';
      return {
        ok: false,
        text: '',
        latencyMs: 0,
        error: `未在服务器或已连接的远程计算节点${userHint}中找到 ${agentId} 运行时。请在拥有该 Agent 的个人电脑终端运行伴侣命令接入网关。`
      };
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeoutMs = options.timeoutMs || 120000;
    const task: RunnerTask = {
      taskId,
      agentId,
      model: options.model,
      prompt,
      timeoutMs,
      createdAt: Date.now()
    };

    return new Promise<LocalAgentRunResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        if (target.activeTaskCount > 0) target.activeTaskCount--;
        resolve({
          ok: false,
          text: '',
          latencyMs: timeoutMs,
          error: `远程计算节点 (${target.hostname}) 执行任务超时 (${timeoutMs / 1000}s)`
        });
      }, timeoutMs + 5000);

      this.pendingTasks.set(taskId, {
        task,
        machineId: target.id,
        resolve,
        reject,
        onChunk: options.onChunk,
        timer
      });

      const waiter = this.pollWaiters.get(target.id);
      if (waiter) {
        waiter(task);
      } else {
        const queue = this.taskQueues.get(target.id) || [];
        queue.push(task);
        this.taskQueues.set(target.id, queue);
      }
    });
  }

  /**
   * 获取连接节点的状态清单 (支持按用户过滤)
   */
  public listMachines(userId?: string): Array<Omit<RunnerMachine, 'token'>> {
    const now = Date.now();
    return Array.from(this.machines.values())
      .filter((m) => !userId || !m.userId || m.userId === userId || m.userId === 'default-mesh-token' || m.userId === 'user_web')
      .map((m) => {
        const isAlive = now - m.lastHeartbeat <= 45000;
        return {
          id: m.id,
          hostname: m.hostname,
          platform: m.platform,
          arch: m.arch,
          ip: m.ip,
          userId: m.userId,
          status: isAlive ? 'online' : 'offline',
          registeredAt: m.registeredAt,
          lastHeartbeat: m.lastHeartbeat,
          runtimes: m.runtimes,
          activeTaskCount: m.activeTaskCount
        };
      });
  }

  /**
   * 聚合在线远程节点报告的 Agent 列表 (支持按用户过滤)
   */
  public getAggregatedRemoteAgents(userId?: string): LocalAgentInfo[] {
    const agentsMap = new Map<string, LocalAgentInfo>();
    const now = Date.now();

    for (const machine of this.machines.values()) {
      if (machine.status === 'online' && now - machine.lastHeartbeat <= 45000) {
        if (
          userId &&
          machine.userId &&
          machine.userId !== userId &&
          machine.userId !== 'default-mesh-token' &&
          machine.userId !== 'user_web'
        ) {
          continue;
        }
        for (const r of machine.runtimes) {
          const existing = agentsMap.get(r.id);
          const models = Array.from(new Set([...(existing?.candidateModels || []), ...r.models]));
          agentsMap.set(r.id, {
            id: r.id as any,
            name: `${r.name} (远程节点: ${machine.hostname})`,
            installed: true,
            version: r.version,
            executablePath: r.executablePath,
            protocol: (r.protocol as any) || 'acp-stdio',
            description: `运行在远程计算节点 ${machine.hostname} (${machine.ip || 'LAN'}) 上的企业 Agent 运行时`,
            candidateModels: models,
            defaultModel: existing?.defaultModel || r.defaultModel || models[0] || ''
          });
        }
      }
    }

    return Array.from(agentsMap.values());
  }

  /**
   * 定期清理离线节点状态
   */
  private startHeartbeatSweep(): void {
    setInterval(() => {
      const now = Date.now();
      for (const machine of this.machines.values()) {
        if (machine.status === 'online' && now - machine.lastHeartbeat > 45000) {
          machine.status = 'offline';
          this.emit('machine:offline', machine);
        }
      }
    }, 15000).unref();
  }
}

export const globalRunnerMesh = new RunnerMeshManager();
