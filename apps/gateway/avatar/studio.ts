import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  AvatarMood,
  AvatarStyle,
  AvatarSession,
  AvatarFaceMeta,
  AvatarPreset,
  AvatarCostEstimate,
} from '@museclaw/protocol';
import type { BotRegistry } from '../bots/registry.ts';
import { globalModelStore } from '../bots/provider-store.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AVATAR_MOODS: AvatarMood[] = ['idle', 'working', 'waiting', 'happy', 'error'];
export const AVATAR_CANDIDATES = 4;

export const AVATAR_STYLES: Record<AvatarStyle, string> = {
  muse: 'cute 3D character render in the style of a collectible vinyl toy, soft matte materials with subtle sheen, rounded simplified forms, big friendly eyes, soft studio lighting with gentle shadows, pastel accents',
  flat: 'flat vector illustration, soft pastel colours, clean simple shapes, subtle shading',
  clay: '3D clay render, soft studio lighting, matte rounded forms, gentle colours',
  watercolor: 'gentle watercolour painting, soft edges, light paper texture',
  pixel: 'crisp pixel art, limited palette, clean silhouette',
  line: 'minimal line drawing with two accent colours on cream, confident strokes',
  sticker: 'glossy sticker style, thick white outline, bold saturated colours',
};

export const DEFAULT_STYLE: AvatarStyle = 'muse';

const VARIATIONS = [
  'variation 1: the most typical, classic colouring',
  'variation 2: a different breed or colour pattern, lighter tones',
  'variation 3: a different breed or colour pattern, darker or warmer tones, a small accessory such as a scarf or glasses',
  'variation 4: a playful take: unusual colouring or a tiny outfit, slight head tilt',
];

const MOOD_INSTRUCTIONS: Record<Exclude<AvatarMood, 'idle'>, string> = {
  working:
    'It now wears over-ear headphones and sits typing on a small open laptop in front of it, focused and content, a faint glow from the screen on its face.',
  waiting:
    'It now holds a small glowing crystal ball in both hands at chest height and gazes into it with wide curious eyes, waiting for an answer.',
  happy:
    'It is now celebrating, hugging a big glowing yellow five-pointed star, eyes closed with a wide smile. Same white background; no confetti, no night sky, no extra decoration.',
  error:
    'It now looks sheepish and apologetic, a small sweat drop beside its head, one hand behind its head, shoulders slightly raised.',
};

const KEEP_PROMPT =
  'Keep this exact character: same face, colours, outfit, art style, proportions, framing, camera angle and pure white background. Change only the pose and props described. ';

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'dragon',
    name: '小龙 (Dragon)',
    description: '圆滚滚的奶油黄色幼龙，带有小巧的角与展开的翅膀',
    style: 'muse',
    emoji: '🐲',
    moods: {
      idle: '/avatars/dragon-idle.webp',
      working: '/avatars/dragon-working.webp',
      waiting: '/avatars/dragon-waiting.webp',
      happy: '/avatars/dragon-happy.webp',
      error: '/avatars/dragon-error.webp',
    },
    clips: {
      idle: '/avatars/dragon-idle.mp4',
      working: '/avatars/dragon-working.mp4',
      waiting: '/avatars/dragon-waiting.mp4',
      happy: '/avatars/dragon-happy.mp4',
    },
  },
  {
    id: 'haibara',
    name: '小哀 (Haibara)',
    description: '沉静目光与浅蓝针织，兼具智慧与冷静的守护者',
    style: 'muse',
    emoji: '🌸',
    moods: {
      idle: '/avatars/presets/haibara/idle.webp',
      working: '/avatars/presets/haibara/working.webp',
      waiting: '/avatars/presets/haibara/waiting.webp',
      happy: '/avatars/presets/haibara/happy.webp',
      error: '/avatars/presets/haibara/error.webp',
    },
  },
  {
    id: 'moss-courier',
    name: '苔藓邮差 (Moss Courier)',
    description: '绿叶耳朵与布制信件包的森林小小信使',
    style: 'muse',
    emoji: '🍀',
    moods: {
      idle: '/avatars/presets/moss-courier/idle.webp',
      working: '/avatars/presets/moss-courier/working.webp',
      waiting: '/avatars/presets/moss-courier/waiting.webp',
      happy: '/avatars/presets/moss-courier/happy.webp',
      error: '/avatars/presets/moss-courier/error.webp',
    },
  },
  {
    id: 'tide-tinker',
    name: '潮汐工匠 (Tide Tinker)',
    description: '海沫色蝾螈工匠，佩戴珊瑚触角与工具囊',
    style: 'clay',
    emoji: '🫧',
    moods: {
      idle: '/avatars/presets/tide-tinker/idle.webp',
      working: '/avatars/presets/tide-tinker/working.webp',
      waiting: '/avatars/presets/tide-tinker/waiting.webp',
      happy: '/avatars/presets/tide-tinker/happy.webp',
      error: '/avatars/presets/tide-tinker/error.webp',
    },
  },
  {
    id: 'dusk-moth',
    name: '暮光飞蛾 (Dusk Moth)',
    description: '深靛蓝飞蛾学者，配有复古圆眼镜与水彩双翼',
    style: 'watercolor',
    emoji: '🌙',
    moods: {
      idle: '/avatars/presets/dusk-moth/idle.webp',
      working: '/avatars/presets/dusk-moth/working.webp',
      waiting: '/avatars/presets/dusk-moth/waiting.webp',
      happy: '/avatars/presets/dusk-moth/happy.webp',
      error: '/avatars/presets/dusk-moth/error.webp',
    },
  },
  {
    id: 'copper-acorn',
    name: '纯铜橡果 (Copper Acorn)',
    description: '纯铜机械橡果小助手，带有温润齿轮与青灰防风围巾',
    style: 'line',
    emoji: '🦊',
    moods: {
      idle: '/avatars/presets/copper-acorn/idle.webp',
      working: '/avatars/presets/copper-acorn/working.webp',
      waiting: '/avatars/presets/copper-acorn/waiting.webp',
      happy: '/avatars/presets/copper-acorn/happy.webp',
      error: '/avatars/presets/copper-acorn/error.webp',
    },
  },
];

