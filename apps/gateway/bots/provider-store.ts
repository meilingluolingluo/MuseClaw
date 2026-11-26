import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  globalProviderRuntime,
  type EnvironmentInfo,
  type LLMCaller,
  type PermissionMode,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderSnapshot,
  type ProviderTestResult,
  type ReasoningEffort
} from '../../../packages/sandbox-core/src/index.ts';

export interface ProviderInstanceRecord extends ProviderInstanceConfig {
  createdAt?: number;
  updatedAt?: number;
}

export interface ModelProviderStoreConfig {
  activeInstanceId: string;
  activeModelId: string;
  activeEnvironmentId: string;
  instances: ProviderInstanceRecord[];
}

export interface PublicProviderEntry extends ProviderInstanceRecord {
  hasApiKey: boolean;
  maskedApiKey: string;
  snapshot?: ProviderSnapshot;
}

const DEFAULT_INSTANCES: ProviderInstanceRecord[] = [
  {
    instanceId: 'claude',
    displayName: 'Claude Code',
    driver: 'claude',
    environmentId: 'local',
    model: 'sonnet',
    permissionMode: 'auto_edits',
    effort: 'medium',
    enabled: true,
    isDefault: true,
    description: 'Anthropic Claude Code Agent SDK 原生运行时'
  },
  {
    instanceId: 'codex',
    displayName: 'Codex CLI',
    driver: 'codex',
    environmentId: 'local',
    model: 'gpt-5.3-codex',
    permissionMode: 'auto_edits',
    effort: 'medium',
    enabled: true,
    isDefault: true,
    description: 'OpenAI Codex CLI 结构化编程运行时'
  },
  {
    instanceId: 'pi',
    displayName: 'Pi Agent',
    driver: 'pi',
    environmentId: 'local',
    model: 'anthropic/claude-sonnet-4-6',
    permissionMode: 'auto_edits',
    enabled: true,
    isDefault: true,
    description: 'Pi Coding Agent CLI 运行时'
  },
  {
    instanceId: 'ollama',
    displayName: 'Ollama (本地大模型)',
    driver: 'ollama',
    environmentId: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder',
    enabled: true,
    isDefault: true,
    description: '本地 Ollama OpenAI 兼容服务'
  },
  {
    instanceId: 'deepseek',
    displayName: 'DeepSeek',
    driver: 'openai-compat',
    environmentId: 'local',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    enabled: true,
    isDefault: true
  },
  {
    instanceId: 'openai',
    displayName: 'OpenAI',
    driver: 'openai-compat',
    environmentId: 'local',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    enabled: true,
    isDefault: true
  },
  {
    instanceId: 'siliconflow',
    displayName: 'SiliconFlow (硅基流动)',
    driver: 'openai-compat',
    environmentId: 'local',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    enabled: true,
    isDefault: true
  },
  {
    instanceId: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    driver: 'openai-compat',
    environmentId: 'local',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    enabled: true,
    isDefault: true
  },
  {
    instanceId: 'qwen',
    displayName: 'Qwen (通义千问)',
    driver: 'openai-compat',
    environmentId: 'local',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    enabled: true,
    isDefault: true
  },
  {
    instanceId: 'custom',
    displayName: '自定义 OpenAI 兼容端点',
    driver: 'openai-compat',
    environmentId: 'local',
    baseUrl: '',
    model: '',
    enabled: true,
    isDefault: true
  }
];

