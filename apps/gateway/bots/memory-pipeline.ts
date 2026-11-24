import fs from 'node:fs';
import path from 'node:path';
import type { Session } from '@museclaw/protocol';
import type { LLMCaller } from '../../../packages/sandbox-core/src/loop.ts';
import {
  extractJsonProposals,
  similarity,
  type MemoryCategory
} from './consolidate.ts';
import type { BotMemoryManager } from './memory.ts';

export interface CaptureTurnParams {
  botId: string;
  botName: string;
  userId: string;
  sessionId: string;
  userText: string;
  assistantText: string;
  caller: LLMCaller;
  isTainted?: boolean;
  sessionKind?: 'interactive' | 'cron' | 'routine' | 'heartbeat' | 'subagent';
  isHidden?: boolean;
  today?: string;
}

export interface CaptureTurnResult {
  skipped?: boolean;
  reason?: string;
  capturedCount: number;
  droppedCount: number;
  storedItems: Array<{ target: 'user' | 'bot' | 'topic'; content: string; topic?: string; until?: string }>;
}

export interface ReflectionIdea {
  id: string;
  text: string;
  fromSessions: number[];
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: number;
  updatedAt?: number;
}

export interface ReflectResult {
  skipped?: boolean;
  reason?: string;
  prunedCount: number;
  learnedCount: number;
  outdatedCount: number;
  ideasCount: number;
}

export interface FeedFeedbackSignal {
  action: 'like' | 'discuss' | 'dismiss';
  title: string;
  tags?: string[];
  area?: string;
}

export interface FeedFeedbackProfile {
  likedTopics: string[];
  dismissedTopics: string[];
}

const MIN_CAPTURE_CONFIDENCE = 0.6;
const MIN_REFLECT_CONFIDENCE = 0.7;
const MAX_CAPTURE_CANDIDATES = 8;
const MAX_IDEAS_STORED = 10;

