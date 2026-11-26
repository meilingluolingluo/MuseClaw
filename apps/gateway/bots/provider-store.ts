import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ModelProviderConfig,
  type LLMCaller,
  type LocalAgentProbeOverride,
  isStdioLocalAgent,
  createOpenAICompatibleCaller,
  createLocalAgentCaller,
  testProviderConnection,
  probeOllamaModels,
  resolveApiKey,
  resolveModelAlias,
  probeLocalAgents,
  discoverClaudeModels,
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
    id: 'claude',
    name: 'Claude Code (本地 Agent)',
    baseUrl: '',
    model: 'claude-sonnet-4-6',
    candidateModels: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'sonnet', 'opus', 'haiku'],
    isLocalAgent: true,
    category: 'local_agent',
    protocol: 'acp-stdio',
    installCommand: 'npm i -g @anthropic-ai/claude-code',
    docUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    description: 'Anthropic 官方本地编码 Agent，支持本机 OAuth 登录或自定义 Anthropic 兼容接口，实时流式输出'
  },
  {
    id: 'codex',
    name: 'OpenAI Codex (本地 Agent)',
    baseUrl: 'local://codex',
    model: 'gpt-5.4',
    candidateModels: ['gpt-5.4', 'gpt-5.3-codex', 'o3', 'gpt-4o'],
    isLocalAgent: true,
    category: 'local_agent',
    protocol: 'acp-stdio',
    installCommand: 'npm i -g @openai/codex',
    docUrl: 'https://github.com/openai/codex',
    description: '本地 OpenAI Codex 终端编码 Agent，支持 headless stdio 交互'
  },
  {
    id: 'pi',
    name: 'Pi Coding Agent (本地 Agent)',
    baseUrl: 'local://pi',
    model: 'anthropic/claude-sonnet-4-6',
    candidateModels: ['anthropic/claude-sonnet-4-6', 'openai/gpt-5.4', 'deepseek/deepseek-chat'],
    isLocalAgent: true,
    category: 'local_agent',
    protocol: 'json-rpc-stdio',
    installCommand: 'npm i -g @mariozechner/pi-coding-agent',
    docUrl: 'https://github.com/badlogic/pi-mono',
    description: '轻量高性能终端 Coding Agent，支持 stdio JSON-RPC 与多模型驱动'
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness (本地 dsh)',
    baseUrl: 'local://dsh',
    model: 'deepseek-official/deepseek-chat',
    candidateModels: ['deepseek-official/deepseek-chat', 'deepseek-official/deepseek-reasoner'],
    isLocalAgent: true,
    category: 'local_agent',
    protocol: 'acp-stdio',
    installCommand: 'curl -fsSL https://deepseek.ai/dsh/install.sh | bash',
    docUrl: 'https://github.com/deepseek-ai/deepseek-harness',
    description: 'DeepSeek 官方开源本地终端 Harness 编码 Agent，支持 ACP 协议'
  },
  {
    id: 'ollama',
    name: '本地 Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    model: 'llama3.2',
    candidateModels: ['llama3.2', 'qwen2.5-coder', 'deepseek-r1:8b', 'mistral'],
    isLocalAgent: true,
    category: 'local_agent',
    protocol: 'openai-http',
    installCommand: 'brew install ollama && ollama serve',
    docUrl: 'https://ollama.com',
    description: '无需联网与 API Key，完全在本地硬件私有化运行'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
    candidateModels: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    category: 'cloud_api',
    description: '国内原生推理与 Coding 模型，性价比极高'
  },
  {
    id: 'openai',
    name: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    candidateModels: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini', 'gpt-4.5-preview'],
    category: 'cloud_api',
    description: '行业标准旗舰模型，支持原生 Tool Calling'
  },
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'deepseek-ai/DeepSeek-V3',
    candidateModels: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct'],
    category: 'cloud_api',
    description: '高并发 DeepSeek 与开源大模型托管云服务'
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-32k',
    candidateModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'],
    category: 'cloud_api',
    description: '超长上下文中文原生模型'
  },
  {
    id: 'qwen',
    name: '通义千问 (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    candidateModels: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-72b-instruct'],
    category: 'cloud_api',
    description: '阿里云官方模型服务，兼容 OpenAI 协议'
  },
  {
    id: 'custom',
    name: '自定义 OpenAI 网关 (Custom)',
    baseUrl: 'https://api.example.com/v1/chat/completions',
    model: '',
    candidateModels: [],
    isCustom: true,
    category: 'cloud_api',
    description: '支持任意自建代理、中转或私有 OpenAI 兼容大模型网关'
  },
  {
    id: 'ducc',
    name: 'Baidu CC (内网 ducc)',
    baseUrl: 'local://ducc',
    model: 'GLM-5.3-Flash-内部',
    candidateModels: ['GLM-5.3-Flash-内部', 'Opus 5.5', 'Claude Sonnet 5.5', 'DeepSeek-V4.1-Flash-内部'],
    isLocalAgent: true,
    category: 'intranet_agent',
    protocol: 'acp-stdio',
    installCommand: 'curl -fsSL http://team-mesh.loop.baidu-int.com:8004/api/tmesh/dist/install.sh | bash',
    docUrl: 'http://team-mesh.loop.baidu-int.com:8004',
    description: 'Baidu 内部 Claude Code 编码 Agent，免 Key 直连内网大模型'
  },
  {
    id: 'ducx',
    name: 'Baidu CX (内网 ducx)',
    baseUrl: 'local://ducx',
    model: 'gpt-5.6-sol',
    candidateModels: ['gpt-5.6-sol', 'gpt-6.1-sol', 'GLM-5.3-Flash', 'DeepSeek-V4-Pro'],
    isLocalAgent: true,
    category: 'intranet_agent',
    protocol: 'acp-stdio',
    installCommand: 'curl -fsSL http://team-mesh.loop.baidu-int.com:8004/api/tmesh/dist/install.sh | bash',
    docUrl: 'http://team-mesh.loop.baidu-int.com:8004',
    description: 'Baidu 内部 Codex 架构高级编码 Agent，支持多模型与高阶推理'
  }
];

