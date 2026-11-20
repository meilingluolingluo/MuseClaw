import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LLMCaller } from '../../../packages/sandbox-core/src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type FeedArea =
  | 'planning'
  | 'research'
  | 'goals'
  | 'money'
  | 'health'
  | 'home'
  | 'learning'
  | 'people'
  | 'files'
  | 'fun';

export interface FeedPost {
  id: string;
  title: string;
  body: string;
  area: FeedArea;
  prompt: string;
  ts: string;
  sessionId?: string;
  routineId?: string;
  routineName?: string;
}

export interface FeedPostsData {
  instructions: string;
  generated_at: string | null;
  daily: boolean;
  time: string;
  posts: FeedPost[];
  error?: string;
}

export interface FeedActivityItem {
  id: string;
  ts: string;
  kind: 'pass' | 'goal' | 'artifact' | 'approval' | 'routine' | 'chat';
  title: string;
  text: string;
  sessionId?: string;
  sessionTitle?: string;
  path?: string;
  quiet?: boolean;
}

const VALID_AREAS: Set<FeedArea> = new Set([
  'planning',
  'research',
  'goals',
  'money',
  'health',
  'home',
  'learning',
  'people',
  'files',
  'fun'
]);

const DEFAULT_INSTRUCTIONS =
  '给我做一个关于我关心的事的动态。短一点、直接一点，扫一眼就能看完，别搞标题党。';

const FEED_PROMPT_TEMPLATE = `你是一个贴心、懂业务且严谨的企业数字员工助手。你的任务是为当前用户撰写专属的“动态”（Feed）：几条短小精悍、真正有价值、量身定制的动态卡片。
这些动态不是千篇一律的废话，而是基于用户当前的真实目标、长期记忆、近期对话与业务进展，提出的关键提醒、目标推进建言、重要技术观察或值得思考的小计划。

【用户的动态定制要求】
{instructions}

【你所了解的用户当前上下文】
{context}

请撰写 {n} 条动态。必须且仅输出合法的 JSON 数组，不要包含任何前导或后置的闲聊寒暄。
数组中每一项的数据结构必须为：
{{
  "title": "<标题，不超过 15 字，简练有力>",
  "body": "<60 到 160 字的 Markdown 正文，可分短段或项目符号列表，禁止一级标题>",
  "area": "<只能是以下分类之一: planning, research, goals, money, health, home, learning, people, files, fun>",
  "prompt": "<引导用户一键点击展开讨论或执行跟进的预制提示词，例如：'帮我分析当前目标的核心风险'，若无则留空>"
}}

请全部使用中文输出。`;

/**
 * 员工专属动态（Feed）存储与智能体生成引擎
 * 支持多用户物理隔离存储、每日定时自动生成、即时撰写、以及离线工作动态聚合。
 */
