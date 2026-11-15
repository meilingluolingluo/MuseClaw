import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bot 静态专属记忆管理器 (对标 MEMORY.md 预算管理)
 * 纯文件轻量存储，不引入向量检索或后台抓取进程
 */
export class BotMemoryManager {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(__dirname, '../data/bots');
  }

  /**
   * 获取指定 Bot 的 MEMORY.md 文件路径
   */
  public getMemoryPath(botId: string): string {
    return path.join(this.baseDir, botId, 'MEMORY.md');
  }

  /**
   * 读取指定 Bot 的记忆内容（安全预算控制：最多 200 行或 24KB）
   */
  public getMemory(botId: string): string {
    const filePath = this.getMemoryPath(botId);
    if (!fs.existsSync(filePath)) {
      return '';
    }
    try {
      let content = fs.readFileSync(filePath, 'utf-8');
      // 截断控制：最多 24KB
      if (content.length > 24 * 1024) {
        content = content.slice(0, 24 * 1024) + '\n...[记忆内容已按 24KB 预算截断]';
      }
      // 行数控制：最多 200 行
      const lines = content.split('\n');
      if (lines.length > 200) {
        content = lines.slice(0, 200).join('\n') + '\n...[记忆行数已按 200 行预算截断]';
      }
      return content.trim();
    } catch (err: any) {
      console.warn(`[BotMemory] 读取 ${botId} 记忆异常: ${err.message}`);
      return '';
    }
  }

  /**
   * 保存或更新指定 Bot 的记忆内容
   */
  public saveMemory(botId: string, content: string): void {
    const filePath = this.getMemoryPath(botId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  /**
   * 为默认 Bot 提供初始记忆模板
   */
  public ensureDefaultMemory(botId: string, defaultContent: string): void {
    const filePath = this.getMemoryPath(botId);
    if (!fs.existsSync(filePath)) {
      this.saveMemory(botId, defaultContent);
    }
  }
}