function inferCategory(p: ModelProviderConfig): 'local_agent' | 'cloud_api' | 'intranet_agent' {
  if (p.category) return p.category;
  if (p.id === 'ducc' || p.id === 'ducx') return 'intranet_agent';
  if (p.isLocalAgent || isStdioLocalAgent(p.id) || p.id === 'ollama') return 'local_agent';
  return 'cloud_api';
}

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

  public getProviderConfig(providerId: string): ModelProviderConfig | undefined {
    return this.providers.get(providerId);
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
          const merged: ModelProviderConfig = {
            ...existing,
            ...p,
            category: existing?.category || p.category || inferCategory(p)
          };
          // 兼容旧配置：将空字符串或失效占位清理，同时保留用户显式设置
          if (p.id === 'claude' && merged.baseUrl === 'local://claude') {
            merged.baseUrl = '';
          }
          this.providers.set(p.id, merged);
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

  public resolveEffectiveLocalModel(provider: ModelProviderConfig, userId?: string): ModelProviderConfig {
    const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents(userId);
    const remote = remoteAgents.find((r) => r.id === provider.id);
    const remoteModels = remote?.candidateModels || [];
    const customModels = provider.customModels || [];

    if (provider.id === 'claude') {
      const claudeInfo = discoverClaudeModels(provider.configDir, provider.executablePath, customModels);
      const baseList = remoteModels.length > 0 ? remoteModels : claudeInfo.models;
      const candidateModels = Array.from(new Set([...baseList, ...customModels]));
      const effectiveModel = provider.model?.trim()
        ? provider.model.trim()
        : (remote?.defaultModel || claudeInfo.defaultModel || candidateModels[0] || 'claude-sonnet-4-6');
      return {
        ...provider,
        model: effectiveModel,
        candidateModels
      };
    }

    if (provider.id === 'codex') {
      const codexInfo = discoverCodexModels(provider.configDir);
      const candidateModels = Array.from(new Set([...(remoteModels.length > 0 ? remoteModels : codexInfo.models), ...customModels]));
      const effectiveModel = customModels.includes(provider.model)
        ? provider.model
        : resolveModelAlias(
            provider.model,
            candidateModels,
            remote?.defaultModel || codexInfo.defaultModel || candidateModels[0] || 'gpt-5.4'
          );
      return {
        ...provider,
        model: effectiveModel,
        candidateModels
      };
    }
    if (provider.id === 'pi') {
      const piInfo = discoverPiModels(provider.configDir);
      const candidateModels = Array.from(new Set([...(remoteModels.length > 0 ? remoteModels : piInfo.models), ...customModels]));
      const effectiveModel = customModels.includes(provider.model)
        ? provider.model
        : resolveModelAlias(
            provider.model,
            candidateModels,
            remote?.defaultModel || piInfo.defaultModel || candidateModels[0] || 'anthropic/claude-sonnet-4-6'
          );
      return {
        ...provider,
        model: effectiveModel,
        candidateModels
      };
    }
    if (provider.id === 'ducc') {
      const duccInfo = discoverDuccModels();
      const candidateModels = Array.from(new Set([...(remoteModels.length > 0 ? remoteModels : duccInfo.models), ...customModels]));
      const effectiveModel = customModels.includes(provider.model)
        ? provider.model
        : resolveModelAlias(
            provider.model,
            candidateModels,
            remote?.defaultModel || duccInfo.defaultModel || candidateModels[0] || 'GLM-5.3-Flash-内部'
          );
      return {
        ...provider,
        model: effectiveModel,
        candidateModels
      };
    }
    if (provider.id === 'ducx') {
      const ducxInfo = discoverDucxModels();
      const candidateModels = Array.from(new Set([...(remoteModels.length > 0 ? remoteModels : ducxInfo.models), ...customModels]));
      const effectiveModel = customModels.includes(provider.model)
        ? provider.model
        : resolveModelAlias(
            provider.model,
            candidateModels,
            remote?.defaultModel || ducxInfo.defaultModel || candidateModels[0] || 'gpt-5.6-sol'
          );
      return {
        ...provider,
        model: effectiveModel,
        candidateModels
      };
    }
    return provider;
  }

  public getActiveProvider(userId?: string): ModelProviderConfig {
    const p = this.providers.get(this.activeProviderId);
    const provider = p || this.providers.get('deepseek') || DEFAULT_PRESETS[0];
    return this.resolveEffectiveLocalModel(provider, userId);
  }

  public getActiveCaller(options?: { userId?: string }): LLMCaller {
    const active = this.getActiveProvider(options?.userId);
    if (isStdioLocalAgent(active.id) || (active.isLocalAgent && active.id !== 'ollama')) {
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
      if (isStdioLocalAgent(provider.id) || (provider.isLocalAgent && provider.id !== 'ollama')) {
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

  private redactEnv(env?: Record<string, string>): Record<string, string> | undefined {
    if (!env) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (/key|token|secret|password/i.test(k)) {
        out[k] = v ? '••••••••' : '';
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  public async getPublicConfig(
    userId?: string,
    options?: { forceRefresh?: boolean }
  ): Promise<{
    activeProviderId: string;
    providers: Array<ModelProviderConfig & { hasKey: boolean; maskedKey: string }>;
  }> {
    const overrides: Record<string, LocalAgentProbeOverride> = {};
    for (const p of this.providers.values()) {
      if (p.isLocalAgent || isStdioLocalAgent(p.id) || p.id === 'ollama') {
        overrides[p.id] = {
          binaryPath: p.binaryPath,
          configDir: p.configDir,
          cwd: p.cwd,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          env: p.env,
          customModels: p.customModels
        };
      }
    }

    let localAgents: any[] = [];
    try {
      localAgents = await probeLocalAgents({
        overrides,
        userId,
        forceRefresh: options?.forceRefresh
      });
    } catch {
      // 容错处理
    }
    const localMap = new Map(localAgents.map((a) => [a.id, a]));

    const list = await Promise.all(
      Array.from(this.providers.values()).map(async (p) => {
        const isLocal = Boolean(p.isLocalAgent || isStdioLocalAgent(p.id) || p.id === 'ollama');
        const category = inferCategory(p);
        const localInfo = localMap.get(p.id);
        const resolved = resolveApiKey(p.apiKey, p.id);

        let candidateModels: string[] = [];
        const remoteAgents = isLocal ? globalRunnerMesh.getAggregatedRemoteAgents(userId) : [];
        const remote = remoteAgents.find((r) => r.id === p.id);

        if (p.id === 'ollama') {
          const detectedModels = localInfo?.candidateModels && localInfo.candidateModels.length > 0 ? localInfo.candidateModels : [];
          const remoteModels = remote?.candidateModels && remote.candidateModels.length > 0 ? remote.candidateModels : [];
          candidateModels = Array.from(
            new Set([
              ...(remoteModels.length > 0
                ? remoteModels
                : (detectedModels.length > 0 ? detectedModels : (p.candidateModels || ['llama3.2', 'qwen2.5-coder', 'deepseek-r1:8b', 'mistral']))),
              ...(p.customModels || [])
            ])
          );
          p.candidateModels = candidateModels;
        } else if (isLocal) {
          let models: string[] = [];
          if (remote?.candidateModels && remote.candidateModels.length > 0) {
            models = remote.candidateModels;
          } else {
            let dynamicDiscovered: string[] = [];
            if (p.id === 'claude') dynamicDiscovered = discoverClaudeModels(p.configDir, localInfo?.executablePath, p.customModels).models;
            else if (p.id === 'codex') dynamicDiscovered = discoverCodexModels(p.configDir).models;
            else if (p.id === 'pi') dynamicDiscovered = discoverPiModels(p.configDir).models;
            else if (p.id === 'ducc') dynamicDiscovered = discoverDuccModels().models;
            else if (p.id === 'ducx') dynamicDiscovered = discoverDucxModels().models;

            models = Array.from(new Set([
              ...(localInfo?.installed ? (localInfo.candidateModels || []) : []),
              ...dynamicDiscovered,
              ...(p.customModels || []),
              ...(p.candidateModels || [])
            ]));
          }
          candidateModels = Array.from(new Set([...models, ...(p.customModels || [])]));
          p.candidateModels = candidateModels;
        } else {
          const cached = this.getRemoteModelsCache(p.id, p.baseUrl, resolved || '');
          if (cached && cached.length > 0) {
            candidateModels = cached;
          } else if (resolved && p.baseUrl) {
            try {
              const res = await fetchRemoteModels(p.baseUrl, resolved, 3000);
              if (res.ok && res.models.length > 0) {
                this.setRemoteModelsCache(p.id, p.baseUrl, resolved, res.models);
                const merged = Array.from(new Set([...res.models, ...(p.candidateModels || [])]));
                candidateModels = merged;
                p.candidateModels = merged;
              }
            } catch {
              // 容错处理
            }
          }
          if (candidateModels.length === 0 && p.candidateModels && p.candidateModels.length > 0) {
            candidateModels = p.candidateModels;
          }
          if (p.customModels && p.customModels.length > 0) {
            candidateModels = Array.from(new Set([...candidateModels, ...p.customModels]));
          }
        }

        const effectiveModel = p.id === 'claude' && p.model?.trim()
          ? p.model.trim()
          : candidateModels.length > 0
            ? (p.model && candidateModels.includes(p.model) ? p.model : candidateModels[0])
            : p.model;

        let isInstalled: boolean | undefined = undefined;
        let isAvailable: boolean | undefined = undefined;
        let hasKey = false;
        const effectiveVersion = localInfo?.version || remote?.version || p.version;
        const effectiveExecutable = localInfo?.executablePath || remote?.executablePath || p.executablePath;
        let maskedKey = '';

        if (p.id === 'ollama') {
          const isHttpActive = localInfo?.version === 'HTTP Service Active' || Boolean(remote?.installed);
          const isBinInstalled = Boolean(localInfo?.installed || remote?.installed);
          isInstalled = isBinInstalled;
          isAvailable = isHttpActive;
          hasKey = isHttpActive;
          if (isHttpActive) {
            maskedKey = remote?.installed ? '远程节点已就绪' : '本地服务已就绪';
          } else if (isBinInstalled) {
            maskedKey = '服务未运行 (请执行 ollama serve)';
          } else {
            maskedKey = '未检测到';
          }
        } else if (isLocal) {
          isInstalled = Boolean(localInfo?.installed || remote?.installed);
          const remoteReady = remote ? (remote.status ? remote.status === 'ready' : Boolean(remote.installed)) : false;
          const localReady = localInfo ? (localInfo.isAvailable !== false && localInfo.installed) : false;
          isAvailable = Boolean(localReady || remoteReady);
          hasKey = Boolean(resolved || isAvailable);
          maskedKey = resolved
            ? this.maskKey(resolved)
            : isInstalled
              ? (effectiveVersion || (localInfo?.installed ? '本地就绪' : '远程就绪'))
              : '未检测到';
        } else {
          hasKey = Boolean(resolved);
          maskedKey = this.maskKey(resolved);
        }

        return {
          ...p,
          category,
          model: effectiveModel,
          candidateModels,
          isLocalAgent: isLocal,
          installed: isInstalled,
          isAvailable,
          status: localInfo?.status || (isAvailable ? 'ready' : isInstalled ? 'warning' : 'not_found'),
          statusMessage: localInfo?.statusMessage,
          auth: localInfo?.auth || remote?.auth,
          source: localInfo?.source || (remote ? 'remote' : 'local'),
          machineName: localInfo?.machineName || remote?.machineName,
          installCommand: localInfo?.installCommand || p.installCommand,
          docUrl: localInfo?.docUrl || p.docUrl,
          checkedAt: localInfo?.checkedAt,
          version: effectiveVersion,
          executablePath: effectiveExecutable,
          hasKey,
          maskedKey,
          env: this.redactEnv(p.env),
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
    provider?: Partial<ModelProviderConfig> & { id: string; clearApiKey?: boolean };
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

      let updatedKey = existing.apiKey;
      if (input.provider.clearApiKey) {
        updatedKey = undefined;
      } else if (input.provider.apiKey !== undefined && input.provider.apiKey.trim() !== '') {
        updatedKey = input.provider.apiKey.trim();
      }

      let updatedEnv = existing.env;
      if (input.provider.env !== undefined) {
        const nextEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(input.provider.env)) {
          if (v === '••••••••' && existing.env?.[k]) {
            nextEnv[k] = existing.env[k];
          } else if (typeof v === 'string' && v.trim() !== '') {
            nextEnv[k] = v.trim();
          }
        }
        updatedEnv = Object.keys(nextEnv).length > 0 ? nextEnv : undefined;
      }

      const nextCustomModels = input.provider.customModels !== undefined
        ? Array.from(new Set(input.provider.customModels.map((m) => m.trim()).filter(Boolean)))
        : existing.customModels;

      const { clearApiKey: _clear, ...cleanInput } = input.provider;
      this.providers.set(input.provider.id, {
        ...existing,
        ...cleanInput,
        apiKey: updatedKey,
        env: updatedEnv,
        customModels: nextCustomModels
      });

      this.cachedCaller = null;
    }

    this.save();
    return { success: true, activeProviderId: this.activeProviderId };
  }

  public async testProvider(config: ModelProviderConfig & { providerId?: string; userId?: string }) {
    const id = config.id || config.providerId || '';
    const existing = this.providers.get(id);
    const mergedEnv = config.env !== undefined ? { ...(existing?.env || {}), ...config.env } : existing?.env;
    if (mergedEnv) {
      for (const [k, v] of Object.entries(mergedEnv)) {
        if (v === '••••••••' && existing?.env?.[k]) {
          mergedEnv[k] = existing.env[k];
        }
      }
    }
    const merged: ModelProviderConfig & { userId?: string } = {
      ...existing,
      ...config,
      id,
      apiKey: config.apiKey && config.apiKey.trim() !== '' ? config.apiKey.trim() : existing?.apiKey,
      baseUrl: config.baseUrl !== undefined ? config.baseUrl : (existing?.baseUrl || ''),
      binaryPath: config.binaryPath !== undefined ? config.binaryPath : existing?.binaryPath,
      configDir: config.configDir !== undefined ? config.configDir : existing?.configDir,
      cwd: config.cwd !== undefined ? config.cwd : existing?.cwd,
      extraArgs: config.extraArgs !== undefined ? config.extraArgs : existing?.extraArgs,
      env: mergedEnv
    };
    return testProviderConnection(merged);
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

    if (providerId && isStdioLocalAgent(providerId)) {
      let localModels: string[] = [];
      if (providerId === 'claude') localModels = discoverClaudeModels(provider?.configDir, provider?.executablePath, provider?.customModels).models;
      else if (providerId === 'codex') localModels = discoverCodexModels(provider?.configDir).models;
      else if (providerId === 'pi') localModels = discoverPiModels(provider?.configDir).models;
      else if (providerId === 'ducc') localModels = discoverDuccModels().models;
      else if (providerId === 'ducx') localModels = discoverDucxModels().models;

      const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents();
      const remote = remoteAgents.find((r) => r.id === providerId);
      const combined = Array.from(new Set([...(remote?.candidateModels || []), ...localModels, ...(provider?.customModels || [])]));
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
