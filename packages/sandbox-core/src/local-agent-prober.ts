import { execFile, execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join } from 'node:path';
import { globalRunnerMesh } from './runner-mesh.ts';

export type LocalAgentId = 'claude' | 'codex' | 'pi' | 'dsh' | 'ollama' | 'ducc' | 'ducx';

export const STDIO_LOCAL_AGENT_IDS = ['claude', 'codex', 'pi', 'dsh', 'ducc', 'ducx'] as const;

export function isStdioLocalAgent(id: string): boolean {
  return (STDIO_LOCAL_AGENT_IDS as readonly string[]).includes(id);
}

export interface LocalAgentAuthInfo {
  status: 'authenticated' | 'unauthenticated' | 'unknown';
  method?: string;
  label?: string;
  email?: string;
  endpoint?: string;
}

export type LocalAgentStatus = 'ready' | 'unauthenticated' | 'warning' | 'error' | 'not_found';

export interface LocalAgentProbeOverride {
  binaryPath?: string;
  configDir?: string;
  cwd?: string;
  baseUrl?: string;
  apiKey?: string;
  env?: Record<string, string>;
  customModels?: string[];
}

export interface LocalAgentInfo {
  id: LocalAgentId;
  name: string;
  installed: boolean;
  isAvailable?: boolean;
  status?: LocalAgentStatus;
  statusMessage?: string;
  auth?: LocalAgentAuthInfo;
  version?: string;
  executablePath?: string;
  protocol: 'acp-stdio' | 'json-rpc-stdio' | 'openai-http';
  category?: 'local_agent' | 'intranet_agent';
  description: string;
  candidateModels: string[];
  defaultModel: string;
  installCommand?: string;
  docUrl?: string;
  source?: 'local' | 'remote';
  machineName?: string;
  checkedAt?: number;
}

const DEFAULT_CLAUDE_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5',
  'sonnet',
  'opus',
  'haiku'
];

const WINDOWS_SHIM_EXTENSIONS = new Set(['.cmd', '.bat', '.ps1']);

const CLAUDE_PACKAGE_ENTRIES = [
  ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'],
  ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'],
  ['..', 'Packages', 'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe', 'claude.exe']
] as const;

/**
 * 展开路径中的波浪号 (~) 为当前用户主目录
 */
