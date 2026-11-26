import * as NodeChildProcess from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AsyncPushQueue } from './async-queue.ts';
import {
  executeVersionProbe,
  expandHomePath,
  findExecutableInPath,
  getAugmentedPath,
  parseCliExtraArgs,
  resolveExecutableLaunchTarget,
  signalProcessGroup
} from './executable.ts';
import type {
  AgentRuntimeEvent,
  ApprovalDecision,
  ProviderDriver,
  ProviderInstanceConfig,
  ProviderModelDescriptor,
  ProviderSnapshot,
  TurnRunParams
} from './types.ts';

const CURATED_PI_MODELS: ProviderModelDescriptor[] = [
  { slug: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (via Pi)' },
  { slug: 'openai/gpt-5.4', name: 'GPT-5.4 (via Pi)' },
  { slug: 'deepseek/deepseek-chat', name: 'DeepSeek Chat (via Pi)' }
];

function discoverPiModels(configDir?: string): ProviderModelDescriptor[] {
  const dir = expandHomePath(configDir) || join(homedir(), '.pi', 'agent');
  const modelsPath = join(dir, 'models.json');
  const bySlug = new Map<string, ProviderModelDescriptor>();

  if (existsSync(modelsPath)) {
    try {
      const raw = JSON.parse(readFileSync(modelsPath, 'utf8'));
      if (raw.providers && typeof raw.providers === 'object') {
        for (const [providerName, provider] of Object.entries(raw.providers as Record<string, any>)) {
          if (Array.isArray(provider?.models)) {
            for (const m of provider.models) {
              const id = m.id || m.name;
              if (typeof id === 'string' && id.trim()) {
                const slug = id.includes('/') ? id.trim() : `${providerName}/${id.trim()}`;
                bySlug.set(slug, { slug, name: m.name || slug });
              }
            }
          }
        }
      }
    } catch {
      // 忽略损坏配置
    }
  }

  for (const m of CURATED_PI_MODELS) {
    if (!bySlug.has(m.slug)) bySlug.set(m.slug, m);
  }
  return Array.from(bySlug.values());
}

interface LivePiSession {
  child: NodeChildProcess.ChildProcess;
  pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: Error) => void }>;
  activeTurnQueue?: AsyncPushQueue<AgentRuntimeEvent>;
  interrupted: boolean;
}

export class PiProviderDriver implements ProviderDriver {
  public readonly kind = 'pi' as const;
  public readonly supportsNativeSession = true;
  private sessions = new Map<string, LivePiSession>();

  public async probe(
    instance: ProviderInstanceConfig,
    options?: { environmentId?: string; environmentLabel?: string }
  ): Promise<ProviderSnapshot> {
    const envId = options?.environmentId || instance.environmentId || 'local';
    const envLabel = options?.environmentLabel || '本机环境';
    const now = Date.now();
    const models = discoverPiModels(instance.configDir);

    for (const slug of instance.customModels || []) {
      const clean = slug.trim();
      if (clean && !models.some((m) => m.slug === clean)) {
        models.push({ slug: clean, name: clean, isCustom: true });
      }
    }

    if (!instance.enabled) {
      return {
        instanceId: instance.instanceId,
        driver: 'pi',
        displayName: instance.displayName,
        enabled: false,
        installed: false,
        status: 'disabled',
        version: null,
        auth: { status: 'unknown' },
        models,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: 'npm i -g @mariozechner/pi-coding-agent',
        message: '已在设置中禁用此实例'
      };
    }

    const exe = instance.binaryPath
      ? findExecutableInPath(instance.binaryPath)
      : findExecutableInPath('pi');

    if (!exe) {
      return {
        instanceId: instance.instanceId,
        driver: 'pi',
        displayName: instance.displayName,
        enabled: true,
        installed: false,
        status: 'not_found',
        version: null,
        auth: { status: 'unknown' },
        models,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: 'npm i -g @mariozechner/pi-coding-agent',
        message: '未在系统 PATH 中检测到 pi 命令'
      };
    }

    const ver = await executeVersionProbe(exe, ['--version'], 8000);
    return {
      instanceId: instance.instanceId,
      driver: 'pi',
      displayName: instance.displayName,
      enabled: true,
      installed: ver.ok,
      status: ver.ok ? 'ready' : 'error',
      version: ver.version || null,
      executablePath: exe,
      auth: { status: ver.ok ? 'authenticated' : 'unknown', label: ver.ok ? '本地就绪' : '状态未知' },
      models,
      checkedAt: now,
      environmentId: envId,
      environmentLabel: envLabel,
      installCommand: 'npm i -g @mariozechner/pi-coding-agent',
      ...(!ver.ok ? { message: ver.error } : {})
    };
  }