export class AvatarStudio {
  private dataDir: string;
  private customDir: string;
  private sessionsDir: string;
  private currentSession: AvatarSession | null = null;
  private listeners: Array<(session: AvatarSession) => void> = [];
  private botRegistry: BotRegistry;

  constructor(botRegistry: BotRegistry, baseDir?: string) {
    this.botRegistry = botRegistry;
    this.dataDir = baseDir || path.resolve(__dirname, '../data/avatars');
    this.customDir = path.join(this.dataDir, 'custom');
    this.sessionsDir = path.join(this.dataDir, 'sessions');

    this.ensureDirs();
  }

  private ensureDirs() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.customDir)) fs.mkdirSync(this.customDir, { recursive: true });
    if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  public subscribe(cb: (session: AvatarSession) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    if (this.currentSession) {
      for (const listener of this.listeners) {
        try {
          listener(this.currentSession);
        } catch (e) {
          console.error('[AvatarStudio] Listener notification failed:', e);
        }
      }
    }
  }

  public getCurrentSession(): AvatarSession | null {
    return this.currentSession;
  }

  public getPresets(): AvatarPreset[] {
    return AVATAR_PRESETS;
  }

  /**
   * 检查当前系统可用于图像生成的模型与环境状态
   */
  public getImageEndpointConfig(): {
    available: boolean;
    provider: string;
    model: string;
    videoModel: string;
    apiKey: string;
    baseUrl: string;
  } {
    const qwenProv = globalModelStore?.getProviderConfig?.('qwen');
    const openAiProv = globalModelStore?.getProviderConfig?.('openai');
    const siliconProv = globalModelStore?.getProviderConfig?.('siliconflow');
    const googleProv = globalModelStore?.getProviderConfig?.('google');

    const envDashscopeKey = process.env.DASHSCOPE_API_KEY || qwenProv?.apiKey || '';
    const envSiliconKey = process.env.SILICONFLOW_API_KEY || siliconProv?.apiKey || '';
    const envOpenAiKey = process.env.OPENAI_API_KEY || openAiProv?.apiKey || '';
    const envGoogleKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || googleProv?.apiKey || '';

    if (envGoogleKey) {
      return {
        available: true,
        provider: 'google',
        model: googleProv?.model || 'imagen-3.0-generate-002',
        videoModel: '',
        apiKey: envGoogleKey,
        baseUrl: googleProv?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta',
      };
    }

    if (envDashscopeKey) {
      return {
        available: true,
        provider: 'dashscope',
        model: 'qwen-image-3.0',
        videoModel: 'wan2.2-i2v-flash',
        apiKey: envDashscopeKey,
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      };
    }

    if (envSiliconKey) {
      return {
        available: true,
        provider: 'siliconflow',
        model: 'black-forest-labs/FLUX.1-schnell',
        videoModel: '',
        apiKey: envSiliconKey,
        baseUrl: 'https://api.siliconflow.cn/v1',
      };
    }

    if (envOpenAiKey) {
      return {
        available: true,
        provider: 'openai',
        model: 'dall-e-3',
        videoModel: '',
        apiKey: envOpenAiKey,
        baseUrl: 'https://api.openai.com/v1',
      };
    }

    // 默认内置生成器始终可用
    return {
      available: true,
      provider: 'builtin-procedural',
      model: 'museclaw-avatar-v1',
      videoModel: '',
      apiKey: '',
      baseUrl: 'local://builtin',
    };
  }

  /**
   * 获取某 Bot 当前佩戴的形象元数据
   */
  public getFaceInfo(botId?: string): AvatarFaceMeta | null {
    const bot = botId ? this.botRegistry.get(botId) : this.botRegistry.getCoordinator();
    const faceId = bot?.avatar || 'haibara';

    // 预设形象
    const preset = AVATAR_PRESETS.find((p) => p.id === faceId);
    if (preset) {
      return {
        id: preset.id,
        botId: bot?.id,
        description: preset.description,
        style: preset.style,
        model: 'preset',
        created: 0,
        moods: preset.moods,
        clips: preset.clips,
      };
    }

    // 自定义形象
    const metaPath = path.join(this.customDir, faceId, 'face.json');
    if (fs.existsSync(metaPath)) {
      try {
        const raw = fs.readFileSync(metaPath, 'utf-8');
        return JSON.parse(raw);
      } catch (err) {
        console.warn(`[AvatarStudio] 读取 face.json 失败: ${err}`);
      }
    }

    return null;
  }

  /**
   * 启动形象创建会话 (估算阶段)
   */
  public async begin(params: {
    description: string;
    style?: string;
    thread?: string;
    botId?: string;
    reference?: string;
  }): Promise<AvatarSession> {
    const styleKey = (params.style || DEFAULT_STYLE) in AVATAR_STYLES ? (params.style as AvatarStyle) : DEFAULT_STYLE;
    const ep = this.getImageEndpointConfig();
    const sid = `sess_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const sessionDir = path.join(this.sessionsDir, sid);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const session: AvatarSession = {
      id: sid,
      thread: params.thread || 'main',
      botId: params.botId || this.botRegistry.getCoordinator()?.id || 'muse',
      stage: 'estimate',
      description: params.description.trim(),
      style: styleKey,
      reference: params.reference || '',
      cost: {
        pictures: AVATAR_CANDIDATES + 4, // 4 候选图 + 4 姿态图
        clips: ep.videoModel ? 4 : 0,
        model: ep.model,
        clip_model: ep.videoModel,
        cloud: ep.provider !== 'builtin-procedural',
      },
      candidates: [null, null, null, null],
      errors: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.currentSession = session;
    this.notify();
    return session;
  }

  /**
   * 确认绘制：开始生成 4 张候选图
   */
  public async start(sessionId: string): Promise<AvatarSession> {
    if (!this.currentSession || this.currentSession.id !== sessionId) {
      throw new Error('当前会话不存在或已失效');
    }

    const session = this.currentSession;
    session.stage = 'drawing';
    session.candidates = [null, null, null, null];
    session.errors = [];
    session.chosen = null;
    session.updatedAt = Date.now();
    this.notify();

    // 异步生成 4 个候选
    this.generateCandidatesAsync(session);
    return session;
  }

  /**
   * 重新生成当前会话的 4 张候选图
   */
  public async regenerate(sessionId: string): Promise<AvatarSession> {
    return this.start(sessionId);
  }

  /**
   * 异步绘制 4 个候选图
   */
  private async generateCandidatesAsync(session: AvatarSession) {
    const ep = this.getImageEndpointConfig();
    const sessionDir = path.join(this.sessionsDir, session.id);

    const tasks = Array.from({ length: AVATAR_CANDIDATES }).map(async (_, index) => {
      try {
        const prompt = this.buildPrompt(session.description, index, session.style);
        const imgBuffer = await this.renderImage(ep, prompt, session.reference, index);

        const filename = `c${index}.webp`;
        const filepath = path.join(sessionDir, filename);
        fs.writeFileSync(filepath, imgBuffer);

        session.candidates[index] = `/avatars/sessions/${session.id}/${filename}`;
        session.updatedAt = Date.now();
        this.notify();
      } catch (err: any) {
        console.error(`[AvatarStudio] 生成候选图 ${index} 失败:`, err);
        session.errors = session.errors || [];
        session.errors.push(`候选图 ${index + 1}: ${err.message || err}`);
        this.notify();
      }
    });

    await Promise.allSettled(tasks);

    if (session.candidates.some((c) => c !== null)) {
      session.stage = 'choose';
    } else {
      session.stage = 'failed';
      session.message = session.errors?.[0] || '未能成功生成候选形象图片';
    }
    session.updatedAt = Date.now();
    this.notify();
  }

  /**
   * 选定一个候选，并由此生成 5 种心情状态的全套姿态图
   */
  public async choose(sessionId: string, index: number, targetBotId?: string): Promise<AvatarSession> {
    if (!this.currentSession || this.currentSession.id !== sessionId) {
      throw new Error('当前会话不存在或已失效');
    }

    const session = this.currentSession;
    if (session.stage !== 'choose') {
      return session;
    }

    if (index < 0 || index >= AVATAR_CANDIDATES || !session.candidates[index]) {
      throw new Error(`候选索引 ${index} 不存在`);
    }

    session.chosen = index;
    session.stage = 'posing';
    session.errors = [];
    const faceId = `face_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    session.face = faceId;
    session.moods = {};
    session.clips = {};
    session.updatedAt = Date.now();
    this.notify();

    // 异步生成全套姿态
    this.generateMoodPosesAsync(session, index, targetBotId);
    return session;
  }

  /**
   * 异步生成 5 种姿态图 (idle, working, waiting, happy, error)
   */
  private async generateMoodPosesAsync(session: AvatarSession, chosenIndex: number, targetBotId?: string) {
    const faceId = session.face!;
    const faceDir = path.join(this.customDir, faceId);
    if (!fs.existsSync(faceDir)) fs.mkdirSync(faceDir, { recursive: true });

    try {
      const ep = this.getImageEndpointConfig();
      const chosenRelUrl = session.candidates[chosenIndex]!;
      // 将所选候选图作为 idle 姿态
      const chosenFileName = path.basename(chosenRelUrl);
      const chosenPath = path.join(this.sessionsDir, session.id, chosenFileName);

      const idleDest = path.join(faceDir, 'idle.webp');
      if (fs.existsSync(chosenPath)) {
        fs.copyFileSync(chosenPath, idleDest);
      } else {
        // 回退生成
        const baseBuffer = await this.renderImage(ep, session.description, '', chosenIndex);
        fs.writeFileSync(idleDest, baseBuffer);
      }

      session.moods = session.moods || {};
      session.moods.idle = `/avatars/custom/${faceId}/idle.webp`;
      this.notify();

      // 依次为 working, waiting, happy, error 生成对应姿态
      const otherMoods: Array<Exclude<AvatarMood, 'idle'>> = ['working', 'waiting', 'happy', 'error'];

      for (const mood of otherMoods) {
        try {
          const moodInstruction = MOOD_INSTRUCTIONS[mood];
          const moodPrompt = `${KEEP_PROMPT} Character: ${session.description}. ${moodInstruction}`;
          const moodBuffer = await this.renderMoodImage(ep, moodPrompt, idleDest, mood, session.style, chosenIndex);

          const moodDest = path.join(faceDir, `${mood}.webp`);
          fs.writeFileSync(moodDest, moodBuffer);
          session.moods[mood] = `/avatars/custom/${faceId}/${mood}.webp`;
        } catch (err: any) {
          console.warn(`[AvatarStudio] 生成姿态 ${mood} 出错，回退复用 idle 姿态:`, err);
          // 回退复制 idle 姿态，保证 5 个情绪切图永远不留白
          fs.copyFileSync(idleDest, path.join(faceDir, `${mood}.webp`));
          session.moods[mood] = `/avatars/custom/${faceId}/${mood}.webp`;
        }
        session.updatedAt = Date.now();
        this.notify();
      }

      // 保存 face.json 元数据
      const meta: AvatarFaceMeta = {
        id: faceId,
        botId: targetBotId || session.botId,
        description: session.description,
        style: session.style,
        model: ep.model,
        clip_model: ep.videoModel,
        created: Date.now(),
        moods: session.moods,
      };
      fs.writeFileSync(path.join(faceDir, 'face.json'), JSON.stringify(meta, null, 2), 'utf-8');

      // 更新目标 Bot 的 avatar 为该 faceId
      const finalBotId = targetBotId || session.botId || 'muse';
      const bot = this.botRegistry.get(finalBotId);
      if (bot) {
        bot.avatar = faceId;
        (bot as any).avatarType = 'custom';
        this.botRegistry.save();
      }

      session.stage = 'done';
      session.message = `新形象已成功生成并装配至智能体「${bot?.name || finalBotId}」！`;
      session.updatedAt = Date.now();
      this.notify();
    } catch (err: any) {
      console.error('[AvatarStudio] 姿态生成流程异常:', err);
      session.stage = 'failed';
      session.message = `生成姿态失败: ${err.message || err}`;
      session.updatedAt = Date.now();
      this.notify();
    }
  }

  /**
   * 为当前所佩戴的形象重新生成 4 种情绪姿态
   */
  public async redrawMoods(botId?: string): Promise<AvatarSession> {
    const finalBotId = botId || this.botRegistry.getCoordinator()?.id || 'muse';
    const faceInfo = this.getFaceInfo(finalBotId);

    if (!faceInfo || faceInfo.model === 'preset') {
      throw new Error('预设形象不支持在线重绘，请使用 AI 创作新形象');
    }

    const sid = `sess_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const session: AvatarSession = {
      id: sid,
      thread: 'main',
      botId: finalBotId,
      stage: 'posing',
      description: faceInfo.description,
      style: faceInfo.style,
      candidates: [faceInfo.moods?.idle || null, null, null, null],
      chosen: 0,
      face: faceInfo.id,
      moods: { idle: faceInfo.moods?.idle },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.currentSession = session;
    this.notify();

    this.generateMoodPosesAsync(session, 0, finalBotId);
    return session;
  }

  /**
   * 取消形象创建会话
   */
  public cancel(sessionId: string): AvatarSession {
    if (this.currentSession && this.currentSession.id === sessionId) {
      this.currentSession.stage = 'cancelled';
      this.currentSession.message = '已取消当前形象创建';
      this.currentSession.updatedAt = Date.now();
      this.notify();
      return this.currentSession;
    }
    throw new Error('指定会话不存在');
  }

  /**
   * 构建绘制候选图的标准 Prompt
   */
  public buildPrompt(description: string, index: number, styleKey: string): string {
    const cleanDesc = description.trim().replace(/[。.!！,，]+$/, '');
    const styleDesc = AVATAR_STYLES[styleKey as AvatarStyle] || AVATAR_STYLES.muse;
    const variationDesc = VARIATIONS[index % AVATAR_CANDIDATES];

    return (
      `A cute character based on: ${cleanDesc}. ${styleDesc}. Full body, standing, facing the viewer, ` +
      `centred, whole figure visible with margin on all sides, big head and small body, friendly expression, ` +
      `pure white background, soft ground shadow only. ${variationDesc}. ` +
      `Square composition. No text, no watermark, no border, no props other than what is described, one character only.`
    );
  }

  /**
   * 核心图像渲染管道：优先调用配置的远程模型接口，离线或无 Key 时调用高保真内置生成器
   */
  private async renderImage(
    ep: ReturnType<typeof this.getImageEndpointConfig>,
    prompt: string,
    referencePath: string,
    index: number
  ): Promise<Buffer> {
    if (ep.provider === 'google' && ep.apiKey) {
      try {
        const model = ep.model || 'imagen-3.0-generate-002';
        const url = `${ep.baseUrl}/models/${model}:predict?key=${ep.apiKey}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': ep.apiKey,
          },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: '1:1',
              outputMimeType: 'image/jpeg',
            },
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as any;
          const b64 = data.predictions?.[0]?.bytesBase64Encoded;
          if (b64) return Buffer.from(b64, 'base64');
        } else {
          const errText = await resp.text();
          console.warn(`[AvatarStudio] Google Imagen 3 接口响应异常 (${resp.status}):`, errText);
        }
      } catch (e) {
        console.warn('[AvatarStudio] Google Imagen 3 图像接口调用失败，降级至内置生成器:', e);
      }
    }

    if ((ep.provider === 'openai' || ep.provider === 'siliconflow') && ep.apiKey) {
      try {
        const resp = await fetch(`${ep.baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ep.apiKey}`,
          },
          body: JSON.stringify({
            model: ep.model || (ep.provider === 'siliconflow' ? 'black-forest-labs/FLUX.1-schnell' : 'dall-e-3'),
            prompt,
            ...(ep.provider === 'siliconflow'
              ? { image_size: '1024x1024', batch_size: 1 }
              : { n: 1, size: '1024x1024', response_format: 'b64_json' }),
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as any;
          const b64 = data.data?.[0]?.b64_json;
          if (b64) return Buffer.from(b64, 'base64');
          const url = data.data?.[0]?.url;
          if (url) {
            const imgRes = await fetch(url);
            return Buffer.from(await imgRes.arrayBuffer());
          }
        }
      } catch (e) {
        console.warn(`[AvatarStudio] ${ep.provider} 图像接口调用失败，降级至内置生成器:`, e);
      }
    }

    if (ep.provider === 'dashscope' && ep.apiKey) {
      try {
        const resp = await fetch(`${ep.baseUrl}/services/aigc/text2image/image-synthesis`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ep.apiKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify({
            model: ep.model || 'qwen-image-3.0',
            input: { prompt },
            parameters: { size: '1024*1024', n: 1 },
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as any;
          const outputUrl = data.output?.results?.[0]?.url;
          if (outputUrl) {
            const imgRes = await fetch(outputUrl);
            return Buffer.from(await imgRes.arrayBuffer());
          }
        }
      } catch (e) {
        console.warn('[AvatarStudio] DashScope 图像接口调用失败，降级至内置生成器:', e);
      }
    }

    // 内置高保真风格化角色生成器（输出精美的 WebP/SVG 矢量渲染流）
    return this.generateProceduralAvatar(prompt, 'idle', index);
  }

  /**
   * 姿态图生成管道：针对情绪特有道具与动作进行个性化渲染
   */
  private async renderMoodImage(
    ep: ReturnType<typeof this.getImageEndpointConfig>,
    prompt: string,
    baseIdlePath: string,
    mood: Exclude<AvatarMood, 'idle'>,
    style: string,
    variantIndex = 0
  ): Promise<Buffer> {
    if (
      (ep.provider === 'google' || ep.provider === 'openai' || ep.provider === 'siliconflow' || ep.provider === 'dashscope') &&
      ep.apiKey
    ) {
      try {
        const buf = await this.renderImage(ep, prompt, baseIdlePath, variantIndex);
        if (buf && buf.length > 0) return buf;
      } catch (e) {
        console.warn(`[AvatarStudio] 姿态 ${mood} 远程生成失败，回退内置:`, e);
      }
    }

    return this.generateProceduralAvatar(prompt, mood, variantIndex);
  }

  /**
   * 内置风格化矢量/WebP 形象生成器
   * 依据提示词与情绪（idle, working, waiting, happy, error）动态渲染具备鲜明角色特征的专属形象
   */
  private generateProceduralAvatar(prompt: string, mood: AvatarMood, variantIndex: number): Buffer {
    const lowerPrompt = (prompt || '').toLowerCase();

    // 意图与角色物种嗅探
    const isDog = /(犬|狗|柴犬|柯基|金毛|哈士奇|dog|puppy|shiba|corgi)/i.test(lowerPrompt);
    const isCat = /(猫|猫咪|波斯猫|小猫|cat|kitten)/i.test(lowerPrompt);
    const isRabbit = /(兔|兔子|兔兔|rabbit|bunny)/i.test(lowerPrompt);
    const isRobot = /(机甲|机器人|赛博|机械|智能体|robot|cyber|mech)/i.test(lowerPrompt);

    // 配件嗅探 (围巾、眼镜、护目镜、帽子等)
    const hasScarf = /(围巾|格子|红蓝格子|领巾|领结|scarf|tie)/i.test(lowerPrompt);
    const hasGoggles = /(护目镜|眼镜|墨镜|霓虹护目镜|goggles|glasses)/i.test(lowerPrompt);
    const hasHat = /(帽|巫师帽|帽子|hat|cap)/i.test(lowerPrompt);

    // 依据描述意图与变体索引动态提取色板
    let palette: { primary: string; secondary: string; accent: string; highlight: string };

    if (isDog) {
      // 柴犬与小狗的 4 款经典变体色
      const dogColors = [
        { primary: '#E67E22', secondary: '#FAD7A0', accent: '#D35400', highlight: '#FFF5E1' }, // 经典赤柴
        { primary: '#2C3E50', secondary: '#F39C12', accent: '#E74C3C', highlight: '#FDFEFE' }, // 经典黑柴
        { primary: '#F5B041', secondary: '#FEF9E7', accent: '#E67E22', highlight: '#FFFFFF' }, // 奶油黄白柴
        { primary: '#7F8C8D', secondary: '#F4D03F', accent: '#34495E', highlight: '#EAEDED' }, // 胡麻柴
      ];
      palette = dogColors[variantIndex % dogColors.length];
    } else if (isCat) {
      // 猫咪 4 款变体色
      const catColors = [
        { primary: '#E67E22', secondary: '#FAD7A0', accent: '#FF7675', highlight: '#FFF9E6' }, // 橘猫
        { primary: '#2C3E50', secondary: '#BDC3C7', accent: '#3498DB', highlight: '#FFFFFF' }, // 蓝猫/奶牛猫
        { primary: '#F39C12', secondary: '#2C3E50', accent: '#E74C3C', highlight: '#FFFFFF' }, // 三花
        { primary: '#BDC3C7', secondary: '#ECF0F1', accent: '#FF7675', highlight: '#FFFFFF' }, // 银渐层
      ];
      palette = catColors[variantIndex % catColors.length];
    } else if (isRobot) {
      // 赛博朋克 4 款变体色
      const robotColors = [
        { primary: '#2C3E50', secondary: '#00CEC9', accent: '#FD79A8', highlight: '#81ECEC' }, // 霓虹黑曜
        { primary: '#6C5CE7', secondary: '#A29BFE', accent: '#00B894', highlight: '#DFE6E9' }, // 赛博紫
        { primary: '#0984E3', secondary: '#74B9FF', accent: '#F1C40F', highlight: '#FFFFFF' }, // 钛金属蓝
        { primary: '#636E72', secondary: '#FFEAA7', accent: '#E17055', highlight: '#F5F6FA' }, // 工业灰
      ];
      palette = robotColors[variantIndex % robotColors.length];
    } else {
      // 潮玩默认 4 款变体色
      const defaultColors = [
        { primary: '#FF6B6B', secondary: '#FFE66D', accent: '#4ECDC4', highlight: '#FFFFFF' },
        { primary: '#4D96FF', secondary: '#6BCB77', accent: '#FFD93D', highlight: '#FFFFFF' },
        { primary: '#9B51E0', secondary: '#F2994A', accent: '#2D9CDB', highlight: '#FFFFFF' },
        { primary: '#F7B731', secondary: '#55E6C1', accent: '#FC5C65', highlight: '#FFFFFF' },
      ];
      palette = defaultColors[variantIndex % defaultColors.length];
    }

    // 耳朵/角矢量造型
    let earsSvg = '';
    if (isDog) {
      earsSvg = `
        <!-- 柴犬萌萌三角耳朵 (带浅色耳绒) -->
        <polygon points="156,175 186,102 216,160" fill="${palette.primary}"/>
        <polygon points="166,166 186,118 206,156" fill="${palette.secondary}"/>
        <polygon points="356,175 326,102 296,160" fill="${palette.primary}"/>
        <polygon points="346,166 326,118 306,156" fill="${palette.secondary}"/>
      `;
    } else if (isCat) {
      earsSvg = `
        <!-- 猫咪尖尖耳朵 -->
        <polygon points="165,170 185,110 220,155" fill="${palette.primary}"/>
        <polygon points="172,165 185,122 210,155" fill="#FFB8B8"/>
        <polygon points="347,170 327,110 292,155" fill="${palette.primary}"/>
        <polygon points="340,165 327,122 302,155" fill="#FFB8B8"/>
      `;
    } else if (isRabbit) {
      earsSvg = `
        <!-- 长长兔耳朵 -->
        <ellipse cx="205" cy="115" rx="18" ry="50" transform="rotate(-8 205 115)" fill="${palette.primary}"/>
        <ellipse cx="205" cy="115" rx="10" ry="36" transform="rotate(-8 205 115)" fill="#FFB8B8"/>
        <ellipse cx="307" cy="115" rx="18" ry="50" transform="rotate(8 307 115)" fill="${palette.primary}"/>
        <ellipse cx="307" cy="115" rx="10" ry="36" transform="rotate(8 307 115)" fill="#FFB8B8"/>
      `;
    } else if (isRobot) {
      earsSvg = `
        <!-- 赛博天线与传感器 -->
        <line x1="190" y1="160" x2="160" y2="105" stroke="${palette.primary}" stroke-width="8" stroke-linecap="round"/>
        <circle cx="160" cy="105" r="14" fill="${palette.accent}"/>
        <circle cx="160" cy="105" r="7" fill="#FFFFFF"/>
        <line x1="322" y1="160" x2="352" y2="105" stroke="${palette.primary}" stroke-width="8" stroke-linecap="round"/>
        <circle cx="352" cy="105" r="14" fill="${palette.accent}"/>
        <circle cx="352" cy="105" r="7" fill="#FFFFFF"/>
      `;
    } else {
      earsSvg = `
        <!-- 潮玩圆润萌宠小耳朵 -->
        <ellipse cx="178" cy="148" rx="22" ry="32" transform="rotate(-20 178 148)" fill="${palette.accent}"/>
        <ellipse cx="178" cy="148" rx="12" ry="20" transform="rotate(-20 178 148)" fill="#FFFFFF" opacity="0.4"/>
        <ellipse cx="334" cy="148" rx="22" ry="32" transform="rotate(20 334 148)" fill="${palette.accent}"/>
        <ellipse cx="334" cy="148" rx="12" ry="20" transform="rotate(20 334 148)" fill="#FFFFFF" opacity="0.4"/>
      `;
    }

    // 口鼻腮肉面部特征
    let faceDetailsSvg = '';
    if (isDog) {
      faceDetailsSvg = `
        <!-- 柴犬浅色脸颊腮肉与口鼻区 -->
        <ellipse cx="256" cy="254" rx="46" ry="32" fill="${palette.highlight}"/>
        <ellipse cx="196" cy="242" rx="20" ry="16" fill="${palette.highlight}" opacity="0.8"/>
        <ellipse cx="316" cy="242" rx="20" ry="16" fill="${palette.highlight}" opacity="0.8"/>
        <!-- 经典柴犬浅色小圆眉毛 (麻薯眉) -->
        <ellipse cx="214" cy="196" rx="9" ry="6" fill="${palette.secondary}"/>
        <ellipse cx="298" cy="196" rx="9" ry="6" fill="${palette.secondary}"/>
        <!-- 小狗黑色圆润鼻头 -->
        <path d="M 248 238 Q 256 235 264 238 Q 268 245 256 250 Q 244 245 248 238 Z" fill="#2C3E50"/>
        <ellipse cx="254" cy="239" rx="3" ry="1.5" fill="#FFFFFF" opacity="0.7"/>
        <!-- 萌萌小狗嘴巴 -->
        <path d="M 248 254 Q 252 258 256 254 Q 260 258 264 254" stroke="#2C3E50" stroke-width="3" stroke-linecap="round" fill="none"/>
      `;
    } else if (isCat) {
      faceDetailsSvg = `
        <!-- 猫咪胡须 -->
        <line x1="160" y1="245" x2="195" y2="248" stroke="#7F8C8D" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="160" y1="256" x2="195" y2="254" stroke="#7F8C8D" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="352" y1="245" x2="317" y2="248" stroke="#7F8C8D" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="352" y1="256" x2="317" y2="254" stroke="#7F8C8D" stroke-width="2.5" stroke-linecap="round"/>
        <!-- 小巧粉色猫鼻 -->
        <polygon points="252,242 260,242 256,247" fill="#FF7675"/>
      `;
    }

    // 配件 (围巾、眼镜、帽子等)
    let accessorySvg = '';
    if (hasScarf) {
      accessorySvg = `
        <!-- 红蓝格子保暖围巾 -->
        <g id="plaidScarf">
          <!-- 围巾主体项圈 -->
          <path d="M 195 288 Q 256 312 317 288 Q 325 310 312 320 Q 256 338 200 320 Z" fill="#C0392B"/>
          <!-- 格子横向条纹 -->
          <path d="M 197 296 Q 256 318 315 296" stroke="#2980B9" stroke-width="4.5" fill="none" opacity="0.85"/>
          <path d="M 199 306 Q 256 326 313 306" stroke="#F1C40F" stroke-width="2" fill="none" opacity="0.75"/>
          <!-- 格子纵向条纹 -->
          <line x1="225" y1="294" x2="223" y2="322" stroke="#2980B9" stroke-width="4" opacity="0.85"/>
          <line x1="256" y1="300" x2="256" y2="330" stroke="#2980B9" stroke-width="4" opacity="0.85"/>
          <line x1="287" y1="294" x2="289" y2="322" stroke="#2980B9" stroke-width="4" opacity="0.85"/>
          <!-- 飘逸垂坠的围巾尾部与流苏 -->
          <polygon points="282,312 308,312 316,368 288,370" fill="#C0392B"/>
          <line x1="285" y1="330" x2="312" y2="330" stroke="#2980B9" stroke-width="4" opacity="0.85"/>
          <line x1="287" y1="350" x2="314" y2="350" stroke="#2980B9" stroke-width="4" opacity="0.85"/>
          <line x1="298" y1="312" x2="302" y2="368" stroke="#F1C40F" stroke-width="2.5" opacity="0.75"/>
          <!-- 流苏穗子 -->
          <line x1="290" y1="370" x2="290" y2="378" stroke="#F1C40F" stroke-width="2"/>
          <line x1="296" y1="370" x2="296" y2="378" stroke="#F1C40F" stroke-width="2"/>
          <line x1="302" y1="370" x2="302" y2="378" stroke="#F1C40F" stroke-width="2"/>
          <line x1="308" y1="370" x2="308" y2="378" stroke="#F1C40F" stroke-width="2"/>
          <line x1="314" y1="368" x2="314" y2="376" stroke="#F1C40F" stroke-width="2"/>
        </g>
      `;
    }

    if (hasGoggles) {
      accessorySvg += `
        <!-- 赛博霓虹护目镜 -->
        <rect x="180" y="196" width="152" height="42" rx="18" fill="#1E272E" stroke="${palette.secondary}" stroke-width="3"/>
        <rect x="186" y="202" width="65" height="30" rx="12" fill="${palette.secondary}" opacity="0.6"/>
        <rect x="261" y="202" width="65" height="30" rx="12" fill="${palette.secondary}" opacity="0.6"/>
        <line x1="192" y1="210" x2="242" y2="210" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>
        <line x1="267" y1="210" x2="317" y2="210" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>
      `;
    }

    if (hasHat) {
      accessorySvg += `
        <!-- 俏皮小巫师帽 -->
        <polygon points="256,90 220,150 292,150" fill="#2C3A47"/>
        <ellipse cx="256" cy="150" rx="44" ry="12" fill="#3B3B98"/>
        <polygon points="256,140 262,148 250,148" fill="#F1C40F"/>
      `;
    }

    // 情绪道具与神态
    let moodAddon = '';
    let eyesSvg = '';
    let mouthSvg = '';

    switch (mood) {
      case 'working':
        moodAddon = `
          <!-- 耳机 -->
          <path d="M 160 220 A 100 100 0 0 1 352 220" fill="none" stroke="#2C3A47" stroke-width="18" stroke-linecap="round"/>
          <rect x="142" y="190" width="28" height="50" rx="14" fill="#3B3B98"/>
          <rect x="342" y="190" width="28" height="50" rx="14" fill="#3B3B98"/>
          <!-- 笔记本电脑 -->
          <rect x="190" y="340" width="132" height="74" rx="8" fill="#57606F"/>
          <rect x="198" y="346" width="116" height="60" rx="4" fill="#ECCC68" opacity="0.9"/>
          <!-- 键盘底座 -->
          <polygon points="170,414 342,414 360,432 152,432" fill="#2F3542"/>
          <!-- 荧光光晕 -->
          <ellipse cx="256" cy="370" rx="60" ry="25" fill="#FFFFFF" opacity="0.3" filter="blur(6px)"/>
        `;
        eyesSvg = `
          <ellipse cx="216" cy="226" rx="9" ry="12" fill="#2F3542"/>
          <ellipse cx="296" cy="226" rx="9" ry="12" fill="#2F3542"/>
          <circle cx="219" cy="222" r="3.5" fill="#FFFFFF"/>
          <circle cx="299" cy="222" r="3.5" fill="#FFFFFF"/>
        `;
        mouthSvg = `<path d="M 246 252 Q 256 256 266 252" stroke="#2F3542" stroke-width="4" stroke-linecap="round" fill="none"/>`;
        break;

      case 'waiting':
        moodAddon = `
          <!-- 发光魔法水晶球 -->
          <circle cx="256" cy="350" r="42" fill="url(#crystalGrad)" opacity="0.85"/>
          <circle cx="256" cy="350" r="38" fill="none" stroke="#FFFFFF" stroke-width="2" opacity="0.6"/>
          <circle cx="244" cy="338" r="10" fill="#FFFFFF" opacity="0.75" filter="blur(2px)"/>
          <path d="M 230 350 Q 256 320 282 350" stroke="#FFEAA7" stroke-width="2.5" fill="none" opacity="0.8"/>
          <!-- 双手捧球 -->
          <circle cx="206" cy="354" r="16" fill="${palette.primary}"/>
          <circle cx="306" cy="354" r="16" fill="${palette.primary}"/>
        `;
        eyesSvg = `
          <ellipse cx="212" cy="222" rx="14" ry="18" fill="#2F3542"/>
          <ellipse cx="300" cy="222" rx="14" ry="18" fill="#2F3542"/>
          <circle cx="216" cy="216" r="6" fill="#FFFFFF"/>
          <circle cx="304" cy="216" r="6" fill="#FFFFFF"/>
          <circle cx="208" cy="228" r="2.5" fill="#FFFFFF"/>
          <circle cx="296" cy="228" r="2.5" fill="#FFFFFF"/>
        `;
        mouthSvg = `<ellipse cx="256" cy="256" rx="7" ry="9" fill="#2F3542"/>`;
        break;

      case 'happy':
        moodAddon = `
          <!-- 怀抱闪耀大金星 -->
          <polygon points="256,300 270,332 305,334 278,356 287,390 256,370 225,390 234,356 207,334 242,332" fill="#FEE140" stroke="#FFA502" stroke-width="3"/>
          <circle cx="256" cy="346" r="14" fill="#FFFFFF" opacity="0.4" filter="blur(4px)"/>
          <!-- 开心小手臂环抱 -->
          <path d="M 194 340 Q 215 365 240 355" stroke="${palette.primary}" stroke-width="22" stroke-linecap="round" fill="none"/>
          <path d="M 318 340 Q 297 365 272 355" stroke="${palette.primary}" stroke-width="22" stroke-linecap="round" fill="none"/>
        `;
        eyesSvg = `
          <!-- 弯弯开怀笑眼 -->
          <path d="M 204 226 Q 216 210 228 226" stroke="#2F3542" stroke-width="5" stroke-linecap="round" fill="none"/>
          <path d="M 284 226 Q 296 210 308 226" stroke="#2F3542" stroke-width="5" stroke-linecap="round" fill="none"/>
          <!-- 粉扑扑腮红 -->
          <ellipse cx="196" cy="238" rx="14" ry="8" fill="#FF7675" opacity="0.6"/>
          <ellipse cx="316" cy="238" rx="14" ry="8" fill="#FF7675" opacity="0.6"/>
        `;
        mouthSvg = `
          <path d="M 240 248 Q 256 270 272 248 Z" fill="#E74C3C"/>
          <path d="M 246 256 Q 256 264 266 256" fill="#FF7675"/>
        `;
        break;

      case 'error':
        moodAddon = `
          <!-- 额头大冷汗水滴 -->
          <path d="M 326 170 Q 320 185 320 192 A 8 8 0 1 0 336 192 Q 336 185 326 170 Z" fill="#74B9FF" stroke="#0984E3" stroke-width="1.5"/>
          <!-- 一只手挠后脑勺 -->
          <path d="M 314 310 Q 346 270 330 220" stroke="${palette.primary}" stroke-width="20" stroke-linecap="round" fill="none"/>
        `;
        eyesSvg = `
          <!-- 窘迫圈圈眼/豆豆眼 -->
          <line x1="208" y1="220" x2="224" y2="230" stroke="#2F3542" stroke-width="4.5" stroke-linecap="round"/>
          <line x1="224" y1="220" x2="208" y2="230" stroke="#2F3542" stroke-width="4.5" stroke-linecap="round"/>
          <circle cx="296" cy="225" r="9" fill="#2F3542"/>
          <circle cx="298" cy="223" r="3" fill="#FFFFFF"/>
        `;
        mouthSvg = `<path d="M 242 260 Q 252 252 262 262 Q 272 252 276 260" stroke="#2F3542" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
        break;

      case 'idle':
      default:
        eyesSvg = `
          <ellipse cx="214" cy="224" rx="11" ry="15" fill="#2F3542"/>
          <ellipse cx="298" cy="224" rx="11" ry="15" fill="#2F3542"/>
          <circle cx="218" cy="218" r="4.5" fill="#FFFFFF"/>
          <circle cx="302" cy="218" r="4.5" fill="#FFFFFF"/>
          <circle cx="211" cy="228" r="2" fill="#FFFFFF"/>
          <circle cx="295" cy="228" r="2" fill="#FFFFFF"/>
          <ellipse cx="196" cy="240" rx="12" ry="6" fill="#FFB8B8" opacity="0.4"/>
          <ellipse cx="316" cy="240" rx="12" ry="6" fill="#FFB8B8" opacity="0.4"/>
        `;
        mouthSvg = !isDog ? `<path d="M 246 250 Q 256 258 266 250" stroke="#2F3542" stroke-width="4" stroke-linecap="round" fill="none"/>` : '';
        break;
    }

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
        <defs>
          <radialGradient id="bodyGrad" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.5"/>
            <stop offset="40%" stop-color="${palette.primary}"/>
            <stop offset="100%" stop-color="${palette.secondary}"/>
          </radialGradient>
          <radialGradient id="headGrad" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.6"/>
            <stop offset="50%" stop-color="${palette.primary}"/>
            <stop offset="100%" stop-color="${palette.accent}"/>
          </radialGradient>
          <radialGradient id="crystalGrad" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#E0F7FA"/>
            <stop offset="60%" stop-color="#26C6DA"/>
            <stop offset="100%" stop-color="#00838F"/>
          </radialGradient>
          <radialGradient id="shadowGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          </radialGradient>
        </defs>

        <!-- 摄影棚白底与阴影 -->
        <rect width="512" height="512" fill="#FAF9F6"/>
        <ellipse cx="256" cy="450" rx="130" ry="24" fill="url(#shadowGrad)"/>

        <!-- 角色身体 -->
        <ellipse cx="256" cy="340" rx="72" ry="68" fill="url(#bodyGrad)"/>
        <ellipse cx="256" cy="346" rx="42" ry="46" fill="${palette.highlight}" opacity="0.45"/>

        <!-- 双脚/脚掌 -->
        <ellipse cx="218" cy="405" rx="26" ry="18" fill="${palette.secondary}"/>
        <ellipse cx="294" cy="405" rx="26" ry="18" fill="${palette.secondary}"/>

        <!-- 双手 (待机状态展示) -->
        ${mood === 'idle' ? `
          <ellipse cx="180" cy="336" rx="18" ry="16" fill="${palette.primary}"/>
          <ellipse cx="332" cy="336" rx="18" ry="16" fill="${palette.primary}"/>
        ` : ''}

        <!-- 头部造型 -->
        <ellipse cx="256" cy="226" rx="98" ry="92" fill="url(#headGrad)"/>

        <!-- 角色特定耳朵/犄角 -->
        ${earsSvg}

        <!-- 角色面部腮肉与口鼻细节 -->
        ${faceDetailsSvg}

        <!-- 情绪眼神与嘴形 -->
        ${eyesSvg}
        ${mouthSvg}

        <!-- 围巾/眼镜等饰品 -->
        ${accessorySvg}

        <!-- 情绪动态道具 -->
        ${moodAddon}
      </svg>
    `.trim();

    return Buffer.from(svg, 'utf-8');
  }
}