export function expandHomePath(inputPath?: string): string | undefined {
  if (!inputPath) return undefined;
  const trimmed = inputPath.trim();
  if (!trimmed) return undefined;
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function isExistingFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * 解析 Windows 下的脚本封装器，返回可直接通过 Node child_process 启动的二进制或脚本入口
 */
export function resolveExecutableLaunchTarget(executablePath: string): {
  command: string;
  argsPrefix: string[];
} {
  if (process.platform !== 'win32') {
    return { command: executablePath, argsPrefix: [] };
  }
  const ext = extname(executablePath).toLowerCase();
  if (!WINDOWS_SHIM_EXTENSIONS.has(ext)) {
    return { command: executablePath, argsPrefix: [] };
  }

  const shimDir = dirname(executablePath);
  for (const segments of CLAUDE_PACKAGE_ENTRIES) {
    const candidate = join(shimDir, ...segments);
    if (isExistingFile(candidate)) {
      if (candidate.toLowerCase().endsWith('.js')) {
        return { command: process.execPath, argsPrefix: [candidate] };
      }
      return { command: candidate, argsPrefix: [] };
    }
  }

  return { command: executablePath, argsPrefix: [] };
}

/**
 * 扩充 PATH 环境变量以覆盖常见的用户环境 (npm-global, bun, nvm, brew, .local/bin 等)
 */
export function getAugmentedPath(): string {
  const home = homedir();
  const extraDirs = [
    join(home, '.multica', 'shims'),
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.nvm', 'current', 'bin'),
    join(home, '.baidu-cc', 'baidu-cc', 'bin'),
    join(home, '.comate', 'baidu-cc', 'bin'),
    join(home, '.baidu-cx', 'baidu-cx', 'bin'),
    join(home, '.comate', 'baidu-cx', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ];

  const currentPath = process.env.PATH || '';
  const currentDirs = currentPath.split(delimiter).filter(Boolean);
  const merged = Array.from(new Set([...extraDirs, ...currentDirs]));
  return merged.filter((d) => existsSync(d)).join(delimiter);
}

/**
 * 在系统 PATH 或显式路径中安全查找可执行文件
 */
export function findExecutableInPath(command: string, customPath?: string): string | null {
  const expanded = expandHomePath(command) || command;
  if (!expanded) return null;

  const isExplicitPath = expanded.includes('/') || expanded.includes('\\') || expanded.startsWith('.');
  if (isExplicitPath || isExistingFile(expanded)) {
    if (isExistingFile(expanded)) return expanded;
    if (process.platform === 'win32') {
      for (const ext of ['.exe', '.cmd', '.bat']) {
        if (isExistingFile(`${expanded}${ext}`)) return `${expanded}${ext}`;
      }
    }
    if (isExplicitPath) return null;
  }

  const pathEnv = customPath || getAugmentedPath();
  const dirs = pathEnv.split(delimiter);
  const candidates = process.platform === 'win32' && !extname(expanded)
    ? [expanded, `${expanded}.exe`, `${expanded}.cmd`, `${expanded}.bat`]
    : [expanded];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of candidates) {
      const fullPath = join(dir, name);
      if (isExistingFile(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

interface ParsedClaudeSettings {
  activeModel?: string;
  env: Record<string, string>;
  customModelKeys: string[];
}

/**
 * 读取本地 Claude Code 配置文件中的环境变量与默认模型声明
 */
export function readClaudeSettingsFiles(configDir?: string, executablePath?: string): ParsedClaudeSettings {
  const env: Record<string, string> = {};
  const customModelKeys: string[] = [];
  let activeModel = '';

  const candidateDirs: string[] = [];
  const customDir = expandHomePath(configDir);
  if (customDir) {
    candidateDirs.push(customDir);
  } else {
    candidateDirs.push(join(homedir(), '.claude'));
    if (executablePath) {
      const winMatch = executablePath.match(/^(\/mnt\/[a-zA-Z]\/Users\/[^/]+)\//);
      if (winMatch && winMatch[1]) {
        candidateDirs.push(join(winMatch[1], '.claude'));
      }
    }
  }

  for (const dir of candidateDirs) {
    const settingsFile = join(dir, 'settings.json');
    if (!isExistingFile(settingsFile)) continue;
    try {
      const raw = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, any>;
      if (typeof raw.model === 'string' && raw.model.trim() && !activeModel) {
        activeModel = raw.model.trim();
      }
      if (raw.env && typeof raw.env === 'object') {
        for (const [k, v] of Object.entries(raw.env)) {
          if (typeof v === 'string' && v.trim()) {
            env[k] = v.trim();
          }
        }
        if (env.ANTHROPIC_MODEL && !activeModel) {
          activeModel = env.ANTHROPIC_MODEL;
        }
      }
      if (raw.modelSettings && typeof raw.modelSettings === 'object') {
        for (const key of Object.keys(raw.modelSettings)) {
          if (key.trim()) customModelKeys.push(key.trim());
        }
      }
      break;
    } catch {
      // 忽略损坏的配置文件
    }
  }

  return {
    activeModel: activeModel || undefined,
    env,
    customModelKeys
  };
}

/**
 * 动态提取本地 Claude Code 模型清单与配置环境
 */
export function discoverClaudeModels(
  configDir?: string,
  executablePath?: string,
  customModels?: string[]
): { models: string[]; defaultModel: string; settingsEnv: Record<string, string> } {
  const settings = readClaudeSettingsFiles(configDir, executablePath);
  const merged = new Set<string>();

  if (settings.activeModel) {
    merged.add(settings.activeModel);
  }
  for (const m of customModels || []) {
    if (m && m.trim()) merged.add(m.trim());
  }
  for (const m of DEFAULT_CLAUDE_MODELS) {
    merged.add(m);
  }
  for (const m of settings.customModelKeys) {
    merged.add(m);
  }

  const models = Array.from(merged);
  return {
    models,
    defaultModel: settings.activeModel || models[0] || 'claude-sonnet-4-6',
    settingsEnv: settings.env
  };
}

/**
 * 探测 Claude Code 的真实登录状态或自定义网关/API Key 认证可用性
 */
export function probeClaudeAuth(
  executablePath: string,
  override?: LocalAgentProbeOverride,
  settingsEnv?: Record<string, string>
): Promise<{ auth: LocalAgentAuthInfo; status: LocalAgentStatus; statusMessage?: string }> {
  return new Promise((resolve) => {
    const cleanEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: getAugmentedPath(),
      CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1'
    };

    const customConfigDir = expandHomePath(override?.configDir);
    if (customConfigDir) {
      cleanEnv.CLAUDE_CONFIG_DIR = customConfigDir;
    }

    const effectiveEnvMap: Record<string, string> = {
      ...(settingsEnv || {}),
      ...(override?.env || {})
    };
    const overrideBaseUrl =
      override?.baseUrl && !override.baseUrl.startsWith('local://') ? override.baseUrl.trim() : '';
    const effectiveBaseUrl =
      overrideBaseUrl ||
      effectiveEnvMap.ANTHROPIC_BASE_URL ||
      process.env.ANTHROPIC_BASE_URL ||
      '';
    const effectiveApiKey =
      (override?.apiKey && override.apiKey.trim()) ||
      effectiveEnvMap.ANTHROPIC_API_KEY ||
      effectiveEnvMap.ANTHROPIC_AUTH_TOKEN ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      '';

    const target = resolveExecutableLaunchTarget(executablePath);
    execFile(
      target.command,
      [...target.argsPrefix, 'auth', 'status'],
      {
        timeout: 5000,
        maxBuffer: 128 * 1024,
        env: cleanEnv
      },
      (err, stdout) => {
        let parsed: Record<string, any> | null = null;
        try {
          const trimmed = (stdout || '').trim();
          if (trimmed.startsWith('{')) {
            parsed = JSON.parse(trimmed);
          }
        } catch {
          parsed = null;
        }

        if (parsed && parsed.loggedIn === true) {
          const authMethod = typeof parsed.authMethod === 'string' ? parsed.authMethod : 'oauth';
          const email = typeof parsed.email === 'string' ? parsed.email : undefined;
          const sub = typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : undefined;
          const apiProvider = typeof parsed.apiProvider === 'string' ? parsed.apiProvider : undefined;
          const label = sub
            ? `Claude ${sub}`
            : apiProvider && apiProvider !== 'firstParty'
              ? apiProvider
              : authMethod === 'apiKey'
                ? 'Anthropic API Key'
                : 'Claude 账号已登录';
          return resolve({
            auth: {
              status: 'authenticated',
              method: authMethod,
              label,
              email
            },
            status: 'ready'
          });
        }

        if (effectiveBaseUrl || effectiveApiKey) {
          let endpointOrigin: string | undefined;
          if (effectiveBaseUrl) {
            try {
              endpointOrigin = new URL(effectiveBaseUrl).origin;
            } catch {
              endpointOrigin = effectiveBaseUrl;
            }
          }
          return resolve({
            auth: {
              status: 'authenticated',
              method: effectiveBaseUrl ? 'customEndpoint' : 'apiKey',
              label: effectiveBaseUrl ? '自定义 Anthropic 网关' : 'Anthropic API Key',
              ...(endpointOrigin ? { endpoint: endpointOrigin } : {})
            },
            status: 'ready'
          });
        }

        if (err && !parsed) {
          return resolve({
            auth: {
              status: 'unknown',
              label: '状态检测未完成'
            },
            status: 'warning',
            statusMessage: '已检测到 Claude Code 程序，但读取认证状态失败，请点击测试连通性或检查本机权限。'
          });
        }

        return resolve({
          auth: {
            status: 'unauthenticated',
            method: 'none',
            label: '未登录认证'
          },
          status: 'unauthenticated',
          statusMessage:
            '已检测到 Claude Code，但尚未完成登录认证。请在终端运行 claude auth login，或在下方填写自定义 API Base URL 与 Key。'
        });
      }
    );
  });
}

/**
 * 动态提取本地 Codex 用户实际配置的模型列表与默认模型
 */
export function discoverCodexModels(configDir?: string): { models: string[]; defaultModel: string } {
  const home = expandHomePath(configDir) || join(homedir(), '.codex');
  const configPath = join(home, 'config.toml');
  const fallback = {
    models: ['gpt-5.4', 'gpt-5.3-codex', 'o3', 'gpt-4o'],
    defaultModel: 'gpt-5.4'
  };

  const modelsSet = new Set<string>();
  let activeModel = '';

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf8');
      const modelMatch = content.match(/^model\s*=\s*["']([^"']+)["']/m);
      if (modelMatch && modelMatch[1]) {
        activeModel = modelMatch[1].trim();
      }

      const catalogMatch = content.match(/^model_catalog_json\s*=\s*["']([^"']+)["']/m);
      if (catalogMatch && catalogMatch[1] && existsSync(catalogMatch[1])) {
        try {
          const catalogRaw = JSON.parse(readFileSync(catalogMatch[1], 'utf8'));
          if (Array.isArray(catalogRaw.models)) {
            for (const m of catalogRaw.models) {
              const id = m.id || m.slug || m.name || m.display_name;
              if (id && typeof id === 'string') {
                modelsSet.add(id);
              }
            }
          }
        } catch {}
      }
    } catch {}
  }

  const mixinCat = join(home, 'model-catalogs', 'mixin-models.json');
  if (existsSync(mixinCat)) {
    try {
      const raw = JSON.parse(readFileSync(mixinCat, 'utf8'));
      if (Array.isArray(raw.models)) {
        for (const m of raw.models) {
          const id = m.id || m.slug || m.name || m.display_name;
          if (id && typeof id === 'string') modelsSet.add(id);
        }
      }
    } catch {}
  }

  const oneapiCat = join(homedir(), '.baidu-cx', 'model-catalogs', 'oneapi-models.json');
  if (existsSync(oneapiCat)) {
    try {
      const raw = JSON.parse(readFileSync(oneapiCat, 'utf8'));
      if (Array.isArray(raw.models)) {
        for (const m of raw.models) {
          const id = m.id || m.slug || m.name || m.display_name;
          if (id && typeof id === 'string') modelsSet.add(id);
        }
      }
    } catch {}
  }

  if (activeModel) modelsSet.add(activeModel);

  const list = Array.from(modelsSet);
  if (list.length === 0) {
    fallback.models.forEach((m) => modelsSet.add(m));
  }
  const finalList = Array.from(modelsSet);
  return {
    models: finalList.length > 0 ? finalList : fallback.models,
    defaultModel: activeModel || finalList[0] || fallback.defaultModel
  };
}

/**
 * 动态提取本地 Pi Coding Agent 用户实际配置的模型列表与默认模型
 */
export function discoverPiModels(configDir?: string): { models: string[]; defaultModel: string } {
  const home = expandHomePath(configDir) || join(homedir(), '.pi', 'agent');
  const modelsPath = join(home, 'models.json');
  const fallback = {
    models: ['anthropic/claude-sonnet-4-6', 'openai/gpt-5.4', 'deepseek/deepseek-chat'],
    defaultModel: 'anthropic/claude-sonnet-4-6'
  };

  const modelsSet = new Set<string>();

  if (existsSync(modelsPath)) {
    try {
      const raw = JSON.parse(readFileSync(modelsPath, 'utf8'));
      if (raw.providers && typeof raw.providers === 'object') {
        for (const provider of Object.values(raw.providers as Record<string, any>)) {
          if (Array.isArray(provider.models)) {
            for (const m of provider.models) {
              const id = m.id || m.name;
              if (id && typeof id === 'string') {
                modelsSet.add(id);
              }
            }
          }
        }
      }
    } catch {}
  }

  const list = Array.from(modelsSet);
  if (list.length === 0) {
    fallback.models.forEach((m) => modelsSet.add(m));
  }
  const finalList = Array.from(modelsSet);
  return {
    models: finalList.length > 0 ? finalList : fallback.models,
    defaultModel: finalList[0] || fallback.defaultModel
  };
}

/**
 * 动态提取本地 ducc 用户实际配置的模型列表与默认模型
 */
export function discoverDuccModels(): { models: string[]; defaultModel: string } {
  const home = homedir();
  const userJsonPath = join(home, '.baidu-cc', 'user.json');
  const fallback = {
    models: [
      'GLM-5.3-Flash-内部',
      'Opus 4.8',
      'Opus 5',
      'Opus 5.5',
      'Claude Sonnet 5',
      'Claude Sonnet 5.5',
      'Claude Haiku 5.5',
      'ERNIE-5.5-Flash-Preview-内部',
      'DeepSeek-V4.1-Flash-内部',
      'DeepSeek-V4-Pro',
      'gpt-6.1-sol',
      'gpt-5.6-sol'
    ],
    defaultModel: 'GLM-5.3-Flash-内部'
  };

  let activeModel = '';
  if (existsSync(userJsonPath)) {
    try {
      const data = JSON.parse(readFileSync(userJsonPath, 'utf8'));
      if (data.env?.ANTHROPIC_MODEL) {
        activeModel = data.env.ANTHROPIC_MODEL.trim();
      }
    } catch {}
  }

  const modelsSet = new Set<string>();
  if (activeModel) {
    modelsSet.add(activeModel);
  }

  const duccBin = findExecutableInPath('ducc');
  if (duccBin) {
    try {
      const output = execSync(`"${duccBin}" models`, {
        timeout: 2500,
        env: { ...process.env, PATH: getAugmentedPath() },
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
      });
      const match = output.match(/Available Models:\s*([\s\S]+)/i);
      if (match && match[1]) {
        const parsed = match[1]
          .split(',')
          .map((m) => m.trim())
          .filter((m) => m && !m.includes('自定义模型组'));
        parsed.forEach((m) => modelsSet.add(m));
      }
    } catch {}
  }

  const list = Array.from(modelsSet);
  if (list.length === 0) {
    fallback.models.forEach((m) => modelsSet.add(m));
  }
  const finalList = Array.from(modelsSet);
  return {
    models: finalList.length > 0 ? finalList : fallback.models,
    defaultModel: activeModel || finalList[0] || fallback.defaultModel
  };
}

/**
 * 动态提取本地 ducx 用户实际配置的模型列表与默认模型
 */
export function discoverDucxModels(): { models: string[]; defaultModel: string } {
  const home = homedir();
  const configPath = join(home, '.baidu-cx', 'config.toml');
  const catalogPath = join(home, '.baidu-cx', 'model-catalogs', 'oneapi-models.json');
  const fallback = {
    models: [
      'gpt-5.6-sol',
      'gpt-6.1-sol',
      'gpt-6.2-sol',
      'GLM-5.3-Flash',
      'DeepSeek-V4-Pro',
      'DeepSeek-V4.1-Flash',
      'ERNIE-5.5-Flash-Preview-内部'
    ],
    defaultModel: 'gpt-5.6-sol'
  };

  let activeModel = '';
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf8');
      const modelMatch = content.match(/^model\s*=\s*["']([^"']+)["']/m);
      if (modelMatch && modelMatch[1]) {
        activeModel = modelMatch[1].trim();
      }
    } catch {}
  }

  const modelsSet = new Set<string>();
  if (activeModel) {
    modelsSet.add(activeModel);
  }

  const ducxBin = findExecutableInPath('ducx') || findExecutableInPath('baidu-cx');
  if (ducxBin) {
    try {
      const output = execSync(`"${ducxBin}" models`, {
        timeout: 2500,
        env: { ...process.env, PATH: getAugmentedPath() },
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8'
      });
      const match = output.match(/Available Models:\s*([\s\S]+)/i);
      if (match && match[1]) {
        const parsed = match[1]
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean);
        parsed.forEach((m) => modelsSet.add(m));
      }
    } catch {}
  }

  if (existsSync(catalogPath)) {
    try {
      const raw = JSON.parse(readFileSync(catalogPath, 'utf8'));
      if (Array.isArray(raw.models)) {
        for (const item of raw.models) {
          const id = item.slug || item.display_name || item.id;
          if (id && typeof id === 'string') {
            modelsSet.add(id);
          }
        }
      }
    } catch {}
  }

  const list = Array.from(modelsSet);
  if (list.length === 0) {
    fallback.models.forEach((m) => modelsSet.add(m));
  }
  const finalList = Array.from(modelsSet);
  return {
    models: finalList.length > 0 ? finalList : fallback.models,
    defaultModel: activeModel || finalList[0] || fallback.defaultModel
  };
}

