import { spawn } from 'node:child_process';
import {
  getAugmentedPath,
  findExecutableInPath,
  expandHomePath,
  resolveExecutableLaunchTarget,
  probeClaudeAuth,
  discoverClaudeModels,
  discoverCodexModels,
  discoverPiModels,
  discoverDuccModels,
  discoverDucxModels,
  executeVersionProbe,
  type LocalAgentAuthInfo
} from './local-agent-prober.ts';
import { globalRunnerMesh } from './runner-mesh.ts';
import type { LLMCaller, LLMMessage, ToolDefinition } from './loop.ts';
import type { ModelProviderConfig } from './llm.ts';
import { resolveApiKey } from './llm.ts';
import { splitReasoningAndContent } from './reasoning.ts';

export interface LocalAgentRunOptions {
  model?: string;
  cwd?: string;
  binaryPath?: string;
  configDir?: string;
  extraArgs?: string;
  env?: Record<string, string>;
  baseUrl?: string;
  apiKey?: string;
  maxTurns?: number;
  disableHooks?: boolean;
  disableMcp?: boolean;
  timeoutMs?: number;
  userId?: string;
  targetMachineId?: string;
  onChunk?: (delta: string, reasoningDelta?: string) => void;
}

export interface LocalAgentRunResult {
  ok: boolean;
  text: string;
  reasoning?: string;
  latencyMs: number;
  error?: string;
}

export interface LocalAgentTestResult {
  ok: boolean;
  latencyMs: number;
  version?: string;
  auth?: LocalAgentAuthInfo;
  replyPreview?: string;
  diagnosticCode?: 'ready' | 'not_found' | 'unauthenticated' | 'execution_failed';
  error?: string;
}

export type ClaudeStreamEvent =
  | { kind: 'init'; model?: string; version?: string; sessionId?: string; apiKeySource?: string }
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking_delta'; thinking: string }
  | { kind: 'assistant'; textParts: string[]; thinkingParts: string[]; isApiError?: boolean; errorCode?: string }
  | { kind: 'result'; text?: string; isError: boolean; errorMessage?: string; durationMs?: number; sessionId?: string };

/**
 * 解析附加 CLI 参数字符串（支持单引号与双引号包裹的带空格参数）
 */
export function parseCliExtraArgs(raw?: string): string[] {
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

/**
 * 解析 Claude Code `--output-format stream-json` 输出的单行 NDJSON 事件
 */
export function parseClaudeStreamLine(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (parsed.type === 'system' && parsed.subtype === 'init') {
    return {
      kind: 'init',
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      version: typeof parsed.claude_code_version === 'string' ? parsed.claude_code_version : undefined,
      sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : undefined,
      apiKeySource: typeof parsed.apiKeySource === 'string' ? parsed.apiKeySource : undefined
    };
  }

  if (parsed.type === 'stream_event' && parsed.event && typeof parsed.event === 'object') {
    const ev = parsed.event;
    if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta === 'object') {
      if (ev.delta.type === 'text_delta' && typeof ev.delta.text === 'string' && ev.delta.text.length > 0) {
        return { kind: 'text_delta', text: ev.delta.text };
      }
      if (ev.delta.type === 'thinking_delta' && typeof ev.delta.thinking === 'string' && ev.delta.thinking.length > 0) {
        return { kind: 'thinking_delta', thinking: ev.delta.thinking };
      }
    }
    return null;
  }

  if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    for (const part of parsed.message.content) {
      if (part && part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim()) {
        thinkingParts.push(part.thinking.trim());
      } else if (part && part.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
        textParts.push(part.text);
      }
    }
    return {
      kind: 'assistant',
      textParts,
      thinkingParts,
      isApiError: Boolean(parsed.is_api_error_message),
      errorCode: typeof parsed.error === 'string' ? parsed.error : undefined
    };
  }

  if (parsed.type === 'result') {
    const isError = Boolean(parsed.is_error);
    const resultText = typeof parsed.result === 'string' ? parsed.result : undefined;
    return {
      kind: 'result',
      text: resultText,
      isError,
      errorMessage: isError ? resultText || 'Claude Code 执行返回错误' : undefined,
      durationMs: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : undefined,
      sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : undefined
    };
  }

  return null;
}