const SECRET_PATTERN =
  /(?:sk-[a-zA-Z0-9_-]{12,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]+|Bearer\s+[A-Za-z0-9._-]{10,}|(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+)/i;

const VALID_CATEGORIES = new Set<MemoryCategory>([
  'profile',
  'preference',
  'people',
  'routine',
  'constraint',
  'interest',
  'general'
]);

function todayIso(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function containsSecret(text: string): boolean {
  return SECRET_PATTERN.test(text || '');
}

function normalizeForEvidence(str: string): string {
  return (str || '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

/**
 * 确定性证据锚定校验：确保候选记忆引用了真实存在于本轮用户发言中的文本片段
 */
export function hasGroundedEvidence(evidence: unknown, userText: string): boolean {
  if (typeof evidence !== 'string') return false;
  const trimmed = evidence.trim();
  if (trimmed.length < 2) return false;

  const normSource = normalizeForEvidence(userText);
  const normEv = normalizeForEvidence(trimmed);
  if (!normEv || !normSource) return false;

  if (normSource.includes(normEv)) {
    return true;
  }

  // 允许截断引用：检查长度 >= 4 的核心片段或相似度
  if (normEv.length >= 6) {
    const step = Math.max(1, Math.floor(normEv.length / 3));
    for (let i = 0; i <= normEv.length - 4; i += step) {
      if (normSource.includes(normEv.slice(i, i + 4))) {
        return true;
      }
    }
  }

  return similarity(trimmed, userText) >= 0.35;
}

function parseJsonObjectSafe(rawReply: string): Record<string, unknown> | null {
  let cleaned = (rawReply || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch {}
  }
  return null;
}

function mapCategory(rawCategory: unknown, rawKind?: unknown): MemoryCategory {
  const c = String(rawCategory || '').trim().toLowerCase();
  if (VALID_CATEGORIES.has(c as MemoryCategory)) {
    return c as MemoryCategory;
  }
  const k = String(rawKind || '').trim().toLowerCase();
  if (k === 'interest') return 'interest';
  if (k === 'preference') return 'preference';
  if (k === 'decision' || k === 'constraint') return 'constraint';
  return 'general';
}

/**
 * 统一认知记忆管线：
 * 1. 对话后受控提取（带来源门禁、原话证据校验、时效标签与分层路由）
 * 2. 跨会话周期反思（提炼跨会话模式、纠正过期事实、生成自动化建议）
 * 3. 动态交互反馈回写（将点赞/讨论/忽略实时反哺至兴趣画像）
 */
export class MemoryPipeline {
  private memory: BotMemoryManager;

  constructor(memory: BotMemoryManager) {
    this.memory = memory;
  }

  /**
   * 单轮对话结束后异步静默提取值得长期记忆的关键事实、偏好与兴趣
   */
  public async captureTurnMemory(params: CaptureTurnParams): Promise<CaptureTurnResult> {
    const userText = (params.userText || '').trim();
    const assistantText = (params.assistantText || '').trim();

    if (params.isTainted) {
      return { skipped: true, reason: 'tainted_turn', capturedCount: 0, droppedCount: 0, storedItems: [] };
    }
    if (params.sessionKind && params.sessionKind !== 'interactive') {
      return { skipped: true, reason: 'non_interactive_session', capturedCount: 0, droppedCount: 0, storedItems: [] };
    }
    if (params.isHidden) {
      return { skipped: true, reason: 'hidden_turn', capturedCount: 0, droppedCount: 0, storedItems: [] };
    }
    if (userText.length < 4) {
      return { skipped: true, reason: 'short_input', capturedCount: 0, droppedCount: 0, storedItems: [] };
    }

    const today = params.today || todayIso();
    const existingBotMemory = this.memory.getMemory(params.botId, params.userId);
    const existingUserProfile = this.memory.getUserProfile(params.userId);
    const existingTopics = this.memory.listTopics(params.botId, params.userId);

    const prompt = [
      `你是 ${params.botName} 认知记忆系统的 CAPTURE（准入提取）模块。今天日期：${today}。`,
      '请仔细阅读本轮用户与助手的对话，判断用户是否明确表达了值得长期留存或有明确期限的事实、偏好、约束或兴趣。',
      '',
      '【本轮对话】',
      `用户: ${userText.slice(0, 1500)}`,
      assistantText ? `${params.botName}: ${assistantText.slice(0, 800)}` : '',
      '',
      '【严格准入规则】',
      '1. 只保留用户本人明确陈述的：长期偏好、个人/团队事实、长期关注兴趣、明确作出的业务决定、或有明确截止日期的临时安排。',
      '2. 严禁把“单次任务指令”或“假设性提问”当作事实（例如“帮我写个10人创业公司的计划”不代表用户在创业公司；“用一句话回答我”只针对本轮而非长期偏好）。',
      '3. 严禁记录密码、密钥、Token、账号等敏感凭据。',
      '4. 每条必须提供 evidence：逐字摘录支持该条目的用户原话片段；没有原话依据的不得输出。',
      '5. 若事件仅在某日期前有效（如“周五评审”“下周出差”），必须计算并填写 until ("YYYY-MM-DD")；长期事实不填 until。',
      '6. category 取值：profile | preference | interest | people | routine | constraint | general。',
      '7. 若是跨所有数字员工通用的用户本人核心画像/长期偏好/兴趣，设 aboutUser: true；若属于特定项目、人物或领域细节，给出简短 topic（如 "agent-memory"）和 2~4 个 topicAliases。',
      '8. 严禁重复输出下方已有记忆中已存在的内容。',
      '',
      `【已有共享画像摘要】\n${existingUserProfile.slice(-1500)}`,
      `【已有员工记忆摘要】\n${existingBotMemory.slice(-2000)}`,
      `【已有主题目录】\n${existingTopics.map((t) => `${t.slug}(${t.name})`).join(', ') || '(暂无)'}`,
      '',
      '仅输出 JSON 数组（最多 6 条），若无可提取内容请严格输出 []：',
      '[{"text":"第三方陈述的一句话事实","category":"preference","evidence":"用户原话摘录","until":"YYYY-MM-DD或省略","aboutUser":false,"topic":"可选主题","topicAliases":["别名1"],"confidence":0.85}]'
    ]
      .filter(Boolean)
      .join('\n');

    let rawReply = '';
    try {
      const resp = await params.caller(
        [
          { role: 'system', content: '你是一个严格的 JSON 记忆提取器，只输出合法 JSON 数组，不输出多余解释。' },
          { role: 'user', content: prompt }
        ],
        []
      );
      rawReply = resp.content || '';
    } catch (err: any) {
      return {
        skipped: true,
        reason: `llm_error: ${err?.message || err}`,
        capturedCount: 0,
        droppedCount: 0,
        storedItems: []
      };
    }

    const candidates = extractJsonProposals(rawReply).slice(0, MAX_CAPTURE_CANDIDATES);
    const storedItems: CaptureTurnResult['storedItems'] = [];
    let droppedCount = 0;

    for (const cand of candidates) {
      const text = typeof cand.text === 'string' ? cand.text.replace(/[\r\n]+/g, ' ').trim().slice(0, 300) : '';
      const confidence = typeof cand.confidence === 'number' ? cand.confidence : 0;
      const untilRaw = typeof cand.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cand.until.trim())
        ? cand.until.trim()
        : undefined;

      if (!text || confidence < MIN_CAPTURE_CONFIDENCE) {
        droppedCount++;
        continue;
      }
      if (containsSecret(text) || containsSecret(String(cand.evidence || ''))) {
        droppedCount++;
        continue;
      }
      if (!hasGroundedEvidence(cand.evidence, userText)) {
        droppedCount++;
        continue;
      }
      if (untilRaw && untilRaw < today) {
        droppedCount++;
        continue;
      }

      const category = mapCategory(cand.category, cand.kind);
      const topic = typeof cand.topic === 'string' ? cand.topic.trim() : '';
      const aliases = Array.isArray(cand.topicAliases)
        ? cand.topicAliases.map((a) => String(a || '').trim()).filter(Boolean).slice(0, 6)
        : [];
      const aboutUser = cand.aboutUser === true;

      if (topic && !aboutUser) {
        const res = this.memory.upsertTopicEntry(
          params.botId,
          topic,
          text,
          { aliases, until: untilRaw, origin: 'agent' },
          params.userId
        );
        if (res.success) {
          storedItems.push({ target: 'topic', content: text, topic: res.topic?.slug || topic, until: untilRaw });
        } else {
          droppedCount++;
        }
      } else if (aboutUser) {
        const res = this.memory.addUserProfileItem(params.userId, text, category, {
          until: untilRaw,
          origin: 'agent'
        });
        if (res.success && res.added) {
          storedItems.push({ target: 'user', content: text, until: untilRaw });
        } else {
          droppedCount++;
        }
      } else {
        const dup = this.memory.searchMemory(params.botId, text, params.userId);
        if (dup.length > 0 && similarity(dup[0].item.content, text) >= 0.82) {
          droppedCount++;
          continue;
        }
        const res = this.memory.addMemoryItem(params.botId, text, category, false, params.userId, {
          until: untilRaw,
          origin: 'agent'
        });
        if (res.success) {
          storedItems.push({ target: 'bot', content: text, until: untilRaw });
        } else {
          droppedCount++;
        }
      }
    }

    return {
      capturedCount: storedItems.length,
      droppedCount,
      storedItems
    };
  }

  // =========================================================================
  // 跨会话反思 (Cross-Session Reflection)
  // =========================================================================

  private getIdeasPath(botId: string, userId: string = 'system'): string {
    return path.join(this.memory.getBotDir(botId, userId), 'reflection_ideas.json');
  }

  public getReflectionIdeas(botId: string, userId: string = 'system'): ReflectionIdea[] {
    const filePath = this.getIdeasPath(botId, userId);
    if (!fs.existsSync(filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveReflectionIdeas(botId: string, ideas: ReflectionIdea[], userId: string = 'system'): void {
    const filePath = this.getIdeasPath(botId, userId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(ideas.slice(0, MAX_IDEAS_STORED), null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  public updateReflectionIdeaStatus(
    botId: string,
    userId: string,
    ideaId: string,
    status: 'accepted' | 'dismissed'
  ): { success: boolean; ideas: ReflectionIdea[] } {
    const ideas = this.getReflectionIdeas(botId, userId);
    const target = ideas.find((i) => i.id === ideaId);
    if (!target) {
      return { success: false, ideas };
    }
    target.status = status;
    target.updatedAt = Date.now();
    this.saveReflectionIdeas(botId, ideas, userId);
    return { success: true, ideas };
  }

  /**
   * 跨会话周期反思：清理过期条目，从多段历史对话中提炼高可信模式、纠偏过时记忆并生成主动建议
   */
  public async reflectAcrossSessions(params: {
    botId: string;
    botName: string;
    userId: string;
    sessions: Session[];
    caller: LLMCaller;
    today?: string;
  }): Promise<ReflectResult> {
    const today = params.today || todayIso();
    const { removedCount: prunedCount } = this.memory.pruneExpiredMemories(params.botId, params.userId, today);

    const eligible = (params.sessions || [])
      .filter((s) => {
        if (!s || !Array.isArray(s.messages)) return false;
        const title = (s.title || '').trim();
        if (title.startsWith('[定时') || title.startsWith('[Webhook')) return false;
        return s.messages.some((m) => m.role === 'user' && !m.hidden && (m.content || '').trim().length >= 3);
      })
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .slice(0, 12);

    if (eligible.length < 2) {
      return {
        skipped: true,
        reason: 'insufficient_sessions',
        prunedCount,
        learnedCount: 0,
        outdatedCount: 0,
        ideasCount: 0
      };
    }

    const sessionBlocks = eligible.map((sess, idx) => {
      const lines = (sess.messages || [])
        .filter((m) => !m.hidden && (m.role === 'user' || m.role === 'assistant') && (m.content || '').trim())
        .slice(-10)
        .map((m) => `${m.role === 'user' ? '用户' : params.botName}: ${(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 350)}`);
      return `会话 ${idx + 1} (${sess.title || sess.id}):\n${lines.join('\n')}`;
    });

    const botData = this.memory.getMemoryData(params.botId, params.userId);
    const numberedNotebook = botData.items
      .map((item, i) => `[${i}] (${item.category}${item.protected ? ', protected' : ''}) ${item.content}`)
      .join('\n');

    const prompt = [
      `你是 ${params.botName} 记忆系统的 REFLECT（跨会话反思）模块。今天日期：${today}。`,
      '请通读以下多个最近对话，仅提取“只有把多段对话放在一起看才能发现的规律”：',
      '',
      sessionBlocks.join('\n\n'),
      '',
      '【当前编号记忆库】',
      numberedNotebook || '(暂无条目)',
      '',
      '【输出规范】',
      '1. learned：仅保留在至少 2 个不同会话中反复体现的长期习惯、兴趣方向或协作偏好（from 必须包含至少 2 个会话编号，confidence >= 0.7）。',
      '2. outdated：仅当后续对话明确推翻了【当前编号记忆库】中某个非 protected 条目时才输出 { "index": 序号, "now": "更新后的准确事实", "from": [会话编号] }。',
      '3. ideas：最多 3 条自动化/主动协同建议（例如用户反复手工询问同一类事项，建议设为定时例程或专属技能）。',
      '4. 严禁输出密码/密钥，严禁重复已有记忆。',
      '',
      '仅输出如下结构的单个 JSON 对象：',
      '{"learned":[{"text":"...","category":"interest","from":[1,2],"aboutUser":true,"confidence":0.85}],"outdated":[{"index":0,"now":"...","from":[2]}],"ideas":[{"text":"...","from":[1,3]}]}'
    ].join('\n');

    let rawReply = '';
    try {
      const resp = await params.caller(
        [
          { role: 'system', content: '你是一个严谨的跨会话反思分析器，只输出单个合法 JSON 对象。' },
          { role: 'user', content: prompt }
        ],
        []
      );
      rawReply = resp.content || '';
    } catch (err: any) {
      return {
        skipped: true,
        reason: `llm_error: ${err?.message || err}`,
        prunedCount,
        learnedCount: 0,
        outdatedCount: 0,
        ideasCount: 0
      };
    }

    const parsed = parseJsonObjectSafe(rawReply);
    if (!parsed) {
      return {
        prunedCount,
        learnedCount: 0,
        outdatedCount: 0,
        ideasCount: 0
      };
    }

    let learnedCount = 0;
    let outdatedCount = 0;
    let ideasCount = 0;

    // 1. 晋升跨会话模式 learned
    const learnedRaw = Array.isArray(parsed.learned) ? parsed.learned : [];
    for (const item of learnedRaw.slice(0, 6)) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const text = typeof obj.text === 'string' ? obj.text.replace(/[\r\n]+/g, ' ').trim().slice(0, 300) : '';
      const conf = typeof obj.confidence === 'number' ? obj.confidence : 0;
      const fromSet = Array.isArray(obj.from)
        ? Array.from(new Set(obj.from.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= eligible.length)))
        : [];
      if (!text || conf < MIN_REFLECT_CONFIDENCE || fromSet.length < 2 || containsSecret(text)) {
        continue;
      }

      const category = mapCategory(obj.category);
      if (obj.aboutUser === true) {
        const res = this.memory.addUserProfileItem(params.userId, text, category, { origin: 'agent', weight: 1.5 });
        if (res.success && (res.added || res.boosted)) learnedCount++;
      } else {
        const dup = this.memory.searchMemory(params.botId, text, params.userId);
        if (dup.length > 0 && similarity(dup[0].item.content, text) >= 0.82) continue;
        const res = this.memory.addMemoryItem(params.botId, text, category, false, params.userId, { origin: 'agent', weight: 1.5 });
        if (res.success) learnedCount++;
      }
    }

    // 2. 纠偏过时记忆 outdated
    const outdatedRaw = Array.isArray(parsed.outdated) ? parsed.outdated : [];
    for (const item of outdatedRaw.slice(0, 5)) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const idx = typeof obj.index === 'number' ? obj.index : -1;
      const nowText = typeof obj.now === 'string' ? obj.now.replace(/[\r\n]+/g, ' ').trim().slice(0, 300) : '';
      if (!Number.isInteger(idx) || idx < 0 || idx >= botData.items.length || !nowText || containsSecret(nowText)) {
        continue;
      }
      const target = botData.items[idx];
      if (!target || target.protected) continue;
      const upd = this.memory.updateMemoryItem(params.botId, target.id, nowText, target.category, params.userId);
      if (upd.success) outdatedCount++;
    }

    // 3. 沉淀主动建议 ideas
    const ideasRaw = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    if (ideasRaw.length > 0) {
      const existingIdeas = this.getReflectionIdeas(params.botId, params.userId);
      const newIdeas: ReflectionIdea[] = [...existingIdeas];
      for (const rawIdea of ideasRaw.slice(0, 3)) {
        if (!rawIdea || typeof rawIdea !== 'object') continue;
        const obj = rawIdea as Record<string, unknown>;
        const text = typeof obj.text === 'string' ? obj.text.replace(/[\r\n]+/g, ' ').trim().slice(0, 240) : '';
        if (!text || containsSecret(text)) continue;
        if (newIdeas.some((ex) => similarity(ex.text, text) >= 0.78)) continue;
        const fromSessions = Array.isArray(obj.from)
          ? obj.from.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= eligible.length)
          : [];
        newIdeas.unshift({
          id: `idea_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          text,
          fromSessions,
          status: 'pending',
          createdAt: Date.now()
        });
        ideasCount++;
      }
      if (ideasCount > 0) {
        this.saveReflectionIdeas(params.botId, newIdeas, params.userId);
      }
    }

    return {
      prunedCount,
      learnedCount,
      outdatedCount,
      ideasCount
    };
  }

  // =========================================================================
  // 动态交互反馈回写 (Feed Feedback Loop)
  // =========================================================================

  private getFeedbackPath(userId: string): string {
    return path.join(this.memory.getUserDir(userId), 'feed_feedback.json');
  }

  public getFeedbackProfile(userId: string = 'user_web'): FeedFeedbackProfile {
    const filePath = this.getFeedbackPath(userId);
    if (!fs.existsSync(filePath)) {
      return { likedTopics: [], dismissedTopics: [] };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return {
        likedTopics: Array.isArray(parsed.likedTopics) ? parsed.likedTopics : [],
        dismissedTopics: Array.isArray(parsed.dismissedTopics) ? parsed.dismissedTopics : []
      };
    } catch {
      return { likedTopics: [], dismissedTopics: [] };
    }
  }

  private saveFeedbackProfile(userId: string, profile: FeedFeedbackProfile): void {
    const filePath = this.getFeedbackPath(userId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        {
          likedTopics: profile.likedTopics.slice(0, 30),
          dismissedTopics: profile.dismissedTopics.slice(0, 30)
        },
        null,
        2
      ),
      'utf-8'
    );
    fs.renameSync(tmp, filePath);
  }

  /**
   * 将用户对动态卡片的点赞、讨论与不感兴趣行为闭环回写至兴趣画像与负反馈列表
   */
  public recordFeedFeedback(
    userId: string,
    _botId: string,
    signal: FeedFeedbackSignal
  ): FeedFeedbackProfile {
    const profile = this.getFeedbackProfile(userId);
    const rawKeywords = Array.isArray(signal.tags) && signal.tags.length > 0
      ? signal.tags.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean)
      : [signal.title.trim()].filter(Boolean);

    if (signal.action === 'like' || signal.action === 'discuss') {
      const weightDelta = signal.action === 'discuss' ? 0.8 : 0.5;
      for (const kw of rawKeywords.slice(0, 3)) {
        profile.likedTopics = [kw, ...profile.likedTopics.filter((t) => t !== kw)];
        profile.dismissedTopics = profile.dismissedTopics.filter((t) => t !== kw);
        this.memory.addUserProfileItem(userId, `关注方向：${kw}`, 'interest', {
          origin: 'feedback',
          weight: weightDelta
        });
      }
    } else if (signal.action === 'dismiss') {
      for (const kw of rawKeywords.slice(0, 3)) {
        profile.dismissedTopics = [kw, ...profile.dismissedTopics.filter((t) => t !== kw)];
        profile.likedTopics = profile.likedTopics.filter((t) => t !== kw);
      }
    }

    this.saveFeedbackProfile(userId, profile);
    return profile;
  }
}
