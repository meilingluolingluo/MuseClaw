import * as NodeChildProcess from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  query as claudeQuery,
  type CanUseTool,
  type ModelInfo as ClaudeModelInfo,
  type Options as ClaudeQueryOptions,
  type PermissionMode as SdkPermissionMode,
  type PermissionResult,
  type Query as ClaudeQuery,
  type SDKMessage,
  type SDKUserMessage,
  type SpawnOptions as ClaudeSpawnOptions,
  type SpawnedProcess as ClaudeSpawnedProcess
} from '@anthropic-ai/claude-agent-sdk';
import { AsyncPushQueue } from './async-queue.ts';
import {
  executeVersionProbe,
  expandHomePath,
  findExecutableInPath,
  getAugmentedPath,
  isExistingFile,
  parseCliExtraArgs,
  resolveExecutableLaunchTarget,
  signalProcessGroup
} from './executable.ts';
import type {
  AgentRuntimeEvent,
  ApprovalDecision,
  PermissionMode,
  ProviderAuthSnapshot,
  ProviderDriver,
  ProviderInstanceConfig,
  ProviderModelDescriptor,
  ProviderSnapshot,
  ProviderStatus,
  ReasoningEffort,
  TurnRunParams
} from './types.ts';

const CLAUDE_HOST_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_DESKTOP_APP_VERSION',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
  'CLAUDE_AGENT_SDK_VERSION',
  'ELECTRON_RUN_AS_NODE'
];

const CURATED_CLAUDE_MODELS: ProviderModelDescriptor[] = [
  {
    slug: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max']
  },
  {
    slug: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    slug: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    supportsEffort: false
  },
  {
    slug: 'sonnet',
    name: 'Sonnet (别名)',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max']
  },
  {
    slug: 'opus',
    name: 'Opus (别名)',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    slug: 'haiku',
    name: 'Haiku (别名)',
    supportsEffort: false
  }
];

const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'WebSearch',
  'WebFetch',
  'NotebookRead',
  'TodoRead'
]);

const EDIT_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'TodoWrite'
]);

const SESSION_IDLE_TTL_MS = 15 * 60 * 1000;
const PROBE_INIT_TIMEOUT_MS = 15_000;

interface PendingApproval {
  requestId: string;
  toolName: string;
  resolve: (decision: ApprovalDecision) => void;
}

interface LiveClaudeSession {
  sessionKey: string;
  queryRuntime: ClaudeQuery;
  promptQueue: AsyncPushQueue<SDKUserMessage>;
  iterator: AsyncIterator<SDKMessage, void>;
  providerSessionId?: string;
  configFingerprint: string;
  activeModel?: string;
  spawnedChild?: NodeChildProcess.ChildProcess;
  stderrTail: string[];
  lastUsedAt: number;
  activeTurnAbort?: AbortController;
}

function hasClaudeManagedMcpConfig(): boolean {
  const target =
    process.platform === 'darwin'
      ? '/Library/Application Support/ClaudeCode/managed-mcp.json'
      : process.platform === 'win32'
        ? 'C:\\Program Files\\ClaudeCode\\managed-mcp.json'
        : '/etc/claude-code/managed-mcp.json';
  return existsSync(target);
}