function formatClaudeFriendlyError(rawError: string, errorCode?: string): string {
  const lower = rawError.toLowerCase();
  if (
    errorCode === 'authentication_failed' ||
    lower.includes('not logged in') ||
    lower.includes('please run /login') ||
    lower.includes('authentication_failed')
  ) {
    return 'Claude Code 尚未登录认证。请在终端运行 `claude auth login` 完成登录，或在配置面板中填写自定义 API Base URL 与 Key。';
  }
  return rawError;
}

function isRunningAsRoot(): boolean {
  return (
    (typeof process.getuid === 'function' && process.getuid() === 0) ||
    process.env.USER === 'root' ||
    process.env.LOGNAME === 'root' ||
    Boolean(process.env.SUDO_USER) ||
    Boolean(process.env.SUDO_UID) ||
    process.env.UID === '0'
  );
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

  if (availableModels.includes(clean)) {
    return clean;
  }

  const lower = clean.toLowerCase();
  const exactCase = availableModels.find((m) => m.toLowerCase() === lower);
  if (exactCase) {
    return exactCase;
  }

  const keywords = ['deepseek', 'sonnet', 'opus', 'haiku', 'claude', 'gpt-6', 'gpt-5', 'gpt-4', 'glm', 'kimi', 'ernie', 'grok', 'minimax', 'qwen'];
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      const matched = availableModels.find((m) => m.toLowerCase().includes(kw));
      if (matched) {
        return matched;
      }
    }
  }

  const partial = availableModels.find((m) => m.toLowerCase().includes(lower) || lower.includes(m.toLowerCase()));
  if (partial) {
    return partial;
  }

  return defaultModel || availableModels[0];
}

/**
 * 快速测试指定本地 Agent 的健康度、认证状态与延迟
 */
