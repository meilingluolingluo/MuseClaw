import { spawn } from 'node:child_process';
import {
  getAugmentedPath,
  findExecutableInPath,
  discoverCodexModels,
  discoverPiModels,
  discoverDuccModels,
  discoverDucxModels
} from './local-agent-prober.ts';
import { globalRunnerMesh } from './runner-mesh.ts';
import type { LLMCaller, LLMMessage, ToolDefinition } from './loop.ts';
import type { ModelProviderConfig } from './llm.ts';
import { resolveApiKey } from './llm.ts';

export interface LocalAgentRunOptions {
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  apiKey?: string;
  userId?: string;
  targetMachineId?: string;
  onChunk?: (text: string) => void;
}

export interface LocalAgentRunResult {
  ok: boolean;
  text: string;
  latencyMs: number;
  error?: string;
}

/**
 * 快速测试指定本地 Agent 的健康度与延迟
 */
export async function testLocalAgent(agentId: string): Promise<{ ok: boolean; latencyMs: number; version?: string; error?: string }> {
  const exe = findExecutableInPath(agentId);
  if (!exe) {
    const remoteRunner = globalRunnerMesh.findAvailableRunnerForAgent(agentId);
    if (remoteRunner) {
      const rt = remoteRunner.runtimes.find((r) => r.id === agentId);
      return {
        ok: true,
        latencyMs: 15,
        version: `${rt?.version || '在线就绪'} (节点: ${remoteRunner.hostname})`
      };
    }
    return { ok: false, latencyMs: 0, error: `未在系统 PATH 或已连接的远程计算节点中找到: ${agentId}` };
  }

  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(exe, ['--version'], {
      env: { ...process.env, PATH: getAugmentedPath() },
      timeout: 4000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      const latencyMs = Date.now() - start;
      if (code === 0) {
        resolve({ ok: true, latencyMs, version: stdout.trim().split('\n')[0] });
      } else {
        resolve({ ok: false, latencyMs, error: stderr.trim() || `进程异常退出 (code ${code})` });
      }
    });

    child.on('error', (err) => {
      resolve({ ok: false, latencyMs: Date.now() - start, error: err.message });
    });
  });
}

/**
 * 执行本地 Agent 单轮调用
 */
