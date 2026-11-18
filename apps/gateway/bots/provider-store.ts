import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ModelProviderConfig,
  type LLMCaller,
  createOpenAICompatibleCaller,
  createLocalAgentCaller,
  testProviderConnection,
  probeOllamaModels,
  resolveApiKey,
  runLocalAgent,
  testLocalAgent,
  probeLocalAgents,
  discoverCodexModels,
  discoverPiModels,
  discoverDuccModels,
  discoverDucxModels,
  fetchRemoteModels,
  globalRunnerMesh
} from '../../../packages/sandbox-core/src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ModelsConfigFile {
  activeProviderId: string;
  providers: ModelProviderConfig[];
  updatedAt?: number;
}

const DEFAULT_PRESETS: ModelProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
    candidateModels: [],
    description: '国内最强原生推理与 Coding 模型，性价比极高'
  },
  {
    id: 'openai',
    name: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: '',
    candidateModels: [],
    description: '行业标准旗舰模型，支持原生 Tool Calling'
  },
  {
    id: 'ollama',
    name: '本地 Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    model: '',
    candidateModels: [],
    description: '无需联网与 API Key，完全在本地硬件私有化运行'
  },
  {
    id: 'codex',
    name: 'OpenAI Codex (本地 Agent)',
    baseUrl: 'local://codex',
    model: '',
    candidateModels: [],
    isLocalAgent: true,
    protocol: 'acp-stdio',
    description: '本地 OpenAI Codex 终端编码 Agent，支持 headless stdio 交互'
  },
  {
    id: 'pi',
    name: 'Pi Coding Agent (本地 Agent)',
    baseUrl: 'local://pi',
    model: '',
    candidateModels: [],
    isLocalAgent: true,
    protocol: 'json-rpc-stdio',
    description: '极简高性能终端 Coding Agent，支持 stdio JSON-RPC 与多模型驱动'
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness (本地 dsh)',
    baseUrl: 'local://dsh',
    model: '',
    candidateModels: [],
    isLocalAgent: true,
    protocol: 'acp-stdio',
    description: 'DeepSeek 官方开源本地终端 Harness 编码 Agent，支持 ACP 协议'
  },
  {
    id: 'ducc',
    name: 'Baidu CC (本地 ducc)',
    baseUrl: 'local://ducc',
    model: '',
    candidateModels: [],
    isLocalAgent: true,
    protocol: 'acp-stdio',
    description: 'Baidu 内部 Claude Code 深度编码 Agent，免 Key 直连内网大模型'
  },
  {
    id: 'ducx',
    name: 'Baidu CX (本地 ducx)',
    baseUrl: 'local://ducx',
    model: '',
    candidateModels: [],
    isLocalAgent: true,
    protocol: 'acp-stdio',
    description: 'Baidu 内部 Codex 架构高级编码 Agent，支持多模型与高阶推理'
  },
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    model: '',
    candidateModels: [],
    description: '高并发 DeepSeek 与开源大模型托管云服务'
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    model: '',
    candidateModels: [],
    description: '超长上下文中文原生模型'
  },
  {
    id: 'qwen',
    name: '通义千问 (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: '',
    candidateModels: [],
    description: '阿里云官方模型服务，兼容 OpenAI 协议'
  },
  {
    id: 'custom',
    name: '企业内部专有网关 (Custom)',
    baseUrl: 'https://api.example.com/v1/chat/completions',
    model: '',
    candidateModels: [],
    isCustom: true,
    description: '支持任意企业内网代理、中转或私有大模型网关'
  }
];

export class ModelProviderStore {
  private configPath: string;
  private activeProviderId: string = 'deepseek';
  private providers: Map<string, ModelProviderConfig> = new Map();
  private cachedCaller: { providerId: string; caller: LLMCaller } | null = null;
  private remoteModelsCache = new Map<string, { models: string[]; timestamp: number }>();