export async function testLocalAgent(
  agentId: string,
  model?: string,
  userId?: string,
  options: LocalAgentRunOptions = {}
): Promise<LocalAgentTestResult> {
  const remoteRunner = globalRunnerMesh.findAvailableRunnerForAgent(agentId, userId);
  const exe = options.binaryPath
    ? findExecutableInPath(options.binaryPath)
    : findExecutableInPath(agentId);

  // 1. 远程节点路由
  if (remoteRunner && (!exe || userId)) {
    const rt = remoteRunner.runtimes.find((r) => r.id === agentId);
    if (!rt) {
      return {
        ok: false,
        latencyMs: 0,
        diagnosticCode: 'not_found',
        error: `远程计算节点 (${remoteRunner.hostname}) 未就绪运行时: ${agentId}`
      };
    }

    if (rt.auth?.status === 'unauthenticated' && !options.baseUrl && !options.apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        version: rt.version,
        auth: rt.auth,
        diagnosticCode: 'unauthenticated',
        error: rt.statusMessage || `远程计算节点 (${remoteRunner.hostname}) 的 ${agentId} 尚未登录认证`
      };
    }

    if (model || agentId === 'claude') {
      const runResult = await globalRunnerMesh.dispatchTask(agentId, 'Reply with just: OK', {
        model,
        userId,
        targetMachineId: remoteRunner.id,
        binaryPath: options.binaryPath,
        configDir: options.configDir,
        cwd: options.cwd,
        extraArgs: options.extraArgs,
        env: options.env,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        maxTurns: agentId === 'claude' ? 1 : undefined,
        timeoutMs: 25000
      });
      if (runResult.ok) {
        return {
          ok: true,
          latencyMs: runResult.latencyMs,
          version: `${rt.version || '在线就绪'} (节点: ${remoteRunner.hostname})`,
          auth: rt.auth,
          replyPreview: runResult.text.trim().slice(0, 100),
          diagnosticCode: 'ready'
        };
      }
      return {
        ok: false,
        latencyMs: runResult.latencyMs,
        version: rt.version,
        auth: rt.auth,
        diagnosticCode: 'execution_failed',
        error: runResult.error || `远程计算节点 (${remoteRunner.hostname}) 模型验证未通过`
      };
    }

    return {
      ok: true,
      latencyMs: 15,
      version: `${rt.version || '在线就绪'} (节点: ${remoteRunner.hostname})`,
      auth: rt.auth,
      diagnosticCode: 'ready'
    };
  }

  // 2. 本地执行程序检测
  if (!exe) {
    const userHint = userId ? ` (所属用户: ${userId})` : '';
    const pathHint = options.binaryPath ? `自定义路径 "${options.binaryPath}"` : `系统 PATH 或远程节点${userHint}`;
    return {
      ok: false,
      latencyMs: 0,
      diagnosticCode: 'not_found',
      error: `未在${pathHint}中找到: ${agentId}`
    };
  }

  // 3. Claude Code 专属双段式探测（先检查版本与认证态，就绪后再发轻量级真实对话探针）
  if (agentId === 'claude') {
    const start = Date.now();
    const versionProbe = await executeVersionProbe(exe, ['--version']);
    if (!versionProbe.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        diagnosticCode: 'execution_failed',
        error: versionProbe.error || 'Claude Code --version 执行失败'
      };
    }

    const discovery = discoverClaudeModels(options.configDir, exe);
    const authProbe = await probeClaudeAuth(
      exe,
      {
        binaryPath: options.binaryPath,
        configDir: options.configDir,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        env: options.env
      },
      discovery.settingsEnv
    );

    if (authProbe.status === 'unauthenticated') {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        version: versionProbe.version,
        auth: authProbe.auth,
        diagnosticCode: 'unauthenticated',
        error: authProbe.statusMessage || 'Claude Code 尚未完成认证，请先登录或配置自定义网关。'
      };
    }

    const runResult = await runLocalAgent('claude', 'Reply with just: OK', {
      ...options,
      model,
      maxTurns: 1,
      disableHooks: true,
      disableMcp: true,
      timeoutMs: 25000
    });

    if (runResult.ok) {
      return {
        ok: true,
        latencyMs: runResult.latencyMs,
        version: versionProbe.version,
        auth: authProbe.auth,
        replyPreview: runResult.text.trim().slice(0, 100),
        diagnosticCode: 'ready'
      };
    }

    const isUnauth = runResult.error?.includes('尚未登录认证') || runResult.error?.includes('Not logged in');
    return {
      ok: false,
      latencyMs: runResult.latencyMs,
      version: versionProbe.version,
      auth: authProbe.auth,
      diagnosticCode: isUnauth ? 'unauthenticated' : 'execution_failed',
      error: runResult.error || 'Claude Code 探针调用失败'
    };
  }

  // 4. 其他本地 Agent 验证
  if (model) {
    const runResult = await runLocalAgent(agentId, 'Hi', { ...options, model, userId, timeoutMs: 15000 });
    if (runResult.ok) {
      return {
        ok: true,
        latencyMs: runResult.latencyMs,
        version: `本地就绪 (${runResult.latencyMs}ms)`,
        replyPreview: runResult.text.trim().slice(0, 100),
        diagnosticCode: 'ready'
      };
    }
    return {
      ok: false,
      latencyMs: runResult.latencyMs,
      diagnosticCode: 'execution_failed',
      error: runResult.error || '本地 Agent 模型验证未通过'
    };
  }

  const start = Date.now();
  const ver = await executeVersionProbe(exe, ['--version']);
  const latencyMs = Date.now() - start;
  if (ver.ok) {
    return { ok: true, latencyMs, version: ver.version, diagnosticCode: 'ready' };
  }
  return {
    ok: false,
    latencyMs,
    diagnosticCode: 'execution_failed',
    error: ver.error || '进程探针异常退出'
  };
}

/**
 * 执行本地 Agent 单轮调用
 */