function readLocalClaudeSettings(configDir?: string, executablePath?: string): {
  activeModel?: string;
  env: Record<string, string>;
} {
  const env: Record<string, string> = {};
  let activeModel = '';
  const dirs: string[] = [];
  const custom = expandHomePath(configDir);
  if (custom) {
    dirs.push(custom);
  } else {
    dirs.push(join(homedir(), '.claude'));
    if (executablePath) {
      const winMatch = executablePath.match(/^(\/mnt\/[a-zA-Z]\/Users\/[^/]+)\//);
      if (winMatch?.[1]) {
        dirs.push(join(winMatch[1], '.claude'));
      }
    }
  }

  for (const dir of dirs) {
    const file = join(dir, 'settings.json');
    if (!isExistingFile(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
      if (typeof raw.model === 'string' && raw.model.trim()) {
        activeModel = raw.model.trim();
      }
      if (raw.env && typeof raw.env === 'object') {
        for (const [k, v] of Object.entries(raw.env)) {
          if (typeof v === 'string' && v.trim()) env[k] = v.trim();
        }
        if (!activeModel && env.ANTHROPIC_MODEL) activeModel = env.ANTHROPIC_MODEL;
      }
      break;
    } catch {
      // 忽略损坏配置
    }
  }
  return { activeModel: activeModel || undefined, env };
}

export function buildClaudeProcessEnv(instance: ProviderInstanceConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: getAugmentedPath(),
    CLAUDE_CODE_ENTRYPOINT: 'museclaw',
    CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false'
  };

  for (const key of CLAUDE_HOST_SESSION_VARS) {
    delete env[key];
  }

  const expandedConfigDir = expandHomePath(instance.configDir);
  if (expandedConfigDir) {
    env.CLAUDE_CONFIG_DIR = expandedConfigDir;
  }

  if (instance.baseUrl && instance.baseUrl.trim() && !instance.baseUrl.startsWith('local://')) {
    env.ANTHROPIC_BASE_URL = instance.baseUrl.trim();
  }

  if (instance.apiKey && instance.apiKey.trim()) {
    const cleanKey = instance.apiKey.trim();
    env.ANTHROPIC_API_KEY = cleanKey;
    if (env.ANTHROPIC_BASE_URL && !env.ANTHROPIC_AUTH_TOKEN) {
      env.ANTHROPIC_AUTH_TOKEN = cleanKey;
    }
  }

  if (instance.env) {
    for (const [k, v] of Object.entries(instance.env)) {
      if (typeof v === 'string' && v.trim() !== '') {
        env[k] = v.trim();
      }
    }
  }

  return env;
}

function mapSdkModels(
  reported: ClaudeModelInfo[] | undefined,
  customModels: string[] | undefined,
  settingsModel?: string
): ProviderModelDescriptor[] {
  const bySlug = new Map<string, ProviderModelDescriptor>();

  if (settingsModel) {
    bySlug.set(settingsModel, { slug: settingsModel, name: settingsModel, isCustom: true });
  }

  for (const m of reported || []) {
    const slug = m.value?.trim();
    if (!slug || slug === 'default') continue;
    bySlug.set(slug, {
      slug,
      name: m.displayName?.trim() || slug,
      supportsEffort: Boolean(m.supportsEffort),
      supportedEffortLevels: m.supportedEffortLevels ? [...m.supportedEffortLevels] : undefined
    });
  }

  for (const m of CURATED_CLAUDE_MODELS) {
    if (!bySlug.has(m.slug)) {
      bySlug.set(m.slug, m);
    }
  }

  for (const slug of customModels || []) {
    const clean = slug.trim();
    if (clean && !bySlug.has(clean)) {
      bySlug.set(clean, { slug: clean, name: clean, isCustom: true });
    }
  }

  return Array.from(bySlug.values());
}

function probeCliAuthFallback(
  executablePath: string,
  env: NodeJS.ProcessEnv
): Promise<{ loggedIn: boolean; authMethod?: string; email?: string; subscriptionType?: string }> {
  return new Promise((resolve) => {
    const target = resolveExecutableLaunchTarget(executablePath);
    NodeChildProcess.execFile(
      target.command,
      [...target.argsPrefix, 'auth', 'status'],
      { timeout: 5000, maxBuffer: 128 * 1024, env },
      (_err, stdout) => {
        try {
          const trimmed = (stdout || '').trim();
          if (trimmed.startsWith('{')) {
            const parsed = JSON.parse(trimmed);
            return resolve({
              loggedIn: Boolean(parsed.loggedIn),
              authMethod: typeof parsed.authMethod === 'string' ? parsed.authMethod : undefined,
              email: typeof parsed.email === 'string' ? parsed.email : undefined,
              subscriptionType:
                typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : undefined
            });
          }
        } catch {
          // 忽略解析异常
        }
        resolve({ loggedIn: false });
      }
    );
  });
}

function resolveSdkPermissionMode(mode?: PermissionMode): SdkPermissionMode {
  if (mode === 'full') return 'bypassPermissions';
  if (mode === 'auto_edits') return 'acceptEdits';
  return 'default';
}

function makeConfigFingerprint(instance: ProviderInstanceConfig, cwd: string): string {
  return JSON.stringify({
    binaryPath: instance.binaryPath || '',
    configDir: instance.configDir || '',
    cwd,
    baseUrl: instance.baseUrl || '',
    apiKey: instance.apiKey || '',
    extraArgs: instance.extraArgs || '',
    env: instance.env || {},
    permissionMode: instance.permissionMode || 'auto_edits'
  });
}

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' && typeof input.command === 'string') {
    return `执行终端命令: ${input.command.slice(0, 120)}`;
  }
  if ((toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') && typeof input.file_path === 'string') {
    return `修改文件: ${input.file_path}`;
  }
  const preview = JSON.stringify(input).slice(0, 120);
  return `调用工具 ${toolName}: ${preview}`;
}

