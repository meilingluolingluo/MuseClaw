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
 * 解析用户指定模型代号在候选可用模型列表中的最佳匹配
 */
export function resolveModelAlias(
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

/**
 * 快速测试指定本地 Agent 的健康度与延迟 (支持携带具体模型与指定用户专属节点进行真实探针验证)
 */
export async function testLocalAgent(
  agentId: string,
  model?: string,
  userId?: string
): Promise<{ ok: boolean; latencyMs: number; version?: string; error?: string }> {
  const remoteRunner = globalRunnerMesh.findAvailableRunnerForAgent(agentId, userId);
  const exe = findExecutableInPath(agentId);

  // 1. 如果网关未安装但有远程节点，或明确路由至远程计算节点
  if (remoteRunner && (!exe || userId)) {
    const rt = remoteRunner.runtimes.find((r) => r.id === agentId);
    if (!rt) {
      return { ok: false, latencyMs: 0, error: `远程计算节点 (${remoteRunner.hostname}) 未就绪运行时: ${agentId}` };
    }

    // 若指定了模型，派发轻量级探针任务验证端到端可用性
    if (model) {
      const runResult = await globalRunnerMesh.dispatchTask(agentId, 'Hi', {
        model,
        userId,
        targetMachineId: remoteRunner.id,
        timeoutMs: 15000
      });
      if (runResult.ok) {
        return {
          ok: true,
          latencyMs: runResult.latencyMs,
          version: `${rt.version || '在线就绪'} (节点: ${remoteRunner.hostname})`
        };
      }
      return {
        ok: false,
        latencyMs: runResult.latencyMs,
        error: runResult.error || `远程计算节点 (${remoteRunner.hostname}) 模型验证未通过`
      };
    }

    return {
      ok: true,
      latencyMs: 15,
      version: `${rt.version || '在线就绪'} (节点: ${remoteRunner.hostname})`
    };
  }

  // 2. 本地执行程序检测
  if (!exe) {
    const userHint = userId ? ` (所属用户: ${userId})` : '';
    return { ok: false, latencyMs: 0, error: `未在系统 PATH 或已连接的远程计算节点${userHint}中找到: ${agentId}` };
  }

  if (model) {
    const runResult = await runLocalAgent(agentId, 'Hi', { model, userId, timeoutMs: 15000 });
    if (runResult.ok) {
      return { ok: true, latencyMs: runResult.latencyMs, version: `本地就绪 (${runResult.latencyMs}ms)` };
    }
    return { ok: false, latencyMs: runResult.latencyMs, error: runResult.error || '本地 Agent 模型验证未通过' };
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
      return globalRunnerMesh.dispatchTask(agentId, prompt, { ...options, targetMachineId: remoteRunner.id });
    }
  }

  // 2. 检查当前网关本地是否存在该可执行程序
  const exe = findExecutableInPath(agentId);
  if (!exe) {
    const remoteRunner = globalRunnerMesh.findAvailableRunnerForAgent(agentId);
    if (remoteRunner) {
      return globalRunnerMesh.dispatchTask(agentId, prompt, { ...options, targetMachineId: remoteRunner.id });
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
    const codexInfo = discoverCodexModels();
    const targetModel = resolveModelAlias(options.model, codexInfo.models, codexInfo.defaultModel);
    if (targetModel) {
      args.push('--model', targetModel);
    }
    args.push('-');
  } else if (agentId === 'pi') {
    args = ['-p', '--no-session'];
    const piInfo = discoverPiModels();
    const targetModel = resolveModelAlias(options.model, piInfo.models, piInfo.defaultModel);
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
    args = isRoot
      ? ['-p', '--output-format=stream-json', '--verbose']
      : ['-p', '--output-format=stream-json', '--verbose', '--dangerously-skip-permissions'];
    const duccInfo = discoverDuccModels();
    const targetModel = resolveModelAlias(options.model, duccInfo.models, duccInfo.defaultModel);
    if (targetModel) {
      args.push('--model', targetModel);
    }
  } else if (agentId === 'ducx') {
    args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];
    const ducxInfo = discoverDucxModels();
    const targetModel = resolveModelAlias(options.model, ducxInfo.models, ducxInfo.defaultModel);
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
        } else if (agentId === 'ducc') {
          const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
          const textParts: string[] = [];
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
        if (!onChunk || !chunk) return;
        // 如果是已由远程 Runner 提取的格式化文本或纯文本增量，直接透传至前端
        if (chunk.startsWith('> 💭') || (!chunk.includes('{"type":') && !chunk.startsWith('{'))) {
          onChunk(chunk);
          return;
        }

        if (config.id === 'codex' || config.id === 'ducx') {
          streamBuffer += chunk;
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.type === 'item.completed' && parsed.item) {
                if (parsed.item.type === 'reasoning' && parsed.item.text) {
                  const reasoning = parsed.item.text.trim();
                  if (reasoning) {
                    onChunk(`> 💭 **思考推理**：\n> ${reasoning.replace(/\n/g, '\n> ')}\n\n`);
                  }
                } else if (parsed.item.type === 'agent_message' && parsed.item.text) {
                  const clean = parsed.item.text.replace(/\n\nSkipped:[\s\S]*$/, '').trim();
                  if (clean) onChunk(clean);
                }
              }
            } catch {
              if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
                onChunk(trimmed + '\n');
              }
            }
          }
        } else if (config.id === 'ducc') {
          streamBuffer += chunk;
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
                    const th = c.thinking.trim();
                    if (th) onChunk(`> 💭 **思考推理**：\n> ${th.replace(/\n/g, '\n> ')}\n\n`);
                  } else if (c.type === 'text' && c.text) {
                    onChunk(c.text);
                  }
                }
              }
            } catch {
              if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
                onChunk(trimmed + '\n');
              }
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