export async function runLocalAgent(
  agentId: string,
  prompt: string,
  options: LocalAgentRunOptions = {}
): Promise<LocalAgentRunResult> {
  // 1. 若用户有在线远程节点且未强指定本机自定义二进制路径，优先路由到用户的计算节点
  if (options.userId && !options.binaryPath) {
    const remoteRunner = globalRunnerMesh.findAvailableRunnerForAgent(agentId, options.userId);
    if (remoteRunner) {
      return globalRunnerMesh.dispatchTask(agentId, prompt, {
        ...options,
        targetMachineId: remoteRunner.id
      });
    }
  }

  // 2. 查找当前主机可执行文件
  const exe = options.binaryPath
    ? findExecutableInPath(options.binaryPath)
    : findExecutableInPath(agentId);
  if (!exe) {
    if (!options.binaryPath) {
      const remoteRunner = globalRunnerMesh.findAvailableRunnerForAgent(agentId);
      if (remoteRunner) {
        return globalRunnerMesh.dispatchTask(agentId, prompt, {
          ...options,
          targetMachineId: remoteRunner.id
        });
      }
    }
    const userHint = options.userId ? ` (所属用户: ${options.userId})` : '';
    return {
      ok: false,
      text: '',
      latencyMs: 0,
      error: options.binaryPath
        ? `未在自定义路径找到 ${agentId}: ${options.binaryPath}`
        : `未在服务器或已连接的远程计算节点${userHint}中找到 ${agentId}。请在个人电脑上运行伴侣命令连接此网关。`
    };
  }

  const start = Date.now();
  const timeoutMs = options.timeoutMs || 120000;
  const extraCliArgs = parseCliExtraArgs(options.extraArgs);

  let args: string[] = [];
  let feedViaStdin = true;

  if (agentId === 'claude') {
    args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    if (options.disableHooks !== false) {
      args.push('--settings', JSON.stringify({ disableAllHooks: true }));
    }
    if (options.disableMcp !== false) {
      args.push('--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }));
    }
    if (options.maxTurns && options.maxTurns > 0) {
      args.push('--max-turns', String(options.maxTurns));
    }
    if (!isRunningAsRoot() && !extraCliArgs.includes('--permission-mode')) {
      args.push('--dangerously-skip-permissions');
    }
    const requestedModel = options.model?.trim();
    if (requestedModel && requestedModel !== 'default' && requestedModel !== 'auto') {
      args.push('--model', requestedModel);
    }
    if (extraCliArgs.length > 0) {
      args.push(...extraCliArgs);
    }
  } else if (agentId === 'codex') {
    args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];
    const codexInfo = discoverCodexModels(options.configDir);
    const targetModel = resolveModelAlias(options.model, codexInfo.models, codexInfo.defaultModel);
    if (targetModel) {
      args.push('--model', targetModel);
    }
    if (extraCliArgs.length > 0) args.push(...extraCliArgs);
    args.push('-');
  } else if (agentId === 'pi') {
    args = ['-p', '--no-session'];
    const piInfo = discoverPiModels(options.configDir);
    const targetModel = resolveModelAlias(options.model, piInfo.models, piInfo.defaultModel);
    if (targetModel) {
      args.push('--model', targetModel);
    }
    if (extraCliArgs.length > 0) args.push(...extraCliArgs);
  } else if (agentId === 'ducc') {
    args = isRunningAsRoot()
      ? ['-p', '--output-format=stream-json', '--verbose']
      : ['-p', '--output-format=stream-json', '--verbose', '--dangerously-skip-permissions'];
    const duccInfo = discoverDuccModels();
    const targetModel = resolveModelAlias(options.model, duccInfo.models, duccInfo.defaultModel);
    if (targetModel) {
      args.push('--model', targetModel);
    }
    if (extraCliArgs.length > 0) args.push(...extraCliArgs);
  } else if (agentId === 'ducx') {
    args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];
    const ducxInfo = discoverDucxModels();
    const targetModel = resolveModelAlias(options.model, ducxInfo.models, ducxInfo.defaultModel);
    if (targetModel) {
      args.push('--model', targetModel);
    }
    if (extraCliArgs.length > 0) args.push(...extraCliArgs);
    args.push('-');
  } else if (agentId === 'dsh') {
    args = ['headless', ...extraCliArgs, prompt];
    feedViaStdin = false;
  } else {
    args = [...extraCliArgs, prompt];
    feedViaStdin = false;
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: getAugmentedPath(),
    CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false'
  };

  if (agentId !== 'claude') {
    env.IS_SANDBOX = '1';
    env.CLAUDE_ALLOW_ROOT = '1';
  }

  const expandedConfigDir = expandHomePath(options.configDir);
  if (expandedConfigDir) {
    if (agentId === 'claude') env.CLAUDE_CONFIG_DIR = expandedConfigDir;
    else if (agentId === 'codex') env.CODEX_HOME = expandedConfigDir;
  }

  if (options.baseUrl && !options.baseUrl.startsWith('local://') && agentId === 'claude') {
    env.ANTHROPIC_BASE_URL = options.baseUrl.trim();
  }

  if (options.apiKey && options.apiKey.trim()) {
    if (agentId === 'claude') {
      const cleanKey = options.apiKey.trim();
      env.ANTHROPIC_API_KEY = cleanKey;
      if (env.ANTHROPIC_BASE_URL && !env.ANTHROPIC_AUTH_TOKEN) {
        env.ANTHROPIC_AUTH_TOKEN = cleanKey;
      }
    } else {
      env.DEEPSEEK_API_KEY = options.apiKey.trim();
    }
  }

  if (options.env) {
    for (const [k, v] of Object.entries(options.env)) {
      if (typeof v === 'string' && v.trim() !== '') {
        env[k] = v;
      }
    }
  }

  const expandedCwd = expandHomePath(options.cwd);
  const spawnTarget = resolveExecutableLaunchTarget(exe);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let streamLineBuf = '';
    let claudeDeltaText = '';
    let claudeDeltaReasoning = '';
    let claudeAssistantText = '';
    let claudeAssistantReasoning = '';
    let claudeResultText = '';
    let claudeErrorText = '';
    let claudeErrorCode: string | undefined;

    const child = spawn(spawnTarget.command, [...spawnTarget.argsPrefix, ...args], {
      cwd: expandedCwd || process.cwd(),
      env,
      timeout: timeoutMs
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

      if (agentId === 'claude') {
        streamLineBuf += text;
        const lines = streamLineBuf.split('\n');
        streamLineBuf = lines.pop() || '';
        for (const line of lines) {
          const ev = parseClaudeStreamLine(line);
          if (!ev) continue;
          if (ev.kind === 'text_delta') {
            claudeDeltaText += ev.text;
            options.onChunk?.(ev.text);
          } else if (ev.kind === 'thinking_delta') {
            claudeDeltaReasoning += ev.thinking;
            options.onChunk?.('', ev.thinking);
          } else if (ev.kind === 'assistant') {
            if (ev.isApiError) {
              claudeErrorCode = ev.errorCode;
              claudeErrorText = ev.textParts.join('\n').trim();
            } else {
              if (ev.thinkingParts.length > 0) {
                const th = ev.thinkingParts.join('\n\n');
                if (!claudeDeltaReasoning && th) {
                  options.onChunk?.('', th);
                }
                claudeAssistantReasoning = (claudeAssistantReasoning ? `${claudeAssistantReasoning}\n\n` : '') + th;
              }
              if (ev.textParts.length > 0) {
                const txt = ev.textParts.join('');
                if (!claudeDeltaText && txt) {
                  options.onChunk?.(txt);
                }
                claudeAssistantText += txt;
              }
            }
          } else if (ev.kind === 'result') {
            if (ev.isError) {
              claudeErrorText = ev.errorMessage || claudeErrorText || 'Claude Code 返回执行错误';
            } else if (ev.text) {
              claudeResultText = ev.text;
            }
          }
        }
        return;
      }

      if (options.onChunk) {
        options.onChunk(text);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      const latencyMs = Date.now() - start;

      if (agentId === 'claude') {
        if (streamLineBuf.trim()) {
          const ev = parseClaudeStreamLine(streamLineBuf);
          if (ev) {
            if (ev.kind === 'text_delta') {
              claudeDeltaText += ev.text;
              options.onChunk?.(ev.text);
            } else if (ev.kind === 'thinking_delta') {
              claudeDeltaReasoning += ev.thinking;
              options.onChunk?.('', ev.thinking);
            } else if (ev.kind === 'assistant') {
              if (ev.isApiError) {
                claudeErrorCode = ev.errorCode;
                claudeErrorText = ev.textParts.join('\n').trim();
              } else {
                if (ev.thinkingParts.length > 0) {
                  claudeAssistantReasoning =
                    (claudeAssistantReasoning ? `${claudeAssistantReasoning}\n\n` : '') +
                    ev.thinkingParts.join('\n\n');
                }
                if (ev.textParts.length > 0) {
                  claudeAssistantText += ev.textParts.join('');
                }
              }
            } else if (ev.kind === 'result') {
              if (ev.isError) {
                claudeErrorText = ev.errorMessage || claudeErrorText;
              } else if (ev.text) {
                claudeResultText = ev.text;
              }
            }
          }
        }

        if (claudeErrorText) {
          return resolve({
            ok: false,
            text: '',
            latencyMs,
            error: formatClaudeFriendlyError(claudeErrorText, claudeErrorCode)
          });
        }

        const finalText = (claudeDeltaText || claudeAssistantText || claudeResultText).trim();
        const finalReasoning = (claudeDeltaReasoning || claudeAssistantReasoning).trim() || undefined;
        if (code === 0 && finalText) {
          return resolve({
            ok: true,
            text: finalText,
            reasoning: finalReasoning,
            latencyMs
          });
        }

        const rawErr = stderr.trim() || stdout.trim() || `Claude Code 异常退出 (code ${code})`;
        return resolve({
          ok: false,
          text: finalText,
          latencyMs,
          error: formatClaudeFriendlyError(rawErr, claudeErrorCode)
        });
      }

      if (code === 0 && stdout.trim()) {
        let extractedText = stdout.trim();
        let extractedReasoning: string | undefined;

        if (agentId === 'codex' || agentId === 'ducx') {
          const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
          const messages: string[] = [];
          const reasoningParts: string[] = [];
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'item.completed' && parsed.item) {
                if (parsed.item.type === 'reasoning' && parsed.item.text) {
                  reasoningParts.push(parsed.item.text.trim());
                } else if (parsed.item.type === 'agent_message' && parsed.item.text) {
                  messages.push(parsed.item.text);
                }
              }
            } catch {
              // 忽略非 JSON 行
            }
          }
          if (reasoningParts.length > 0) {
            extractedReasoning = reasoningParts.join('\n\n');
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

        resolve({ ok: true, text: extractedText, reasoning: extractedReasoning, latencyMs });
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
 * 提取并序列化消息正文为纯文本，支持纯字符串与多模态 ContentPart 复合结构
 */
function extractContentText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (part.type === 'text') return part.text || '';
          if (part.type === 'image_url') {
            const url = part.image_url?.url || '';
            if (url.startsWith('data:image/')) {
              const mime = url.substring(5, url.indexOf(';'));
              return `[图片附件: base64 ${mime} 图像]`;
            }
            return `[图片附件: ${url}]`;
          }
          if (part.text) return String(part.text);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content || '');
}

/**
 * 将 LLMMessage 数组格式化为本地 Agent 可识别的提示词
 */
export function formatLLMMessagesToPrompt(messages: LLMMessage[]): string {
  if (!Array.isArray(messages)) {
    return extractContentText(messages);
  }
  if (messages.length === 1 && messages[0].content) {
    return extractContentText(messages[0].content);
  }
  return messages
    .filter((m) => Boolean(m.content))
    .map((m) => {
      const text = extractContentText(m.content);
      if (m.role === 'system') return `[System Instruction]\n${text}`;
      if (m.role === 'user') return `[User]\n${text}`;
      if (m.role === 'assistant') return `[Assistant]\n${text}`;
      return `[Tool Result ${m.tool_call_id || ''}]\n${text}`;
    })
    .join('\n\n');
}

/**
 * 创建对接本地 Agent 的 LLMCaller 实例 (支持按用户路由隔离与本地运行时配置覆写)
 */
export function createLocalAgentCaller(
  config: ModelProviderConfig,
  callerOptions: { userId?: string } = {}
): LLMCaller {
  return async (
    messages: LLMMessage[],
    _tools: ToolDefinition[],
    onChunk?: (delta: string, reasoningDelta?: string) => void
  ) => {
    const prompt = formatLLMMessagesToPrompt(messages);
    const apiKey = resolveApiKey(config.apiKey, config.id) || (config.id === 'dsh' ? resolveApiKey(undefined, 'deepseek') : '');

    let accumulatedReasoning = '';
    let streamBuffer = '';
    const res = await runLocalAgent(config.id, prompt, {
      model: config.model,
      apiKey: apiKey || undefined,
      baseUrl: config.baseUrl,
      binaryPath: config.binaryPath,
      configDir: config.configDir,
      cwd: config.cwd,
      extraArgs: config.extraArgs,
      env: config.env,
      userId: callerOptions.userId,
      onChunk: (chunk, reasoning) => {
        if (!onChunk) return;
        if (reasoning) {
          accumulatedReasoning = (accumulatedReasoning ? `${accumulatedReasoning}\n\n` : '') + reasoning;
          onChunk('', reasoning);
          return;
        }
        if (!chunk) return;

        if (config.id === 'claude') {
          onChunk(chunk);
          return;
        }

        if (!chunk.includes('{"type":') && !chunk.startsWith('{')) {
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
                  const r = parsed.item.text.trim();
                  if (r) {
                    accumulatedReasoning = (accumulatedReasoning ? `${accumulatedReasoning}\n\n` : '') + r;
                    onChunk('', r);
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
                    if (th) {
                      accumulatedReasoning = (accumulatedReasoning ? `${accumulatedReasoning}\n\n` : '') + th;
                      onChunk('', th);
                    }
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

    const parsedResult = splitReasoningAndContent(res.text, res.reasoning || accumulatedReasoning);

    return {
      content: parsedResult.content,
      reasoning_content: parsedResult.reasoning,
      toolCalls: []
    };
  };
}
