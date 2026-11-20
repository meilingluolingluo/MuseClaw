import { execFile, execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { globalRunnerMesh } from './runner-mesh.ts';

export interface LocalAgentInfo {
  id: 'codex' | 'pi' | 'dsh' | 'ollama' | 'ducc' | 'ducx';
  name: string;
  installed: boolean;
  version?: string;
  executablePath?: string;
  protocol: 'acp-stdio' | 'json-rpc-stdio' | 'openai-http';
  description: string;
  candidateModels: string[];
  defaultModel: string;
  installCommand?: string;
  docUrl?: string;
}

/**
 * 动态提取本地 Codex 用户实际配置的模型列表与默认模型
 */
export function discoverCodexModels(): { models: string[]; defaultModel: string } {
  const home = homedir();
  const configPath = join(home, '.codex', 'config.toml');
  const fallback = {
    models: [
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
    ],
    defaultModel: 'Grok-4.7-baidu-oneapi',
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

  const mixinCat = join(home, '.codex', 'model-catalogs', 'mixin-models.json');
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

  const oneapiCat = join(home, '.baidu-cx', 'model-catalogs', 'oneapi-models.json');
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
    defaultModel: activeModel || finalList[0] || fallback.defaultModel,
  };
}

/**
 * 动态提取本地 Pi Coding Agent 用户实际配置的模型列表与默认模型
 */
export function discoverPiModels(): { models: string[]; defaultModel: string } {
  const home = homedir();
  const modelsPath = join(home, '.pi', 'agent', 'models.json');
  const fallback = {
    models: [
      'anthropic/claude-3-7-sonnet',
      'Opus 5.5-baidu-oneapi',
      'Claude Sonnet 5.5-baidu-oneapi',
      'Claude Haiku 5.5-baidu-oneapi',
      'Opus 5-baidu-oneapi',
      'Claude Sonnet 5-baidu-oneapi',
      'Opus 4.8-baidu-oneapi',
      'DeepSeek-V4.1-Flash-baidu-oneapi',
      'DeepSeek-V4-Flash-baidu-oneapi',
      'DeepSeek-V4-Pro-baidu-oneapi',
      'Kimi-K2.7-Code-baidu-oneapi',
      'openai/gpt-4o',
      'deepseek/deepseek-chat',
      'gpt-5.6-sol',
      'GLM-5.3-Flash'
    ],
    defaultModel: 'anthropic/claude-3-7-sonnet',
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
    defaultModel: finalList[0] || fallback.defaultModel,
  };
}

/**
 * 动态提取本地 ducc (Baidu CC) 用户实际配置的模型列表与默认模型
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
 * 动态提取本地 ducx (Baidu CX) 用户实际配置的模型列表与默认模型
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
 * 扩充 PATH 环境变量以覆盖常见的用户环境 (nvm, brew, .local/bin, 企业 Agent 目录等)
 */
export function getAugmentedPath(): string {
  const home = homedir();
  const extraDirs = [
    join(home, '.multica', 'shims'),
    join(home, '.local', 'bin'),
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

/**
 * 在系统 PATH 中安全查找指定可执行程序
 */
export function findExecutableInPath(command: string, customPath?: string): string | null {
  if (existsSync(command)) return command;
  const pathEnv = customPath || getAugmentedPath();
  const dirs = pathEnv.split(delimiter);

  for (const dir of dirs) {
    if (!dir) continue;
    const fullPath = join(dir, command);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

/**
 * 执行版本探测，附带安全超时与隔离环境变量
 */
export function executeVersionProbe(
  executablePath: string,
  args: string[] = ['--version'],
  timeoutMs = 3500
): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const cleanEnv = {
      ...process.env,
      PATH: getAugmentedPath(),
    };

    // 剔除可能干扰探针的临时敏感凭证
    delete cleanEnv.OPENAI_API_KEY;
    delete cleanEnv.ANTHROPIC_API_KEY;

    execFile(
      executablePath,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
        env: cleanEnv,
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

/**
 * 探测本机所有受支持的本地 Agent 运行时
 */
export async function probeLocalAgents(): Promise<LocalAgentInfo[]> {
  const results: LocalAgentInfo[] = [];

  // 1. OpenAI Codex CLI
  const codexPath = findExecutableInPath('codex');
  let codexVersion: string | undefined;
  if (codexPath) {
    const probe = await executeVersionProbe(codexPath, ['--version']);
    if (probe.ok) codexVersion = probe.version;
  }
  const codexModels = discoverCodexModels();
  results.push({
    id: 'codex',
    name: 'OpenAI Codex (本地 Agent)',
    installed: Boolean(codexPath && codexVersion),
    version: codexVersion,
    executablePath: codexPath || undefined,
    protocol: 'acp-stdio',
    description: '本地 OpenAI Codex 终端编码 Agent，支持 headless stdio 交互',
    candidateModels: codexModels.models,
    defaultModel: codexModels.defaultModel,
    installCommand: 'npm i -g @openai/codex',
    docUrl: 'https://github.com/openai/codex',
  });

  // 2. Pi Coding Agent (@earendil-works/pi-coding-agent)
  const piPath = findExecutableInPath('pi');
  let piVersion: string | undefined;
  if (piPath) {
    const probe = await executeVersionProbe(piPath, ['--version']);
    if (probe.ok) piVersion = probe.version;
  }
  const piModels = discoverPiModels();
  results.push({
    id: 'pi',
    name: 'Pi Coding Agent (本地 Agent)',
    installed: Boolean(piPath && piVersion),
    version: piVersion,
    executablePath: piPath || undefined,
    protocol: 'json-rpc-stdio',
    description: '极简高性能终端 Coding Agent，支持 stdio JSON-RPC 与多模型驱动',
    candidateModels: piModels.models,
    defaultModel: piModels.defaultModel,
    installCommand: 'npm i -g @earendil-works/pi-coding-agent',
    docUrl: 'https://github.com/earendil-works/pi-coding-agent',
  });

  // 3. DeepSeek Harness (`dsh`)
  const dshPath = findExecutableInPath('dsh');
  let dshVersion: string | undefined;
  if (dshPath) {
    const probe = await executeVersionProbe(dshPath, ['--version']);
    if (probe.ok) dshVersion = probe.version;
  }
  results.push({
    id: 'dsh',
    name: 'DeepSeek Harness (本地 dsh)',
    installed: Boolean(dshPath && dshVersion),
    version: dshVersion,
    executablePath: dshPath || undefined,
    protocol: 'acp-stdio',
    description: 'DeepSeek 官方开源本地终端 Harness 编码 Agent，支持 ACP 协议',
    candidateModels: ['deepseek-official/deepseek-chat', 'deepseek-official/deepseek-reasoner'],
    defaultModel: 'deepseek-official/deepseek-chat',
    installCommand: 'curl -fsSL https://deepseek.ai/dsh/install.sh | bash',
    docUrl: 'https://github.com/deepseek-ai/deepseek-harness',
  });

  // 4. Ollama
  const ollamaProbe = await probeOllamaService('http://127.0.0.1:11434');
  const ollamaBin = findExecutableInPath('ollama');
  const ollamaInstalled = ollamaProbe.ok || Boolean(ollamaBin);
  results.push({
    id: 'ollama',
    name: '本地 Ollama (Local)',
    installed: ollamaInstalled,
    version: ollamaProbe.ok ? 'HTTP Service Active' : ollamaBin ? 'Installed (Stopped)' : undefined,
    executablePath: ollamaBin || undefined,
    protocol: 'openai-http',
    description: '本地私有化大模型引擎，完全在本地硬件私有运行，无需联网',
    candidateModels: ollamaProbe.models.length > 0 ? ollamaProbe.models : ['llama3.2', 'qwen2.5-coder', 'deepseek-r1:8b'],
    defaultModel: ollamaProbe.models[0] || 'llama3.2',
    installCommand: 'brew install ollama && ollama serve',
    docUrl: 'https://ollama.com',
  });

  // 5. Baidu CC (`ducc`)
  const duccPath = findExecutableInPath('ducc');
  let duccVersion: string | undefined;
  if (duccPath) {
    const probe = await executeVersionProbe(duccPath, ['--version']);
    if (probe.ok) duccVersion = probe.version;
  }
  const duccModels = discoverDuccModels();
  results.push({
    id: 'ducc',
    name: 'Baidu CC (本地 ducc)',
    installed: Boolean(duccPath && duccVersion),
    version: duccVersion,
    executablePath: duccPath || undefined,
    protocol: 'acp-stdio',
    description: 'Baidu 内部 Claude Code 深度编码 Agent，免 Key 直连内网大模型',
    candidateModels: duccModels.models,
    defaultModel: duccModels.defaultModel,
    installCommand: 'curl -fsSL http://team-mesh.loop.baidu-int.com:8004/api/tmesh/dist/install.sh | bash',
    docUrl: 'http://team-mesh.loop.baidu-int.com:8004'
  });

  // 6. Baidu CX (`ducx`)
  const ducxPath = findExecutableInPath('ducx') || findExecutableInPath('baidu-cx');
  let ducxVersion: string | undefined;
  if (ducxPath) {
    const probe = await executeVersionProbe(ducxPath, ['--version']);
    if (probe.ok) ducxVersion = probe.version;
  }
  const ducxModels = discoverDucxModels();
  results.push({
    id: 'ducx',
    name: 'Baidu CX (本地 ducx)',
    installed: Boolean(ducxPath && ducxVersion),
    version: ducxVersion,
    executablePath: ducxPath || undefined,
    protocol: 'acp-stdio',
    description: 'Baidu 内部 Codex 架构高级编码 Agent，支持多模型与高阶推理',
    candidateModels: ducxModels.models,
    defaultModel: ducxModels.defaultModel,
    installCommand: 'curl -fsSL http://team-mesh.loop.baidu-int.com:8004/api/tmesh/dist/install.sh | bash',
    docUrl: 'http://team-mesh.loop.baidu-int.com:8004'
  });

  // 7. 聚合已连接的远程计算节点报告的 Agent 运行时
  const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents();
  for (const remote of remoteAgents) {
    const existing = results.find((r) => r.id === remote.id);
    if (existing) {
      if (!existing.installed) {
        existing.installed = true;
        existing.version = remote.version || existing.version;
        existing.candidateModels = remote.candidateModels && remote.candidateModels.length > 0
          ? remote.candidateModels
          : existing.candidateModels;
        existing.defaultModel = remote.defaultModel || existing.defaultModel;
      } else {
        existing.version = remote.version || existing.version;
        const merged = Array.from(new Set([...(remote.candidateModels || []), ...(existing.candidateModels || [])]));
        existing.candidateModels = merged.length > 0 ? merged : existing.candidateModels;
        if (!existing.defaultModel) existing.defaultModel = remote.defaultModel;
      }
      existing.description = `${existing.description} [由远程节点 ${remote.name} 提供]`;
    } else {
      results.push(remote);
    }
  }

  return results;
}
