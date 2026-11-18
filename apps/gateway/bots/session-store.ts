import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session } from '@museclaw/protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 会话存储管理器 (对标 OpenMausBot 工作区多用户物理隔离存储架构)
 * 支持每个用户独立目录落盘 (data/users/<userId>/sessions.json)，避免单一大文件并发冲突与数据串扰
 */
export class SessionStore {
  private sessions = new Map<string, Session>();
  private dataDir: string;
  private defaultFilePath: string;
  private loadedUsers = new Set<string>();

  constructor(baseDir?: string) {
    const givenPath = baseDir || path.resolve(__dirname, '../data');
    if (givenPath.endsWith('.json')) {
      this.defaultFilePath = givenPath;
      this.dataDir = path.dirname(givenPath);
    } else {
      this.dataDir = givenPath;
      this.defaultFilePath = path.join(givenPath, 'sessions.json');
    }
    this.ensureDirs();
    this.loadLegacySessions();
    this.scanAndLoadUserSessions();
  }

  private ensureDirs() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    const usersDir = path.join(this.dataDir, 'users');
    if (!fs.existsSync(usersDir)) {
      fs.mkdirSync(usersDir, { recursive: true });
    }
  }

  /**
   * 获取指定用户会话文件的物理落盘路径
   */
  public getUserFilePath(userId?: string): string {
    const sanitized = userId ? userId.replace(/[^\w-]/g, '_') : undefined;
    if (sanitized && sanitized !== 'default' && sanitized !== 'global') {
      return path.join(this.dataDir, 'users', sanitized, 'sessions.json');
    }
    return this.defaultFilePath;
  }

  /**
   * 载入遗留默认 sessions.json 会话
   */
  private loadLegacySessions() {
    if (fs.existsSync(this.defaultFilePath)) {
      try {
        const raw = fs.readFileSync(this.defaultFilePath, 'utf-8');
        const list: Session[] = JSON.parse(raw);
        for (const item of list) {
          if (item.messages && item.messages.length > 0) {
            this.sessions.set(item.id, item);
          }
        }
      } catch (err: any) {
        console.warn(`[SessionStore] 加载默认 sessions.json 异常: ${err.message}`);
      }
    }
  }

  /**
   * 扫描并预热已有用户的专属会话记录
   */
  private scanAndLoadUserSessions() {
    const usersDir = path.join(this.dataDir, 'users');
    if (!fs.existsSync(usersDir)) return;
    try {
      const entries = fs.readdirSync(usersDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          this.loadUserSessions(entry.name);
        }
      }
    } catch (err: any) {
      console.warn(`[SessionStore] 扫描用户会话目录异常: ${err.message}`);
    }
  }

  /**
   * 按需加载指定用户的专属会话
   */
  public loadUserSessions(userId: string) {
    const sanitized = userId.replace(/[^\w-]/g, '_');
    const userFile = this.getUserFilePath(sanitized);
    this.loadedUsers.add(sanitized);
    if (!fs.existsSync(userFile)) return;
    try {
      const raw = fs.readFileSync(userFile, 'utf-8');
      const list: Session[] = JSON.parse(raw);
      for (const item of list) {
        if (item.messages && item.messages.length > 0) {
          if (!item.userId) item.userId = sanitized;
          this.sessions.set(item.id, item);
        }
      }
    } catch (err: any) {
      console.warn(`[SessionStore] 加载用户 ${sanitized} 会话异常: ${err.message}`);
    }
  }

  /**
   * 保存指定用户的会话数据到专属物理文件 (原子写入)
   */
  public saveUserSessions(userId?: string) {
    const sanitized = userId ? userId.replace(/[^\w-]/g, '_') : undefined;
    const targetFile = this.getUserFilePath(sanitized);
    try {
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const userSessions = Array.from(this.sessions.values()).filter((s) => {
        if (!s.messages || s.messages.length === 0) return false;
        if (sanitized && sanitized !== 'default' && sanitized !== 'global') {
          return s.userId === sanitized;
        }
        return !s.userId || s.userId === 'default' || s.userId === 'global';
      });

      const data = JSON.stringify(userSessions, null, 2);
      const tmpPath = `${targetFile}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, targetFile);
    } catch (err: any) {
      console.error(`[SessionStore] 保存会话文件 (${targetFile}) 失败: ${err.message}`);
    }
  }

  public saveAll() {
    const userIds = new Set<string>();
    for (const s of this.sessions.values()) {
      if (s.userId) userIds.add(s.userId);
      else userIds.add('default');
    }
    for (const uid of userIds) {
      this.saveUserSessions(uid);
    }
  }

  public get(id: string, userId?: string): Session | undefined {
    const sanitized = userId ? userId.replace(/[^\w-]/g, '_') : undefined;
    let s = this.sessions.get(id);
    if (!s && sanitized && !this.loadedUsers.has(sanitized)) {
      this.loadUserSessions(sanitized);
      s = this.sessions.get(id);
    }
    if (!s) return undefined;
    if (sanitized && s.userId && s.userId !== sanitized) return undefined;
    return s;
  }

  /**
   * 创建新会话（强绑定指定 bot_id 与归属用户，并写入专属物理文件）
   */
  public create(id: string, botId: string, title = '新会话', userId?: string): Session {
    if (!botId) {
      throw new Error('创建会话必须指定归属的 bot_id');
    }
    const sanitizedUserId = userId ? userId.replace(/[^\w-]/g, '_') : undefined;
    const existing = this.sessions.get(id);
    if (existing) {
      if (existing.bot_id !== botId) {
        throw new Error(
          `禁止将已有会话换绑到另一 Bot (已有归属: ${existing.bot_id}, 请求归属: ${botId})`
        );
      }
      if (sanitizedUserId && !existing.userId) existing.userId = sanitizedUserId;
      return existing;
    }

    const now = Date.now();
    const session: Session = {
      id,
      bot_id: botId,
      botId,
      userId: sanitizedUserId,
      title,
      created_at: now,
      updated_at: now,
      messages: []
    };

    this.sessions.set(id, session);
    this.saveUserSessions(sanitizedUserId);
    return session;
  }

  /**
   * 保存或更新会话（严格校验 bot_id 不可变更）
   */
  public save(session: Session, userId?: string) {
    if (!session.bot_id && !session.botId) {
      throw new Error('会话数据缺少必填字段 bot_id');
    }
    const targetBotId = session.bot_id || session.botId!;

    const existing = this.sessions.get(session.id);
    if (existing && existing.bot_id !== targetBotId) {
      throw new Error(
        `禁止将已有会话换绑到另一 Bot (已有归属: ${existing.bot_id}, 尝试变更: ${targetBotId})`
      );
    }

    session.bot_id = targetBotId;
    session.botId = targetBotId;
    const effectiveUserId = userId || session.userId || existing?.userId;
    if (effectiveUserId) {
      session.userId = effectiveUserId;
    }
    session.updated_at = Date.now();

    this.sessions.set(session.id, session);
    this.saveUserSessions(session.userId);
  }

  /**
   * 列出所有会话，可选按 botId 和 userId 过滤 (默认过滤掉无消息的空会话)
   */
  public list(botId?: string, userId?: string, includeEmpty = false): Session[] {
    const sanitized = userId ? userId.replace(/[^\w-]/g, '_') : undefined;
    if (sanitized && !this.loadedUsers.has(sanitized)) {
      this.loadUserSessions(sanitized);
    }

    const all = Array.from(this.sessions.values()).filter((s) => {
      const hasMsg = includeEmpty || (s.messages && s.messages.length > 0);
      if (!hasMsg) return false;
      if (sanitized) {
        if (s.userId && s.userId !== sanitized) return false;
        if (!s.userId && sanitized !== 'admin') return false;
      }
      return true;
    });

    if (!botId) {
      return all.sort((a, b) => b.updated_at - a.updated_at);
    }
    return all.filter((s) => s.bot_id === botId).sort((a, b) => b.updated_at - a.updated_at);
  }

  public delete(id: string, userId?: string): boolean {
    const s = this.get(id, userId);
    if (!s) return false;
    const userToSave = s.userId;
    const res = this.sessions.delete(id);
    if (res) {
      this.saveUserSessions(userToSave);
    }
    return res;
  }
}
