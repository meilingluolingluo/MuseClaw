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

const CURATED_CODEX_MODELS: ProviderModelDescriptor[] = [
  { slug: 'gpt-5.4', name: 'GPT-5.4', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] },
  { slug: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] },
  { slug: 'o3', name: 'o3', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
  { slug: 'gpt-4o', name: 'GPT-4o', supportsEffort: false }
];

function discoverCodexLocalConfig(configDir?: string): {
  models: ProviderModelDescriptor[];
  activeModel?: string;
  customEndpoint?: string;
} {
  const home = expandHomePath(configDir) || join(homedir(), '.codex');
  const configPath = join(home, 'config.toml');
  const bySlug = new Map<string, ProviderModelDescriptor>();
  let activeModel = '';
  let customEndpoint = '';

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf8');
      const modelMatch = content.match(/^model\s*=\s*["']([^"']+)["']/m);
      if (modelMatch?.[1]) {
        activeModel = modelMatch[1].trim();
        bySlug.set(activeModel, { slug: activeModel, name: activeModel });
      }
      const urlMatch = content.match(/^openai_base_url\s*=\s*["']([^"']+)["']/m);
      if (urlMatch?.[1]) {
        customEndpoint = urlMatch[1].trim();
      }
      const catalogMatch = content.match(/^model_catalog_json\s*=\s*["']([^"']+)["']/m);
      if (catalogMatch?.[1] && existsSync(catalogMatch[1])) {
        const raw = JSON.parse(readFileSync(catalogMatch[1], 'utf8'));
        if (Array.isArray(raw.models)) {
          for (const m of raw.models) {
            const id = m.id || m.slug || m.name || m.display_name;
            if (typeof id === 'string' && id.trim()) {
              bySlug.set(id.trim(), { slug: id.trim(), name: m.display_name || id.trim() });
            }
          }
        }
      }
    } catch {
      // 忽略损坏配置
    }
  }

  for (const m of CURATED_CODEX_MODELS) {
    if (!bySlug.has(m.slug)) bySlug.set(m.slug, m);
  }

  return {
    models: Array.from(bySlug.values()),
    activeModel: activeModel || undefined,
    customEndpoint: customEndpoint || undefined
  };
}

interface ActiveCodexTurn {
  child: NodeChildProcess.ChildProcess;
  interrupted: boolean;
}

export class CodexProviderDriver implements ProviderDriver {
  public readonly kind = 'codex' as const;
  public readonly supportsNativeSession = true;
  private activeTurns = new Map<string, ActiveCodexTurn>();

  public async probe(
    instance: ProviderInstanceConfig,
    options?: { environmentId?: string; environmentLabel?: string }
  ): Promise<ProviderSnapshot> {
    const envId = options?.environmentId || instance.environmentId || 'local';
    const envLabel = options?.environmentLabel || '本机环境';
    const now = Date.now();
    const discovered = discoverCodexLocalConfig(instance.configDir);

    for (const slug of instance.customModels || []) {
      const clean = slug.trim();
      if (clean && !discovered.models.some((m) => m.slug === clean)) {
        discovered.models.push({ slug: clean, name: clean, isCustom: true });
      }
    }

    if (!instance.enabled) {
      return {
        instanceId: instance.instanceId,
        driver: 'codex',
        displayName: instance.displayName,
        enabled: false,
        installed: false,
        status: 'disabled',
        version: null,
        auth: { status: 'unknown' },
        models: discovered.models,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: 'npm i -g @openai/codex',
        message: '已在设置中禁用此实例'
      };
    }

    const exe = instance.binaryPath
      ? findExecutableInPath(instance.binaryPath)
      : findExecutableInPath('codex');

    if (!exe) {
      return {
        instanceId: instance.instanceId,
        driver: 'codex',
        displayName: instance.displayName,
        enabled: true,
        installed: false,
        status: 'not_found',
        version: null,
        auth: { status: 'unknown' },
        models: discovered.models,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: 'npm i -g @openai/codex',
        message: '未在系统 PATH 中检测到 codex 命令'
      };
    }

    const ver = await executeVersionProbe(exe, ['--version'], 8000);
    const hasCustomKey = Boolean(instance.apiKey?.trim() || instance.env?.OPENAI_API_KEY || process.env.OPENAI_API_KEY);
    const codexHome = expandHomePath(instance.configDir) || join(homedir(), '.codex');
    const hasAuthJson = existsSync(join(codexHome, 'auth.json'));

    const authenticated = hasCustomKey || hasAuthJson || Boolean(discovered.customEndpoint);
    return {
      instanceId: instance.instanceId,
      driver: 'codex',
      displayName: instance.displayName,
      enabled: true,
      installed: ver.ok,
      status: !ver.ok ? 'error' : authenticated ? 'ready' : 'unauthenticated',
      version: ver.version || null,
      executablePath: exe,
      auth: authenticated
        ? {
            status: 'authenticated',
            method: hasCustomKey ? 'apiKey' : 'chatgpt',
            label: discovered.customEndpoint ? '自定义端点' : hasCustomKey ? 'OpenAI API Key' : 'Codex 本地凭据',
            ...(discovered.customEndpoint ? { endpoint: discovered.customEndpoint } : {})
          }
        : { status: 'unauthenticated', method: 'none', label: '未登录认证' },
      models: discovered.models,
      checkedAt: now,
      environmentId: envId,
      environmentLabel: envLabel,
      installCommand: 'npm i -g @openai/codex',
      ...(!ver.ok ? { message: ver.error } : !authenticated ? { message: '请在终端运行 codex login 或配置 OPENAI_API_KEY' } : {})
    };
  }

