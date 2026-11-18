#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os, { homedir, hostname } from 'node:os';
import path, { delimiter, join } from 'node:path';
import http from 'node:http';
import https from 'node:https';

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
      'Opus 5.5',
      'Claude Sonnet 5.5',
      'ERNIE-5.5-Flash-Preview-内部',
      'DeepSeek-V4.1-Flash-内部',
      'gpt-6.1-sol',
      'gpt-5.6-sol'
    ];
    const models = Array.from(new Set([
      ...(activeModel ? [activeModel] : []),
      ...detectedModels,
      ...fallbackModels
    ]));
    runtimes.push({
      id: 'ducc',
      name: 'Baidu CC (本地 ducc)',
      executablePath: duccPath,
      models,
      defaultModel: activeModel || models[0]
    });
  }

  // 2. ducx (Baidu CX)
  const ducxPath = findExecutable('ducx');
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
    const fallbackModels = [
      'gpt-5.6-sol',
      'DeepSeek-V4.1-Flash',
      'ERNIE-5.5-Flash-Preview-内部',
      'GLM-5.3-Flash',
      'gpt-6.1-sol',
      'DeepSeek-V4-Pro'
    ];
    const models = Array.from(new Set([
      ...(activeModel ? [activeModel] : []),
      ...detectedModels,
      ...fallbackModels
    ]));
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
    runtimes.push({
      id: 'codex',
      name: 'OpenAI Codex (本地 Agent)',
      executablePath: codexPath,
      models: ['gpt-4o', 'o3-mini', 'o1'],
      defaultModel: 'gpt-4o'
    });
  }

  // 4. pi
  const piPath = findExecutable('pi');
  if (piPath) {
    runtimes.push({
      id: 'pi',
      name: 'Pi Coding Agent (本地 Agent)',
      executablePath: piPath,
      models: ['anthropic/claude-3-7-sonnet', 'openai/gpt-4o'],
      defaultModel: 'anthropic/claude-3-7-sonnet'
    });
  }

  return runtimes;
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

    let args = [];
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
      if (task.model) args.push('--model', task.model);
    } else if (task.agentId === 'ducx' || task.agentId === 'codex') {
      args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];
      if (task.model) args.push('--model', task.model);
      args.push('-');
    } else if (task.agentId === 'pi') {
      args = ['-p', '--no-session'];
      if (task.model) args.push('--model', task.model);
    } else {
      args = [task.prompt];
    }

    const env = Object.assign({}, process.env, {
      PATH: getAugmentedPath(),
      IS_SANDBOX: '1',
      CLAUDE_ALLOW_ROOT: '1'
    });
    const child = spawn(exe, args, { env, timeout: task.timeoutMs || 90000 });

    let stdout = '';
    let stderr = '';
    let streamBuffer = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;

      if (task.agentId === 'ducx' || task.agentId === 'codex') {
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
                    chunk: `> 💭 **思考推理**：\n> ${reasoning.replace(/\n/g, '\n> ')}\n\n`
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
                    chunk: `> 💭 **思考推理**：\n> ${c.thinking.trim().replace(/\n/g, '\n> ')}\n\n`
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

    if (task.agentId === 'ducc' || task.agentId === 'ducx' || task.agentId === 'codex') {
      child.stdin.write(task.prompt);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on('close', async (code) => {
      const latencyMs = Date.now() - start;
      let extractedText = stdout.trim();

      if (task.agentId === 'ducx' || task.agentId === 'codex') {
        const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
        const msgs = [];
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
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

      const ok = code === 0 && Boolean(extractedText);
      console.log(`📤 任务完成 [${task.taskId}]: ${ok ? '成功' : '失败'} (${latencyMs}ms)`);

      await this.request(`/api/runner/tasks/${task.taskId}/complete`, 'POST', {
        ok,
        text: extractedText,
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
