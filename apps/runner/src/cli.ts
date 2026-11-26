#!/usr/bin/env node
import { spawn, execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import os, { homedir, hostname } from 'node:os';
import path, { delimiter, dirname, extname, join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import readline from 'node:readline';

interface RuntimeAuthInfo {
  status: 'authenticated' | 'unauthenticated' | 'unknown';
  method?: string;
  label?: string;
  email?: string;
  endpoint?: string;
}

interface RuntimeDef {
  id: string;
  name: string;
  version?: string;
  executablePath?: string;
  models: string[];
  defaultModel: string;
  protocol?: string;
  status?: 'ready' | 'unauthenticated' | 'warning' | 'error' | 'not_found';
  statusMessage?: string;
  auth?: RuntimeAuthInfo;
}

interface RunnerTask {
  taskId: string;
  agentId: string;
  model?: string;
  prompt: string;
  timeoutMs: number;
  binaryPath?: string;
  configDir?: string;
  cwd?: string;
  extraArgs?: string;
  env?: Record<string, string>;
  baseUrl?: string;
  apiKey?: string;
  maxTurns?: number;
}

const WINDOWS_SHIM_EXTENSIONS = new Set(['.cmd', '.bat', '.ps1']);
const CLAUDE_PACKAGE_ENTRIES = [
  ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'],
  ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'],
  ['..', 'Packages', 'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe', 'claude.exe']
];

function expandHomePath(inputPath?: string): string | undefined {
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

function resolveExecutableLaunchTarget(executablePath: string): { command: string; argsPrefix: string[] } {
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

function parseCliExtraArgs(raw?: string): string[] {
  if (!raw || !raw.trim()) return [];
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const val = match[1] ?? match[2] ?? match[3];
    if (val !== undefined && val.length > 0) {
      tokens.push(val);
    }
  }
  return tokens;
}

function getAugmentedPath(): string {
  const home = homedir();
  const extraDirs = [
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.baidu-cc', 'baidu-cc', 'bin'),
    join(home, '.comate', 'baidu-cc', 'bin'),
    join(home, '.baidu-cx', 'baidu-cx', 'bin'),
    join(home, '.comate', 'baidu-cx', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.cargo', 'bin'),
    join(home, '.nvm', 'current', 'bin'),
  ];
  const currentPath = process.env.PATH || '';
  const currentDirs = currentPath.split(delimiter).filter(Boolean);
  const merged = Array.from(new Set([...extraDirs, ...currentDirs]));
  return merged.filter((d) => existsSync(d)).join(delimiter);
}

function findExecutable(command: string): string | null {
  const expanded = expandHomePath(command) || command;
  if (!expanded) return null;
  const isExplicit = expanded.includes('/') || expanded.includes('\\') || expanded.startsWith('.');
  if (isExplicit || isExistingFile(expanded)) {
    if (isExistingFile(expanded)) return expanded;
    if (process.platform === 'win32') {
      for (const ext of ['.exe', '.cmd', '.bat']) {
        if (isExistingFile(`${expanded}${ext}`)) return `${expanded}${ext}`;
      }
    }
    if (isExplicit) return null;
  }

  const pathEnv = getAugmentedPath();
  const dirs = pathEnv.split(delimiter);
  const candidates = process.platform === 'win32' && !extname(expanded)
    ? [expanded, `${expanded}.exe`, `${expanded}.cmd`, `${expanded}.bat`]
    : [expanded];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of candidates) {
      const fullPath = join(dir, name);
      if (isExistingFile(fullPath)) return fullPath;
    }
  }
  return null;
}

function probeVersionSafe(executablePath: string): string | undefined {
  try {
    const target = resolveExecutableLaunchTarget(executablePath);
    const out = execFileSync(target.command, [...target.argsPrefix, '--version'], {
      timeout: 4500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        PATH: getAugmentedPath(),
        CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
        CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1'
      }
    });
    return (out || '').trim().split('\n')[0] || undefined;
  } catch {
    return undefined;
  }
}

function queryCliModels(binPath: string, cmdArgs: string[] = ['models']): string[] {
  try {
    const out = execSync(`"${binPath}" ${cmdArgs.join(' ')}`, {
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: Object.assign({}, process.env, { PATH: getAugmentedPath() })
    });
    const match = out.match(/Available Models:\s*([\s\S]+)/i);
    if (match && match[1]) {
      return match[1]
        .split(',')
        .map((m) => m.trim())
        .filter((m) => m && !m.includes('自定义模型组'));
    }
  } catch {}
  return [];
}

function resolveModelAlias(
  requestedModel: string | undefined,
  availableModels: string[],
  defaultModel?: string
): string {
  if (!availableModels || availableModels.length === 0) {
    return requestedModel || defaultModel || '';
  }
  if (!requestedModel || !requestedModel.trim()) {
    return defaultModel || availableModels[0];
  }

  const clean = requestedModel.trim();

  // 1. 精确匹配
  if (availableModels.includes(clean)) {
    return clean;
  }

  // 2. 忽略大小写精确匹配
  const lower = clean.toLowerCase();
  const exactCase = availableModels.find((m) => m.toLowerCase() === lower);
  if (exactCase) {
    return exactCase;
  }

  // 3. 常见模型别名/系列族模糊归一化
  const keywords = ['deepseek', 'sonnet', 'opus', 'haiku', 'claude', 'gpt-6', 'gpt-5', 'gpt-4', 'glm', 'kimi', 'ernie', 'grok', 'minimax', 'qwen'];
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      const matched = availableModels.find((m) => m.toLowerCase().includes(kw));
      if (matched) {
        return matched;
      }
    }
  }

  // 4. 任意子串包含匹配
  const partial = availableModels.find((m) => m.toLowerCase().includes(lower) || lower.includes(m.toLowerCase()));
  if (partial) {
    return partial;
  }

  // 5. 兜底回退为当前可用默认模型或列表首个模型
  return defaultModel || availableModels[0];
}

