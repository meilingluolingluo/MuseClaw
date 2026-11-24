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
  sourceUrl?: string;
  sourceName?: string;
  imageUrl?: string;
  tags?: string[];
  liked?: boolean;
  dismissed?: boolean;
  kind?: 'intel' | 'insight' | 'brief';
}

export interface FeedSearchHit {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  image?: string;
}

export interface WriteFeedOptions {
  searchWeb?: (query: string, count?: number) => Promise<FeedSearchHit[]>;
  interests?: string[];
  likedTopics?: string[];
  dismissedTopics?: string[];
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
要求：直白、短小、有信息密度、禁止标题党、扫一眼就能看完。

【用户的动态版块说明】
{instructions}

【用户的兴趣与反馈倾向】
{interestSection}

【你所了解的用户当前上下文】
{context}

【外部真实检索结果（如有则优先据此生成带出处的真实情报卡片，严禁捏造未在结果中出现的链接）】
{searchResults}

请撰写 {n} 条动态。必须且仅输出合法的 JSON 数组，不要包含任何前导或后置的闲聊寒暄。
数组中每一项的数据结构必须为：
{
  "title": "<标题，不超过 22 字，直接陈述核心事实或洞见，不搞标题党>",
  "body": "<60 到 160 字的精炼正文，禁止一级标题，讲清核心结论与实用价值>",
  "area": "<只能是以下分类之一: planning, research, goals, money, health, home, learning, people, files, fun>",
  "kind": "<'intel' 表示外部真实情报，'insight' 表示结合记忆与目标的深度提醒>",
  "sourceUrl": "<若来自上方检索结果，填写对应的真实 http/https URL，否则留空>",
  "sourceName": "<来源站点或机构名称，如 GitHub、机器之心、技术博客等，无则留空>",
  "imageUrl": "<检索结果自带的真实图片 URL（若有），否则留空>",
  "tags": ["<1~3个简短中文或技术标签>"],
  "prompt": "<引导用户一键点击展开讨论或执行跟进的提示词，例如：'帮我分析这条动态对当前项目的影响'，若无则留空>"
}

请全部使用中文输出。`;

function safeExternalUrl(raw: unknown): string | undefined {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return undefined;
  return /^https?:\/\//i.test(s) ? s : undefined;
}

function localDateIso(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

  public toggleLikePost(userId: string, postId: string): { success: boolean; post?: FeedPost } {
    const data = this.getFeedPosts(userId);
    const target = data.posts.find((p) => p.id === postId);
    if (!target) {
      return { success: false };
    }
    target.liked = !target.liked;
    this.saveFeedPosts(userId, data);
    return { success: true, post: target };
  }

  public dismissPost(userId: string, postId: string): { success: boolean; post?: FeedPost } {
    const data = this.getFeedPosts(userId);
    const target = data.posts.find((p) => p.id === postId);
    if (!target) {
      return { success: false };
    }
    data.posts = data.posts.filter((p) => p.id !== postId);
    this.saveFeedPosts(userId, data);
    return { success: true, post: target };
  }

  /**
   * 检查今日定时动态是否到期且尚未生成
   */
  public isDailyFeedDue(userId: string, now: number = Date.now()): boolean {
    const data = this.getFeedPosts(userId);
    if (!data.daily) return false;
    const todayStr = localDateIso(now);
    if (data.generated_at && localDateIso(new Date(data.generated_at).getTime()) === todayStr) {
      return false;
    }
    const [hhStr, mmStr] = (data.time || '08:00').split(':');
    const targetH = Number(hhStr);
    const targetM = Number(mmStr);
    if (!Number.isFinite(targetH) || !Number.isFinite(targetM)) return false;

    const d = new Date(now);
    const nowMinutes = d.getHours() * 60 + d.getMinutes();
    const dueMinutes = targetH * 60 + targetM;
    return nowMinutes >= dueMinutes;
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

  private async planSearchQueries(
    caller: LLMCaller,
    instructions: string,
    interests: string[],
    likedTopics: string[],
    dismissedTopics: string[],
    contextLines: string[]
  ): Promise<string[]> {
    const fallback = interests.slice(0, 2);
    const planPrompt = [
      '请根据以下用户关注点与动态定制要求，生成 2 到 3 个用于联网搜索最新资讯的精准搜索关键词。',
      `定制说明: ${instructions}`,
      interests.length ? `用户兴趣: ${interests.join(', ')}` : '',
      likedTopics.length ? `偏好主题(正向): ${likedTopics.join(', ')}` : '',
      dismissedTopics.length ? `避开主题(负向): ${dismissedTopics.join(', ')}` : '',
      contextLines.length ? `近期上下文:\n${contextLines.slice(0, 6).join('\n')}` : '',
      '仅输出字符串数组 JSON，例如 ["AI Agent memory architecture 2026", "TypeScript release notes"]。若完全无需外部检索可输出 []。'
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const resp = await caller(
        [
          { role: 'system', content: '你是一个搜索词规划器，只输出合法 JSON 字符串数组。' },
          { role: 'user', content: planPrompt }
        ],
        []
      );
      const raw = (resp.content || '').trim();
      const s = raw.indexOf('[');
      const e = raw.lastIndexOf(']');
      if (s >= 0 && e > s) {
        const parsed = JSON.parse(raw.slice(s, e + 1));
        if (Array.isArray(parsed)) {
          const queries = parsed.map((q) => String(q || '').trim()).filter((q) => q.length >= 2).slice(0, 3);
          if (queries.length > 0) return queries;
        }
      }
    } catch {}
    return fallback;
  }

  public async writeFeedPosts(
    userId: string,
    caller: LLMCaller,
    contextLines: string[] = [],
    count = 3,
    options?: WriteFeedOptions
  ): Promise<FeedPostsData> {
    if (this.writingLocks.has(userId)) {
      return this.getFeedPosts(userId);
    }

    this.writingLocks.add(userId);
    try {
      const data = this.getFeedPosts(userId);
      const interests = options?.interests || [];
      const likedTopics = options?.likedTopics || [];
      const dismissedTopics = options?.dismissedTopics || [];

      const interestParts: string[] = [];
      if (interests.length > 0) interestParts.push(`- 长期兴趣方向: ${interests.join('；')}`);
      if (likedTopics.length > 0) interestParts.push(`- 历史正向反馈主题: ${likedTopics.join('、')}`);
      if (dismissedTopics.length > 0) interestParts.push(`- 历史不感兴趣主题(尽量回避): ${dismissedTopics.join('、')}`);
      const interestSection = interestParts.length > 0 ? interestParts.join('\n') : '- 暂无显式兴趣标签';

      // Step 1: 如具备外部搜索能力，先规划查询词并并发拉取真实资讯
      const existingUrls = new Set(data.posts.map((p) => p.sourceUrl).filter(Boolean));
      const existingTitles = data.posts.slice(0, 30).map((p) => p.title.toLowerCase());
      const collectedHits: FeedSearchHit[] = [];

      if (options?.searchWeb) {
        const queries = await this.planSearchQueries(
          caller,
          data.instructions || DEFAULT_INSTRUCTIONS,
          interests,
          likedTopics,
          dismissedTopics,
          contextLines
        );
        if (queries.length > 0) {
          const batch = await Promise.all(
            queries.map((q) => options.searchWeb!(q, 4).catch(() => []))
          );
          const seenUrls = new Set<string>();
          for (const list of batch) {
            for (const hit of list) {
              const url = safeExternalUrl(hit?.url);
              const title = String(hit?.title || '').trim();
              if (!url || !title) continue;
              if (existingUrls.has(url) || seenUrls.has(url)) continue;
              if (existingTitles.some((t) => t === title.toLowerCase())) continue;
              seenUrls.add(url);
              collectedHits.push({ ...hit, url, title });
            }
          }
        }
      }

      const searchResultsText =
        collectedHits.length > 0
          ? collectedHits
              .slice(0, 10)
              .map(
                (h, i) =>
                  `[${i + 1}] 标题: ${h.title}\n    链接: ${h.url}${h.source ? `\n    来源: ${h.source}` : ''}${
                    h.image ? `\n    配图: ${h.image}` : ''
                  }${h.snippet ? `\n    摘要: ${h.snippet.slice(0, 260)}` : ''}`
              )
              .join('\n')
          : '（本轮未命中外部检索结果，请完全基于用户本地记忆、活跃目标与近期工作聚焦撰写高价值洞察与提醒，sourceUrl 留空）';

      const prompt = FEED_PROMPT_TEMPLATE.replace('{instructions}', data.instructions || DEFAULT_INSTRUCTIONS)
        .replace('{interestSection}', interestSection)
        .replace('{context}', contextLines.length > 0 ? contextLines.join('\n') : '- 当前尚无额外历史记忆与自驱目标')
        .replace('{searchResults}', searchResultsText)
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
      const allowedHitUrls = new Set(collectedHits.map((h) => h.url));

      const now = new Date().toISOString();
      const newItems: FeedPost[] = parsedPosts.map((p, idx) => {
        const rawSourceUrl = safeExternalUrl(p.sourceUrl);
        const verifiedUrl =
          rawSourceUrl && (allowedHitUrls.size === 0 || allowedHitUrls.has(rawSourceUrl))
            ? rawSourceUrl
            : undefined;
        const matchedHit = verifiedUrl ? collectedHits.find((h) => h.url === verifiedUrl) : undefined;
        const imageUrl = safeExternalUrl(p.imageUrl) || safeExternalUrl(matchedHit?.image);

        return {
          id: `post_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
          title: p.title || '工作简报与推进建议',
          body: p.body || '无详细内容',
          area: VALID_AREAS.has(p.area as FeedArea) ? (p.area as FeedArea) : 'goals',
          prompt: p.prompt || '',
          ts: now,
          kind: verifiedUrl ? 'intel' : p.kind === 'brief' ? 'brief' : 'insight',
          ...(verifiedUrl ? { sourceUrl: verifiedUrl } : {}),
          ...(p.sourceName || matchedHit?.source ? { sourceName: p.sourceName || matchedHit?.source } : {}),
          ...(imageUrl ? { imageUrl } : {}),
          ...(Array.isArray(p.tags) && p.tags.length > 0 ? { tags: p.tags } : {})
        };
      });

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

    const normalizeItem = (item: Record<string, any>): Partial<FeedPost> => ({
      title: String(item.title || '').trim().slice(0, 120),
      body: String(item.body || '').trim().slice(0, 2000),
      area: item.area,
      prompt: String(item.prompt || '').trim().slice(0, 500),
      sourceUrl: safeExternalUrl(item.sourceUrl),
      sourceName: typeof item.sourceName === 'string' ? item.sourceName.trim().slice(0, 60) : undefined,
      imageUrl: safeExternalUrl(item.imageUrl),
      tags: Array.isArray(item.tags)
        ? item.tags.map((t: any) => String(t || '').trim().slice(0, 24)).filter(Boolean).slice(0, 4)
        : undefined,
      kind: item.kind === 'intel' || item.kind === 'insight' || item.kind === 'brief' ? item.kind : undefined
    });

    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => item && typeof item === 'object')
          .map(normalizeItem)
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
            fallbackList.push(normalizeItem(obj));
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