function formatClaudeError(raw: string): { message: string; code?: string } {
  const lower = raw.toLowerCase();
  if (
    lower.includes('not logged in') ||
    lower.includes('please run /login') ||
    lower.includes('authentication_failed')
  ) {
    return {
      code: 'unauthenticated',
      message: 'Claude Code 尚未登录认证。请在终端执行 `claude auth login` 或在配置中心填写自定义 API 网关与密钥。'
    };
  }
  if (lower.includes('rate_limit') || lower.includes('429')) {
    return { code: 'rate_limit', message: `Claude 请求触发限流: ${raw}` };
  }
  return { message: raw };
}

function parseExtraArgsFlags(extraArgs?: string): Record<string, string | null> | undefined {
  const tokens = parseCliExtraArgs(extraArgs);
  if (tokens.length === 0) return undefined;
  const extra: Record<string, string | null> = {};
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.startsWith('-')) continue;
    const key = tok.replace(/^--?/, '');
    const eqIdx = key.indexOf('=');
    if (eqIdx > 0) {
      extra[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
    } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
      extra[key] = tokens[++i];
    } else {
      extra[key] = null;
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

export class ClaudeProviderDriver implements ProviderDriver {
  public readonly kind = 'claude' as const;
  public readonly supportsNativeSession = true;

  private sessions = new Map<string, LiveClaudeSession>();
  private pendingApprovals = new Map<string, PendingApproval>();
  private activeTurnQueues = new Map<string, AsyncPushQueue<AgentRuntimeEvent>>();
  private idleTimer: NodeJS.Timeout;

  constructor() {
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, session] of this.sessions.entries()) {
        if (!session.activeTurnAbort && now - session.lastUsedAt > SESSION_IDLE_TTL_MS) {
          void this.closeSession(key);
        }
      }
    }, 60_000);
    this.idleTimer.unref();
  }

  private spawnHook(
    onSpawn?: (child: NodeChildProcess.ChildProcess) => void,
    onStderr?: (chunk: string) => void
  ): (spawnOptions: ClaudeSpawnOptions) => ClaudeSpawnedProcess {
    return (spawnOptions: ClaudeSpawnOptions) => {
      const target = resolveExecutableLaunchTarget(spawnOptions.command);
      const child = NodeChildProcess.spawn(target.command, [...target.argsPrefix, ...spawnOptions.args], {
        cwd: spawnOptions.cwd,
        env: spawnOptions.env,
        signal: spawnOptions.signal,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true
      });
      if (onStderr) {
        child.stderr?.setEncoding('utf8').on('data', onStderr);
      }
      onSpawn?.(child);
      return child as unknown as ClaudeSpawnedProcess;
    };
  }

  public async probe(
    instance: ProviderInstanceConfig,
    options?: { environmentId?: string; environmentLabel?: string }
  ): Promise<ProviderSnapshot> {
    const envId = options?.environmentId || instance.environmentId || 'local';
    const envLabel = options?.environmentLabel || '本机环境';
    const now = Date.now();

    if (!instance.enabled) {
      return {
        instanceId: instance.instanceId,
        driver: 'claude',
        displayName: instance.displayName,
        enabled: false,
        installed: false,
        status: 'disabled',
        version: null,
        auth: { status: 'unknown' },
        models: mapSdkModels(undefined, instance.customModels),
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: 'npm i -g @anthropic-ai/claude-code',
        message: '已在设置中禁用此实例'
      };
    }

    const exe = instance.binaryPath
      ? findExecutableInPath(instance.binaryPath)
      : findExecutableInPath('claude');

    if (!exe) {
      return {
        instanceId: instance.instanceId,
        driver: 'claude',
        displayName: instance.displayName,
        enabled: true,
        installed: false,
        status: 'not_found',
        version: null,
        auth: { status: 'unknown' },
        models: mapSdkModels(undefined, instance.customModels),
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: 'npm i -g @anthropic-ai/claude-code',
        message: instance.binaryPath
          ? `未在自定义路径找到可执行程序: ${instance.binaryPath}`
          : '未在系统 PATH 中检测到 claude 命令'
      };
    }

    const versionRes = await executeVersionProbe(exe, ['--version'], 10_000);
    if (!versionRes.ok) {
      return {
        instanceId: instance.instanceId,
        driver: 'claude',
        displayName: instance.displayName,
        enabled: true,
        installed: true,
        status: 'error',
        version: null,
        executablePath: exe,
        auth: { status: 'unknown' },
        models: mapSdkModels(undefined, instance.customModels),
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: 'npm i -g @anthropic-ai/claude-code',
        message: versionRes.error || 'Claude Code 无法响应 --version'
      };
    }

    const processEnv = buildClaudeProcessEnv(instance);
    const localSettings = readLocalClaudeSettings(instance.configDir, exe);
    const mergedProbeEnv: NodeJS.ProcessEnv = { ...localSettings.env, ...processEnv };
    const managedMcp = hasClaudeManagedMcpConfig();
    const target = resolveExecutableLaunchTarget(exe);

    const probeAbort = new AbortController();
    let probeQuery: ClaudeQuery | undefined;
    let initResult: Awaited<ReturnType<ClaudeQuery['initializationResult']>> | undefined;

    try {
      const q = claudeQuery({
        // eslint-disable-next-line require-yield
        prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
          await new Promise<void>((resolve) => {
            if (probeAbort.signal.aborted) return resolve();
            probeAbort.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        })(),
        options: {
          persistSession: false,
          pathToClaudeCodeExecutable: target.sdkExecutablePath,
          abortController: probeAbort,
          settingSources: ['user', 'project', 'local'],
          settings: { disableAllHooks: true },
          allowedTools: [],
          mcpServers: {},
          ...(managedMcp ? {} : { strictMcpConfig: true }),
          env: mergedProbeEnv,
          spawnClaudeCodeProcess: this.spawnHook()
        }
      });
      probeQuery = q;

      initResult = await Promise.race([
        q.initializationResult(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Claude SDK 初始化探针超时')), PROBE_INIT_TIMEOUT_MS)
        )
      ]);
    } catch {
      initResult = undefined;
    } finally {
      if (!probeAbort.signal.aborted) probeAbort.abort();
      try {
        probeQuery?.close();
      } catch {
        // 忽略释放异常
      }
    }

    const account = initResult?.account as
      | {
          email?: string;
          subscriptionType?: string;
          tokenSource?: string;
          apiKeySource?: string;
          apiProvider?: string;
        }
      | undefined;

    const customEndpointRaw =
      mergedProbeEnv.ANTHROPIC_BASE_URL || localSettings.env.ANTHROPIC_BASE_URL || '';
    const customEndpoint = customEndpointRaw.trim()
      ? (() => {
          try {
            return new URL(customEndpointRaw.trim()).origin;
          } catch {
            return customEndpointRaw.trim();
          }
        })()
      : undefined;
    const hasCustomKey = Boolean(
      mergedProbeEnv.ANTHROPIC_API_KEY ||
        mergedProbeEnv.ANTHROPIC_AUTH_TOKEN ||
        localSettings.env.ANTHROPIC_API_KEY ||
        localSettings.env.ANTHROPIC_AUTH_TOKEN
    );

    let auth: ProviderAuthSnapshot;
    let status: ProviderStatus;
    let message: string | undefined;

    if (account) {
      const hasFirstPartyToken = Boolean(account.tokenSource && account.tokenSource !== 'none');
      const hasSdkApiKey = Boolean(account.apiKeySource && account.apiKeySource !== 'none');
      const isThirdPartyProvider = Boolean(account.apiProvider && account.apiProvider !== 'firstParty');

      if (hasFirstPartyToken || hasSdkApiKey || isThirdPartyProvider || account.email || account.subscriptionType) {
        const label = customEndpoint
          ? '自定义 Anthropic 网关'
          : account.subscriptionType
            ? `Claude ${account.subscriptionType}`
            : hasSdkApiKey || hasCustomKey
              ? 'Anthropic API Key'
              : 'Claude 账号已登录';
        auth = {
          status: 'authenticated',
          method: customEndpoint ? 'customEndpoint' : hasSdkApiKey ? 'apiKey' : account.tokenSource || 'oauth',
          label,
          ...(account.email ? { email: account.email } : {}),
          ...(account.subscriptionType ? { subscriptionType: account.subscriptionType } : {}),
          ...(customEndpoint ? { endpoint: customEndpoint } : {})
        };
        status = 'ready';
      } else if (customEndpoint || hasCustomKey) {
        auth = {
          status: 'authenticated',
          method: customEndpoint ? 'customEndpoint' : 'apiKey',
          label: customEndpoint ? '自定义 Anthropic 网关' : 'Anthropic API Key',
          ...(customEndpoint ? { endpoint: customEndpoint } : {})
        };
        status = 'ready';
      } else {
        auth = { status: 'unauthenticated', method: 'none', label: '未登录认证' };
        status = 'unauthenticated';
        message = '已检测到 Claude Code，但尚未完成认证。请执行 claude auth login 或配置自定义网关与 Key。';
      }
    } else {
      const fallback = await probeCliAuthFallback(exe, mergedProbeEnv);
      if (fallback.loggedIn) {
        auth = {
          status: 'authenticated',
          method: fallback.authMethod || 'oauth',
          label: fallback.subscriptionType ? `Claude ${fallback.subscriptionType}` : 'Claude 账号已登录',
          ...(fallback.email ? { email: fallback.email } : {})
        };
        status = 'ready';
      } else if (customEndpoint || hasCustomKey) {
        auth = {
          status: 'authenticated',
          method: customEndpoint ? 'customEndpoint' : 'apiKey',
          label: customEndpoint ? '自定义 Anthropic 网关' : 'Anthropic API Key',
          ...(customEndpoint ? { endpoint: customEndpoint } : {})
        };
        status = 'ready';
      } else {
        auth = { status: 'unauthenticated', method: 'none', label: '未登录认证' };
        status = 'unauthenticated';
        message = '已检测到 Claude Code，但尚未完成认证。请执行 claude auth login 或配置自定义网关与 Key。';
      }
    }

    const models = mapSdkModels(initResult?.models, instance.customModels, localSettings.activeModel);
    const slashCommands = (initResult?.commands || [])
      .map((c) => c.name?.trim())
      .filter((n): n is string => Boolean(n));

    return {
      instanceId: instance.instanceId,
      driver: 'claude',
      displayName: instance.displayName,
      enabled: true,
      installed: true,
      status,
      version: versionRes.version || null,
      executablePath: exe,
      auth,
      models,
      slashCommands,
      checkedAt: now,
      environmentId: envId,
      environmentLabel: envLabel,
      installCommand: 'npm i -g @anthropic-ai/claude-code',
      ...(message ? { message } : {})
    };
  }

  private openSession(
    params: TurnRunParams,
    executablePath: string,
    cwd: string,
    resumeSessionId?: string
  ): LiveClaudeSession {
    const env = buildClaudeProcessEnv(params.instance);
    const target = resolveExecutableLaunchTarget(executablePath);
    const managedMcp = hasClaudeManagedMcpConfig();
    const promptQueue = new AsyncPushQueue<SDKUserMessage>();
    const stderrTail: string[] = [];
    let spawnedChild: NodeChildProcess.ChildProcess | undefined;

    const permissionMode = resolveSdkPermissionMode(params.permissionMode || params.instance.permissionMode);
    const extraFlags = parseExtraArgsFlags(params.instance.extraArgs);

    const canUseTool: CanUseTool | undefined =
      permissionMode === 'bypassPermissions'
        ? undefined
        : async (toolName, input, opts): Promise<PermissionResult> => {
            const effectiveMode = params.permissionMode || params.instance.permissionMode || 'auto_edits';
            if (effectiveMode === 'auto_edits' && EDIT_TOOLS.has(toolName)) {
              return { behavior: 'allow', updatedInput: input };
            }
            if (effectiveMode === 'ask' && READ_ONLY_TOOLS.has(toolName)) {
              return { behavior: 'allow', updatedInput: input };
            }

            const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const currentTurnQueue = this.activeTurnQueues.get(params.sessionKey);
            if (!currentTurnQueue) {
              return { behavior: 'deny', message: '会话审批通道不可用' };
            }

            currentTurnQueue.push({
              type: 'approval.request',
              requestId,
              toolName,
              summary: summarizeToolInput(toolName, input),
              input
            });

            return new Promise<PermissionResult>((resolve) => {
              const onAbort = () => {
                this.pendingApprovals.delete(requestId);
                resolve({ behavior: 'deny', message: '用户已中断当前执行' });
              };
              opts.signal.addEventListener('abort', onAbort, { once: true });

              this.pendingApprovals.set(requestId, {
                requestId,
                toolName,
                resolve: (decision) => {
                  opts.signal.removeEventListener('abort', onAbort);
                  this.pendingApprovals.delete(requestId);
                  if (decision.approved) {
                    resolve({
                      behavior: 'allow',
                      updatedInput: decision.updatedInput || input
                    });
                  } else {
                    resolve({
                      behavior: 'deny',
                      message: decision.message || '用户拒绝执行该操作'
                    });
                  }
                }
              });
            });
          };

    const effort: ReasoningEffort | undefined =
      params.effort && params.effort !== 'default'
        ? params.effort
        : params.instance.effort && params.instance.effort !== 'default'
          ? params.instance.effort
          : undefined;

    const options: ClaudeQueryOptions = {
      cwd,
      env,
      pathToClaudeCodeExecutable: target.sdkExecutablePath,
      persistSession: true,
      includePartialMessages: true,
      settingSources: ['user', 'project', 'local'],
      settings: { disableAllHooks: true },
      mcpServers: {},
      ...(managedMcp ? {} : { strictMcpConfig: true }),
      permissionMode,
      ...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      ...(canUseTool ? { canUseTool } : {}),
      ...(params.model && params.model !== 'default' && params.model !== 'auto'
        ? { model: params.model }
        : params.instance.model && params.instance.model !== 'default'
          ? { model: params.instance.model }
          : {}),
      ...(effort ? { effort } : {}),
      ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      ...(extraFlags ? { extraArgs: extraFlags } : {}),
      spawnClaudeCodeProcess: this.spawnHook(
        (child) => {
          spawnedChild = child;
        },
        (chunk) => {
          for (const line of chunk.split('\n')) {
            const clean = line.trim();
            if (!clean) continue;
            stderrTail.push(clean);
            if (stderrTail.length > 20) stderrTail.shift();
          }
        }
      )
    };

    const queryRuntime = claudeQuery({
      prompt: promptQueue,
      options
    });

    const session: LiveClaudeSession = {
      sessionKey: params.sessionKey,
      queryRuntime,
      promptQueue,
      iterator: queryRuntime[Symbol.asyncIterator](),
      providerSessionId: resumeSessionId,
      configFingerprint: makeConfigFingerprint(params.instance, cwd),
      activeModel: params.model || params.instance.model,
      spawnedChild,
      stderrTail,
      lastUsedAt: Date.now()
    };

    this.sessions.set(params.sessionKey, session);
    return session;
  }

  public async *runTurn(params: TurnRunParams): AsyncGenerator<AgentRuntimeEvent, void, void> {
    const exe = params.instance.binaryPath
      ? findExecutableInPath(params.instance.binaryPath)
      : findExecutableInPath('claude');

    if (!exe) {
      yield {
        type: 'turn.failed',
        code: 'not_found',
        error: params.instance.binaryPath
          ? `未在自定义路径找到 Claude Code: ${params.instance.binaryPath}`
          : '未在系统 PATH 中检测到 claude 命令，请先安装 Claude Code。'
      };
      return;
    }

    const cwd = expandHomePath(params.cwd || params.instance.cwd) || process.cwd();
    const fingerprint = makeConfigFingerprint(params.instance, cwd);
    const requestedModel = params.model || params.instance.model;

    let session = this.sessions.get(params.sessionKey);
    const canReuse =
      session &&
      !session.promptQueue.isClosed() &&
      session.configFingerprint === fingerprint &&
      (!params.resumeSessionId || session.providerSessionId === params.resumeSessionId);

    if (!canReuse && session) {
      await this.closeSession(params.sessionKey);
      session = undefined;
    }

    const attemptTurn = async function* (
      driver: ClaudeProviderDriver,
      useResumeId: string | undefined,
      isRetryWithoutResume: boolean
    ): AsyncGenerator<AgentRuntimeEvent | { __retryWithoutResume: true }, void, void> {
      const turnStartedAt = Date.now();
      let liveSession = driver.sessions.get(params.sessionKey);
      if (!liveSession) {
        liveSession = driver.openSession(params, exe, cwd, useResumeId);
      } else if (requestedModel && requestedModel !== liveSession.activeModel && requestedModel !== 'default') {
        try {
          await liveSession.queryRuntime.setModel(requestedModel);
          liveSession.activeModel = requestedModel;
        } catch {
          // 若运行中切模不被支持，则重建会话
          await driver.closeSession(params.sessionKey);
          liveSession = driver.openSession(params, exe, cwd, useResumeId);
        }
      }

      liveSession.lastUsedAt = Date.now();
      const turnAbort = new AbortController();
      liveSession.activeTurnAbort = turnAbort;

      const onParentAbort = () => {
        turnAbort.abort();
        void driver.interruptTurn(params.sessionKey);
      };
      params.signal?.addEventListener('abort', onParentAbort, { once: true });

      const turnQueue = new AsyncPushQueue<AgentRuntimeEvent>();
      driver.activeTurnQueues.set(params.sessionKey, turnQueue);

      // 将用户消息推入长驻 SDK 会话流
      liveSession.promptQueue.push({
        type: 'user',
        message: { role: 'user', content: params.prompt },
        parent_tool_use_id: null
      });

      const toolStarts = new Map<string, { name: string; startedAt: number }>();
      let deltaText = '';
      let deltaReasoning = '';
      let assistantText = '';
      let assistantReasoning = '';
      let emittedSessionStarted = false;
      let retrySignal = false;

      const pump = (async () => {
        try {
          while (!turnAbort.signal.aborted) {
            const next = await liveSession!.iterator.next();
            if (next.done) {
              if (!turnAbort.signal.aborted) {
                const detail = liveSession!.stderrTail.slice(-3).join(' | ');
                turnQueue.push({
                  type: 'turn.failed',
                  error: detail || 'Claude Code 进程已退出'
                });
              }
              await driver.closeSession(params.sessionKey);
              break;
            }

            const msg = next.value as Record<string, any>;
            liveSession!.lastUsedAt = Date.now();

            if (msg.type === 'system' && msg.subtype === 'init') {
              const sid = typeof msg.session_id === 'string' ? msg.session_id : undefined;
              if (sid) {
                liveSession!.providerSessionId = sid;
                if (!emittedSessionStarted) {
                  emittedSessionStarted = true;
                  turnQueue.push({
                    type: 'session.started',
                    providerSessionId: sid,
                    model: typeof msg.model === 'string' ? msg.model : undefined,
                    version: typeof msg.claude_code_version === 'string' ? msg.claude_code_version : undefined
                  });
                }
              }
              continue;
            }

            if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta') {
              const d = msg.event.delta;
              if (d?.type === 'text_delta' && typeof d.text === 'string' && d.text.length > 0) {
                deltaText += d.text;
                turnQueue.push({ type: 'text.delta', text: d.text });
              } else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string' && d.thinking.length > 0) {
                deltaReasoning += d.thinking;
                turnQueue.push({ type: 'reasoning.delta', text: d.thinking });
              }
              continue;
            }

            if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
              if (msg.is_api_error_message) {
                const errRaw = msg.message.content.map((c: any) => c.text || '').join('\n').trim();
                const formatted = formatClaudeError(errRaw);
                turnQueue.push({
                  type: 'turn.failed',
                  code: formatted.code,
                  error: formatted.message
                });
                continue;
              }

              for (const block of msg.message.content) {
                if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
                  const th = block.thinking.trim();
                  assistantReasoning = (assistantReasoning ? `${assistantReasoning}\n\n` : '') + th;
                  if (!deltaReasoning) {
                    turnQueue.push({ type: 'reasoning.delta', text: th });
                  }
                } else if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
                  assistantText += block.text;
                  if (!deltaText) {
                    turnQueue.push({ type: 'text.delta', text: block.text });
                  }
                } else if (block?.type === 'tool_use' && block.id && block.name) {
                  toolStarts.set(block.id, { name: block.name, startedAt: Date.now() });
                  turnQueue.push({
                    type: 'tool.start',
                    toolCallId: block.id,
                    toolName: block.name,
                    input: (block.input && typeof block.input === 'object' ? block.input : {}) as Record<string, unknown>
                  });
                }
              }
              continue;
            }

            if (msg.type === 'user' && msg.message && Array.isArray(msg.message.content)) {
              for (const block of msg.message.content) {
                if (block?.type === 'tool_result' && block.tool_use_id) {
                  const started = toolStarts.get(block.tool_use_id);
                  const durationMs = started ? Math.max(0, Date.now() - started.startedAt) : 0;
                  turnQueue.push({
                    type: 'tool.end',
                    toolCallId: block.tool_use_id,
                    toolName: started?.name || 'tool',
                    output: msg.tool_use_result ?? block.content,
                    isError: Boolean(block.is_error),
                    durationMs
                  });
                }
              }
              continue;
            }

            if (msg.type === 'result') {
              const sid = typeof msg.session_id === 'string' ? msg.session_id : liveSession!.providerSessionId;
              if (sid) liveSession!.providerSessionId = sid;

              if (msg.is_error) {
                const rawErr =
                  (Array.isArray(msg.errors) && msg.errors.join('; ')) ||
                  (typeof msg.result === 'string' && msg.result) ||
                  'Claude Code 执行出错';
                if (
                  useResumeId &&
                  !isRetryWithoutResume &&
                  /no conversation found|session.*not found|could not find.*session/i.test(rawErr)
                ) {
                  retrySignal = true;
                  await driver.closeSession(params.sessionKey);
                  break;
                }
                const formatted = formatClaudeError(rawErr);
                turnQueue.push({
                  type: 'turn.failed',
                  code: formatted.code,
                  error: formatted.message
                });
              } else {
                const finalText = (deltaText || assistantText || (typeof msg.result === 'string' ? msg.result : '')).trim();
                const finalReasoning = (deltaReasoning || assistantReasoning).trim() || undefined;
                turnQueue.push({
                  type: 'turn.completed',
                  text: finalText,
                  reasoning: finalReasoning,
                  providerSessionId: sid,
                  usage: msg.usage
                    ? {
                        inputTokens: msg.usage.input_tokens,
                        outputTokens: msg.usage.output_tokens,
                        costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined
                      }
                    : undefined,
                  durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : Date.now() - turnStartedAt
                });
              }
              break;
            }
          }
        } catch (err: any) {
          const detail = liveSession?.stderrTail.slice(-3).join(' | ');
          const rawMsg = detail || err?.message || String(err);
          if (
            useResumeId &&
            !isRetryWithoutResume &&
            /no conversation found|session.*not found|could not find.*session/i.test(rawMsg)
          ) {
            retrySignal = true;
          } else if (turnAbort.signal.aborted) {
            turnQueue.push({ type: 'turn.interrupted', reason: '用户已中断执行' });
          } else {
            const formatted = formatClaudeError(rawMsg);
            turnQueue.push({ type: 'turn.failed', code: formatted.code, error: formatted.message });
          }
          await driver.closeSession(params.sessionKey);
        } finally {
          turnQueue.close();
        }
      })();

      try {
        for await (const ev of turnQueue) {
          yield ev;
        }
        await pump;
        if (retrySignal) {
          yield { __retryWithoutResume: true };
        }
      } finally {
        params.signal?.removeEventListener('abort', onParentAbort);
        driver.activeTurnQueues.delete(params.sessionKey);
        if (liveSession) liveSession.activeTurnAbort = undefined;
      }
    };

    const resumeId = session ? undefined : params.resumeSessionId;
    for await (const ev of attemptTurn(this, resumeId, false)) {
      if ('__retryWithoutResume' in ev) {
        for await (const retryEv of attemptTurn(this, undefined, true)) {
          if (!('__retryWithoutResume' in retryEv)) {
            yield retryEv;
          }
        }
        return;
      }
      yield ev;
    }
  }

  public async interruptTurn(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    for (const [reqId, pending] of this.pendingApprovals.entries()) {
      this.pendingApprovals.delete(reqId);
      pending.resolve({ approved: false, message: '当前任务已被中断' });
    }
    if (!session) return;
    session.activeTurnAbort?.abort();
    try {
      await session.queryRuntime.interrupt();
    } catch {
      await this.closeSession(sessionKey);
    }
  }

  public async respondApproval(requestId: string, decision: ApprovalDecision): Promise<boolean> {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;
    pending.resolve(decision);
    return true;
  }

  public async closeSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    this.sessions.delete(sessionKey);
    session.activeTurnAbort?.abort();
    session.promptQueue.close();
    try {
      session.queryRuntime.close();
    } catch {
      // 忽略关闭异常
    }
    const pid = session.spawnedChild?.pid;
    if (pid && session.spawnedChild && session.spawnedChild.exitCode === null) {
      signalProcessGroup(pid, 'SIGTERM');
      setTimeout(() => {
        if (session.spawnedChild && session.spawnedChild.exitCode === null) {
          signalProcessGroup(pid, 'SIGKILL');
        }
      }, 1000).unref();
    }
  }

  public async disposeAll(): Promise<void> {
    clearInterval(this.idleTimer);
    for (const key of Array.from(this.sessions.keys())) {
      await this.closeSession(key);
    }
    for (const [reqId, pending] of this.pendingApprovals.entries()) {
      this.pendingApprovals.delete(reqId);
      pending.resolve({ approved: false, message: '运行时已停止' });
    }
  }
}