  public async *runTurn(params: TurnRunParams): AsyncGenerator<AgentRuntimeEvent, void, void> {
    const exe = params.instance.binaryPath
      ? findExecutableInPath(params.instance.binaryPath)
      : findExecutableInPath('pi');

    if (!exe) {
      yield { type: 'turn.failed', code: 'not_found', error: '未检测到 pi 可执行文件' };
      return;
    }

    const startedAt = Date.now();
    const cwd = expandHomePath(params.cwd || params.instance.cwd) || process.cwd();
    const extraArgs = parseCliExtraArgs(params.instance.extraArgs);
    const args = ['-p', '--no-session'];
    const model = params.model || params.instance.model;
    if (model && model !== 'default') {
      args.push('--model', model);
    }
    if (extraArgs.length > 0) args.push(...extraArgs);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: getAugmentedPath()
    };
    const expandedConfigDir = expandHomePath(params.instance.configDir);
    if (expandedConfigDir) env.PI_CODING_AGENT_DIR = expandedConfigDir;
    if (params.instance.env) {
      for (const [k, v] of Object.entries(params.instance.env)) {
        if (typeof v === 'string' && v.trim()) env[k] = v.trim();
      }
    }

    const target = resolveExecutableLaunchTarget(exe);
    const fullPrompt = params.systemPrompt ? `[System]\n${params.systemPrompt}\n\n[User]\n${params.prompt}` : params.prompt;
    const child = NodeChildProcess.spawn(target.command, [...target.argsPrefix, ...args, fullPrompt], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true
    });

    const session: LivePiSession = {
      child,
      pendingRequests: new Map(),
      interrupted: false
    };
    this.sessions.set(params.sessionKey, session);

    const onAbort = () => {
      void this.interruptTurn(params.sessionKey);
    };
    params.signal?.addEventListener('abort', onAbort, { once: true });

    const queue = new AsyncPushQueue<AgentRuntimeEvent>();
    session.activeTurnQueue = queue;

    let fullText = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const txt = chunk.toString();
      fullText += txt;
      queue.push({ type: 'text.delta', text: txt });
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      this.sessions.delete(params.sessionKey);
      if (session.interrupted) {
        queue.push({ type: 'turn.interrupted', reason: '用户已中断执行' });
      } else if (code === 0 && fullText.trim()) {
        queue.push({
          type: 'turn.completed',
          text: fullText.trim(),
          durationMs: Date.now() - startedAt
        });
      } else {
        queue.push({
          type: 'turn.failed',
          error: stderr.trim() || `Pi 异常退出 (code ${code})`
        });
      }
      queue.close();
    });
    child.on('error', (err) => {
      this.sessions.delete(params.sessionKey);
      queue.push({ type: 'turn.failed', error: err.message });
      queue.close();
    });

    try {
      for await (const ev of queue) {
        yield ev;
      }
    } finally {
      params.signal?.removeEventListener('abort', onAbort);
    }
  }

  public async interruptTurn(sessionKey: string): Promise<void> {
    const s = this.sessions.get(sessionKey);
    if (!s) return;
    s.interrupted = true;
    if (s.child.pid) signalProcessGroup(s.child.pid, 'SIGTERM');
  }

  public async respondApproval(_requestId: string, _decision: ApprovalDecision): Promise<boolean> {
    return false;
  }

  public async closeSession(sessionKey: string): Promise<void> {
    await this.interruptTurn(sessionKey);
  }

  public async disposeAll(): Promise<void> {
    for (const key of Array.from(this.sessions.keys())) {
      await this.closeSession(key);
    }
  }
}