  public getRemoteModelsCache(providerId: string, baseUrl: string, apiKey: string): string[] | null {
    const cacheKey = `${providerId}:${baseUrl}:${apiKey.slice(0, 8)}`;
    const cached = this.remoteModelsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      return cached.models;
    }
    return null;
  }

  public setRemoteModelsCache(providerId: string, baseUrl: string, apiKey: string, models: string[]): void {
    const cacheKey = `${providerId}:${baseUrl}:${apiKey.slice(0, 8)}`;
    this.remoteModelsCache.set(cacheKey, { models, timestamp: Date.now() });
  }

  constructor(customPath?: string) {
    this.configPath = customPath || path.resolve(__dirname, '../../../config/models.json');
    this.initDefaultPresets();
    this.load();
  }

  private initDefaultPresets(): void {
    for (const preset of DEFAULT_PRESETS) {
      this.providers.set(preset.id, { ...preset });
    }
  }

  public load(): void {
    if (!fs.existsSync(this.configPath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const data: ModelsConfigFile = JSON.parse(raw);
      if (data.activeProviderId && (this.providers.has(data.activeProviderId) || data.providers?.some(p => p.id === data.activeProviderId))) {
        this.activeProviderId = data.activeProviderId;
      }
      if (Array.isArray(data.providers)) {
        for (const p of data.providers) {
          const existing = this.providers.get(p.id);
          this.providers.set(p.id, {
            ...existing,
            ...p
          });
        }
      }
    } catch {
      // 容错处理
    }
  }

  public save(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: ModelsConfigFile = {
        activeProviderId: this.activeProviderId,
        providers: Array.from(this.providers.values()),
        updatedAt: Date.now()
      };
      fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // 容错处理
    }
  }

  public resolveEffectiveLocalModel(provider: ModelProviderConfig): ModelProviderConfig {
    const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents();
    const remote = remoteAgents.find((r) => r.id === provider.id);
    const remoteModels = remote?.candidateModels || [];

    if (provider.id === 'codex') {
      const codexInfo = discoverCodexModels();
      const candidateModels = Array.from(new Set([...remoteModels, ...codexInfo.models, ...(provider.candidateModels || [])]));
      const effectiveModel = (provider.model && candidateModels.includes(provider.model) && provider.model !== 'gpt-4o')
        ? provider.model
        : (codexInfo.defaultModel || remote?.defaultModel || candidateModels[0] || 'Claude Sonnet 5.5-baidu-oneapi');
      return {
        ...provider,
        model: effectiveModel,
        candidateModels
      };
    }
    if (provider.id === 'pi') {
      const piInfo = discoverPiModels();
      const candidateModels = Array.from(new Set([...remoteModels, ...piInfo.models, ...(provider.candidateModels || [])]));
      const effectiveModel = (provider.model && candidateModels.includes(provider.model) && provider.model !== 'anthropic/claude-3-7-sonnet')
        ? provider.model
        : (piInfo.defaultModel || remote?.defaultModel || candidateModels[0] || 'Opus 5.5-baidu-oneapi');
      return {
        ...provider,
        model: effectiveModel,
        candidateModels
      };
    }
    if (provider.id === 'ducc') {
      const duccInfo = discoverDuccModels();
      const candidateModels = Array.from(new Set([...remoteModels, ...duccInfo.models, ...(provider.candidateModels || [])]));
      const effectiveModel = (provider.model && candidateModels.includes(provider.model))
        ? provider.model
        : (duccInfo.defaultModel || remote?.defaultModel || candidateModels[0] || 'GLM-5.3-Flash-内部');
      return {
        ...provider,
        model: effectiveModel,
        candidateModels
      };
    }
    if (provider.id === 'ducx') {
      const ducxInfo = discoverDucxModels();
      const candidateModels = Array.from(new Set([...remoteModels, ...ducxInfo.models, ...(provider.candidateModels || [])]));
      const effectiveModel = (provider.model && candidateModels.includes(provider.model))
        ? provider.model
        : (ducxInfo.defaultModel || remote?.defaultModel || candidateModels[0] || 'gpt-5.6-sol');
      return {
        ...provider,
        model: effectiveModel,
        candidateModels
      };
    }
    return provider;
  }

  public getActiveProvider(): ModelProviderConfig {
    const p = this.providers.get(this.activeProviderId);
    const provider = p || this.providers.get('deepseek') || DEFAULT_PRESETS[0];
    return this.resolveEffectiveLocalModel(provider);
  }

  public getActiveCaller(options?: { userId?: string }): LLMCaller {
    const active = this.getActiveProvider();
    if (active.isLocalAgent || ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(active.id)) {
      if (options?.userId) {
        return createLocalAgentCaller(active, { userId: options.userId });
      }
      if (this.cachedCaller && this.cachedCaller.providerId === active.id) {
        return this.cachedCaller.caller;
      }
      const caller = createLocalAgentCaller(active);
      this.cachedCaller = { providerId: active.id, caller };
      return caller;
    }
    if (this.cachedCaller && this.cachedCaller.providerId === active.id) {
      return this.cachedCaller.caller;
    }
    const caller = createOpenAICompatibleCaller(active);
    this.cachedCaller = { providerId: active.id, caller };
    return caller;
  }

  public getCallerForBot(botModelConfig?: { providerId?: string; model?: string }): LLMCaller {
    if (botModelConfig?.providerId && this.providers.has(botModelConfig.providerId)) {
      const provider = { ...this.providers.get(botModelConfig.providerId)! };
      if (botModelConfig.model) {
        provider.model = botModelConfig.model;
      }
      if (provider.isLocalAgent || ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(provider.id)) {
        return createLocalAgentCaller(this.resolveEffectiveLocalModel(provider));
      }
      return createOpenAICompatibleCaller(provider);
    }
    return this.getActiveCaller();
  }

  public maskKey(key?: string): string {
    if (!key || key.length < 6) return key ? '••••••' : '';
    return `${key.slice(0, 3)}••••••${key.slice(-3)}`;
  }

  public async getPublicConfig(): Promise<{
    activeProviderId: string;
    providers: Array<ModelProviderConfig & { hasKey: boolean; maskedKey: string }>;
  }> {
    let localAgents: Array<{ id: string; installed: boolean; version?: string; executablePath?: string }> = [];
    try {
      localAgents = await probeLocalAgents();
    } catch {
      // 容错处理
    }
    const localMap = new Map(localAgents.map((a) => [a.id, a]));

    const list = await Promise.all(
      Array.from(this.providers.values()).map(async (p) => {
        const isLocal = Boolean(p.isLocalAgent || ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(p.id));
        const localInfo = localMap.get(p.id);
        const resolved = resolveApiKey(p.apiKey, p.id);

        let candidateModels: string[] = [];

        if (isLocal) {
          const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents();
          const remote = remoteAgents.find((r) => r.id === p.id);
          const models = Array.from(new Set([
            ...(remote?.candidateModels || []),
            ...(localInfo?.candidateModels || []),
            ...(p.candidateModels || [])
          ]));
          candidateModels = models;
          p.candidateModels = models;
        } else if (p.id === 'ollama') {
          candidateModels = p.candidateModels || [];
        } else {
          const cached = this.getRemoteModelsCache(p.id, p.baseUrl, resolved || '');
          if (cached && cached.length > 0) {
            candidateModels = cached;
          } else if (resolved && p.baseUrl) {
            try {
              const res = await fetchRemoteModels(p.baseUrl, resolved, 3000);
              if (res.ok && res.models.length > 0) {
                this.setRemoteModelsCache(p.id, p.baseUrl, resolved, res.models);
                candidateModels = res.models;
                p.candidateModels = res.models;
              }
            } catch {
              // 容错处理
            }
          }
          if (candidateModels.length === 0 && p.candidateModels && p.candidateModels.length > 0) {
            candidateModels = p.candidateModels;
          }
        }

        const effectiveModel = candidateModels.length > 0
          ? (p.model && candidateModels.includes(p.model) ? p.model : candidateModels[0])
          : p.model;

        const hasKey = isLocal ? Boolean(localInfo?.installed) : Boolean(resolved);
        const maskedKey = isLocal
          ? (localInfo?.installed ? (localInfo.version || '已就绪') : '未安装')
          : this.maskKey(resolved);

        return {
          ...p,
          model: effectiveModel,
          candidateModels,
          isLocalAgent: isLocal,
          installed: isLocal ? Boolean(localInfo?.installed) : undefined,
          version: localInfo?.version || p.version,
          executablePath: localInfo?.executablePath || p.executablePath,
          hasKey,
          maskedKey,
          apiKey: undefined // 安全考虑不向前端明文回传完整 Key
        };
      })
    );

    return {
      activeProviderId: this.activeProviderId,
      providers: list
    };
  }

  public updateConfig(input: {
    activeProviderId?: string;
    provider?: Partial<ModelProviderConfig> & { id: string };
  }): { success: boolean; activeProviderId: string } {
    if (input.activeProviderId && this.providers.has(input.activeProviderId)) {
      this.activeProviderId = input.activeProviderId;
      this.cachedCaller = null;
    }

    if (input.provider && input.provider.id) {
      const existing = this.providers.get(input.provider.id) || {
        id: input.provider.id,
        name: input.provider.name || input.provider.id,
        baseUrl: input.provider.baseUrl || '',
        model: input.provider.model || '',
        isCustom: true
      };

      const updatedKey = input.provider.apiKey !== undefined && input.provider.apiKey !== ''
        ? input.provider.apiKey.trim()
        : existing.apiKey;

      this.providers.set(input.provider.id, {
        ...existing,
        ...input.provider,
        apiKey: updatedKey
      });

      this.cachedCaller = null;
    }

    this.save();
    return { success: true, activeProviderId: this.activeProviderId };
  }

  public async testProvider(config: ModelProviderConfig & { providerId?: string }) {
    const id = config.id || config.providerId || '';
    const existing = this.providers.get(id);
    const merged = { ...existing, ...config, id };
    return testProviderConnection(merged as ModelProviderConfig);
  }

  public async probeOllama(baseUrl?: string) {
    return probeOllamaModels(baseUrl);
  }

  public async fetchModelsForProvider(input: {
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<{ ok: boolean; models: string[]; error?: string }> {
    const providerId = input.providerId;
    const provider = providerId ? this.providers.get(providerId) : undefined;

    if (providerId === 'codex' || providerId === 'pi' || providerId === 'ducc' || providerId === 'ducx') {
      let localModels: string[] = [];
      if (providerId === 'codex') localModels = discoverCodexModels().models;
      else if (providerId === 'pi') localModels = discoverPiModels().models;
      else if (providerId === 'ducc') localModels = discoverDuccModels().models;
      else if (providerId === 'ducx') localModels = discoverDucxModels().models;

      const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents();
      const remote = remoteAgents.find((r) => r.id === providerId);
      const combined = Array.from(new Set([...(remote?.candidateModels || []), ...localModels]));
      if (provider && combined.length > 0) {
        provider.candidateModels = combined;
        this.save();
      }
      return { ok: true, models: combined };
    }
    if (providerId === 'ollama') {
      return this.probeOllama(input.baseUrl || provider?.baseUrl);
    }

    const baseUrl = input.baseUrl || provider?.baseUrl || '';
    const rawKey = input.apiKey || provider?.apiKey;
    const effectiveKey = resolveApiKey(rawKey, providerId);

    const res = await fetchRemoteModels(baseUrl, effectiveKey, 6000);
    if (res.ok && res.models.length > 0) {
      if (provider) {
        provider.candidateModels = res.models;
        if (!provider.model || !res.models.includes(provider.model)) {
          provider.model = res.models[0];
        }
        this.save();
      }
      this.setRemoteModelsCache(providerId || baseUrl, baseUrl, effectiveKey || '', res.models);
    }
    return res;
  }
}

export const globalModelStore = new ModelProviderStore();
