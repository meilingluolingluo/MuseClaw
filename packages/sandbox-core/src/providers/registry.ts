import os from 'node:os';
import { ClaudeProviderDriver } from './claude-driver.ts';
import { CodexProviderDriver } from './codex-driver.ts';
import { EnvironmentBridge, globalEnvironmentBridge } from './environment-bridge.ts';
import { OpenAICompatProviderDriver } from './openai-compat-driver.ts';
import { PiProviderDriver } from './pi-driver.ts';
import type {
  AgentRuntimeEvent,
  ApprovalDecision,
  EnvironmentInfo,
  ProviderDriver,
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderSnapshot,
  TurnRunParams
} from './types.ts';
import type { LLMCaller, LLMMessage, ToolDefinition } from '../loop.ts';
import { createOpenAICompatibleCaller } from '../llm.ts';
import { splitReasoningAndContent } from '../reasoning.ts';

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  snapshot?: ProviderSnapshot;
  model?: string;
  version?: string | null;
  auth?: ProviderSnapshot['auth'];
  replyPreview?: string;
  diagnosticCode: 'ready' | 'not_found' | 'unauthenticated' | 'execution_failed' | 'disabled';
  error?: string;
}

const PROBE_CACHE_TTL_MS = 20_000;

/**
 * 统一 Provider 运行时管理中心 (ProviderRuntimeManager)
 * 负责统筹本机与远程环境中的多实例驱动，管理探针缓存、会话路由、中断与资源回收。
 */
export class ProviderRuntimeManager {
  private drivers: Map<ProviderDriverKind, ProviderDriver>;
  private bridge: EnvironmentBridge;
  private probeCache = new Map<string, { expiresAt: number; snapshot: ProviderSnapshot }>();

  constructor(bridge: EnvironmentBridge = globalEnvironmentBridge) {
    this.bridge = bridge;
    const claude = new ClaudeProviderDriver();
    const codex = new CodexProviderDriver();
    const pi = new PiProviderDriver();
    const ollama = new OpenAICompatProviderDriver('ollama');
    const openaiCompat = new OpenAICompatProviderDriver('openai-compat');

    this.drivers = new Map<ProviderDriverKind, ProviderDriver>([
      ['claude', claude],
      ['codex', codex],
      ['pi', pi],
      ['ollama', ollama],
      ['openai-compat', openaiCompat]
    ]);
  }

  public getDriver(kind: ProviderDriverKind): ProviderDriver | undefined {
    return this.drivers.get(kind);
  }

  public getEnvironmentBridge(): EnvironmentBridge {
    return this.bridge;
  }

  public listEnvironments(userId?: string): EnvironmentInfo[] {
    const localEnv: EnvironmentInfo = {
      environmentId: 'local',
      label: `本机环境 (${os.hostname()})`,
      kind: 'local',
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      status: 'online'
    };
    return [localEnv, ...this.bridge.listEnvironments(userId)];
  }

  public async probeInstance(
    instance: ProviderInstanceConfig,
    options?: { forceRefresh?: boolean; userId?: string }
  ): Promise<ProviderSnapshot> {
    const cacheKey = JSON.stringify({
      instanceId: instance.instanceId,
      driver: instance.driver,
      enabled: instance.enabled,
      environmentId: instance.environmentId,
      binaryPath: instance.binaryPath || '',
      configDir: instance.configDir || '',
      baseUrl: instance.baseUrl || '',
      hasApiKey: Boolean(instance.apiKey),
      customModels: instance.customModels || [],
      env: instance.env || {}
    });

    if (!options?.forceRefresh) {
      const cached = this.probeCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.snapshot;
      }
    }

