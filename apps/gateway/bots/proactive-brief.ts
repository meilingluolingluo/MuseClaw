import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BotMemoryManager } from './memory.ts';
import type { MemoryPipeline } from './memory-pipeline.ts';
import type { FeedStore } from './feed-store.ts';
import type { SessionStore } from './session-store.ts';
import type { GoalStore } from '../goals/store.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRESENCE_COOLDOWN_MS = 30 * 60_000; // 30 分钟内刚活跃过不打扰
const AWAY_REFRESH_MS = 3 * 60 * 60_000; // 离开超过 3 小时允许补充简报

export interface ProactiveBriefState {
  enabled: boolean;
  quietStart: string;
  quietEnd: string;
  lastActiveAt: number;
  lastBriefAt: number;
  lastBriefDay: string;
  deliveredSignalIds: string[];
}

export interface EvaluateBriefParams {
  userId: string;
  botId?: string;
  now?: number;
  force?: boolean;
  botMemory: BotMemoryManager;
  memoryPipeline: MemoryPipeline;
  feedStore: FeedStore;
  goalStore: GoalStore;
  sessionStore: SessionStore;
}

export interface EvaluateBriefResult {
  emitted: boolean;
  reason?: string;
  sessionId?: string;
  message?: string;
  signalCount?: number;
}