/**
 * 执行版本探测，附带安全超时与隔离环境变量
 */
export function executeVersionProbe(
  executablePath: string,
  args: string[] = ['--version'],
  timeoutMs = 4500
): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const cleanEnv = {
      ...process.env,
      PATH: getAugmentedPath(),
      CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1'
    };

    delete cleanEnv.OPENAI_API_KEY;
    delete cleanEnv.ANTHROPIC_API_KEY;

    const target = resolveExecutableLaunchTarget(executablePath);
    execFile(
      target.command,
      [...target.argsPrefix, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
        env: cleanEnv
      },
      (err, stdout, stderr) => {
        if (err) {
          const errMsg = err.killed ? '探针调用超时' : (stderr || err.message).trim().slice(0, 160);
          return resolve({ ok: false, error: errMsg });
        }
        const line = (stdout || '').trim().split('\n')[0] || '';
        resolve({ ok: true, version: line });
      }
    );
  });
}

/**
 * 探测本地 Ollama 状态与已拉取模型
 */
export async function probeOllamaService(
  baseUrl = 'http://127.0.0.1:11434'
): Promise<{ ok: boolean; models: string[]; version?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const origin = baseUrl.replace(/\/v1.*$/, '').replace(/\/api.*$/, '');
    const res = await fetch(`${origin}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, models: [] };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models || []).map((m) => m.name);
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  }
}

const probeCache = new Map<string, { expiresAt: number; data: LocalAgentInfo[] }>();
const PROBE_CACHE_TTL_MS = 20_000;

function mergeCustomModels(models: string[], customModels?: string[]): string[] {
  if (!customModels || customModels.length === 0) return models;
  return Array.from(new Set([...models, ...customModels.map((m) => m.trim()).filter(Boolean)]));
}

/**
 * 探测本机及远程在线节点中受支持的本地 Agent 运行时
 */
export async function probeLocalAgents(options?: {
  overrides?: Record<string, LocalAgentProbeOverride>;
  userId?: string;
  forceRefresh?: boolean;
}): Promise<LocalAgentInfo[]> {
  const overrides = options?.overrides || {};
  const cacheKey = JSON.stringify({
    userId: options?.userId || '',
    overrides: Object.entries(overrides).map(([k, v]) => [
      k,
      v.binaryPath || '',
      v.configDir || '',
      v.baseUrl || '',
      Boolean(v.apiKey),
      v.customModels || []
    ])
  });

  if (!options?.forceRefresh) {
    const cached = probeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const now = Date.now();

  const probeClaude = async (): Promise<LocalAgentInfo> => {
    const ov = overrides.claude;
    const claudePath = ov?.binaryPath
      ? findExecutableInPath(ov.binaryPath)
      : findExecutableInPath('claude');
    let claudeVersion: string | undefined;
    let auth: LocalAgentAuthInfo = { status: 'unknown' };
    let status: LocalAgentStatus = 'not_found';
    let statusMessage: string | undefined;
    const claudeDiscovery = discoverClaudeModels(ov?.configDir, claudePath || undefined, ov?.customModels);

    if (claudePath) {
      const versionRes = await executeVersionProbe(claudePath, ['--version']);
      if (versionRes.ok) {
        claudeVersion = versionRes.version;
        const authProbe = await probeClaudeAuth(claudePath, ov, claudeDiscovery.settingsEnv);
        auth = authProbe.auth;
        status = authProbe.status;
        statusMessage = authProbe.statusMessage;
      } else {
        status = 'error';
        statusMessage = versionRes.error || 'Claude Code 程序存在但无法正常响应 --version';
      }
    } else {
      statusMessage = ov?.binaryPath
        ? `未在自定义路径找到可执行程序: ${ov.binaryPath}`
        : '未在系统 PATH 中检测到 claude 命令，可在本机安装或连接个人电脑节点。';
    }

    const installed = Boolean(claudePath && claudeVersion);
    return {
      id: 'claude',
      name: 'Claude Code (本地 Agent)',
      installed,
      isAvailable: installed && status === 'ready',
      status,
      statusMessage,
      auth,
      version: claudeVersion,
      executablePath: claudePath || undefined,
      protocol: 'acp-stdio',
      category: 'local_agent',
      description: 'Anthropic 官方本地编码 Agent，支持本机 OAuth 登录或自定义 Anthropic 网关与实时流式推理',
      candidateModels: claudeDiscovery.models,
      defaultModel: claudeDiscovery.defaultModel,
      installCommand: 'npm i -g @anthropic-ai/claude-code',
      docUrl: 'https://docs.anthropic.com/en/docs/claude-code',
      source: 'local',
      checkedAt: now
    };
  };

  const probeCodex = async (): Promise<LocalAgentInfo> => {
    const ov = overrides.codex;
    const codexPath = ov?.binaryPath
      ? findExecutableInPath(ov.binaryPath)
      : findExecutableInPath('codex');
    let codexVersion: string | undefined;
    if (codexPath) {
      const probe = await executeVersionProbe(codexPath, ['--version']);
      if (probe.ok) codexVersion = probe.version;
    }
    const codexModels = discoverCodexModels(ov?.configDir);
    const installed = Boolean(codexPath && codexVersion);
    return {
      id: 'codex',
      name: 'OpenAI Codex (本地 Agent)',
      installed,
      isAvailable: installed,
      status: installed ? 'ready' : codexPath ? 'error' : 'not_found',
      version: codexVersion,
      executablePath: codexPath || undefined,
      protocol: 'acp-stdio',
      category: 'local_agent',
      description: '本地 OpenAI Codex 终端编码 Agent，支持 headless stdio 交互',
      candidateModels: mergeCustomModels(codexModels.models, ov?.customModels),
      defaultModel: codexModels.defaultModel,
      installCommand: 'npm i -g @openai/codex',
      docUrl: 'https://github.com/openai/codex',
      source: 'local',
      checkedAt: now
    };
  };

  const probePi = async (): Promise<LocalAgentInfo> => {
    const ov = overrides.pi;
    const piPath = ov?.binaryPath
      ? findExecutableInPath(ov.binaryPath)
      : findExecutableInPath('pi');
    let piVersion: string | undefined;
    if (piPath) {
      const probe = await executeVersionProbe(piPath, ['--version']);
      if (probe.ok) piVersion = probe.version;
    }
    const piModels = discoverPiModels(ov?.configDir);
    const installed = Boolean(piPath && piVersion);
    return {
      id: 'pi',
      name: 'Pi Coding Agent (本地 Agent)',
      installed,
      isAvailable: installed,
      status: installed ? 'ready' : piPath ? 'error' : 'not_found',
      version: piVersion,
      executablePath: piPath || undefined,
      protocol: 'json-rpc-stdio',
      category: 'local_agent',
      description: '轻量高性能终端 Coding Agent，支持 stdio JSON-RPC 与多模型驱动',
      candidateModels: mergeCustomModels(piModels.models, ov?.customModels),
      defaultModel: piModels.defaultModel,
      installCommand: 'npm i -g @mariozechner/pi-coding-agent',
      docUrl: 'https://github.com/badlogic/pi-mono',
      source: 'local',
      checkedAt: now
    };
  };

  const probeDsh = async (): Promise<LocalAgentInfo> => {
    const ov = overrides.dsh;
    const dshPath = ov?.binaryPath
      ? findExecutableInPath(ov.binaryPath)
      : findExecutableInPath('dsh');
    let dshVersion: string | undefined;
    if (dshPath) {
      const probe = await executeVersionProbe(dshPath, ['--version']);
      if (probe.ok) dshVersion = probe.version;
    }
    const installed = Boolean(dshPath && dshVersion);
    return {
      id: 'dsh',
      name: 'DeepSeek Harness (本地 dsh)',
      installed,
      isAvailable: installed,
      status: installed ? 'ready' : dshPath ? 'error' : 'not_found',
      version: dshVersion,
      executablePath: dshPath || undefined,
      protocol: 'acp-stdio',
      category: 'local_agent',
      description: 'DeepSeek 官方开源本地终端 Harness 编码 Agent，支持 ACP 协议',
      candidateModels: mergeCustomModels(
        ['deepseek-official/deepseek-chat', 'deepseek-official/deepseek-reasoner'],
        ov?.customModels
      ),
      defaultModel: 'deepseek-official/deepseek-chat',
      installCommand: 'curl -fsSL https://deepseek.ai/dsh/install.sh | bash',
      docUrl: 'https://github.com/deepseek-ai/deepseek-harness',
      source: 'local',
      checkedAt: now
    };
  };

  const probeOllama = async (): Promise<LocalAgentInfo> => {
    const ov = overrides.ollama;
    const ollamaEndpoint = (ov?.baseUrl && !ov.baseUrl.startsWith('local://') ? ov.baseUrl : undefined) || 'http://127.0.0.1:11434';
    const ollamaProbe = await probeOllamaService(ollamaEndpoint);
    const ollamaBin = ov?.binaryPath
      ? findExecutableInPath(ov.binaryPath)
      : findExecutableInPath('ollama');
    const ollamaInstalled = ollamaProbe.ok || Boolean(ollamaBin);
    const baseModels =
      ollamaProbe.models.length > 0 ? ollamaProbe.models : ['llama3.2', 'qwen2.5-coder', 'deepseek-r1:8b'];
    return {
      id: 'ollama',
      name: '本地 Ollama (Local)',
      installed: ollamaInstalled,
      isAvailable: ollamaProbe.ok,
      status: ollamaProbe.ok ? 'ready' : ollamaBin ? 'warning' : 'not_found',
      statusMessage: ollamaProbe.ok
        ? undefined
        : ollamaBin
          ? '已安装 Ollama，但本地服务未启动（请执行 ollama serve）。'
          : '未检测到本地 Ollama 服务。',
      version: ollamaProbe.ok ? 'HTTP Service Active' : ollamaBin ? 'Installed (Stopped)' : undefined,
      executablePath: ollamaBin || undefined,
      protocol: 'openai-http',
      category: 'local_agent',
      description: '本地私有化大模型引擎，完全在本地硬件私有运行，无需联网',
      candidateModels: mergeCustomModels(baseModels, ov?.customModels),
      defaultModel: ollamaProbe.models[0] || 'llama3.2',
      installCommand: 'brew install ollama && ollama serve',
      docUrl: 'https://ollama.com',
      source: 'local',
      checkedAt: now
    };
  };

  const probeDucc = async (): Promise<LocalAgentInfo> => {
    const ov = overrides.ducc;
    const duccPath = ov?.binaryPath
      ? findExecutableInPath(ov.binaryPath)
      : findExecutableInPath('ducc');
    let duccVersion: string | undefined;
    if (duccPath) {
      const probe = await executeVersionProbe(duccPath, ['--version']);
      if (probe.ok) duccVersion = probe.version;
    }
    const duccModels = discoverDuccModels();
    const installed = Boolean(duccPath && duccVersion);
    return {
      id: 'ducc',
      name: 'Baidu CC (内网 ducc)',
      installed,
      isAvailable: installed,
      status: installed ? 'ready' : duccPath ? 'error' : 'not_found',
      version: duccVersion,
      executablePath: duccPath || undefined,
      protocol: 'acp-stdio',
      category: 'intranet_agent',
      description: 'Baidu 内部 Claude Code 编码 Agent，免 Key 直连内网大模型',
      candidateModels: mergeCustomModels(duccModels.models, ov?.customModels),
      defaultModel: duccModels.defaultModel,
      installCommand: 'curl -fsSL http://team-mesh.loop.baidu-int.com:8004/api/tmesh/dist/install.sh | bash',
      docUrl: 'http://team-mesh.loop.baidu-int.com:8004',
      source: 'local',
      checkedAt: now
    };
  };

  const probeDucx = async (): Promise<LocalAgentInfo> => {
    const ov = overrides.ducx;
    const ducxPath = ov?.binaryPath
      ? findExecutableInPath(ov.binaryPath)
      : findExecutableInPath('ducx') || findExecutableInPath('baidu-cx');
    let ducxVersion: string | undefined;
    if (ducxPath) {
      const probe = await executeVersionProbe(ducxPath, ['--version']);
      if (probe.ok) ducxVersion = probe.version;
    }
    const ducxModels = discoverDucxModels();
    const installed = Boolean(ducxPath && ducxVersion);
    return {
      id: 'ducx',
      name: 'Baidu CX (内网 ducx)',
      installed,
      isAvailable: installed,
      status: installed ? 'ready' : ducxPath ? 'error' : 'not_found',
      version: ducxVersion,
      executablePath: ducxPath || undefined,
      protocol: 'acp-stdio',
      category: 'intranet_agent',
      description: 'Baidu 内部 Codex 架构高级编码 Agent，支持多模型与高阶推理',
      candidateModels: mergeCustomModels(ducxModels.models, ov?.customModels),
      defaultModel: ducxModels.defaultModel,
      installCommand: 'curl -fsSL http://team-mesh.loop.baidu-int.com:8004/api/tmesh/dist/install.sh | bash',
      docUrl: 'http://team-mesh.loop.baidu-int.com:8004',
      source: 'local',
      checkedAt: now
    };
  };

  const results = await Promise.all([
    probeClaude(),
    probeCodex(),
    probePi(),
    probeDsh(),
    probeOllama(),
    probeDucc(),
    probeDucx()
  ]);

  const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents(options?.userId);
  for (const remote of remoteAgents) {
    const existing = results.find((r) => r.id === remote.id);
    if (existing) {
      const remoteHasReady = remote.status ? remote.status === 'ready' : remote.installed;
      if (!existing.installed) {
        existing.installed = true;
        existing.isAvailable = remoteHasReady;
        existing.status = remote.status || 'ready';
        existing.statusMessage = remote.statusMessage;
        existing.auth = remote.auth;
        existing.version = remote.version || existing.version;
        existing.executablePath = remote.executablePath || existing.executablePath;
        existing.source = 'remote';
        existing.machineName = remote.machineName;
        existing.candidateModels =
          remote.candidateModels && remote.candidateModels.length > 0
            ? mergeCustomModels(remote.candidateModels, overrides[existing.id]?.customModels)
            : existing.candidateModels;
        existing.defaultModel = remote.defaultModel || existing.defaultModel;
      } else {
        existing.version = remote.version || existing.version;
        const merged = Array.from(
          new Set([...(remote.candidateModels || []), ...(existing.candidateModels || [])])
        );
        existing.candidateModels = merged.length > 0 ? merged : existing.candidateModels;
        if (!existing.defaultModel) existing.defaultModel = remote.defaultModel;
      }
      if (remote.machineName && !existing.description.includes(remote.machineName)) {
        existing.description = `${existing.description} [已连接节点: ${remote.machineName}]`;
      }
    } else {
      results.push(remote);
    }
  }

  probeCache.set(cacheKey, { expiresAt: Date.now() + PROBE_CACHE_TTL_MS, data: results });
  return results;
}
