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

const DEFAULT_BOT_TEMPLATES: Record<string, string> = {
  muse: '# Muse 核心记忆与准则\n- 企业自动化总协调助手。\n- 优先调用工具解决问题，回答清晰精炼。',
  ops_bot: '# OpsBot 运维记忆与准则\n- 专职企业环境、容器、服务健康监控与运维管理。',
  dev_bot: '# DevBot 研发协同记忆与准则\n- 专职代码审查、分支合流与构建部署。'
};

/**
 * 员工专属 Bot 记忆管理器
 * 数据按用户严格物理隔离，落盘于 data/users/<userId>/bots/<botId>/ 目录下。
 */
export class BotMemoryManager {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.resolve(__dirname, '../data/users');
  }

  public getBotDir(botId: string, userId: string): string {
    const sanitizedUser = userId.replace(/[^\w-]/g, '_');
    return path.join(this.baseDir, sanitizedUser, 'bots', botId);
  }

  public getMemoryPath(botId: string, userId: string): string {
    return path.join(this.getBotDir(botId, userId), 'MEMORY.md');
  }

  public getBackupMemoryPath(botId: string, userId: string): string {
    return path.join(this.getBotDir(botId, userId), 'MEMORY.md.bak');
  }

  public getReportsPath(botId: string, userId: string): string {
    return path.join(this.getBotDir(botId, userId), 'consolidate_reports.json');
  }

  /**
   * 读取指定员工名下指定 Bot 的记忆（预算控制：最多 200 行或 24KB）
   * 若员工尚未初始化该 Bot 记忆，自动写入初始模板并返回。
   */
  public getMemory(botId: string, userId: string): string {
    const filePath = this.getMemoryPath(botId, userId);
    if (!fs.existsSync(filePath)) {
      const defaultContent = DEFAULT_BOT_TEMPLATES[botId] || `# ${botId} 核心准则\n- 企业数字员工。`;
      this.saveMemory(botId, defaultContent, userId);
      return defaultContent;
    }

    try {
      let content = fs.readFileSync(filePath, 'utf-8');
      if (content.length > 24 * 1024) {
        content = content.slice(0, 24 * 1024) + '\n...[记忆内容已按 24KB 预算截断]';
      }
      const lines = content.split('\n');
      if (lines.length > 200) {
        content = lines.slice(0, 200).join('\n') + '\n...[记忆行数已按 200 行预算截断]';
      }
      return content.trim();
    } catch (err: any) {
      console.warn(`[BotMemory] 读取员工 ${userId} 的 ${botId} 记忆异常: ${err.message}`);
      return '';
    }
  }

  /**
   * 保存或更新指定员工名下指定 Bot 的记忆内容
   */
  public saveMemory(botId: string, content: string, userId: string): void {
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
   * 执行受控长期记忆整理 (Memory Consolidation)
   */
  public async consolidateMemory(
    botId: string,
    llmCaller: (prompt: string) => Promise<string>,
    options: { dryRun?: boolean; budgetShare?: number } = {},
    userId: string
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
        dryRun: Boolean(options.dryRun)
      };
    }

    const prompt = buildTidyPrompt(items);
    const reply = await llmCaller(prompt);
    const rawProposals = extractJsonProposals(reply);

    const { ops, skipped, more } = planConsolidation(
      items,
      rawProposals,
      options.budgetShare ?? 0.2
    );

    const { newMarkdown, report } = applyConsolidation(
      rawContent,
      items,
      ops,
      botId,
      skipped,
      more,
      Boolean(options.dryRun)
    );

    if (!options.dryRun && report.changed > 0) {
      const bakPath = this.getBackupMemoryPath(botId, userId);
      const bakDir = path.dirname(bakPath);
      if (!fs.existsSync(bakDir)) {
        fs.mkdirSync(bakDir, { recursive: true });
      }
      fs.writeFileSync(bakPath, rawContent, 'utf-8');

      this.saveMemory(botId, newMarkdown, userId);
      this.saveReport(botId, report, userId);
    }

    return report;
  }

  /**
   * 一键撤销上一次记忆整理变更 (Undo)
   */
  public undoLastConsolidation(botId: string, userId: string): {
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

      this.saveMemory(botId, backupContent, userId);
      fs.writeFileSync(bakPath, curContent, 'utf-8');

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
   * 获取指定员工名下指定 Bot 的整理历史记录
   */
  public getConsolidationHistory(botId: string, userId: string): TidyReport[] {
    const repPath = this.getReportsPath(botId, userId);
    if (!fs.existsSync(repPath)) {
      return [];
    }
    try {
      return JSON.parse(fs.readFileSync(repPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  private saveReport(botId: string, report: TidyReport, userId: string): void {
    const repPath = this.getReportsPath(botId, userId);
    const dir = path.dirname(repPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const history = this.getConsolidationHistory(botId, userId);
    history.unshift(report);
    const trimmed = history.slice(0, 50);
    fs.writeFileSync(repPath, JSON.stringify(trimmed, null, 2), 'utf-8');
  }
}
