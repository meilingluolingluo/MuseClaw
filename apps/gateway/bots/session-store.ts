import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session } from '@museclaw/protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 员工专属会话存储管理器
 * 每个员工的会话独立落盘于 data/users/<userId>/sessions.json，
 * 采用独立物理文件存储与原子落盘机制，彻底杜绝数据交叉与并发写入冲突。
 */
export class SessionStore {
  private userSessions = new Map<string, Map<string, Session>>();
  private baseDir: string;

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
          if (item.messages && item.messages.length > 0) {
            item.userId = sanitized;
            sessionMap.set(item.id, item);
          }
        }
      } catch (err: any) {
        console.warn(`[SessionStore] 载入用户 ${sanitized} 会话异常: ${err.message}`);
      }
    }
    return sessionMap;
  }

  private saveUser(userId: string): void {
    const sanitized = userId.replace(/[^\w-]/g, '_');
    const targetFile = this.getUserFilePath(sanitized);
    const sessionMap = this.userSessions.get(sanitized);
    if (!sessionMap) return;

    try {
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const list = Array.from(sessionMap.values()).filter(
        (s) => s.messages && s.messages.length > 0
      );

      const data = JSON.stringify(list, null, 2);
      const tmpPath = `${targetFile}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, targetFile);
    } catch (err: any) {
      console.error(`[SessionStore] 持久化员工 ${sanitized} 会话失败: ${err.message}`);
    }
  }

  public create(id: string, botId: string, title = '新会话', userId: string): Session {
    if (!botId) {
      throw new Error('创建会话必须指定归属的 bot_id');
    }
    if (!userId) {
      throw new Error('创建会话必须指定归属的员工身份 userId');
    }

    const sanitized = userId.replace(/[^\w-]/g, '_');
    const sessionMap = this.loadUser(sanitized);

    const existing = sessionMap.get(id);
    if (existing) {
      if (existing.bot_id !== botId) {
        throw new Error(`禁止将会话换绑到另一 Bot (${existing.bot_id} -> ${botId})`);
      }
      return existing;
    }

    const now = Date.now();
    const session: Session = {
      id,
      bot_id: botId,
      botId,
      userId: sanitized,
      title,
      created_at: now,
      updated_at: now,
      messages: []
    };

    sessionMap.set(id, session);
    this.saveUser(sanitized);
    return session;
  }

  public save(session: Session, userId: string): void {
    if (!session.bot_id && !session.botId) {
      throw new Error('会话缺少必填字段 bot_id');
    }
    const effectiveUserId = (userId || session.userId)?.replace(/[^\w-]/g, '_');
    if (!effectiveUserId) {
      throw new Error('保存会话必须指定归属的员工身份 userId');
    }

    const sessionMap = this.loadUser(effectiveUserId);
    const targetBotId = session.bot_id || session.botId!;

    const existing = sessionMap.get(session.id);
    if (existing && existing.bot_id !== targetBotId) {
      throw new Error(`禁止将会话换绑到另一 Bot (${existing.bot_id} -> ${targetBotId})`);
    }

    session.bot_id = targetBotId;
    session.botId = targetBotId;
    session.userId = effectiveUserId;
    session.updated_at = Date.now();

    sessionMap.set(session.id, session);
    this.saveUser(effectiveUserId);
  }

  public get(id: string, userId: string): Session | undefined {
    if (!userId) return undefined;
    const sanitized = userId.replace(/[^\w-]/g, '_');
    const sessionMap = this.loadUser(sanitized);
    return sessionMap.get(id);
  }

  public list(botId?: string, userId?: string, includeEmpty = false): Session[] {
    if (!userId) return [];
    const sanitized = userId.replace(/[^\w-]/g, '_');
    const sessionMap = this.loadUser(sanitized);

    const all = Array.from(sessionMap.values()).filter((s) => {
      const hasMsg = includeEmpty || (s.messages && s.messages.length > 0);
      return hasMsg;
    });

    if (!botId) {
      return all.sort((a, b) => b.updated_at - a.updated_at);
    }
    return all.filter((s) => s.bot_id === botId).sort((a, b) => b.updated_at - a.updated_at);
  }

  public delete(id: string, userId: string): boolean {
    if (!userId) return false;
    const sanitized = userId.replace(/[^\w-]/g, '_');
    const sessionMap = this.loadUser(sanitized);
    const existing = sessionMap.get(id);
    if (!existing) return false;

    const res = sessionMap.delete(id);
    if (res) {
      this.saveUser(sanitized);
    }
    return res;
  }
}
