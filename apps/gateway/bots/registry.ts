import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentProfile } from '@museclaw/protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class BotRegistry {
  private bots = new Map<string, AgentProfile>();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(__dirname, '../data/bots.json');
    this.load();
    this.ensureDefault();
  }

  private load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: AgentProfile[] = JSON.parse(raw);
        for (const item of list) {
          this.bots.set(item.id, item);
        }
      } catch (err: any) {
        console.warn(`[BotRegistry] 加载 bots.json 异常: ${err.message}`);
      }
    }
  }

  public save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.bots.values()), null, 2);
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err: any) {
      console.error(`[BotRegistry] 保存 bots.json 失败: ${err.message}`);
    }
  }

  /**
   * 启动时确保至少存在一个默认 Bot (Muse 协调者)
   */
  public ensureDefault(): AgentProfile {
    if (this.bots.size === 0) {
      const defaultBot: AgentProfile = {
        id: 'muse',
        name: '小哀',
        description: 'MuseClaw 智能数字员工与协调助手',
        system_prompt: '你是一个敏捷、自驱动的自动化代码与运维助手。直奔要点，执行命令与编辑文件前先做必要安全检查，以最少交互最快落地用户诉求。\n【网络通信与飞书推送重要规程】：\n1. 命令执行沙箱采用隔离策略（禁外网/无外部DNS），严禁在沙箱 Shell 中通过 curl、wget 直连 open.feishu.cn 等外部接口。\n2. 发送飞书通知、报告或消息时，直接调用内置工具 feishu_send_message，由宿主网关代理获取 Token 并完成消息外发。\n3. 调用 feishu_send_message 时，若未指定接收人会自动路由至系统默认通知人；推荐使用富文本互动卡片 (msg_type: "interactive")。',
        tool_allowlist: ['*'],
        memory_ns: 'bots/muse',
        is_coordinator: true,
        enabled: true,
        avatar: 'haibara',
        created_at: Date.now(),
        updated_at: Date.now()
      };
      this.bots.set(defaultBot.id, defaultBot);
      this.save();
      return defaultBot;
    }
    // 返回现有的 coordinator 或第一个
    const firstBot = this.getCoordinator() || this.list()[0];
    if (firstBot && !firstBot.avatar) {
      firstBot.avatar = 'haibara';
      this.save();
    }
    return firstBot;
  }

  public list(): AgentProfile[] {
    return Array.from(this.bots.values());
  }

  public get(id: string): AgentProfile | undefined {
    return this.bots.get(id);
  }

  /**
   * 按名称忽略大小写查找已启用的 Bot
   */
  public findByName(name: string): AgentProfile | undefined {
    const clean = name.trim().toLowerCase();
    if (!clean) return undefined;
    for (const b of this.bots.values()) {
      if (b.enabled && b.name.trim().toLowerCase() === clean) {
        return b;
      }
    }
    return undefined;
  }

  public getCoordinator(): AgentProfile | undefined {
    for (const b of this.bots.values()) {
      if (b.enabled && b.is_coordinator) {
        return b;
      }
    }
    return undefined;
  }

  public create(data: Partial<AgentProfile> & { name: string }): AgentProfile {
    const id = data.id || `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();

    const isCoordinator = Boolean(data.is_coordinator);
    if (isCoordinator) {
      this.clearOtherCoordinators(id);
    }

    const profile: AgentProfile = {
      id,
      name: data.name.trim(),
      description: data.description || '',
      system_prompt: data.system_prompt || data.systemPrompt || '你是一个企业内部严谨、高效的自动化数字员工。',
      model: data.model || 'deepseek-chat',
      tool_allowlist: Array.isArray(data.tool_allowlist) ? data.tool_allowlist : ['*'],
      memory_ns: data.memory_ns || `bots/${id}`,
      is_coordinator: isCoordinator,
      enabled: data.enabled !== false,
      avatar: data.avatar || 'haibara',
      created_at: now,
      updated_at: now
    };

    this.bots.set(id, profile);
    this.save();
    return profile;
  }

  public update(id: string, patch: Partial<AgentProfile>): AgentProfile {
    const bot = this.bots.get(id);
    if (!bot) {
      throw new Error(`Bot [${id}] 不存在`);
    }

    if (patch.is_coordinator) {
      this.clearOtherCoordinators(id);
    }

    const updated: AgentProfile = {
      ...bot,
      ...patch,
      id: bot.id, // ID 不允许修改
      created_at: bot.created_at,
      updated_at: Date.now()
    };

    this.bots.set(id, updated);
    this.save();
    return updated;
  }

  public delete(id: string): boolean {
    const exists = this.bots.delete(id);
    if (exists) {
      this.save();
      // 如果删除了最后一个，恢复默认
      if (this.bots.size === 0) {
        this.ensureDefault();
      }
    }
    return exists;
  }

  private clearOtherCoordinators(exceptId?: string) {
    for (const [key, b] of this.bots.entries()) {
      if (key !== exceptId && b.is_coordinator) {
        b.is_coordinator = false;
        b.updated_at = Date.now();
      }
    }
  }
}