    let snapshot: ProviderSnapshot;
    if (instance.environmentId && instance.environmentId !== 'local') {
      if (options?.userId && !this.bridge.canUserAccess(instance.environmentId, options.userId)) {
        snapshot = {
          instanceId: instance.instanceId,
          driver: instance.driver,
          displayName: instance.displayName,
          enabled: instance.enabled,
          installed: false,
          status: 'error',
          version: null,
          auth: { status: 'unknown' },
          models: [],
          checkedAt: Date.now(),
          environmentId: instance.environmentId,
          environmentLabel: instance.environmentId,
          message: '无权访问该远程计算环境'
        };
      } else {
        snapshot = await this.bridge.probeInstance(instance);
      }
    } else {
      const driver = this.drivers.get(instance.driver);
      if (!driver) {
        throw new Error(`未知的 Provider 驱动类型: ${instance.driver}`);
      }
      snapshot = await driver.probe(instance, {
        environmentId: 'local',
        environmentLabel: `本机环境 (${os.hostname()})`
      });
    }

    this.probeCache.set(cacheKey, {
      expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
      snapshot
    });
    return snapshot;
  }

  public async *runTurn(params: TurnRunParams): AsyncGenerator<AgentRuntimeEvent, void, void> {
    const envId = params.instance.environmentId || 'local';
    if (envId !== 'local') {
      for await (const ev of this.bridge.runTurn(params)) {
        yield ev;
      }
      return;
    }

    const driver = this.drivers.get(params.instance.driver);
    if (!driver) {
      yield { type: 'turn.failed', error: `未注册的驱动类型: ${params.instance.driver}` };
      return;
    }

    for await (const ev of driver.runTurn(params)) {
      yield ev;
    }
  }

  public async testInstance(instance: ProviderInstanceConfig): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    const snapshot = await this.probeInstance(instance, { forceRefresh: true });

    if (!instance.enabled) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        snapshot,
        diagnosticCode: 'disabled',
        error: '当前实例已被禁用'
      };
    }

    if (snapshot.status === 'not_found') {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        snapshot,
        diagnosticCode: 'not_found',
        error: snapshot.message || `未检测到 ${instance.displayName} 运行时`
      };
    }

    if (snapshot.status === 'unauthenticated') {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        snapshot,
        version: snapshot.version,
        auth: snapshot.auth,
        diagnosticCode: 'unauthenticated',
        error: snapshot.message || `${instance.displayName} 尚未完成认证`
      };
    }

    if (instance.driver === 'openai-compat' || instance.driver === 'ollama') {
      const driver = this.drivers.get(instance.driver) as OpenAICompatProviderDriver;
      const res = await driver.testConnection(instance);
      return {
        ok: res.ok,
        latencyMs: res.latencyMs,
        snapshot,
        model: res.model || instance.model,
        version: snapshot.version,
        auth: snapshot.auth,
        diagnosticCode: res.ok ? 'ready' : 'execution_failed',
        error: res.error
      };
    }

    // 针对本地 Agent 驱动，执行轻量级真实单轮验证并随即清理临时测试会话
    const testSessionKey = `probe_test_${instance.instanceId}_${Date.now()}`;
    const testInstanceConfig: ProviderInstanceConfig = {
      ...instance,
      permissionMode: 'full',
      extraArgs: instance.extraArgs
    };

    let replyText = '';
    let failedError = '';

    try {
      for await (const ev of this.runTurn({
        sessionKey: testSessionKey,
        instance: testInstanceConfig,
        prompt: 'Reply with just: OK',
        model: instance.model
      })) {
        if (ev.type === 'text.delta') {
          replyText += ev.text;
        } else if (ev.type === 'turn.completed') {
          if (ev.text) replyText = ev.text;
        } else if (ev.type === 'turn.failed') {
          failedError = ev.error;
        }
      }
    } finally {
      await this.closeSession(testSessionKey, instance.environmentId);
    }

    const latencyMs = Date.now() - startedAt;
    if (failedError) {
      return {
        ok: false,
        latencyMs,
        snapshot,
        model: instance.model,
        version: snapshot.version,
        auth: snapshot.auth,
        diagnosticCode: failedError.includes('尚未登录') ? 'unauthenticated' : 'execution_failed',
        error: failedError
      };
    }

    return {
      ok: true,
      latencyMs,
      snapshot,
      model: instance.model,
      version: snapshot.version,
      auth: snapshot.auth,
      replyPreview: replyText.trim().slice(0, 120) || 'OK',
      diagnosticCode: 'ready'
    };
  }

  public async interruptTurn(sessionKey: string): Promise<void> {
    await Promise.all([
      ...Array.from(this.drivers.values()).map((d) => d.interruptTurn(sessionKey)),
      this.bridge.interruptTurn(sessionKey)
    ]);
  }

  public async respondApproval(requestId: string, decision: ApprovalDecision): Promise<boolean> {
    for (const driver of this.drivers.values()) {
      const handled = await driver.respondApproval(requestId, decision);
      if (handled) return true;
    }
    return this.bridge.respondApproval(requestId, decision);
  }

  public async closeSession(sessionKey: string, environmentId?: string): Promise<void> {
    await Promise.all([
      ...Array.from(this.drivers.values()).map((d) => d.closeSession(sessionKey)),
      this.bridge.closeSession(sessionKey, environmentId)
    ]);
  }

  public async disposeAll(): Promise<void> {
    await Promise.all(Array.from(this.drivers.values()).map((d) => d.disposeAll()));
    this.bridge.dispose();
  }

  /**
   * 创建兼容传统单轮 LLMCaller 的适配器（供记忆反思、巡检、态势流等后台任务复用）
   */
  public createLLMCaller(instance: ProviderInstanceConfig, scopeKey?: string): LLMCaller {
    if (instance.driver === 'openai-compat' || instance.driver === 'ollama') {
      return createOpenAICompatibleCaller({
        id: instance.instanceId,
        name: instance.displayName,
        baseUrl:
          instance.baseUrl ||
          (instance.driver === 'ollama' ? 'http://127.0.0.1:11434/v1/chat/completions' : ''),
        apiKey: instance.apiKey,
        model: instance.model
      });
    }

    return async (
      messages: LLMMessage[],
      _tools: ToolDefinition[],
      onChunk?: (delta: string, reasoningDelta?: string) => void
    ) => {
      const prompt = messages
        .filter((m) => Boolean(m.content))
        .map((m) => {
          const txt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          if (m.role === 'system') return `[System]\n${txt}`;
          if (m.role === 'assistant') return `[Assistant]\n${txt}`;
          return `[User]\n${txt}`;
        })
        .join('\n\n');

      const sessionKey = scopeKey || `caller_${instance.instanceId}_${Date.now()}`;
      let fullText = '';
      let fullReasoning = '';
      let errorMsg = '';

      try {
        for await (const ev of this.runTurn({
          sessionKey,
          instance: { ...instance, permissionMode: 'full' },
          prompt,
          model: instance.model
        })) {
          if (ev.type === 'text.delta') {
            fullText += ev.text;
            onChunk?.(ev.text);
          } else if (ev.type === 'reasoning.delta') {
            fullReasoning += ev.text;
            onChunk?.('', ev.text);
          } else if (ev.type === 'turn.completed') {
            if (ev.text) fullText = ev.text;
            if (ev.reasoning) fullReasoning = ev.reasoning;
          } else if (ev.type === 'turn.failed') {
            errorMsg = ev.error;
          }
        }
      } finally {
        await this.closeSession(sessionKey, instance.environmentId);
      }

      if (errorMsg) {
        throw new Error(`[${instance.displayName}] 执行失败: ${errorMsg}`);
      }

      const parsed = splitReasoningAndContent(fullText, fullReasoning || undefined);
      return {
        content: parsed.content,
        reasoning_content: parsed.reasoning,
        toolCalls: []
      };
    };
  }
}

export const globalProviderRuntime = new ProviderRuntimeManager();
