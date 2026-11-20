#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os, { homedir, hostname } from 'node:os';
import path, { delimiter, join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import readline from 'node:readline';

function getAugmentedPath() {
  const home = homedir();
  const extraDirs = [
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

function findExecutable(command) {
  if (existsSync(command)) return command;
  const pathEnv = getAugmentedPath();
  const dirs = pathEnv.split(delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const fullPath = join(dir, command);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

function queryCliModels(binPath, cmdArgs = ['models']) {
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

function resolveModelAlias(requestedModel, availableModels, defaultModel) {
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

function detectLocalRuntimes() {
  const home = homedir();
  const runtimes = [];

  // 1. ducc (Baidu CC)
  const duccPath = findExecutable('ducc');
  if (duccPath) {
    let activeModel = 'GLM-5.3-Flash-内部';
    const userJson = join(home, '.baidu-cc', 'user.json');
    if (existsSync(userJson)) {
      try {
        const raw = JSON.parse(readFileSync(userJson, 'utf8'));
        if (raw.env && raw.env.ANTHROPIC_MODEL) activeModel = raw.env.ANTHROPIC_MODEL;
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
    const dynamicModels = [];
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
    const dynamicModels = [];
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
    const dynamicModels = [];
    const modelsJson = join(home, '.pi', 'agent', 'models.json');
    if (existsSync(modelsJson)) {
      try {
        const raw = JSON.parse(readFileSync(modelsJson, 'utf8'));
        if (raw.providers && typeof raw.providers === 'object') {
          for (const provider of Object.values(raw.providers)) {
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

class StreamQueue {
  constructor(client, taskId) {
    this.client = client;
    this.taskId = taskId;
    this.queue = [];
    this.isFlushing = false;
  }

  push(chunk) {
    if (!chunk) return;
    this.queue.push(chunk);
    this.flush();
  }

  async flush() {
    if (this.isFlushing) return;
    this.isFlushing = true;
    while (this.queue.length > 0) {
      const chunk = this.queue.shift();
      try {
        await this.client.request(`/api/runner/tasks/${this.taskId}/stream`, 'POST', { chunk });
      } catch (err) {
        // 网络短暂抖动时保持容错，不阻断主流程
      }
    }
    this.isFlushing = false;
  }

  async drain() {
    while (this.queue.length > 0 || this.isFlushing) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

class MuseClawRunnerClient {
  constructor(options) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.token = options.token || process.env.MUSECLAW_TOKEN || 'default-mesh-token';
    this.machineName = options.name || hostname();
    this.machineId = `node_${Buffer.from(this.machineName).toString('hex').slice(0, 10)}`;
    this.runtimes = [];
    this.isRunning = true;
  }

  request(pathname, method = 'POST', body) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(`${this.serverUrl}${pathname}`);
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

  async start() {
    console.log('\n===========================================================');
    console.log('🐾 MuseClaw Remote Mesh Runner 伴侣守护进程已启动');
    console.log('-----------------------------------------------------------');
    console.log(`🖥️  本地主机:   ${this.machineName} (${os.platform()}-${os.arch()})`);
    console.log(`🌐 连接网关:   ${this.serverUrl}`);

    this.runtimes = detectLocalRuntimes();
    console.log(`⚡ 发现运行时: ${this.runtimes.map((r) => `${r.id} (${r.defaultModel})`).join(', ') || '未检测到可用 Agent'}`);

    try {
      const reg = await this.request('/api/runner/register', 'POST', {
        machineId: this.machineId,
        hostname: this.machineName,
        platform: os.platform(),
        arch: os.arch(),
        token: this.token,
        runtimes: this.runtimes
      });
      console.log(`🟢 节点在线就绪 (注册 ID: ${(reg && reg.machineId) || this.machineId})`);
    } catch (err) {
      console.error(`⚠️ 首次注册失败 (${err.message})，进入重试循环...`);
    }

    console.log('📡 正在监听云端任务调度 (Long-Polling Active)...');
    console.log('===========================================================\n');

    this.pollLoop();
  }

  async pollLoop() {
    while (this.isRunning) {
      try {
        const res = await this.request('/api/runner/poll', 'POST', {
          machineId: this.machineId,
          token: this.token
        });

        if (res && res.taskId) {
          console.log(`\n📥 收到云端任务: [${res.taskId}] 调度目标: ${res.agentId} (模型: ${res.model || '默认'})`);
          this.executeTask(res).catch((err) => {
            console.error(`❌ 任务执行异常:`, err);
          });
        }
      } catch (err) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async executeTask(task) {
    const start = Date.now();
    const runtime = this.runtimes.find((r) => r.id === task.agentId);
    const exe = (runtime && runtime.executablePath) || findExecutable(task.agentId);

    if (!exe) {
      await this.request(`/api/runner/tasks/${task.taskId}/complete`, 'POST', {
        ok: false,
        text: '',
        error: `本地未找到运行时 ${task.agentId}，路径不可达`
      });
      return;
    }

    let targetModel = task.model;
    if (runtime && runtime.models && runtime.models.length > 0) {
      targetModel = resolveModelAlias(task.model, runtime.models, runtime.defaultModel);
      if (task.model && targetModel && task.model !== targetModel) {
        console.log(`🔄 [${task.agentId}] 模型别名自动对齐: "${task.model}" -> "${targetModel}"`);
      }
    }

    const streamQueue = new StreamQueue(this, task.taskId);

    let args = [];
    let feedViaStdin = true;

    if (task.agentId === 'ducc') {
      const isRoot = (typeof process.getuid === 'function' && process.getuid() === 0) ||
                     process.env.USER === 'root' ||
                     process.env.LOGNAME === 'root' ||
                     Boolean(process.env.SUDO_USER) ||
                     Boolean(process.env.SUDO_UID) ||
                     process.env.UID === '0';
      args = isRoot
        ? ['-p', '--output-format=stream-json', '--verbose']
        : ['-p', '--output-format=stream-json', '--verbose', '--dangerously-skip-permissions'];
      if (targetModel) args.push('--model', targetModel);
    } else if (task.agentId === 'ducx' || task.agentId === 'codex') {
      args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox'];
      if (targetModel) args.push('--model', targetModel);
      args.push('-');
    } else if (task.agentId === 'pi') {
      args = ['-p', '--no-session'];
      if (targetModel) args.push('--model', targetModel);
    } else if (task.agentId === 'dsh') {
      args = ['headless', task.prompt];
      feedViaStdin = false;
    } else {
      args = [task.prompt];
      feedViaStdin = false;
    }

    const env = Object.assign({}, process.env, {
      PATH: getAugmentedPath(),
      IS_SANDBOX: '1',
      CLAUDE_ALLOW_ROOT: '1'
    });
    const child = spawn(exe, args, { env, timeout: task.timeoutMs || 90000 });

    let stdout = '';
    let stderr = '';

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      stdout += line + '\n';
      const trimmed = line.trim();
      if (!trimmed) return;

      if (task.agentId === 'ducx' || task.agentId === 'codex') {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'item.completed' && parsed.item) {
            if (parsed.item.type === 'reasoning' && parsed.item.text) {
              const reasoning = parsed.item.text.trim();
              if (reasoning) {
                streamQueue.push(`> 💭 **思考推理**：\n> ${reasoning.replace(/\n/g, '\n> ')}\n\n`);
              }
            } else if (parsed.item.type === 'agent_message' && parsed.item.text) {
              const clean = parsed.item.text.replace(/\n\nSkipped:[\s\S]*$/, '').trim();
              if (clean) {
                streamQueue.push(clean);
              }
            }
          }
        } catch {
          if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            streamQueue.push(trimmed + '\n');
          }
        }
      } else if (task.agentId === 'ducc') {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
            for (const c of parsed.message.content) {
              if (c.type === 'thinking' && c.thinking) {
                const th = c.thinking.trim();
                if (th) streamQueue.push(`> 💭 **思考推理**：\n> ${th.replace(/\n/g, '\n> ')}\n\n`);
              } else if (c.type === 'text' && c.text) {
                streamQueue.push(c.text);
              }
            }
          }
        } catch {
          if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            streamQueue.push(trimmed + '\n');
          }
        }
      } else {
        streamQueue.push(trimmed + '\n');
      }
    });

    child.stderr.on('data', (d) => { stderr += d.toString(); });

    if (feedViaStdin) {
      child.stdin.write(task.prompt);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on('close', async (code) => {
      await streamQueue.drain();
      const latencyMs = Date.now() - start;
      let extractedText = stdout.trim();

      if (task.agentId === 'ducx' || task.agentId === 'codex') {
        const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
        const msgs = [];
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed.type === 'item.completed' && parsed.item && parsed.item.type === 'agent_message' && parsed.item.text) {
              msgs.push(parsed.item.text);
            }
          } catch {}
        }
        if (msgs.length > 0) {
          extractedText = msgs.join('\n\n').replace(/\n\nSkipped:[\s\S]*$/, '').trim();
        }
      } else if (task.agentId === 'ducc') {
        const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
        const textParts = [];
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed.type === 'result' && typeof parsed.result === 'string') {
              extractedText = parsed.result.trim();
              break;
            }
            if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
              for (const c of parsed.message.content) {
                if (c.type === 'text' && c.text) textParts.push(c.text);
              }
            }
          } catch {}
        }
        if (!extractedText && textParts.length > 0) {
          extractedText = textParts.join('\n').trim();
        }
      }

      if (!extractedText && code === 0) {
        extractedText = stdout.trim() || '（Agent 执行完成，无文本输出）';
      }

      const ok = code === 0 && Boolean(extractedText);
      console.log(`📤 任务完成 [${task.taskId}]: ${ok ? '成功' : '失败'} (${latencyMs}ms)`);

      try {
        await this.request(`/api/runner/tasks/${task.taskId}/complete`, 'POST', {
          ok,
          text: extractedText,
          latencyMs,
          error: ok ? undefined : (stderr.trim() || stdout.trim() || `进程异常退出 (code ${code})`)
        });
      } catch (err) {
        console.error(`❌ 汇报任务完成失败 [${task.taskId}]:`, err.message);
      }
    });

    child.on('error', async (err) => {
      await streamQueue.drain();
      try {
        await this.request(`/api/runner/tasks/${task.taskId}/complete`, 'POST', {
          ok: false,
          text: '',
          latencyMs: Date.now() - start,
          error: err.message
        });
      } catch {}
    });
  }

  stop() {
    this.isRunning = false;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let serverUrl = process.env.MUSECLAW_SERVER_URL || 'http://localhost:8799';
  let token = process.env.MUSECLAW_TOKEN;
  let name = hostname();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) serverUrl = args[++i];
    if (args[i] === '--token' && args[i + 1]) token = args[++i];
    if (args[i] === '--name' && args[i + 1]) name = args[++i];
  }

  return { serverUrl, token, name };
}

const config = parseArgs();
const client = new MuseClawRunnerClient(config);
client.start().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n👋 正在断开与 MuseClaw 网关的连接...');
  client.stop();
  process.exit(0);
});
