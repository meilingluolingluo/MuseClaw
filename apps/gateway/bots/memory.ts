import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseMemoryMarkdown,
  buildTidyPrompt,
  extractJsonProposals,
  planConsolidation,
  applyConsolidation,
  type TidyReport
} from './consolidate.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bot 静态专属记忆管理器 (对标 OpenMausBot 工作区架构与受控自整理)
 * 支持多用户物理隔离存储 (data/users/<userId>/bots/<botId>/MEMORY.md)
 * 纯 Markdown 文件轻量存储，具备确定性记忆去冗余与一键撤销能力
 */
export class BotMemoryManager {
  private rootDir: string;

  constructor(baseDir?: string) {
    const givenPath = baseDir || path.resolve(__dirname, '../data');
    if (givenPath.endsWith('/bots') || givenPath.endsWith('\\bots')) {
      this.rootDir = path.dirname(givenPath);
    } else {
      this.rootDir = givenPath;
    }
  }

  /**
   * 解析指定 Bot 与用户的物理存储目录
   */
  public getBotDir(botId: string, userId?: string): string {
    const sanitizedUserId = userId ? userId.replace(/[^\w-]/g, '_') : undefined;
    if (sanitizedUserId && sanitizedUserId !== 'global' && sanitizedUserId !== 'admin') {
      return path.join(this.rootDir, 'users', sanitizedUserId, 'bots', botId);
    }
    return path.join(this.rootDir, 'bots', botId);
  }

  /**
   * 获取指定 Bot 与用户对应的 MEMORY.md 文件路径
   */
  public getMemoryPath(botId: string, userId?: string): string {
    return path.join(this.getBotDir(botId, userId), 'MEMORY.md');
  }

  public getBackupMemoryPath(botId: string, userId?: string): string {
    return path.join(this.getBotDir(botId, userId), 'MEMORY.md.bak');
  }

  public getReportsPath(botId: string, userId?: string): string {
    return path.join(this.getBotDir(botId, userId), 'consolidate_reports.json');
  }

  /**
   * 读取指定 Bot 与用户的记忆内容（安全预算控制：最多 200 行或 24KB）
   * 若用户专属记忆尚未创建，自动回退继承该 Bot 的系统预置初始记忆模板
   */
  public getMemory(botId: string, userId?: string): string {
    let filePath = this.getMemoryPath(botId, userId);
    if (!fs.existsSync(filePath) && userId && userId !== 'global' && userId !== 'admin') {
      filePath = this.getMemoryPath(botId);
    }
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
      console.warn(`[BotMemory] 读取 ${botId} (用户: ${userId || 'global'}) 记忆异常: ${err.message}`);
      return '';
    }
  }

  /**
   * 保存或更新指定 Bot 与用户的记忆内容
   */
  public saveMemory(botId: string, content: string, userId?: string): void {
    const filePath = this.getMemoryPath(botId, userId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  /**
   * 为指定 Bot 提供初始记忆模板
   */
  public ensureDefaultMemory(botId: string, defaultContent: string, userId?: string): void {
    const filePath = this.getMemoryPath(botId, userId);
    if (!fs.existsSync(filePath)) {
      this.saveMemory(botId, defaultContent, userId);
    }
  }

  /**
   * 执行受控长期记忆整理 (Memory Consolidation)
   * 遵循确定性死线保护（实体守恒、用户声明锚点保护、20% 预算约束）
   */
  public async consolidateMemory(
    botId: string,
    llmCaller: (prompt: string) => Promise<string>,
    options?: { dryRun?: boolean; budgetShare?: number },
    userId?: string
  ): Promise<TidyReport> {
    const rawContent = this.getMemory(botId, userId);
    const { items } = parseMemoryMarkdown(rawContent);

    if (items.length < 2) {
      return {
        botId,
        timestamp: Date.now(),
        considered: items.length,
        changed: 0,
        merged: [],
        dropped: [],
        skipped: ['事实条目少于 2 条，无需整理'],
        planned: [],
        more: false,
        dryRun: Boolean(options?.dryRun)
      };
    }

    const prompt = buildTidyPrompt(items);
    const reply = await llmCaller(prompt);
    const rawProposals = extractJsonProposals(reply);

    const { ops, skipped, more } = planConsolidation(
      items,
      rawProposals,
      options?.budgetShare ?? 0.2
    );

    const { newMarkdown, report } = applyConsolidation(
      rawContent,
      items,
      ops,
      botId,
      skipped,
      more,
      Boolean(options?.dryRun)
    );

    if (!options?.dryRun && report.changed > 0) {
      // 1. 创建专属回滚备份
      const bakPath = this.getBackupMemoryPath(botId, userId);
      const bakDir = path.dirname(bakPath);
      if (!fs.existsSync(bakDir)) {
        fs.mkdirSync(bakDir, { recursive: true });
      }
      fs.writeFileSync(bakPath, rawContent, 'utf-8');

      // 2. 存入新整理后的记忆文本
      this.saveMemory(botId, newMarkdown, userId);

      // 3. 记录专属审计报告日志
      this.saveReport(botId, report, userId);
    }

    return report;
  }

  /**
   * 一键撤销上一次记忆整理变更 (Undo)
   */
  public undoLastConsolidation(botId: string, userId?: string): {
    success: boolean;
    message: string;
    restoredMemory?: string;
  } {
    const bakPath = this.getBackupMemoryPath(botId, userId);
    if (!fs.existsSync(bakPath)) {
      return { success: false, message: '未找到可撤销的历史备份记录' };
    }

    try {
      const backupContent = fs.readFileSync(bakPath, 'utf-8');
      const curContent = this.getMemory(botId, userId);

      // 将当前与备份互换，支持反撤销
      this.saveMemory(botId, backupContent, userId);
      fs.writeFileSync(bakPath, curContent, 'utf-8');

      console.log(`[BotMemory:Undo] Bot ${botId} (用户: ${userId || 'global'}) 记忆已成功恢复至上一次整理前状态`);
      return {
        success: true,
        message: '已成功撤销最近一次整理变更，记忆已还原',
        restoredMemory: backupContent
      };
    } catch (err: any) {
      return { success: false, message: `撤销失败: ${err.message}` };
    }
  }

  /**
   * 获取指定 Bot 与用户的整理历史记录
   */
  public getConsolidationHistory(botId: string, userId?: string): TidyReport[] {
    let repPath = this.getReportsPath(botId, userId);
    if (!fs.existsSync(repPath) && userId && userId !== 'global' && userId !== 'admin') {
      repPath = this.getReportsPath(botId);
    }
    if (!fs.existsSync(repPath)) {
      return [];
    }
    try {
      return JSON.parse(fs.readFileSync(repPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private saveReport(botId: string, report: TidyReport, userId?: string): void {
    const repPath = this.getReportsPath(botId, userId);
    const dir = path.dirname(repPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const history = this.getConsolidationHistory(botId, userId);
    history.unshift(report);
    // 最多保留最近 50 条报告
    const trimmed = history.slice(0, 50);
    fs.writeFileSync(repPath, JSON.stringify(trimmed, null, 2), 'utf-8');
  }
}
