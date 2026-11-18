import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session } from '@museclaw/protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class SessionStore {
  private sessions = new Map<string, Session>();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(__dirname, '../data/sessions.json');
    this.load();
  }

  private load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: Session[] = JSON.parse(raw);
        for (const item of list) {
          // 仅恢复包含有效消息记录的正式会话，自动滤除遗留的历史空会话
          if (item.messages && item.messages.length > 0) {
            this.sessions.set(item.id, item);
          }
        }
      } catch (err: any) {
        console.warn(`[SessionStore] 加载 sessions.json 异常: ${err.message}`);
      }
    }
  }

  public saveAll() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // 仅持久化包含实际消息记录的会话
      const dataToSave = Array.from(this.sessions.values()).filter(
        (s) => s.messages && s.messages.length > 0
      );
      const data = JSON.stringify(dataToSave, null, 2);
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err: any) {
      console.error(`[SessionStore] 保存 sessions.json 失败: ${err.message}`);
    }
  }

  public get(id: string, userId?: string): Session | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (userId && s.userId && s.userId !== userId) return undefined;
    return s;
  }

  /**
   * 创建新会话（强绑定指定 bot_id 与归属用户）
   */
  public create(id: string, botId: string, title = '新会话', userId?: string): Session {
    if (!botId) {
      throw new Error('创建会话必须指定归属的 bot_id');
    }

    const existing = this.sessions.get(id);
    if (existing) {
      if (existing.bot_id !== botId) {
        throw new Error(
          `禁止将已有会话换绑到另一 Bot (已有归属: ${existing.bot_id}, 请求归属: ${botId})`
        );
      }
      if (userId && !existing.userId) existing.userId = userId;
      return existing;
    }

    const now = Date.now();
    const session: Session = {
      id,
      bot_id: botId,
      botId,
      userId,
      title,
      created_at: now,
      updated_at: now,
      messages: []
    };

    this.sessions.set(id, session);
    this.saveAll();
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
    if (userId && !session.userId) session.userId = userId;
    session.updated_at = Date.now();

    this.sessions.set(session.id, session);
    this.saveAll();
  }

  /**
   * 列出所有会话，可选按 botId 和 userId 过滤 (默认过滤掉无消息的空会话)
   */
  public list(botId?: string, userId?: string, includeEmpty = false): Session[] {
    const all = Array.from(this.sessions.values()).filter(
      (s) => {
        const hasMsg = includeEmpty || (s.messages && s.messages.length > 0);
        if (!hasMsg) return false;
        if (userId && s.userId && s.userId !== userId) return false;
        return true;
      }
    );
    if (!botId) {
      return all.sort((a, b) => b.updated_at - a.updated_at);
    }
    return all.filter((s) => s.bot_id === botId).sort((a, b) => b.updated_at - a.updated_at);
  }

  public delete(id: string, userId?: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (userId && s.userId && s.userId !== userId) return false;
    const res = this.sessions.delete(id);
    if (res) this.saveAll();
    return res;
  }
}
