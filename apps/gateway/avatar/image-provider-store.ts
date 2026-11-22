import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveApiKey } from '../../../packages/sandbox-core/src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ImageProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  candidateModels: string[];
  apiKey?: string;
  description: string;
  enabled?: boolean;
}

export interface ImageModelsConfigFile {
  activeProviderId: string;
  providers: ImageProviderConfig[];
  updatedAt?: number;
}

const DEFAULT_IMAGE_PRESETS: ImageProviderConfig[] = [
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Kwai-Kolors/Kolors',
    candidateModels: [
      'Kwai-Kolors/Kolors',
      'Tongyi-MAI/Z-Image-Turbo',
      'Tongyi-MAI/Z-Image',
      'Qwen/Qwen-Image',
      'OpenMOSS-Team/MOSS-Image',
      'black-forest-labs/FLUX.1-schnell'
    ],
    description: '国内顶尖云端生图平台，支持 Kolors、Z-Image 与 Qwen-Image 毫秒级极速渲染',
    enabled: true
  },
  {
    id: 'google',
    name: 'Google Gemini & Imagen 3',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash-image',
    candidateModels: [
      'gemini-2.5-flash-image',
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
      'imagen-3.0-generate-002'
    ],
    description: 'Google 官方 Imagen 3 高清画图引擎与 Gemini 多模态生图（需在 Google AI Studio 关联结算账号）',
    enabled: true
  },
  {
    id: 'dashscope',
    name: '阿里灵积 / 通义万相',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    model: 'qwen-image-3.0',
    candidateModels: ['qwen-image-3.0', 'wanx-v1'],
    description: '阿里巴巴官方通义万相多模态绘图与动作合成引擎',
    enabled: true
  },
  {
    id: 'openai',
    name: 'OpenAI DALL-E',
    baseUrl: 'https://api.openai.com/v1',
    model: 'dall-e-3',
    candidateModels: ['dall-e-3', 'dall-e-2'],
    description: 'OpenAI 官方 DALL-E 3 高清图像生成引擎',
    enabled: true
  },
  {
    id: 'builtin',
    name: '内置离线矢量引擎 (Built-in)',
    baseUrl: 'local://builtin',
    model: 'museclaw-avatar-v1',
    candidateModels: ['museclaw-avatar-v1'],
    description: '无需联网与 API Key，基于自适应角色算法本地秒级生成精美 SVG/WebP 形象',
    enabled: true
  }
];

export class ImageProviderStore {
  private configPath: string;
  private activeProviderId = 'siliconflow';
  private providers = new Map<string, ImageProviderConfig>();

  constructor(customPath?: string) {
    this.configPath = customPath || path.resolve(__dirname, '../../../config/image-models.json');
    this.initDefaultPresets();
    this.load();
  }

  private initDefaultPresets(): void {
    for (const preset of DEFAULT_IMAGE_PRESETS) {
      this.providers.set(preset.id, { ...preset });
    }
  }

  public load(): void {
    if (!fs.existsSync(this.configPath)) {
      this.save();
      return;
    }
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const data: ImageModelsConfigFile = JSON.parse(raw);
      if (data.activeProviderId && this.providers.has(data.activeProviderId)) {
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
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data: ImageModelsConfigFile = {
        activeProviderId: this.activeProviderId,
        providers: Array.from(this.providers.values()),
        updatedAt: Date.now()
      };
      fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // 容错处理
    }
  }

  public getActiveProviderId(): string {
    return this.activeProviderId;
  }

  public getProviderConfig(id: string): ImageProviderConfig | undefined {
    return this.providers.get(id);
  }

  public getActiveProvider(): ImageProviderConfig & { effectiveKey: string } {
    const prov = this.providers.get(this.activeProviderId) || this.providers.get('builtin') || DEFAULT_IMAGE_PRESETS[0];
    const effectiveKey = resolveApiKey(prov.apiKey, prov.id);
    return {
      ...prov,
      effectiveKey
    };
  }

