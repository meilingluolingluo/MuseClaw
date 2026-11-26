import {
  createOpenAICompatibleCaller,
  fetchRemoteModels,
  probeOllamaModels,
  resolveApiKey,
  testProviderConnection
} from '../llm.ts';
import { findExecutableInPath } from './executable.ts';
import type {
  AgentRuntimeEvent,
  ApprovalDecision,
  ProviderDriver,
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderModelDescriptor,
  ProviderSnapshot,
  TurnRunParams
} from './types.ts';

function toModelDescriptors(slugs: string[], customModels?: string[]): ProviderModelDescriptor[] {
  const customSet = new Set((customModels || []).map((m) => m.trim()).filter(Boolean));
  const merged = Array.from(new Set([...slugs.map((m) => m.trim()).filter(Boolean), ...customSet]));
  return merged.map((slug) => ({
    slug,
    name: slug,
    ...(customSet.has(slug) ? { isCustom: true } : {})
  }));
}

export class OpenAICompatProviderDriver implements ProviderDriver {
  public readonly kind: ProviderDriverKind;
  public readonly supportsNativeSession = false;
  private remoteModelsCache = new Map<string, { models: string[]; expiresAt: number }>();

  constructor(kind: 'ollama' | 'openai-compat') {
    this.kind = kind;
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
        driver: this.kind,
        displayName: instance.displayName,
        enabled: false,
        installed: false,
        status: 'disabled',
        version: null,
        auth: { status: 'unknown' },
        models: toModelDescriptors([], instance.customModels),
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel
      };
    }

    if (this.kind === 'ollama') {
      const endpoint = instance.baseUrl || 'http://127.0.0.1:11434';
      const ollamaBin = findExecutableInPath('ollama');
      const probe = await probeOllamaModels(endpoint);
      const fallback = ['llama3.2', 'qwen2.5-coder', 'deepseek-r1:8b', 'mistral'];
      const models = toModelDescriptors(
        probe.models.length > 0 ? probe.models : fallback,
        instance.customModels
      );
      return {
        instanceId: instance.instanceId,
        driver: 'ollama',
        displayName: instance.displayName,
        enabled: true,
        installed: probe.ok || Boolean(ollamaBin),
        status: probe.ok ? 'ready' : ollamaBin ? 'warning' : 'not_found',
        version: probe.ok ? 'HTTP Service Active' : ollamaBin ? 'Installed (Stopped)' : null,
        executablePath: ollamaBin || undefined,
        auth: {
          status: probe.ok ? 'authenticated' : 'unknown',
          label: probe.ok ? '本地服务已就绪' : ollamaBin ? '服务未启动' : '未检测到'
        },
        models,
        checkedAt: now,
        environmentId: envId,
        environmentLabel: envLabel,
        installCommand: 'brew install ollama && ollama serve',
        ...(probe.ok
          ? {}
          : {
              message: ollamaBin
                ? '已检测到 ollama，但本地服务未启动（请执行 ollama serve）'
                : '未检测到本地 Ollama 服务'
            })
      };
    }

    const effectiveKey = resolveApiKey(instance.apiKey, instance.instanceId);
    const cacheKey = `${instance.instanceId}:${instance.baseUrl || ''}:${effectiveKey.slice(0, 8)}`;
    const cached = this.remoteModelsCache.get(cacheKey);
    let fetchedModels: string[] = [];

    if (cached && cached.expiresAt > now) {
      fetchedModels = cached.models;
    } else if (effectiveKey && instance.baseUrl) {
      const res = await fetchRemoteModels(instance.baseUrl, effectiveKey, 3000);
      if (res.ok && res.models.length > 0) {
        fetchedModels = res.models;
        this.remoteModelsCache.set(cacheKey, {
          models: res.models,
          expiresAt: now + 10 * 60 * 1000
        });
      }
    }

    const baseSlugs = fetchedModels.length > 0 ? fetchedModels : instance.model ? [instance.model] : [];
    const models = toModelDescriptors(baseSlugs, instance.customModels);
    const ready = Boolean(effectiveKey);

    return {
      instanceId: instance.instanceId,
      driver: 'openai-compat',
      displayName: instance.displayName,
      enabled: true,
      installed: true,
      status: ready ? 'ready' : 'unauthenticated',
      version: null,
      auth: ready
        ? {
            status: 'authenticated',
            method: 'apiKey',
            label: 'API Key 已配置',
            ...(instance.baseUrl ? { endpoint: instance.baseUrl } : {})
          }
        : { status: 'unauthenticated', method: 'none', label: '待配置 API Key' },
      models,
      checkedAt: now,
      environmentId: envId,
      environmentLabel: envLabel
    };
  }

  public async testConnection(instance: ProviderInstanceConfig) {
    return testProviderConnection({
      id: instance.instanceId,
      name: instance.displayName,
      baseUrl: instance.baseUrl || (this.kind === 'ollama' ? 'http://127.0.0.1:11434/v1/chat/completions' : ''),
      apiKey: instance.apiKey,
      model: instance.model
    });
  }

  public async *runTurn(params: TurnRunParams): AsyncGenerator<AgentRuntimeEvent, void, void> {
    const startedAt = Date.now();
    const caller = createOpenAICompatibleCaller({
      id: params.instance.instanceId,
      name: params.instance.displayName,
      baseUrl:
        params.instance.baseUrl ||
        (this.kind === 'ollama' ? 'http://127.0.0.1:11434/v1/chat/completions' : ''),
      apiKey: params.instance.apiKey,
      model: params.model || params.instance.model
    });

    const messages = [
      ...(params.systemPrompt ? [{ role: 'system' as const, content: params.systemPrompt }] : []),
      { role: 'user' as const, content: params.prompt }
    ];

    try {
      const res = await caller(messages, []);
      if (res.reasoning_content) {
        yield { type: 'reasoning.delta', text: res.reasoning_content };
      }
      if (res.content) {
        yield { type: 'text.delta', text: res.content };
      }
      yield {
        type: 'turn.completed',
        text: res.content || '',
        reasoning: res.reasoning_content,
        durationMs: Date.now() - startedAt
      };
    } catch (err: any) {
      yield { type: 'turn.failed', error: err?.message || String(err) };
    }
  }

  public async interruptTurn(_sessionKey: string): Promise<void> {}

  public async respondApproval(_requestId: string, _decision: ApprovalDecision): Promise<boolean> {
    return false;
  }

  public async closeSession(_sessionKey: string): Promise<void> {}

  public async disposeAll(): Promise<void> {}
}
