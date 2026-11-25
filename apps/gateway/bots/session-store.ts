import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session } from '@museclaw/protocol';
import { splitReasoningAndContent } from '../../../packages/sandbox-core/src/reasoning.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 员工专属会话存储管理器
 * 每个员工的会话独立落盘于 data/users/<userId>/sessions.json，
 * 采用独立物理文件存储与原子落盘机制，彻底杜绝数据交叉与并发写入冲突。
 */
export class SessionStore {
  private userSessions = new Map<string, Map<string, Session>>();
  private baseDir: string;
  private saveTimers = new Map<string, NodeJS.Timeout>();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(__dirname, '../data/users');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    this.scanAndLoadUsers();
  }

  public getUserFilePath(userId: string): string {
    const sanitized = userId.replace(/[^\w-]/g, '_');
    return path.join(this.baseDir, sanitized, 'sessions.json');
  }

  private scanAndLoadUsers(): void {
    if (!fs.existsSync(this.baseDir)) return;
    try {
      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          this.loadUser(entry.name);
        }
      }
    } catch (err: any) {
      console.warn(`[SessionStore] 扫描用户会话目录异常: ${err.message}`);
    }
  }

  private loadUser(userId: string): Map<string, Session> {
    const sanitized = userId.replace(/[^\w-]/g, '_');
    if (this.userSessions.has(sanitized)) {
      return this.userSessions.get(sanitized)!;
    }

    const sessionMap = new Map<string, Session>();
    this.userSessions.set(sanitized, sessionMap);

    const userFile = this.getUserFilePath(sanitized);
    if (fs.existsSync(userFile)) {
      try {
        const raw = fs.readFileSync(userFile, 'utf-8');
        const list: Session[] = JSON.parse(raw);
        for (const item of list) {
          item.userId = sanitized;
          if (Array.isArray(item.messages)) {
            for (const m of item.messages) {
              if (m.role === 'assistant' && m.content) {
                const { content, reasoning } = splitReasoningAndContent(m.content, m.reasoning);
                m.content = content;
                if (reasoning) {
                  m.reasoning = reasoning;
                }
              }
            }
          }
          sessionMap.set(item.id, item);
        }
      } catch (err: any) {
        console.warn(`[SessionStore] 载入用户 ${sanitized} 会话异常: ${err.message}`);
      }
    }
    return sessionMap;
  }

  private async flushUserDirect(sanitized: string): Promise<void> {
    const targetFile = this.getUserFilePath(sanitized);
    const sessionMap = this.userSessions.get(sanitized);
    if (!sessionMap) return;
    try {
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // 保存全量会话（包含新创建的空会话），并对过长会话历史截断最近 200 条以防无限膨胀
      const list = Array.from(sessionMap.values()).map((s) => {
        if (s.messages && s.messages.length > 200) {
          return {
            ...s,
            messages: s.messages.slice(-200)
          };
        }
        return s;
      });

      const data = JSON.stringify(list, null, 2);
      const tmpPath = `${targetFile}.tmp.${Date.now()}`;
      await fs.promises.writeFile(tmpPath, data, 'utf-8');
      await fs.promises.rename(tmpPath, targetFile);
    } catch (err: any) {
      console.error(`[SessionStore] 持久化员工 ${sanitized} 会话失败: ${err.message}`);
    }
  }

  public async flush(userId?: string): Promise<void> {
    if (userId) {
      const sanitized = userId.replace(/[^\w-]/g, '_');
      const timer = this.saveTimers.get(sanitized);
      if (timer) {
        clearTimeout(timer);
        this.saveTimers.delete(sanitized);
      }
      await this.flushUserDirect(sanitized);
    } else {
      const users = Array.from(this.saveTimers.keys());
      for (const u of users) {
        const timer = this.saveTimers.get(u);
        if (timer) {
          clearTimeout(timer);
          this.saveTimers.delete(u);
        }
        await this.flushUserDirect(u);
      }
    }
  }

  private saveUser(userId: string): void {
    const sanitized = userId.replace(/[^\w-]/g, '_');
    const sessionMap = this.userSessions.get(sanitized);
    if (!sessionMap) return;

    // 清除已有的防抖定时器并防抖异步刷盘
    if (this.saveTimers.has(sanitized)) {
      clearTimeout(this.saveTimers.get(sanitized)!);
    }

    const timer = setTimeout(async () => {
      this.saveTimers.delete(sanitized);
      await this.flushUserDirect(sanitized);
    }, 50);

    this.saveTimers.set(sanitized, timer);
  }

  public create(
    id: string,
    botId: string,
    title = '新会话',
    userId = 'system_proactive',
    kind?: 'main' | 'side'
  ): Session {
    if (!botId) {
      throw new Error('创建会话必须指定归属的 bot_id');
    }
    const effectiveUserId = userId || 'system_proactive';
    const sanitized = effectiveUserId.replace(/[^\w-]/g, '_');

    // 核心约束：主聊类型、标识或指定主聊标题的会话统一收敛委托给 getMainSession，保证严格单例
    const isMainRequested =
      kind === 'main' ||
      id.endsWith('_main') ||
      id === 'main' ||
      title === '主要聊天';

    if (isMainRequested) {
      return this.getMainSession(botId, sanitized);
    }

    const sessionMap = this.loadUser(sanitized);

    // 旁聊标题保护：严禁非主聊使用“主要聊天”名称
    const safeTitle = title && title !== '主要聊天' ? title : '新旁聊';

    const existing = sessionMap.get(id);
    if (existing) {
      if (existing.bot_id !== botId) {
        throw new Error(`禁止将会话换绑到另一 Bot (${existing.bot_id} -> ${botId})`);
      }
      if (!existing.kind) {
        existing.kind = 'side';
      }
      return existing;
    }

    const now = Date.now();
    const session: Session = {
      id,
      bot_id: botId,
      botId,
      userId: sanitized,
      title: safeTitle,
      kind: 'side',
      created_at: now,
      updated_at: now,
      messages: []
    };

    sessionMap.set(id, session);
    this.saveUser(sanitized);
    return session;
  }

  /**
   * 获取或初始化指定 Bot 的常驻主聊 (Main Chat)
   * 严格保证每个数字员工仅有且仅能有一个主聊会话 (单例约束)。
   */
  public getMainSession(botId: string, userId = 'system_proactive'): Session {
    if (!botId) {
      throw new Error('获取常驻主聊必须指定 bot_id');
    }
    const effectiveUserId = userId || 'system_proactive';
    const sanitized = effectiveUserId.replace(/[^\w-]/g, '_');
    const sessionMap = this.loadUser(sanitized);

    const canonicalMainId = `sess_${botId}_main`;

    let mainSession = sessionMap.get(canonicalMainId);

    // 若尚未存在规范 ID，查找历史遗留的主聊会话
    if (!mainSession) {
      for (const sess of sessionMap.values()) {
        if (
          sess.bot_id === botId &&
          (sess.kind === 'main' || sess.id.endsWith('_main') || sess.id === 'main')
        ) {
          mainSession = sess;
          break;
        }
      }
    }

    if (!mainSession) {
      const now = Date.now();
      mainSession = {
        id: canonicalMainId,
        bot_id: botId,
        botId,
        userId: sanitized,
        title: '主要聊天',
        kind: 'main',
        created_at: now,
        updated_at: now,
        messages: []
      };
      sessionMap.set(canonicalMainId, mainSession);
    } else {
      mainSession.kind = 'main';
      mainSession.title = '主要聊天';
      if (mainSession.id !== canonicalMainId && !sessionMap.has(canonicalMainId)) {
        // 平滑迁移旧 ID 到规范主聊 ID
        sessionMap.delete(mainSession.id);
        mainSession.id = canonicalMainId;
        sessionMap.set(canonicalMainId, mainSession);
      }
    }

    // 单例约束与数据清洗：移除重影空会话，确保同一 Bot 下其余会话均降级为旁聊
    for (const [sId, sess] of Array.from(sessionMap.entries())) {
      if (sess.bot_id === botId && sId !== mainSession.id) {
        if (sess.kind === 'main') {
          sess.kind = 'side';
        }
        if (sess.title === '主要聊天') {
          if (!sess.messages || sess.messages.length === 0) {
            sessionMap.delete(sId);
          } else {
            sess.title = '历史旁聊';
            sess.kind = 'side';
          }
        }
      }
    }

    this.saveUser(sanitized);
    return mainSession;
  }

  public save(session: Session, userId?: string): void {
    if (!session.bot_id && !session.botId) {
      throw new Error('会话缺少必填字段 bot_id');
    }
    const rawUserId = userId || session.userId || (session as any).user_id || 'system_proactive';
    const effectiveUserId = rawUserId.replace(/[^\w-]/g, '_');

    const sessionMap = this.loadUser(effectiveUserId);
    const targetBotId = session.bot_id || session.botId!;

    const existing = sessionMap.get(session.id);
    if (existing && existing.bot_id !== targetBotId) {
      throw new Error(`禁止将会话换绑到另一 Bot (${existing.bot_id} -> ${targetBotId})`);
    }

    session.bot_id = targetBotId;
    session.botId = targetBotId;
    session.userId = effectiveUserId;
    if (!session.kind) {
      session.kind = existing?.kind || (session.id.endsWith('_main') || session.id === 'main' ? 'main' : 'side');
    }
    session.updated_at = Date.now();

    if (Array.isArray(session.messages)) {
      for (const m of session.messages) {
        if (m.role === 'assistant' && m.content) {
          const { content, reasoning } = splitReasoningAndContent(m.content, m.reasoning);
          m.content = content;
          if (reasoning) {
            m.reasoning = reasoning;
          }
        }
      }
    }

    sessionMap.set(session.id, session);
    this.saveUser(effectiveUserId);
  }

  public get(id: string, userId: string): Session | undefined {
    if (!userId) return undefined;
    const sanitized = userId.replace(/[^\w-]/g, '_');
    const sessionMap = this.loadUser(sanitized);
    const sess = sessionMap.get(id);
    if (sess && !sess.kind) {
      sess.kind = sess.id.endsWith('_main') || sess.id === 'main' ? 'main' : 'side';
    }
    return sess;
  }

  public list(botId?: string, userIdOrIncludeEmpty?: string | boolean, includeEmpty = false): Session[] {
    let userId = 'system_proactive';
    let incEmpty = includeEmpty;

    if (typeof userIdOrIncludeEmpty === 'boolean') {
      incEmpty = userIdOrIncludeEmpty;
    } else if (typeof userIdOrIncludeEmpty === 'string' && userIdOrIncludeEmpty) {
      userId = userIdOrIncludeEmpty;
    }

    const sanitized = userId.replace(/[^\w-]/g, '_');
    const sessionMap = this.loadUser(sanitized);

    const all = Array.from(sessionMap.values()).filter((s) => {
      // 过滤掉非规范 ID 且无内容的重名“主要聊天”幽灵会话
      const isCanonicalMain = s.id === `sess_${s.bot_id || s.botId}_main` || s.id.endsWith('_main') || s.id === 'main';
      if (!isCanonicalMain && s.title === '主要聊天' && (!s.messages || s.messages.length === 0)) {
        return false;
      }
      const hasMsg = incEmpty || (s.messages && s.messages.length > 0);
      return hasMsg;
    });

    const targetList = botId ? all.filter((s) => s.bot_id === botId || s.botId === botId) : all;

    // 排序逻辑：常驻主聊 (kind: 'main') 始终置顶，其余旁聊按更新时间倒序排列
    return targetList.sort((a, b) => {
      const aMain = a.kind === 'main' || a.id.endsWith('_main') || a.id === 'main';
      const bMain = b.kind === 'main' || b.id.endsWith('_main') || b.id === 'main';
      if (aMain && !bMain) return -1;
      if (!aMain && bMain) return 1;
      return (b.updated_at || 0) - (a.updated_at || 0);
    });
  }

  public clear(id: string, userId = 'system_proactive'): boolean {
    const effectiveUserId = userId || 'system_proactive';
    const sanitized = effectiveUserId.replace(/[^\w-]/g, '_');
    const sessionMap = this.loadUser(sanitized);
    const existing = sessionMap.get(id);
    if (!existing) return false;
    existing.messages = [];
    existing.updated_at = Date.now();
    this.saveUser(sanitized);
    return true;
  }

  public delete(id: string, userId = 'system_proactive'): boolean {
    const effectiveUserId = userId || 'system_proactive';
    const sanitized = effectiveUserId.replace(/[^\w-]/g, '_');
    const sessionMap = this.loadUser(sanitized);
    const existing = sessionMap.get(id);
    if (!existing) return false;

    // 常驻主聊 (main) 禁止物理删除，执行清空重置
    const isMain = existing.kind === 'main' || existing.id.endsWith('_main') || existing.id === 'main';
    if (isMain) {
      existing.messages = [];
      existing.updated_at = Date.now();
      this.saveUser(sanitized);
      return true;
    }

    // 旁聊 (side) 正常物理删除
    const res = sessionMap.delete(id);
    if (res) {
      this.saveUser(sanitized);
    }
    return res;
  }
}