function maskSecret(secret?: string): string {
  if (!secret || !secret.trim()) return '';
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

function isValidDriver(value: unknown): value is ProviderDriverKind {
  return value === 'claude' || value === 'codex' || value === 'pi' || value === 'ollama' || value === 'openai-compat';
}

function sanitizePermissionMode(value: unknown): PermissionMode | undefined {
  if (value === 'ask' || value === 'auto_edits' || value === 'full') {
    return value;
  }
  return undefined;
}

function sanitizeEffort(value: unknown): ReasoningEffort | undefined {
  if (value === 'default' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max') {
    return value;
  }
  return undefined;
}

function sanitizeCustomModels(value: unknown, existing?: string[]): string[] | undefined {
  if (value === undefined) return existing;
  if (!Array.isArray(value)) return existing;
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}

function sanitizeEnvMap(value: unknown, existing?: Record<string, string>): Record<string, string> | undefined {
  if (value === undefined) return existing;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return existing;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.trim();
    if (key && v !== undefined && v !== null) {
      out[key] = String(v);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 多实例模型提供方与环境配置仓储 (ModelProviderStore)
 * 持久化至 config/providers.json，并与 ProviderRuntimeManager 联动完成探针探测与调用路由。
 */
export class ModelProviderStore {
  private readonly filePath: string;
  private config: ModelProviderStoreConfig;

  constructor(configDir = join(process.cwd(), 'config')) {
    this.filePath = join(configDir, 'providers.json');
    this.config = this.load();
  }

  private createDefaultConfig(): ModelProviderStoreConfig {
    return {
      activeInstanceId: 'claude',
      activeModelId: 'sonnet',
      activeEnvironmentId: 'local',
      instances: DEFAULT_INSTANCES.map((inst) => ({ ...inst }))
    };
  }

  private normalizeInstance(raw: any, existing?: ProviderInstanceRecord): ProviderInstanceRecord {
    const driver: ProviderDriverKind = isValidDriver(raw?.driver)
      ? raw.driver
      : existing?.driver || 'openai-compat';
    const instanceId = String(raw?.instanceId || existing?.instanceId || `${driver}-${Date.now()}`).trim();
    const now = Date.now();

    let nextApiKey = existing?.apiKey;
    if (raw?.clearApiKey) {
      nextApiKey = undefined;
    } else if (raw?.apiKey !== undefined) {
      const candidate = String(raw.apiKey).trim();
      if (!candidate.includes('****')) {
        nextApiKey = candidate || undefined;
      }
    }

    return {
      instanceId,
      displayName: String(raw?.displayName ?? existing?.displayName ?? instanceId).trim() || instanceId,
      driver,
      environmentId: String(raw?.environmentId ?? existing?.environmentId ?? 'local').trim() || 'local',
      model: raw?.model !== undefined ? String(raw.model).trim() : (existing?.model ?? ''),
      customModels: sanitizeCustomModels(raw?.customModels, existing?.customModels),
      binaryPath: raw?.binaryPath !== undefined ? String(raw.binaryPath).trim() || undefined : existing?.binaryPath,
      configDir: raw?.configDir !== undefined ? String(raw.configDir).trim() || undefined : existing?.configDir,
      cwd: raw?.cwd !== undefined ? String(raw.cwd).trim() || undefined : existing?.cwd,
      extraArgs: raw?.extraArgs !== undefined ? String(raw.extraArgs) : existing?.extraArgs,
      baseUrl: raw?.baseUrl !== undefined ? String(raw.baseUrl).trim() : existing?.baseUrl,
      apiKey: nextApiKey,
      env: sanitizeEnvMap(raw?.env, existing?.env),
      permissionMode: sanitizePermissionMode(raw?.permissionMode) ?? existing?.permissionMode,
      effort: sanitizeEffort(raw?.effort) ?? existing?.effort,
      description: raw?.description !== undefined ? String(raw.description) : existing?.description,
      isDefault: raw?.isDefault !== undefined ? Boolean(raw.isDefault) : existing?.isDefault,
      enabled: raw?.enabled !== undefined ? Boolean(raw.enabled) : (existing?.enabled ?? true),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
  }

  private load(): ModelProviderStoreConfig {
    try {
      if (existsSync(this.filePath)) {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
        const loadedInstances: ProviderInstanceRecord[] = Array.isArray(parsed?.instances)
          ? parsed.instances.map((item: any) => this.normalizeInstance(item))
          : [];
        const byId = new Map<string, ProviderInstanceRecord>();
        for (const def of DEFAULT_INSTANCES) {
          byId.set(def.instanceId, { ...def });
        }
        for (const item of loadedInstances) {
          const base = byId.get(item.instanceId);
          byId.set(item.instanceId, this.normalizeInstance(item, base));
        }
        const instances = Array.from(byId.values());
        const activeId =
          typeof parsed?.activeInstanceId === 'string' && byId.has(parsed.activeInstanceId)
            ? parsed.activeInstanceId
            : instances[0]?.instanceId || 'claude';
        const active = byId.get(activeId)!;
        return {
          activeInstanceId: activeId,
          activeModelId: String(parsed?.activeModelId || active.model || 'sonnet'),
          activeEnvironmentId: String(parsed?.activeEnvironmentId || active.environmentId || 'local'),
          instances
        };
      }
    } catch (err) {
      console.warn('[ModelProviderStore] Failed to load providers.json, using defaults:', err);
    }

    const defaults = this.createDefaultConfig();
    this.persist(defaults);
    return defaults;
  }

  private persist(nextConfig: ModelProviderStoreConfig = this.config): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(nextConfig, null, 2), 'utf8');
    } catch (err) {
      console.error('[ModelProviderStore] Failed to persist providers.json:', err);
    }
  }

  private toPublicEntry(inst: ProviderInstanceRecord, snapshot?: ProviderSnapshot): PublicProviderEntry {
    const rawKey = inst.apiKey?.trim() || '';
    return {
      ...inst,
      apiKey: maskSecret(rawKey),
      hasApiKey: Boolean(rawKey),
      maskedApiKey: maskSecret(rawKey),
      snapshot
    };
  }

  public getInstances(): ProviderInstanceRecord[] {
    return this.config.instances.map((inst) => ({ ...inst }));
  }

  public getInstance(instanceId: string): ProviderInstanceRecord | undefined {
    const found = this.config.instances.find((item) => item.instanceId === instanceId);
    return found ? { ...found } : undefined;
  }

  public getActiveInstance(): ProviderInstanceRecord {
    const found =
      this.config.instances.find((item) => item.instanceId === this.config.activeInstanceId) ||
      this.config.instances[0] ||
      DEFAULT_INSTANCES[0];
    return {
      ...found,
      model: this.config.activeModelId || found.model || 'sonnet',
      environmentId: this.config.activeEnvironmentId || found.environmentId || 'local'
    };
  }

  public getActiveProvider(): ProviderInstanceRecord {
    return this.getActiveInstance();
  }

  public async getPublicConfig(
    userId?: string,
    options?: { forceRefresh?: boolean }
  ): Promise<{
    activeInstanceId: string;
    activeModelId: string;
    activeEnvironmentId: string;
    environments: EnvironmentInfo[];
    instances: PublicProviderEntry[];
  }> {
    const forceRefresh = Boolean(options?.forceRefresh);
    const probeTargets = this.config.instances.filter(
      (inst) =>
        inst.enabled !== false &&
        (inst.driver === 'claude' || inst.driver === 'codex' || inst.driver === 'pi' || inst.driver === 'ollama')
    );

    const snapshotById = new Map<string, ProviderSnapshot>();
    await Promise.all(
      probeTargets.map(async (inst) => {
        try {
          const snapshot = await globalProviderRuntime.probeInstance(inst, {
            forceRefresh,
            userId
          });
          snapshotById.set(inst.instanceId, snapshot);
        } catch (err: any) {
          snapshotById.set(inst.instanceId, {
            instanceId: inst.instanceId,
            driver: inst.driver,
            displayName: inst.displayName,
            enabled: inst.enabled,
            installed: false,
            status: 'error',
            version: null,
            auth: { status: 'unknown' },
            models: [],
            checkedAt: Date.now(),
            environmentId: inst.environmentId || 'local',
            environmentLabel: inst.environmentId || 'local',
            message: err?.message || '探测失败'
          });
        }
      })
    );

    const publicInstances = this.config.instances.map((inst) =>
      this.toPublicEntry(inst, snapshotById.get(inst.instanceId))
    );
    const environments = globalProviderRuntime.listEnvironments(userId);

    return {
      activeInstanceId: this.config.activeInstanceId,
      activeModelId: this.config.activeModelId,
      activeEnvironmentId: this.config.activeEnvironmentId,
      environments,
      instances: publicInstances
    };
  }

  public upsertInstance(input: Partial<ProviderInstanceRecord> & { instanceId?: string }): ProviderInstanceRecord {
    const instanceId = String(input.instanceId || `${input.driver || 'custom'}-${Date.now()}`).trim();
    const index = this.config.instances.findIndex((item) => item.instanceId === instanceId);
    const existing = index >= 0 ? this.config.instances[index] : undefined;
    const normalized = this.normalizeInstance({ ...input, instanceId }, existing);

    if (index >= 0) {
      this.config.instances[index] = normalized;
    } else {
      this.config.instances.push(normalized);
    }

    if (this.config.activeInstanceId === instanceId) {
      if (normalized.model) {
        this.config.activeModelId = normalized.model;
      }
      if (normalized.environmentId) {
        this.config.activeEnvironmentId = normalized.environmentId;
      }
    }

    this.persist();
    return { ...normalized };
  }

  public removeInstance(instanceId: string): { removed: boolean; reason?: string } {
    if (this.config.instances.length <= 1) {
      return { removed: false, reason: '至少保留一个模型提供方实例' };
    }
    const index = this.config.instances.findIndex((item) => item.instanceId === instanceId);
    if (index < 0) {
      return { removed: false, reason: `未找到实例: ${instanceId}` };
    }
    const target = this.config.instances[index];
    if (target.isDefault) {
      return { removed: false, reason: '默认内置提供方实例不可删除，可通过启用开关停用' };
    }

    this.config.instances.splice(index, 1);
    if (this.config.activeInstanceId === instanceId) {
      const fallback = this.config.instances[0];
      this.config.activeInstanceId = fallback.instanceId;
      this.config.activeModelId = fallback.model || 'sonnet';
      this.config.activeEnvironmentId = fallback.environmentId || 'local';
    }
    this.persist();
    return { removed: true };
  }

  public setActiveInstance(instanceId: string, modelId?: string, environmentId?: string): ModelProviderStoreConfig {
    const target = this.config.instances.find((item) => item.instanceId === instanceId);
    if (!target) {
      throw new Error(`未找到提供方实例: ${instanceId}`);
    }
    this.config.activeInstanceId = target.instanceId;
    if (modelId !== undefined && modelId.trim()) {
      target.model = modelId.trim();
      this.config.activeModelId = modelId.trim();
    } else {
      this.config.activeModelId = target.model || 'sonnet';
    }
    if (environmentId !== undefined && environmentId.trim()) {
      target.environmentId = environmentId.trim();
      this.config.activeEnvironmentId = environmentId.trim();
    } else {
      this.config.activeEnvironmentId = target.environmentId || 'local';
    }
    target.updatedAt = Date.now();
    this.persist();
    return {
      ...this.config,
      instances: this.getInstances()
    };
  }

  public updateConfig(data: {
    activeInstanceId?: string;
    activeModelId?: string;
    activeEnvironmentId?: string;
    instance?: Partial<ProviderInstanceRecord>;
    instances?: Array<Partial<ProviderInstanceRecord>>;
  }): { ok: boolean; activeInstanceId: string; activeModelId: string; activeEnvironmentId: string } {
    if (Array.isArray(data.instances)) {
      for (const item of data.instances) {
        if (item && (item.instanceId || item.driver)) {
          this.upsertInstance(item);
        }
      }
    }

    if (data.instance && (data.instance.instanceId || data.instance.driver)) {
      this.upsertInstance(data.instance);
    }

    if (data.activeInstanceId) {
      this.setActiveInstance(data.activeInstanceId, data.activeModelId, data.activeEnvironmentId);
    } else {
      const current = this.getActiveInstance();
      if (data.activeModelId !== undefined || data.activeEnvironmentId !== undefined) {
        this.setActiveInstance(current.instanceId, data.activeModelId, data.activeEnvironmentId);
      }
    }

    return {
      ok: true,
      activeInstanceId: this.config.activeInstanceId,
      activeModelId: this.config.activeModelId,
      activeEnvironmentId: this.config.activeEnvironmentId
    };
  }

  public async testProvider(data: {
    instanceId?: string;
    driver?: ProviderDriverKind;
    environmentId?: string;
    displayName?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    binaryPath?: string;
    extraArgs?: string;
    cwd?: string;
    permissionMode?: PermissionMode;
    effort?: ReasoningEffort;
  }): Promise<ProviderTestResult> {
    const existing = data.instanceId ? this.getInstance(data.instanceId) : undefined;
    const merged = this.normalizeInstance(
      {
        instanceId: data.instanceId || existing?.instanceId || `test-${Date.now()}`,
        displayName: data.displayName || existing?.displayName || '测试实例',
        driver: data.driver || existing?.driver || 'openai-compat',
        environmentId: data.environmentId || existing?.environmentId || 'local',
        model: data.model ?? existing?.model ?? '',
        baseUrl: data.baseUrl ?? existing?.baseUrl,
        apiKey: data.apiKey ?? existing?.apiKey,
        binaryPath: data.binaryPath ?? existing?.binaryPath,
        extraArgs: data.extraArgs ?? existing?.extraArgs,
        cwd: data.cwd ?? existing?.cwd,
        permissionMode: data.permissionMode ?? existing?.permissionMode,
        effort: data.effort ?? existing?.effort
      },
      existing
    );
    return globalProviderRuntime.testInstance(merged);
  }

  public async probeOllama(baseUrl = 'http://127.0.0.1:11434/v1'): Promise<ProviderSnapshot> {
    const base = this.getInstance('ollama') || DEFAULT_INSTANCES.find((i) => i.instanceId === 'ollama')!;
    return globalProviderRuntime.probeInstance(
      {
        ...base,
        baseUrl
      },
      { forceRefresh: true }
    );
  }

  public async fetchModelsForProvider(data: {
    instanceId?: string;
    driver?: ProviderDriverKind;
    environmentId?: string;
    baseUrl?: string;
    apiKey?: string;
    binaryPath?: string;
    extraArgs?: string;
    userId?: string;
  }): Promise<{ ok: boolean; snapshot: ProviderSnapshot; models: ProviderSnapshot['models'] }> {
    const existing = data.instanceId ? this.getInstance(data.instanceId) : undefined;
    const target = this.normalizeInstance(
      {
        instanceId: data.instanceId || existing?.instanceId || 'custom',
        displayName: existing?.displayName || '探测实例',
        driver: data.driver || existing?.driver || 'openai-compat',
        environmentId: data.environmentId || existing?.environmentId || 'local',
        baseUrl: data.baseUrl ?? existing?.baseUrl,
        apiKey: data.apiKey ?? existing?.apiKey,
        binaryPath: data.binaryPath ?? existing?.binaryPath,
        extraArgs: data.extraArgs ?? existing?.extraArgs
      },
      existing
    );
    const snapshot = await globalProviderRuntime.probeInstance(target, {
      forceRefresh: true,
      userId: data.userId
    });
    return {
      ok: snapshot.status === 'ready' || snapshot.status === 'warning',
      snapshot,
      models: snapshot.models
    };
  }

  public getActiveCaller(opts?: { userId?: string; instanceId?: string }): LLMCaller {
    const inst = opts?.instanceId
      ? (this.getInstance(opts.instanceId) || this.getActiveInstance())
      : this.getActiveInstance();
    const scopeKey = `${opts?.userId || 'default'}:${inst.instanceId}`;
    return globalProviderRuntime.createLLMCaller(inst, scopeKey);
  }

  public getCallerForBot(modelSpec?: string, opts?: { userId?: string }): LLMCaller {
    if (modelSpec && modelSpec.trim()) {
      const raw = modelSpec.trim();
      const colonIdx = raw.indexOf(':');
      const idCandidate = colonIdx > 0 ? raw.slice(0, colonIdx).trim() : raw;
      const modelOverride = colonIdx > 0 ? raw.slice(colonIdx + 1).trim() : '';
      const matched = this.config.instances.find(
        (item) => item.instanceId === idCandidate || item.driver === idCandidate
      );
      if (matched) {
        const overridden: ProviderInstanceRecord = {
          ...matched,
          model: modelOverride || matched.model
        };
        const scopeKey = `${opts?.userId || 'default'}:${overridden.instanceId}:${overridden.model || 'default'}`;
        return globalProviderRuntime.createLLMCaller(overridden, scopeKey);
      }
    }
    return this.getActiveCaller(opts);
  }
}

export const globalModelStore = new ModelProviderStore();