function detectLocalRuntimes(): RuntimeDef[] {
  const home = homedir();
  const runtimes: RuntimeDef[] = [];

  // 0. claude (Claude Code)
  const claudePath = findExecutable('claude');
  if (claudePath) {
    const version = probeVersionSafe(claudePath);
    const defaultClaudeModels = [
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-haiku-4-5',
      'sonnet',
      'opus',
      'haiku'
    ];
    let activeModel = '';
    const settingsEnv: Record<string, string> = {};
    const claudeCandidateDirs = [join(home, '.claude')];
    const winMatch = claudePath.match(/^(\/mnt\/[a-zA-Z]\/Users\/[^/]+)\//);
    if (winMatch && winMatch[1]) {
      claudeCandidateDirs.push(join(winMatch[1], '.claude'));
    }
    for (const dir of claudeCandidateDirs) {
      const settingsFile = join(dir, 'settings.json');
      if (!isExistingFile(settingsFile)) continue;
      try {
        const raw = JSON.parse(readFileSync(settingsFile, 'utf8'));
        if (typeof raw.model === 'string' && raw.model.trim()) activeModel = raw.model.trim();
        if (raw.env && typeof raw.env === 'object') {
          for (const [k, v] of Object.entries(raw.env)) {
            if (typeof v === 'string' && v.trim()) settingsEnv[k] = v.trim();
          }
          if (!activeModel && settingsEnv.ANTHROPIC_MODEL) activeModel = settingsEnv.ANTHROPIC_MODEL;
        }
        break;
      } catch {}
    }

    let auth: RuntimeAuthInfo = { status: 'unknown' };
    let status: RuntimeDef['status'] = version ? 'ready' : 'error';
    let statusMessage: string | undefined;

    if (version) {
      let authJson: Record<string, any> | null = null;
      try {
        const target = resolveExecutableLaunchTarget(claudePath);
        const out = execFileSync(target.command, [...target.argsPrefix, 'auth', 'status'], {
          timeout: 4500,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          env: {
            ...process.env,
            PATH: getAugmentedPath(),
            CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
            CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1'
          }
        });
        if (out && out.trim().startsWith('{')) authJson = JSON.parse(out.trim());
      } catch (err: any) {
        const out = err?.stdout ? String(err.stdout).trim() : '';
        if (out.startsWith('{')) {
          try { authJson = JSON.parse(out); } catch {}
        }
      }

      const customEndpoint = settingsEnv.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || '';
      const hasApiKey = Boolean(
        settingsEnv.ANTHROPIC_API_KEY ||
        settingsEnv.ANTHROPIC_AUTH_TOKEN ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.ANTHROPIC_AUTH_TOKEN
      );

      if (authJson && authJson.loggedIn === true) {
        auth = {
          status: 'authenticated',
          method: typeof authJson.authMethod === 'string' ? authJson.authMethod : 'oauth',
          label: typeof authJson.subscriptionType === 'string' ? `Claude ${authJson.subscriptionType}` : 'Claude 账号已登录',
          email: typeof authJson.email === 'string' ? authJson.email : undefined
        };
        status = 'ready';
      } else if (customEndpoint || hasApiKey) {
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
        statusMessage = '已检测到 Claude Code，但尚未完成登录认证。';
      }
    }

    const models = Array.from(new Set([...(activeModel ? [activeModel] : []), ...defaultClaudeModels]));
    runtimes.push({
      id: 'claude',
      name: 'Claude Code (本地 Agent)',
      version,
      executablePath: claudePath,
      models,
      defaultModel: activeModel || models[0],
      protocol: 'acp-stdio',
      status,
      statusMessage,
      auth
    });
  }

  // 1. ducc (Baidu CC)
  const duccPath = findExecutable('ducc');
  if (duccPath) {
    let activeModel = 'GLM-5.3-Flash-内部';
    const userJson = join(home, '.baidu-cc', 'user.json');
    if (existsSync(userJson)) {
      try {
        const raw = JSON.parse(readFileSync(userJson, 'utf8'));
        if (raw.env?.ANTHROPIC_MODEL) activeModel = raw.env.ANTHROPIC_MODEL;
      } catch {}
    }
    const detectedModels = queryCliModels(duccPath, ['models']);
    const fallbackModels = [
      'GLM-5.3-Flash-内部',
      'Opus 4.8',
      'Opus 5',
      'Opus 5.5',
      'Claude Sonnet 5',
      'Claude Sonnet 5.5',
      'Claude Haiku 5.5',
      'ERNIE-5.5-Flash-Preview-内部',
      'ERNIE-Light-DT-1.0-内部',
      'DeepSeek-V4.1-Flash-内部',
      'DeepSeek-V4-Flash-内部',
      'DeepSeek-V4-Pro',
      'DeepSeek-V4.1-Flash',
      'gpt-6.1-sol',
      'gpt-6.2-sol',
      'gpt-5.6-sol',
      'gpt-5.6-luna',
      'gpt-5.6-terra',
      'gpt-6-luna',
      'gpt-6-astra',
      'gpt-6.2-astra',
      'GLM-5.3-Flash',
      'GLM-5.3',
      'GLM-5.2',
      'Grok-4.7',
      'Grok-4.6',
      'Kimi-K2.7-Code-内部',
      'Kimi K3',
      'Kimi K2.6',
      'MiniMax-M3',
      'Fable 5.2 尝鲜',
      'auto-内部'
    ];
    const models = (detectedModels.length > 0 || activeModel)
      ? Array.from(new Set([...(activeModel ? [activeModel] : []), ...detectedModels]))
      : fallbackModels;
    runtimes.push({
      id: 'ducc',
      name: 'Baidu CC (本地 ducc)',
      executablePath: duccPath,
      models,
      defaultModel: activeModel || models[0]
    });
  }

  // 2. ducx (Baidu CX)
  const ducxPath = findExecutable('ducx') || findExecutable('baidu-cx');
  if (ducxPath) {
    let activeModel = 'gpt-5.6-sol';
    const configToml = join(home, '.baidu-cx', 'config.toml');
    if (existsSync(configToml)) {
      try {
        const content = readFileSync(configToml, 'utf8');
        const match = content.match(/^model\s*=\s*["']([^"']+)["']/m);
        if (match && match[1]) activeModel = match[1];
      } catch {}
    }
    const detectedModels = queryCliModels(ducxPath, ['models']);
    const dynamicModels: string[] = [];
    const oneapiCat = join(home, '.baidu-cx', 'model-catalogs', 'oneapi-models.json');
    if (existsSync(oneapiCat)) {
      try {
        const raw = JSON.parse(readFileSync(oneapiCat, 'utf8'));
        if (Array.isArray(raw.models)) {
          for (const m of raw.models) {
            const id = m.id || m.slug || m.name || m.display_name;
            if (id && typeof id === 'string') dynamicModels.push(id);
          }
        }
      } catch {}
    }
    const fallbackModels = [
      'gpt-5.6-sol',
      'gpt-6.1-sol',
      'gpt-6.2-sol',
      'gpt-6-astra',
      'gpt-6-luna',
      'gpt-5.6-luna',
      'gpt-5.6-terra',
      'GLM-5.3-Flash',
      'GLM-5.3',
      'DeepSeek-V4-Pro',
      'DeepSeek-V4.1-Flash',
      'DeepSeek-V4-Flash-Vision-Exp',
      'ERNIE-5.5-Flash-Preview-内部'
    ];
    const models = (detectedModels.length > 0 || dynamicModels.length > 0 || activeModel)
      ? Array.from(new Set([...(activeModel ? [activeModel] : []), ...detectedModels, ...dynamicModels]))
      : fallbackModels;
    runtimes.push({
      id: 'ducx',
      name: 'Baidu CX (本地 ducx)',
      executablePath: ducxPath,
      models,
      defaultModel: activeModel || models[0]
    });
  }

  // 3. codex
  const codexPath = findExecutable('codex');
  if (codexPath) {
    let activeModel = '';
    const dynamicModels: string[] = [];
    const configToml = join(home, '.codex', 'config.toml');
    if (existsSync(configToml)) {
      try {
        const content = readFileSync(configToml, 'utf8');
        const match = content.match(/^model\s*=\s*["']([^"']+)["']/m);
        if (match && match[1]) activeModel = match[1].trim();

        const catalogMatch = content.match(/^model_catalog_json\s*=\s*["']([^"']+)["']/m);
        if (catalogMatch && catalogMatch[1] && existsSync(catalogMatch[1])) {
          try {
            const catalogRaw = JSON.parse(readFileSync(catalogMatch[1], 'utf8'));
            if (Array.isArray(catalogRaw.models)) {
              for (const m of catalogRaw.models) {
                const id = m.id || m.slug || m.name || m.display_name;
                if (id && typeof id === 'string') dynamicModels.push(id);
              }
            }
          } catch {}
        }
      } catch {}
    }

    const mixinCat = join(home, '.codex', 'model-catalogs', 'mixin-models.json');
    if (existsSync(mixinCat)) {
      try {
        const raw = JSON.parse(readFileSync(mixinCat, 'utf8'));
        if (Array.isArray(raw.models)) {
          for (const m of raw.models) {
            const id = m.id || m.slug || m.name || m.display_name;
            if (id && typeof id === 'string') dynamicModels.push(id);
          }
        }
      } catch {}
    }

    const oneapiCat = join(home, '.baidu-cx', 'model-catalogs', 'oneapi-models.json');
    if (existsSync(oneapiCat)) {
      try {
        const raw = JSON.parse(readFileSync(oneapiCat, 'utf8'));
        if (Array.isArray(raw.models)) {
          for (const m of raw.models) {
            const id = m.id || m.slug || m.name || m.display_name;
            if (id && typeof id === 'string') dynamicModels.push(id);
          }
        }
      } catch {}
    }

    const fallbackModels = [
      'Grok-4.7-baidu-oneapi',
      'Claude Sonnet 5.5-baidu-oneapi',
      'Opus 5.5-baidu-oneapi',
      'DeepSeek-V4.1-Flash-baidu-oneapi',
      'Kimi-K2.7-Code-baidu-oneapi',
      'gpt-6.2-astra',
      'gpt-6.2-sol',
      'gpt-6.1-sol',
      'gpt-6.1-terra',
      'gpt-6-astra',
      'gpt-6-luna',
      'gpt-6-sol',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.5',
      'GLM-5.3-Flash',
      'GLM-5.3',
      'DeepSeek-V4-Pro',
      'DeepSeek-V4.1-Flash',
      'ERNIE-5.5-Flash-Preview-内部',
      'gpt-4o',
      'gpt-4.5-preview',
      'o3-mini',
      'o1',
      'o1-mini'
    ];

    const models = (dynamicModels.length > 0 || activeModel)
      ? Array.from(new Set([...(activeModel ? [activeModel] : []), ...dynamicModels]))
      : fallbackModels;

    runtimes.push({
      id: 'codex',
      name: 'OpenAI Codex (本地 Agent)',
      executablePath: codexPath,
      models,
      defaultModel: activeModel || models[0] || 'Grok-4.7-baidu-oneapi'
    });
  }

  // 4. pi
  const piPath = findExecutable('pi');
  if (piPath) {
    const dynamicModels: string[] = [];
    const modelsJson = join(home, '.pi', 'agent', 'models.json');
    if (existsSync(modelsJson)) {
      try {
        const raw = JSON.parse(readFileSync(modelsJson, 'utf8'));
        if (raw.providers && typeof raw.providers === 'object') {
          for (const provider of Object.values(raw.providers as Record<string, any>)) {
            if (Array.isArray(provider.models)) {
              for (const m of provider.models) {
                const id = m.id || m.name;
                if (id && typeof id === 'string') dynamicModels.push(id);
              }
            }
          }
        }
      } catch {}
    }

    const fallbackModels = [
      'Opus 5.5-baidu-oneapi',
      'Claude Sonnet 5.5-baidu-oneapi',
      'Claude Haiku 5.5-baidu-oneapi',
      'Opus 5-baidu-oneapi',
      'Claude Sonnet 5-baidu-oneapi',
      'Opus 4.8-baidu-oneapi',
      'DeepSeek-V4.1-Flash-baidu-oneapi',
      'DeepSeek-V4-Flash-baidu-oneapi',
      'DeepSeek-V4-Pro-baidu-oneapi',
      'ERNIE-5.5-Flash-Preview-baidu-oneapi',
      'gpt-6.1-sol-baidu-oneapi',
      'gpt-5.6-sol-baidu-oneapi',
      'anthropic/claude-3-7-sonnet',
      'anthropic/claude-3-5-sonnet',
      'openai/gpt-4o',
      'openai/o3-mini'
    ];

    const models = dynamicModels.length > 0
      ? Array.from(new Set(dynamicModels))
      : fallbackModels;

    runtimes.push({
      id: 'pi',
      name: 'Pi Coding Agent (本地 Agent)',
      executablePath: piPath,
      models,
      defaultModel: models[0] || 'Opus 5.5-baidu-oneapi'
    });
  }

  return runtimes;
}

function getServicePaths() {
  const home = homedir();
  const museclawDir = join(home, '.museclaw');
  const configFile = join(museclawDir, 'runner.json');
  const clientScript = join(museclawDir, 'client.js');
  const logFile = join(museclawDir, 'runner.log');
  const errLogFile = join(museclawDir, 'runner.err.log');
  const isMac = os.platform() === 'darwin';
  const launchdPlist = join(home, 'Library', 'LaunchAgents', 'com.museclaw.runner.plist');
  const systemdService = join(home, '.config', 'systemd', 'user', 'museclaw-runner.service');

  return {
    home,
    museclawDir,
    configFile,
    clientScript,
    logFile,
    errLogFile,
    isMac,
    launchdPlist,
    systemdService
  };
}

function loadPersistentConfig(): Record<string, string> {
  const paths = getServicePaths();
  if (existsSync(paths.configFile)) {
    try {
      return JSON.parse(readFileSync(paths.configFile, 'utf8'));
    } catch {}
  }
  return {};
}

function savePersistentConfig(cfg: Record<string, any>): void {
  const paths = getServicePaths();
  if (!existsSync(paths.museclawDir)) {
    mkdirSync(paths.museclawDir, { recursive: true });
  }
  try {
    const existing = loadPersistentConfig();
    const merged = { ...existing, ...cfg };
    writeFileSync(paths.configFile, JSON.stringify(merged, null, 2), 'utf8');
  } catch {}
}

function installService(config: { serverUrl: string; token: string; name: string }): void {
  const paths = getServicePaths();
  if (!existsSync(paths.museclawDir)) {
    mkdirSync(paths.museclawDir, { recursive: true });
  }

  savePersistentConfig(config);

  try {
    const currentScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
    if (currentScript && existsSync(currentScript) && currentScript !== path.resolve(paths.clientScript)) {
      copyFileSync(currentScript, paths.clientScript);
    }
  } catch {}

  const nodeBin = process.execPath;
  const envPath = getAugmentedPath();

  if (os.platform() === 'win32') {
    console.log('\n===========================================================');
    console.log('⚠️ Windows 环境下建议使用前台或任务计划程序运行伴侣进程:');
    console.log(`   node "${paths.clientScript}" --server "${config.serverUrl}" --token "${config.token}"`);
    console.log('===========================================================\n');
    return;
  }

  if (paths.isMac) {
    const launchAgentsDir = join(paths.home, 'Library', 'LaunchAgents');
    if (!existsSync(launchAgentsDir)) {
      mkdirSync(launchAgentsDir, { recursive: true });
    }

    try {
      execSync(`launchctl unload -w "${paths.launchdPlist}" 2>/dev/null`, { stdio: 'ignore' });
    } catch {}

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.museclaw.runner</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${paths.clientScript}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${paths.museclawDir}</string>
  <key>StandardOutPath</key>
  <string>${paths.logFile}</string>
  <key>StandardErrorPath</key>
  <string>${paths.errLogFile}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${envPath}</string>
    <key>HOME</key>
    <string>${paths.home}</string>
  </dict>
</dict>
</plist>`;

    writeFileSync(paths.launchdPlist, plistContent, 'utf8');
    execSync(`launchctl load -w "${paths.launchdPlist}"`);
    console.log('✅ macOS LaunchAgent 守护服务已安装并启动: com.museclaw.runner');
  } else {
    const systemdDir = join(paths.home, '.config', 'systemd', 'user');
    if (!existsSync(systemdDir)) {
      mkdirSync(systemdDir, { recursive: true });
    }

    try {
      execSync('systemctl --user stop museclaw-runner.service 2>/dev/null', { stdio: 'ignore' });
    } catch {}

    const serviceContent = `[Unit]
Description=MuseClaw Remote Mesh Runner Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${paths.clientScript}
WorkingDirectory=${paths.museclawDir}
Restart=always
RestartSec=5
StandardOutput=append:${paths.logFile}
StandardError=append:${paths.errLogFile}
Environment="PATH=${envPath}"
Environment="HOME=${paths.home}"

[Install]
WantedBy=default.target
`;

    writeFileSync(paths.systemdService, serviceContent, 'utf8');
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable --now museclaw-runner.service');
    console.log('✅ Linux systemd 用户常驻服务已安装并启动: museclaw-runner.service');
  }

  console.log('\n===========================================================');
  console.log('🎉 MuseClaw 伴侣服务已成功配置为系统自启动后台常驻守护！');
  console.log(`🌐 接入网关: ${config.serverUrl}`);
  console.log(`🔑 认证令牌: ${config.token}`);
  console.log(`📄 运行日志: tail -f ${paths.logFile}`);
  console.log('💡 电脑开机、注销、睡眠唤醒后均会自动后台静默重连，无需保持终端打开。');
  console.log('-----------------------------------------------------------');
  console.log('🛠️ 常用管理命令:');
  console.log(`   - 查看状态: node "${paths.clientScript}" --status`);
  console.log(`   - 重启服务: node "${paths.clientScript}" --restart-service`);
  console.log(`   - 卸载服务: node "${paths.clientScript}" --uninstall-service`);
  console.log('===========================================================\n');
}

function uninstallService(): void {
  const paths = getServicePaths();
  if (os.platform() === 'win32') {
    console.log('\n===========================================================');
    console.log('⚠️ Windows 环境下建议使用前台或任务计划程序运行伴侣进程:');
    console.log(`   node "${paths.clientScript}" --server "${config.serverUrl}" --token "${config.token}"`);
    console.log('===========================================================\n');
    return;
  }

  if (paths.isMac) {
    try {
      execSync(`launchctl unload -w "${paths.launchdPlist}" 2>/dev/null`, { stdio: 'ignore' });
    } catch {}
    if (existsSync(paths.launchdPlist)) {
      unlinkSync(paths.launchdPlist);
    }
    console.log('🛑 macOS LaunchAgent 守护服务已停止并卸载: com.museclaw.runner');
  } else {
    try {
      execSync('systemctl --user stop museclaw-runner.service 2>/dev/null', { stdio: 'ignore' });
      execSync('systemctl --user disable museclaw-runner.service 2>/dev/null', { stdio: 'ignore' });
    } catch {}
    if (existsSync(paths.systemdService)) {
      unlinkSync(paths.systemdService);
      execSync('systemctl --user daemon-reload 2>/dev/null || true');
    }
    console.log('🛑 Linux systemd 用户常驻服务已停止并卸载: museclaw-runner.service');
  }
}

function getServiceStatus(): void {
  const paths = getServicePaths();
  console.log('\n===========================================================');
  console.log('📊 MuseClaw Remote Mesh Runner 守护服务状态');
  console.log('-----------------------------------------------------------');

  let statusText = '未安装系统自启服务';

  if (os.platform() === 'win32') {
    console.log('\n===========================================================');
    console.log('⚠️ Windows 环境下建议使用前台或任务计划程序运行伴侣进程:');
    console.log(`   node "${paths.clientScript}" --server "${config.serverUrl}" --token "${config.token}"`);
    console.log('===========================================================\n');
    return;
  }

  if (paths.isMac) {
    const isInstalled = existsSync(paths.launchdPlist);
    if (isInstalled) {
      try {
        const out = execSync('launchctl list | grep com.museclaw.runner || true', { encoding: 'utf8' }).trim();
        if (out) {
          const parts = out.split(/\s+/);
          const pid = parts[0];
          statusText = pid !== '-' ? `正在运行 (PID: ${pid})` : `已加载等待中 (退出状态: ${parts[1]})`;
        } else {
          statusText = '已配置但未运行';
        }
      } catch {
        statusText = '已安装';
      }
    }
  } else {
    const isInstalled = existsSync(paths.systemdService);
    if (isInstalled) {
      try {
        const out = execSync('systemctl --user is-active museclaw-runner.service || true', { encoding: 'utf8' }).trim();
        statusText = out === 'active' ? '正在运行 (Active)' : `状态: ${out}`;
      } catch {
        statusText = '已安装';
      }
    }
  }

  console.log(`系统服务:   ${statusText}`);
  if (existsSync(paths.configFile)) {
    try {
      const cfg = JSON.parse(readFileSync(paths.configFile, 'utf8'));
      console.log(`接入网关:   ${cfg.serverUrl || '默认'}`);
      console.log(`用户令牌:   ${cfg.token || '默认'}`);
      console.log(`机器名称:   ${cfg.name || hostname()}`);
    } catch {}
  }

  if (existsSync(paths.logFile)) {
    console.log(`\n📄 最新运行日志 (${paths.logFile}):`);
    console.log('-----------------------------------------------------------');
    try {
      const lines = readFileSync(paths.logFile, 'utf8').trim().split('\n');
      console.log(lines.slice(-10).join('\n'));
    } catch {}
  }
  console.log('===========================================================\n');
}

function restartService(): void {
  const paths = getServicePaths();
  if (os.platform() === 'win32') {
    console.log('\n===========================================================');
    console.log('⚠️ Windows 环境下建议使用前台或任务计划程序运行伴侣进程:');
    console.log(`   node "${paths.clientScript}" --server "${config.serverUrl}" --token "${config.token}"`);
    console.log('===========================================================\n');
    return;
  }

  if (paths.isMac) {
    try {
      execSync(`launchctl unload -w "${paths.launchdPlist}" 2>/dev/null`, { stdio: 'ignore' });
      execSync(`launchctl load -w "${paths.launchdPlist}"`);
      console.log('🔄 macOS 守护服务已重新加载启动！');
    } catch (e: any) {
      console.error('重启服务失败:', e.message);
    }
  } else {
    try {
      execSync('systemctl --user restart museclaw-runner.service');
      console.log('🔄 Linux 守护服务已重新启动！');
    } catch (e: any) {
      console.error('重启服务失败:', e.message);
    }
  }
}

class MuseClawRunnerClient {
  private serverUrl: string;
  private token: string;
  private machineId: string;
  private machineName: string;
  private runtimes: RuntimeDef[] = [];
  private isRunning = true;
  private lastRegisterTime = 0;

  constructor(options: { serverUrl: string; token?: string; name?: string }) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.token = options.token || process.env.MUSECLAW_TOKEN || 'default-mesh-token';
    this.machineName = options.name || hostname();
    this.machineId = `node_${Buffer.from(this.machineName).toString('hex').slice(0, 10)}`;
  }

  private request(path: string, method = 'POST', body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(`${this.serverUrl}${path}`);
      const isHttps = fullUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const payload = body ? JSON.stringify(body) : undefined;
      const req = transport.request(
        fullUrl,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            Authorization: `Bearer ${this.token}`,
            'X-Runner-Machine-Id': this.machineId
          },
          timeout: 45000
        },
        (res) => {
          let resData = '';
          res.on('data', (d) => { resData += d; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(resData || '{}');
              resolve(parsed);
            } catch {
              resolve(resData);
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  public async register(): Promise<boolean> {
    this.runtimes = detectLocalRuntimes();
    try {
      const reg = await this.request('/api/runner/register', 'POST', {
        machineId: this.machineId,
        hostname: this.machineName,
        platform: os.platform(),
        arch: os.arch(),
        token: this.token,
        runtimes: this.runtimes
      });
      this.lastRegisterTime = Date.now();
      console.log(`🟢 节点在线就绪 (注册 ID: ${reg?.machineId || this.machineId})`);
      return true;
    } catch (err: any) {
      console.error(`⚠️ 节点注册失败 (${err.message})`);
      return false;
    }
  }

  public async start(): Promise<void> {
    console.log('\n===========================================================');
    console.log('🐾 MuseClaw Remote Mesh Runner 伴侣守护进程已启动');
    console.log('-----------------------------------------------------------');
    console.log(`🖥️  本地主机:   ${this.machineName} (${os.platform()}-${os.arch()})`);
    console.log(`🌐 连接网关:   ${this.serverUrl}`);

    this.runtimes = detectLocalRuntimes();
    console.log(`⚡ 发现运行时: ${this.runtimes.map((r) => `${r.id} (${r.defaultModel})`).join(', ') || '未检测到可用 Agent'}`);

    const ok = await this.register();
    if (!ok) {
      console.log('⚠️ 首次注册未成功，进入重试与监听循环...');
    }

    console.log('📡 正在监听云端任务调度 (Long-Polling Active)...');
    console.log('===========================================================\n');

    this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // 定期重新同步注册信息（每 3 分钟自动刷新一次，防止网关重载或长时间网络抖动后失联）
        if (Date.now() - this.lastRegisterTime > 180000) {
          await this.register();
        }

        const res = await this.request('/api/runner/poll', 'POST', {
          machineId: this.machineId,
          token: this.token
        });

        if (res && res.needRegister) {
          console.log('🔄 检测到云端网关重启或节点未就绪，正在重新同步注册...');
          await this.register();
          continue;
        }

        if (res && res.taskId) {
          console.log(`\n📥 收到云端任务: [${res.taskId}] 调度目标: ${res.agentId} (模型: ${res.model || '默认'})`);
          this.executeTask(res).catch((err) => {
            console.error(`❌ 任务执行异常:`, err);
          });
        }
      } catch (err: any) {
        // 网络抖动降频等待
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async executeTask(task: RunnerTask): Promise<void> {
    const start = Date.now();
    const runtime = this.runtimes.find((r) => r.id === task.agentId);
    const exe = task.binaryPath
      ? findExecutable(task.binaryPath)
      : (runtime?.executablePath || findExecutable(task.agentId));

    if (!exe) {
      await this.request(`/api/runner/tasks/${task.taskId}/complete`, 'POST', {
        ok: false,
        text: '',
        error: `本地未找到运行时 ${task.agentId}，路径不可达`
      });
      return;
    }

    let targetModel = task.model;
    if (task.agentId !== 'claude' && runtime && runtime.models && runtime.models.length > 0) {
      targetModel = resolveModelAlias(task.model, runtime.models, runtime.defaultModel);
      if (task.model && targetModel && task.model !== targetModel) {
        console.log(`🔄 [${task.agentId}] 模型别名自动对齐: "${task.model}" -> "${targetModel}"`);
      }
    }

    const extraCliArgs = parseCliExtraArgs(task.extraArgs);
    const isRoot = (typeof process.getuid === 'function' && process.getuid() === 0) ||
      process.env.USER === 'root' ||
      process.env.LOGNAME === 'root' ||
      Boolean(process.env.SUDO_USER) ||
      Boolean(process.env.SUDO_UID) ||
      process.env.UID === '0';

    let args: string[] = [];
    if (task.agentId === 'claude') {
      args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--settings', JSON.stringify({ disableAllHooks: true }),
        '--strict-mcp-config',
        '--mcp-config', JSON.stringify({ mcpServers: {} })
      ];
      if (task.maxTurns && task.maxTurns > 0) {
        args.push('--max-turns', String(task.maxTurns));
      }
      if (!isRoot && !extraCliArgs.includes('--permission-mode')) {
        args.push('--dangerously-skip-permissions');
      }
      if (targetModel && targetModel !== 'default' && targetModel !== 'auto') {
        args.push('--model', targetModel);
      }
      if (extraCliArgs.length > 0) args.push(...extraCliArgs);
    } else if (task.agentId === 'ducc') {
      args = isRoot
        ? ['-p', '--output-format=stream-json', '--verbose']
        : ['-p', '--output-format=stream-json', '--verbose', '--dangerously-skip-permissions'];
      if (targetModel) args.push('--model', targetModel);
      if (extraCliArgs.length > 0) args.push(...extraCliArgs);
    } else if (task.agentId === 'ducx' || task.agentId === 'codex') {
      args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];
      if (targetModel) args.push('--model', targetModel);
      if (extraCliArgs.length > 0) args.push(...extraCliArgs);
      args.push('-');
    } else if (task.agentId === 'pi') {
      args = ['-p', '--no-session'];
      if (targetModel) args.push('--model', targetModel);
      if (extraCliArgs.length > 0) args.push(...extraCliArgs);
    } else {
      args = [...extraCliArgs, task.prompt];
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: getAugmentedPath(),
      CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false'
    };
    if (task.agentId !== 'claude') {
      env.IS_SANDBOX = '1';
      env.CLAUDE_ALLOW_ROOT = '1';
    }
    const expandedConfigDir = expandHomePath(task.configDir);
    if (expandedConfigDir) {
      if (task.agentId === 'claude') env.CLAUDE_CONFIG_DIR = expandedConfigDir;
      else if (task.agentId === 'codex') env.CODEX_HOME = expandedConfigDir;
    }
    if (task.baseUrl && !task.baseUrl.startsWith('local://') && task.agentId === 'claude') {
      env.ANTHROPIC_BASE_URL = task.baseUrl.trim();
    }
    if (task.apiKey && task.apiKey.trim()) {
      if (task.agentId === 'claude') {
        const cleanKey = task.apiKey.trim();
        env.ANTHROPIC_API_KEY = cleanKey;
        if (env.ANTHROPIC_BASE_URL && !env.ANTHROPIC_AUTH_TOKEN) {
          env.ANTHROPIC_AUTH_TOKEN = cleanKey;
        }
      } else {
        env.DEEPSEEK_API_KEY = task.apiKey.trim();
      }
    }
    if (task.env) {
      for (const [k, v] of Object.entries(task.env)) {
        if (typeof v === 'string' && v.trim() !== '') env[k] = v;
      }
    }

    const spawnTarget = resolveExecutableLaunchTarget(exe);
    const expandedCwd = expandHomePath(task.cwd);
    const child = spawn(spawnTarget.command, [...spawnTarget.argsPrefix, ...args], {
      cwd: expandedCwd || process.cwd(),
      env,
      timeout: task.timeoutMs || 120000
    });

    let stdout = '';
    let stderr = '';
    let streamBuffer = '';
    let claudeDeltaText = '';
    let claudeDeltaReasoning = '';
    let claudeAssistantText = '';
    let claudeAssistantReasoning = '';
    let claudeResultText = '';
    let claudeErrorText = '';

    const handleClaudeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === 'stream_event' && parsed.event?.type === 'content_block_delta' && parsed.event.delta) {
          const d = parsed.event.delta;
          if (d.type === 'text_delta' && d.text) {
            claudeDeltaText += d.text;
            this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', { chunk: d.text });
          } else if (d.type === 'thinking_delta' && d.thinking) {
            claudeDeltaReasoning += d.thinking;
            this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', { chunk: '', reasoning: d.thinking });
          }
        } else if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
          if (parsed.is_api_error_message) {
            claudeErrorText = parsed.message.content.map((c: any) => c.text || '').join('\n').trim();
          } else {
            for (const c of parsed.message.content) {
              if (c.type === 'thinking' && c.thinking) {
                const th = c.thinking.trim();
                claudeAssistantReasoning = (claudeAssistantReasoning ? `${claudeAssistantReasoning}\n\n` : '') + th;
                if (!claudeDeltaReasoning && th) {
                  this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', { chunk: '', reasoning: th });
                }
              } else if (c.type === 'text' && c.text) {
                claudeAssistantText += c.text;
                if (!claudeDeltaText) {
                  this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', { chunk: c.text });
                }
              }
            }
          }
        } else if (parsed.type === 'result') {
          if (parsed.is_error) {
            claudeErrorText = parsed.result || claudeErrorText || 'Claude Code 返回执行错误';
          } else if (typeof parsed.result === 'string') {
            claudeResultText = parsed.result;
          }
        }
      } catch {}
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;

      if (task.agentId === 'claude') {
        streamBuffer += text;
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';
        for (const line of lines) handleClaudeLine(line);
      } else if (task.agentId === 'ducx' || task.agentId === 'codex') {
        streamBuffer += text;
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed.type === 'item.completed' && parsed.item) {
              if (parsed.item.type === 'reasoning' && parsed.item.text) {
                const reasoning = parsed.item.text.trim();
                if (reasoning) {
                  this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', {
                    chunk: '',
                    reasoning
                  });
                }
              } else if (parsed.item.type === 'agent_message' && parsed.item.text) {
                const clean = parsed.item.text.replace(/\n\nSkipped:[\s\S]*$/, '').trim();
                if (clean) {
                  this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', { chunk: clean });
                }
              }
            }
          } catch {}
        }
      } else if (task.agentId === 'ducc') {
        streamBuffer += text;
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
              for (const c of parsed.message.content) {
                if (c.type === 'thinking' && c.thinking) {
                  this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', {
                    chunk: '',
                    reasoning: c.thinking.trim()
                  });
                } else if (c.type === 'text' && c.text) {
                  this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', { chunk: c.text });
                }
              }
            }
          } catch {
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
              this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', { chunk: trimmed + '\n' });
            }
          }
        }
      } else {
        this.request(`/api/runner/tasks/${task.taskId}/stream`, 'POST', { chunk: text });
      }
    });

    child.stderr.on('data', (d) => { stderr += d.toString(); });

    if (task.agentId === 'claude' || task.agentId === 'ducc' || task.agentId === 'ducx' || task.agentId === 'codex') {
      child.stdin.write(task.prompt);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on('close', async (code) => {
      const latencyMs = Date.now() - start;
      let extractedText = stdout.trim();
      let extractedReasoning: string | undefined;

      if (task.agentId === 'claude') {
        if (streamBuffer.trim()) handleClaudeLine(streamBuffer);
        if (claudeErrorText) {
          await this.request(`/api/runner/tasks/${task.taskId}/complete`, 'POST', {
            ok: false,
            text: '',
            latencyMs,
            error: claudeErrorText
          });
          return;
        }
        extractedText = (claudeDeltaText || claudeAssistantText || claudeResultText).trim();
        extractedReasoning = (claudeDeltaReasoning || claudeAssistantReasoning).trim() || undefined;
      } else if (task.agentId === 'ducx' || task.agentId === 'codex') {
        const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
        const msgs: string[] = [];
        const reasoningParts: string[] = [];
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'item.completed' && parsed.item) {
              if (parsed.item.type === 'reasoning' && parsed.item.text) {
                reasoningParts.push(parsed.item.text.trim());
              } else if (parsed.item.type === 'agent_message' && parsed.item.text) {
                msgs.push(parsed.item.text);
              }
            }
          } catch {}
        }
        if (reasoningParts.length > 0) {
          extractedReasoning = reasoningParts.join('\n\n');
        }
        if (msgs.length > 0) {
          extractedText = msgs.join('\n\n').replace(/\n\nSkipped:[\s\S]*$/, '').trim();
        }
      } else if (task.agentId === 'ducc') {
        const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
        const textParts: string[] = [];
        const reasoningParts: string[] = [];
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
              for (const c of parsed.message.content) {
                if (c.type === 'thinking' && c.thinking) {
                  reasoningParts.push(c.thinking.trim());
                } else if (c.type === 'text' && c.text) {
                  textParts.push(c.text);
                }
              }
            }
            if (parsed.type === 'result' && typeof parsed.result === 'string') {
              if (textParts.length === 0) {
                extractedText = parsed.result.trim();
              }
            }
          } catch {}
        }
        if (reasoningParts.length > 0) {
          extractedReasoning = reasoningParts.join('\n\n');
        }
        if (textParts.length > 0) {
          extractedText = textParts.join('\n').trim();
        }
      }

      const ok = code === 0 && Boolean(extractedText);
      console.log(`📤 任务完成 [${task.taskId}]: ${ok ? '成功' : '失败'} (${latencyMs}ms)`);

      await this.request(`/api/runner/tasks/${task.taskId}/complete`, 'POST', {
        ok,
        text: extractedText,
        reasoning: extractedReasoning,
        latencyMs,
        error: ok ? undefined : (stderr.trim() || stdout.trim() || `进程异常退出 (code ${code})`)
      });
    });

    child.on('error', async (err) => {
      await this.request(`/api/runner/tasks/${task.taskId}/complete`, 'POST', {
        ok: false,
        text: '',
        latencyMs: Date.now() - start,
        error: err.message
      });
    });
  }

  public stop(): void {
    this.isRunning = false;
  }
}

// 命令行启动与服务管理逻辑
function parseArgs() {
  const args = process.argv.slice(2);
  const fileConfig = loadPersistentConfig();

  let serverUrl = process.env.MUSECLAW_SERVER_URL || fileConfig.serverUrl || 'http://localhost:8799';
  let token = process.env.MUSECLAW_TOKEN || fileConfig.token || 'default-mesh-token';
  let name = fileConfig.name || hostname();
  let action = 'run';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--server' || arg === '-s') && args[i + 1]) serverUrl = args[++i];
    else if ((arg === '--token' || arg === '-t') && args[i + 1]) token = args[++i];
    else if ((arg === '--name' || arg === '-n') && args[i + 1]) name = args[++i];
    else if (arg === '--install-service' || arg === '--daemon' || arg === 'service:install') action = 'install-service';
    else if (arg === '--uninstall-service' || arg === 'service:uninstall') action = 'uninstall-service';
    else if (arg === '--restart-service' || arg === 'service:restart') action = 'restart-service';
    else if (arg === '--status' || arg === '-v' || arg === 'service:status') action = 'status';
    else if (arg === '--probe') action = 'probe';
  }

  return { serverUrl, token, name, action };
}

const config = parseArgs();

if (config.action === 'probe') {
  console.log(JSON.stringify(detectLocalRuntimes(), null, 2));
  process.exit(0);
} else if (config.action === 'install-service') {
  installService({ serverUrl: config.serverUrl, token: config.token, name: config.name });
  process.exit(0);
} else if (config.action === 'uninstall-service') {
  uninstallService();
  process.exit(0);
} else if (config.action === 'restart-service') {
  restartService();
  process.exit(0);
} else if (config.action === 'status') {
  getServiceStatus();
  process.exit(0);
}

// 正常启动并持久化更新最近成功配置
savePersistentConfig({ serverUrl: config.serverUrl, token: config.token, name: config.name });
const client = new MuseClawRunnerClient(config);
client.start().catch((err: any) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n👋 正在断开与 MuseClaw 网关的连接...');
  client.stop();
  process.exit(0);
});