export class FeedStore {
  private baseDir: string;
  private writingLocks = new Set<string>();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(__dirname, '../data/users');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getUserDir(userId: string): string {
    const sanitized = (userId || 'user_default').replace(/[^\w-]/g, '_');
    const dir = path.join(this.baseDir, sanitized);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private getPostsPath(userId: string): string {
    return path.join(this.getUserDir(userId), 'feed_posts.json');
  }

  private getActivityPath(userId: string): string {
    return path.join(this.getUserDir(userId), 'feed_activity.json');
  }

  public getFeedPosts(userId: string): FeedPostsData {
    const filePath = this.getPostsPath(userId);
    const defaults: FeedPostsData = {
      instructions: DEFAULT_INSTRUCTIONS,
      generated_at: null,
      daily: true,
      time: '08:00',
      posts: []
    };

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          instructions: typeof parsed.instructions === 'string' ? parsed.instructions : defaults.instructions,
          generated_at: parsed.generated_at || null,
          daily: parsed.daily !== false,
          time: typeof parsed.time === 'string' && /^\d{2}:\d{2}$/.test(parsed.time) ? parsed.time : defaults.time,
          posts: Array.isArray(parsed.posts) ? parsed.posts : []
        };
      } catch (err: any) {
        console.warn(`[FeedStore] 读取用户 ${userId} feed_posts 异常: ${err.message}`);
      }
    }

    return defaults;
  }

  public saveFeedPosts(userId: string, data: FeedPostsData): void {
    const filePath = this.getPostsPath(userId);
    const safeData: FeedPostsData = {
      instructions: data.instructions || DEFAULT_INSTRUCTIONS,
      generated_at: data.generated_at || null,
      daily: data.daily !== false,
      time: data.time || '08:00',
      posts: (data.posts || []).slice(0, 100)
    };

    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(safeData, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  public setFeedInstructions(
    userId: string,
    options: { instructions?: string; daily?: boolean; time?: string }
  ): FeedPostsData {
    const data = this.getFeedPosts(userId);

    if (options.instructions !== undefined) {
      data.instructions = options.instructions.trim().slice(0, 2000) || DEFAULT_INSTRUCTIONS;
    }
    if (options.daily !== undefined) {
      data.daily = Boolean(options.daily);
    }
    if (options.time !== undefined) {
      const trimmed = options.time.trim();
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
        data.time = trimmed;
      }
    }

    this.saveFeedPosts(userId, data);
    return data;
  }

  public deleteFeedPost(userId: string, postId: string): boolean {
    const data = this.getFeedPosts(userId);
    const initialCount = data.posts.length;
    data.posts = data.posts.filter((p) => p.id !== postId);
    if (data.posts.length !== initialCount) {
      this.saveFeedPosts(userId, data);
      return true;
    }
    return false;
  }

  public appendPost(userId: string, post: Omit<FeedPost, 'id' | 'ts'>): FeedPost {
    const data = this.getFeedPosts(userId);
    const now = new Date().toISOString();
    const newPost: FeedPost = {
      id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: post.title.trim().slice(0, 120),
      body: post.body.trim().slice(0, 2000),
      area: VALID_AREAS.has(post.area as FeedArea) ? (post.area as FeedArea) : 'goals',
      prompt: (post.prompt || '').trim().slice(0, 500),
      ts: now,
      sessionId: post.sessionId,
      routineId: post.routineId,
      routineName: post.routineName
    };
    data.posts = [newPost, ...data.posts].slice(0, 100);
    this.saveFeedPosts(userId, data);
    return newPost;
  }

  public async writeFeedPosts(
    userId: string,
    caller: LLMCaller,
    contextLines: string[] = [],
    count = 3
  ): Promise<FeedPostsData> {
    if (this.writingLocks.has(userId)) {
      return this.getFeedPosts(userId);
    }

    this.writingLocks.add(userId);
    try {
      const data = this.getFeedPosts(userId);
      const prompt = FEED_PROMPT_TEMPLATE.replace('{instructions}', data.instructions || DEFAULT_INSTRUCTIONS)
        .replace('{context}', contextLines.length > 0 ? contextLines.join('\n') : '- 当前尚无额外历史记忆与自驱目标')
        .replace('{n}', String(count));

      const response = await caller(
        [
          {
            role: 'system',
            content: '你是一个严格输出 JSON 的企业数字员工助手。任何多余的开场白或解释都会破坏系统解析。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        []
      );

      const rawText = response.content || '';
      const parsedPosts = this.parsePostsFromJson(rawText);

      const now = new Date().toISOString();
      const newItems: FeedPost[] = parsedPosts.map((p, idx) => ({
        id: `post_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        title: p.title || '工作简报与推进建议',
        body: p.body || '无详细内容',
        area: VALID_AREAS.has(p.area as FeedArea) ? (p.area as FeedArea) : 'goals',
        prompt: p.prompt || '',
        ts: now
      }));

      if (newItems.length > 0) {
        data.posts = [...newItems, ...data.posts].slice(0, 100);
        data.generated_at = now;
        this.saveFeedPosts(userId, data);
      }

      return data;
    } catch (err: any) {
      console.error(`[FeedStore] 为用户 ${userId} 生成动态异常:`, err);
      const data = this.getFeedPosts(userId);
      data.error = err.message || '生成动态时发生异常';
      return data;
    } finally {
      this.writingLocks.delete(userId);
    }
  }

  private parsePostsFromJson(text: string): Array<Partial<FeedPost>> {
    let clean = text.trim();

    // 剥离 Markdown 代码块
    const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) {
      clean = fenceMatch[1].trim();
    }

    // 截取数组结构
    const startIdx = clean.indexOf('[');
    const endIdx = clean.lastIndexOf(']');
    if (startIdx !== -1 && endIdx > startIdx) {
      clean = clean.slice(startIdx, endIdx + 1);
    }

    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            title: String(item.title || '').trim().slice(0, 120),
            body: String(item.body || '').trim().slice(0, 2000),
            area: item.area,
            prompt: String(item.prompt || '').trim().slice(0, 500)
          }))
          .filter((item) => item.title && item.body);
      }
    } catch {
      // 容错提取单个 JSON 对象
      const objMatches = text.match(/\{[\s\S]*?\}/g) || [];
      const fallbackList: Array<Partial<FeedPost>> = [];
      for (const objStr of objMatches) {
        try {
          const obj = JSON.parse(objStr);
          if (obj.title && obj.body) {
            fallbackList.push({
              title: String(obj.title).trim(),
              body: String(obj.body).trim(),
              area: obj.area,
              prompt: String(obj.prompt || '').trim()
            });
          }
        } catch {}
      }
      return fallbackList;
    }

    return [];
  }

  public recordActivity(userId: string, item: Omit<FeedActivityItem, 'id' | 'ts'>): void {
    const filePath = this.getActivityPath(userId);
    let list: FeedActivityItem[] = [];
    if (fs.existsSync(filePath)) {
      try {
        list = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {}
    }

    const fullItem: FeedActivityItem = {
      ...item,
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: new Date().toISOString()
    };

    list.unshift(fullItem);
    list = list.slice(0, 60);

    const tmp = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  public getActivity(userId: string, limit = 40): FeedActivityItem[] {
    const filePath = this.getActivityPath(userId);
    if (!fs.existsSync(filePath)) return [];
    try {
      const list: FeedActivityItem[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return Array.isArray(list) ? list.slice(0, limit) : [];
    } catch {
      return [];
    }
  }
}