  public getPublicConfig(): {
    activeProviderId: string;
    providers: Array<ImageProviderConfig & { hasKey: boolean; maskedKey: string }>;
  } {
    const list = Array.from(this.providers.values()).map((p) => {
      const effectiveKey = resolveApiKey(p.apiKey, p.id);
      const hasKey = Boolean(effectiveKey && effectiveKey.length > 0);
      let maskedKey = '';
      if (hasKey) {
        if (effectiveKey.length > 12) {
          maskedKey = `${effectiveKey.slice(0, 4)}••••••••${effectiveKey.slice(-4)}`;
        } else {
          maskedKey = '••••••••';
        }
      }
      return {
        ...p,
        hasKey,
        maskedKey
      };
    });

    return {
      activeProviderId: this.activeProviderId,
      providers: list
    };
  }

  public updateConfig(payload: {
    activeProviderId?: string;
    provider?: Partial<ImageProviderConfig> & { id: string };
  }): { ok: boolean; activeProviderId: string } {
    if (payload.activeProviderId && this.providers.has(payload.activeProviderId)) {
      this.activeProviderId = payload.activeProviderId;
    }
    if (payload.provider && payload.provider.id) {
      const id = payload.provider.id;
      const existing = this.providers.get(id) || {
        id,
        name: id,
        baseUrl: '',
        model: '',
        candidateModels: [],
        description: ''
      };

      const updated: ImageProviderConfig = {
        ...existing,
        ...payload.provider,
        apiKey: payload.provider.apiKey !== undefined ? payload.provider.apiKey : existing.apiKey
      };
      this.providers.set(id, updated);
    }
    this.save();
    return { ok: true, activeProviderId: this.activeProviderId };
  }

  public async testProvider(config: {
    id: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  }): Promise<{ ok: boolean; latencyMs: number; error?: string; models?: string[] }> {
    const start = Date.now();
    const targetUrl = config.baseUrl || this.providers.get(config.id)?.baseUrl || '';
    const effectiveKey = resolveApiKey(config.apiKey, config.id);

    if (config.id === 'builtin') {
      return { ok: true, latencyMs: 0 };
    }

    if (config.id === 'siliconflow') {
      try {
        const resp = await fetch(`${targetUrl.replace(/\/$/, '')}/models?type=image`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${effectiveKey}`
          }
        });
        const latencyMs = Date.now() - start;
        if (resp.ok) {
          const data = (await resp.json()) as any;
          const models = (data.data || []).map((m: any) => m.id);
          return { ok: true, latencyMs, models };
        } else {
          const text = await resp.text();
          return { ok: false, latencyMs, error: `HTTP ${resp.status}: ${text.slice(0, 160)}` };
        }
      } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err.message };
      }
    }

    if (config.id === 'google') {
      try {
        const resp = await fetch(`${targetUrl.replace(/\/$/, '')}/models?key=${effectiveKey}`);
        const latencyMs = Date.now() - start;
        if (resp.ok) {
          const data = (await resp.json()) as any;
          const models = (data.models || []).map((m: any) => m.name.replace(/^models\//, ''));
          return { ok: true, latencyMs, models };
        } else {
          const text = await resp.text();
          return { ok: false, latencyMs, error: `Google API 认证错误 (${resp.status}): ${text.slice(0, 160)}` };
        }
      } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err.message };
      }
    }

    if (config.id === 'openai') {
      try {
        const resp = await fetch(`${targetUrl.replace(/\/$/, '')}/models`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${effectiveKey}` }
        });
        const latencyMs = Date.now() - start;
        if (resp.ok) {
          return { ok: true, latencyMs };
        } else {
          const text = await resp.text();
          return { ok: false, latencyMs, error: `HTTP ${resp.status}: ${text.slice(0, 160)}` };
        }
      } catch (err: any) {
        return { ok: false, latencyMs: Date.now() - start, error: err.message };
      }
    }

    return { ok: true, latencyMs: Date.now() - start };
  }
}

export const globalImageModelStore = new ImageProviderStore();