function localDateIso(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseHm(hm: string): number | null {
  const m = (hm || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isWithinQuietHours(now: number, quietStart: string, quietEnd: string): boolean {
  const startMin = parseHm(quietStart);
  const endMin = parseHm(quietEnd);
  if (startMin === null || endMin === null || startMin === endMin) return false;
  const d = new Date(now);
  const curMin = d.getHours() * 60 + d.getMinutes();
  if (startMin < endMin) {
    return curMin >= startMin && curMin < endMin;
  }
  return curMin >= startMin || curMin < endMin;
}

/**
 * 信号驱动的主动聊天与简报引擎：
 * 结合在场时间、免打扰时段与四类高价值信号（即将到期事件、活跃目标卡点、跨会话反思建议、最新关注动态），
 * 做到“有事才开口、无事保持静默”。
 */
export class ProactiveBriefEngine {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(__dirname, '../data/users');
  }

  private getStatePath(userId: string): string {
    const sanitized = (userId || 'user_web').replace(/[^\w-]/g, '_');
    return path.join(this.baseDir, sanitized, 'proactive_state.json');
  }

  public getState(userId: string): ProactiveBriefState {
    const filePath = this.getStatePath(userId);
    const defaults: ProactiveBriefState = {
      enabled: true,
      quietStart: '23:00',
      quietEnd: '07:30',
      lastActiveAt: 0,
      lastBriefAt: 0,
      lastBriefDay: '',
      deliveredSignalIds: []
    };
    if (!fs.existsSync(filePath)) return defaults;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return {
        enabled: parsed.enabled !== false,
        quietStart: typeof parsed.quietStart === 'string' ? parsed.quietStart : defaults.quietStart,
        quietEnd: typeof parsed.quietEnd === 'string' ? parsed.quietEnd : defaults.quietEnd,
        lastActiveAt: Number(parsed.lastActiveAt) || 0,
        lastBriefAt: Number(parsed.lastBriefAt) || 0,
        lastBriefDay: typeof parsed.lastBriefDay === 'string' ? parsed.lastBriefDay : '',
        deliveredSignalIds: Array.isArray(parsed.deliveredSignalIds) ? parsed.deliveredSignalIds : []
      };
    } catch {
      return defaults;
    }
  }

  private saveState(userId: string, state: ProactiveBriefState): void {
    const filePath = this.getStatePath(userId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const nextState: ProactiveBriefState = {
      ...state,
      deliveredSignalIds: state.deliveredSignalIds.slice(-100)
    };
    const tmp = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(nextState, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  public touchPresence(userId: string, now: number = Date.now()): void {
    const state = this.getState(userId);
    state.lastActiveAt = now;
    this.saveState(userId, state);
  }

  public getSettings(userId: string): {
    enabled: boolean;
    quietStart: string;
    quietEnd: string;
    lastActiveAt: number;
    lastBriefAt: number;
    lastBriefDay: string;
  } {
    const s = this.getState(userId);
    return {
      enabled: s.enabled,
      quietStart: s.quietStart,
      quietEnd: s.quietEnd,
      lastActiveAt: s.lastActiveAt,
      lastBriefAt: s.lastBriefAt,
      lastBriefDay: s.lastBriefDay
    };
  }

  public updateSettings(
    userId: string,
    patch: { enabled?: boolean; quietStart?: string; quietEnd?: string }
  ) {
    const state = this.getState(userId);
    if (patch.enabled !== undefined) state.enabled = Boolean(patch.enabled);
    if (patch.quietStart && parseHm(patch.quietStart) !== null) state.quietStart = patch.quietStart.trim();
    if (patch.quietEnd && parseHm(patch.quietEnd) !== null) state.quietEnd = patch.quietEnd.trim();
    this.saveState(userId, state);
    return this.getSettings(userId);
  }

  /**
   * 评估是否满足主动触达条件；若有高价值未推信号则向主聊写入精炼简报，否则静默返回
   */
  public evaluateAndEmitBrief(params: EvaluateBriefParams): EvaluateBriefResult {
    const now = params.now ?? Date.now();
    const botId = params.botId || 'muse';
    const userId = params.userId || 'user_web';
    const force = Boolean(params.force);
    const state = this.getState(userId);

    if (!force) {
      if (!state.enabled) {
        return { emitted: false, reason: 'disabled' };
      }
      if (isWithinQuietHours(now, state.quietStart, state.quietEnd)) {
        return { emitted: false, reason: 'quiet_hours' };
      }
      if (state.lastActiveAt > 0 && now - state.lastActiveAt < PRESENCE_COOLDOWN_MS) {
        return { emitted: false, reason: 'user_recently_active' };
      }
    }

    const todayStr = localDateIso(now);
    const tomorrowStr = localDateIso(now + 24 * 60 * 60_000);
    const deliveredSet = new Set(state.deliveredSignalIds);

    // 1. 即将到期的时效记忆（今天或明天到期）
    const allMemoryItems = [
      ...params.botMemory.getUserProfileItems(userId),
      ...params.botMemory.getMemoryData(botId, userId).items
    ];
    const urgentMemories = allMemoryItems.filter(
      (item) =>
        item.until &&
        (item.until === todayStr || item.until === tomorrowStr) &&
        !deliveredSet.has(`until:${item.until}:${item.content}`)
    );

    const isFirstBriefToday = state.lastBriefDay !== todayStr;
    const isAwayLongEnough = state.lastBriefAt > 0 && now - state.lastBriefAt >= AWAY_REFRESH_MS;

    if (!force && !isFirstBriefToday && !isAwayLongEnough && urgentMemories.length === 0) {
      return { emitted: false, reason: 'not_due' };
    }

    // 收集 4 类信号
    const signals: Array<{ id: string; line: string }> = [];

    for (const mem of urgentMemories.slice(0, 2)) {
      const whenLabel = mem.until === todayStr ? '今天到期' : '明天到期';
      signals.push({
        id: `until:${mem.until}:${mem.content}`,
        line: `- ⏰ **近期提醒（${whenLabel}）**：${mem.content}`
      });
    }

    // 2. 活跃目标的下一步
    const activeGoals = params.goalStore.list('active').filter((g) => !g.userId || g.userId === userId);
    for (const g of activeGoals.slice(0, 2)) {
      const nextStep = g.steps.find((s) => s.status === 'in_progress') || g.steps.find((s) => s.status === 'pending');
      if (nextStep) {
        const sigId = `goal:${g.id}:${nextStep.id}`;
        if (!deliveredSet.has(sigId)) {
          signals.push({
            id: sigId,
            line: `- 🎯 **目标推进（${g.title} · ${g.progress}%）**：下一步「${nextStep.title}」`
          });
        }
      }
    }

    // 3. 跨会话反思产出的待处理建议
    const pendingIdeas = params.memoryPipeline.getReflectionIdeas(botId, userId).filter((i) => i.status === 'pending');
    for (const idea of pendingIdeas.slice(0, 1)) {
      const sigId = `idea:${idea.id}`;
      if (!deliveredSet.has(sigId)) {
        signals.push({
          id: sigId,
          line: `- 💡 **协同优化建议**：${idea.text}`
        });
      }
    }

    // 4. 最新未读的关注动态
    const feedData = params.feedStore.getFeedPosts(userId);
    const freshPost = (feedData.posts || []).find((p) => {
      if (p.dismissed) return false;
      const ageMs = now - new Date(p.ts).getTime();
      return ageMs <= 24 * 60 * 60_000 && !deliveredSet.has(`feed:${p.id}`);
    });
    if (freshPost) {
      signals.push({
        id: `feed:${freshPost.id}`,
        line: `- 📰 **为你捕捉到新动态**：[${freshPost.title}]${freshPost.sourceUrl ? `（[查看出处](${freshPost.sourceUrl})）` : ''}`
      });
    }

    if (signals.length === 0) {
      return { emitted: false, reason: 'no_signals' };
    }

    const header = isFirstBriefToday ? '早上好，为你同步几项值得关注的事项：' : '在你离开期间，有几项值得推进的动态提醒：';
    const message = `${header}\n\n${signals.map((s) => s.line).join('\n')}\n\n需要我现在帮你展开处理哪一项？直接回复序号或想法即可。`;

    const mainSession = params.sessionStore.getMainSession(botId, userId);
    if (!mainSession.messages) mainSession.messages = [];
    mainSession.messages.push({
      role: 'assistant',
      content: message
    });
    params.sessionStore.save(mainSession, userId);

    for (const sig of signals) {
      state.deliveredSignalIds.push(sig.id);
    }
    state.lastBriefAt = now;
    state.lastBriefDay = todayStr;
    this.saveState(userId, state);

    params.feedStore.recordActivity(userId, {
      kind: 'goal',
      title: '主动简报与提醒',
      text: signals.map((s) => s.line.replace(/^- /, '')).join(' · ').slice(0, 150),
      sessionId: mainSession.id,
      sessionTitle: mainSession.title
    });

    return {
      emitted: true,
      sessionId: mainSession.id,
      message,
      signalCount: signals.length
    };
  }
}