export async function runLocalAgent(
  agentId: string,
  prompt: string,
  options: LocalAgentRunOptions = {}
): Promise<LocalAgentRunResult> {
  // 1. 如果指定了用户专属节点且该节点在线，优先派发至用户个人节点执行
  if (options.userId) {
    const remoteRunner = globalRunnerMesh.findAvailableRunnerForAgent(agentId, options.userId);
    if (remoteRunner) {
      return globalRunnerMesh.dispatchTask(agentId, prompt, options);
    }
  }

  // 2. 检查当前网关本地是否存在该可执行程序
  const exe = findExecutableInPath(agentId);
  if (!exe) {
    const remoteRunner = globalRunnerMesh.findAvailableRunnerForAgent(agentId);
    if (remoteRunner) {
      return globalRunnerMesh.dispatchTask(agentId, prompt, options);
    }
    const userHint = options.userId ? ` (所属用户: ${options.userId})` : '';
    return { ok: false, text: '', latencyMs: 0, error: `未在服务器或已连接的远程计算节点${userHint}中找到 ${agentId}。请在个人电脑上运行伴侣命令连接此网关。` };
  }

  const start = Date.now();
  const timeoutMs = options.timeoutMs || 90000;

  let args: string[] = [];
  let feedViaStdin = true;

  if (agentId === 'codex') {
    args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];
    let targetModel = options.model;
    if (!targetModel || targetModel === 'gpt-4o') {
      const codexInfo = discoverCodexModels();
      targetModel = codexInfo.defaultModel;
    }
    if (targetModel && targetModel !== 'gpt-4o') {
      args.push('--model', targetModel);
    }
    args.push('-');
  } else if (agentId === 'pi') {
    args = ['-p', '--no-session'];
    let targetModel = options.model;
    if (!targetModel || targetModel === 'anthropic/claude-3-7-sonnet') {
      const piInfo = discoverPiModels();
      targetModel = piInfo.defaultModel;
    }
    if (targetModel) {
      args.push('--model', targetModel);
    }
  } else if (agentId === 'ducc') {
    const isRoot = (typeof process.getuid === 'function' && process.getuid() === 0) ||
                   process.env.USER === 'root' ||
                   process.env.LOGNAME === 'root' ||
                   Boolean(process.env.SUDO_USER) ||
                   Boolean(process.env.SUDO_UID) ||
                   process.env.UID === '0';
    args = isRoot ? ['-p'] : ['-p', '--dangerously-skip-permissions'];
    let targetModel = options.model;
    if (!targetModel) {
      const duccInfo = discoverDuccModels();
      targetModel = duccInfo.defaultModel;
    }
    if (targetModel) {
      args.push('--model', targetModel);
    }
  } else if (agentId === 'ducx') {
    args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];
    let targetModel = options.model;
    if (!targetModel) {
      const ducxInfo = discoverDucxModels();
      targetModel = ducxInfo.defaultModel;
    }
    if (targetModel) {
      args.push('--model', targetModel);
    }
    args.push('-');
  } else if (agentId === 'dsh') {
    args = ['headless', prompt];
    feedViaStdin = false;
  } else {
    args = [prompt];
    feedViaStdin = false;
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: getAugmentedPath(),
    IS_SANDBOX: '1',
    CLAUDE_ALLOW_ROOT: '1',
    ...(options.apiKey ? { DEEPSEEK_API_KEY: options.apiKey } : {})
  };

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(exe, args, {
      cwd: options.cwd || process.cwd(),
      env,
      timeout: timeoutMs,
    });

    if (feedViaStdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.onChunk) {
        options.onChunk(text);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      const latencyMs = Date.now() - start;
      if (code === 0 && stdout.trim()) {
        let extractedText = stdout.trim();

        if (agentId === 'codex' || agentId === 'ducx') {
          const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
          const messages: string[] = [];
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message' && parsed.item.text) {
                messages.push(parsed.item.text);
              }
            } catch {
              // 忽略非 JSON 行
            }
          }
          if (messages.length > 0) {
            extractedText = messages.join('\n\n').replace(/\n\nSkipped:[\s\S]*$/, '').trim();
          } else {
            const codexIdx = stdout.indexOf('codex\n');
            if (codexIdx !== -1) {
              const after = stdout.slice(codexIdx + 6);
              const tokensIdx = after.indexOf('tokens used');
              extractedText = (tokensIdx !== -1 ? after.slice(0, tokensIdx) : after).trim();
            }
          }
        }

        resolve({ ok: true, text: extractedText, latencyMs });
      } else {
        const error = stderr.trim() || stdout.trim() || `Agent 执行退出，退出码: ${code}`;
        resolve({ ok: false, text: stdout.trim(), latencyMs, error });
      }
    });

    child.on('error', (err) => {
      resolve({ ok: false, text: '', latencyMs: Date.now() - start, error: err.message });
    });
  });
}

/**
 * 将 LLMMessage 数组格式化为本地 Agent 可识别的提示词
 */
export function formatLLMMessagesToPrompt(messages: LLMMessage[]): string {
  if (!Array.isArray(messages)) {
    return String(messages || '');
  }
  if (messages.length === 1 && messages[0].content) {
    return messages[0].content;
  }
  return messages
    .filter((m) => Boolean(m.content))
    .map((m) => {
      if (m.role === 'system') return `[System Instruction]\n${m.content}`;
      if (m.role === 'user') return `[User]\n${m.content}`;
      if (m.role === 'assistant') return `[Assistant]\n${m.content}`;
      return `[Tool Result ${m.tool_call_id || ''}]\n${m.content}`;
    })
    .join('\n\n');
}

/**
 * 创建对接本地 Agent 的 LLMCaller 实例 (支持按用户路由隔离)
 */
export function createLocalAgentCaller(
  config: ModelProviderConfig,
  callerOptions: { userId?: string } = {}
): LLMCaller {
  return async (messages: LLMMessage[], _tools: ToolDefinition[], onChunk?: (delta: string) => void) => {
    const prompt = formatLLMMessagesToPrompt(messages);
    const apiKey = resolveApiKey(config.apiKey, config.id) || resolveApiKey(undefined, 'deepseek');

    let streamBuffer = '';
    const res = await runLocalAgent(config.id, prompt, {
      model: config.model,
      apiKey,
      userId: callerOptions.userId,
      onChunk: (chunk) => {
        if (!onChunk) return;
        if (config.id === 'codex' || config.id === 'ducx') {
          streamBuffer += chunk;
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop() || '';
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line.trim());
              if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message' && parsed.item.text) {
                const clean = parsed.item.text.replace(/\n\nSkipped:[\s\S]*$/, '').trim();
                if (clean) onChunk(clean);
              }
            } catch {
              // 容错处理非 JSON 行
            }
          }
        } else {
          onChunk(chunk);
        }
      }
    });

    if (!res.ok) {
      throw new Error(`[${config.name || config.id}] 执行失败: ${res.error || '未知错误'}`);
    }

    return {
      content: res.text,
      toolCalls: []
    };
  };
}