  public async *runTurn(params: TurnRunParams): AsyncGenerator<AgentRuntimeEvent, void, void> {
    const exe = params.instance.binaryPath
      ? findExecutableInPath(params.instance.binaryPath)
      : findExecutableInPath('codex');

    if (!exe) {
      yield { type: 'turn.failed', code: 'not_found', error: '未检测到 codex 可执行文件' };
      return;
    }

    const startedAt = Date.now();
    const cwd = expandHomePath(params.cwd || params.instance.cwd) || process.cwd();
    const extraArgs = parseCliExtraArgs(params.instance.extraArgs);
    const model = params.model || params.instance.model;

    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (params.resumeSessionId) {
      args.push('resume', params.resumeSessionId);
    } else {
      args.push('--ephemeral');
    }
    if (model && model !== 'default') {
      args.push('--model', model);
    }
    const perm = params.permissionMode || params.instance.permissionMode;
    if (perm === 'full') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (perm === 'auto_edits') {
      args.push('--full-auto');
    }
    if (extraArgs.length > 0) args.push(...extraArgs);
    args.push('-');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: getAugmentedPath()
    };
    const expandedConfigDir = expandHomePath(params.instance.configDir);
    if (expandedConfigDir) env.CODEX_HOME = expandedConfigDir;
    if (params.instance.apiKey?.trim()) env.OPENAI_API_KEY = params.instance.apiKey.trim();
    if (params.instance.baseUrl?.trim() && !params.instance.baseUrl.startsWith('local://')) {
      env.OPENAI_BASE_URL = params.instance.baseUrl.trim();
    }
    if (params.instance.env) {
      for (const [k, v] of Object.entries(params.instance.env)) {
        if (typeof v === 'string' && v.trim()) env[k] = v.trim();
      }
    }

    const target = resolveExecutableLaunchTarget(exe);
    const child = NodeChildProcess.spawn(target.command, [...target.argsPrefix, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true
    });

    const activeTurn: ActiveCodexTurn = { child, interrupted: false };
    this.activeTurns.set(params.sessionKey, activeTurn);

    const onAbort = () => {
      void this.interruptTurn(params.sessionKey);
    };
    params.signal?.addEventListener('abort', onAbort, { once: true });

    const queue = new AsyncPushQueue<AgentRuntimeEvent>();
    const fullPrompt = params.systemPrompt ? `[System]\n${params.systemPrompt}\n\n[User]\n${params.prompt}` : params.prompt;
    child.stdin?.write(fullPrompt);
    child.stdin?.end();

    let buf = '';
    let stderr = '';
    const messages: string[] = [];
    const reasoningParts: string[] = [];
    let threadId: string | undefined = params.resumeSessionId;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, any>;
        if (parsed.type === 'thread.started' && typeof parsed.thread_id === 'string') {
          threadId = parsed.thread_id;
          queue.push({ type: 'session.started', providerSessionId: parsed.thread_id });
        } else if (parsed.type === 'item.started' && parsed.item?.type === 'command_execution') {
          queue.push({
            type: 'tool.start',
            toolCallId: parsed.item.id || `cmd_${Date.now()}`,
            toolName: 'Bash',
            input: { command: parsed.item.command || '' }
          });
        } else if (parsed.type === 'item.completed' && parsed.item) {
          if (parsed.item.type === 'reasoning' && parsed.item.text) {
            const r = String(parsed.item.text).trim();
            if (r) {
              reasoningParts.push(r);
              queue.push({ type: 'reasoning.delta', text: r });
            }
          } else if (parsed.item.type === 'agent_message' && parsed.item.text) {
            const txt = String(parsed.item.text).replace(/\n\nSkipped:[\s\S]*$/, '').trim();
            if (txt) {
              messages.push(txt);
              queue.push({ type: 'text.delta', text: txt });
            }
          } else if (parsed.item.type === 'command_execution') {
            queue.push({
              type: 'tool.end',
              toolCallId: parsed.item.id || `cmd_${Date.now()}`,
              toolName: 'Bash',
              output: parsed.item.aggregated_output || '',
              isError: Boolean(parsed.item.exit_code && parsed.item.exit_code !== 0),
              durationMs: 0
            });
          }
        }
      } catch {
        // 忽略非 JSON 行
      }
    };

    child.stdout?.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const l of lines) handleLine(l);
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (buf.trim()) handleLine(buf);
      this.activeTurns.delete(params.sessionKey);
      if (activeTurn.interrupted) {
        queue.push({ type: 'turn.interrupted', reason: '用户已中断执行' });
      } else if (code === 0) {
        queue.push({
          type: 'turn.completed',
          text: messages.join('\n\n').trim(),
          reasoning: reasoningParts.length > 0 ? reasoningParts.join('\n\n') : undefined,
          providerSessionId: threadId,
          durationMs: Date.now() - startedAt
        });
      } else {
        queue.push({
          type: 'turn.failed',
          error: stderr.trim() || `Codex 异常退出 (code ${code})`
        });
      }
      queue.close();
    });

    child.on('error', (err) => {
      this.activeTurns.delete(params.sessionKey);
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
    const active = this.activeTurns.get(sessionKey);
    if (!active) return;
    active.interrupted = true;
    if (active.child.pid) signalProcessGroup(active.child.pid, 'SIGTERM');
  }

  public async respondApproval(_requestId: string, _decision: ApprovalDecision): Promise<boolean> {
    return false;
  }

  public async closeSession(sessionKey: string): Promise<void> {
    await this.interruptTurn(sessionKey);
  }

  public async disposeAll(): Promise<void> {
    for (const key of Array.from(this.activeTurns.keys())) {
      await this.closeSession(key);
    }
  }
}
