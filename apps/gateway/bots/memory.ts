import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseMemoryMarkdown,
  buildTidyPrompt,
  extractJsonProposals,
  planConsolidation,
  applyConsolidation,
  calculateMemoryStats,
  insertItemToMarkdown,
  updateItemInMarkdown,
  deleteItemFromMarkdown,
  searchMemoryItems,
  similarity,
  type MemoryCategory,
  type MemoryItem,
  type MemoryStats,
  type TidyReport
} from './consolidate.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BOT_TEMPLATES: Record<string, string> = {
  muse: `# Muse 长期核心记忆与准则
## 用户画像与核心身份 (Profile)
- 企业智能化自动化总协调员工 [user]

## 偏好与工作习惯 (Preferences)
- 优先调用工具解决问题，回答精炼清晰，无多余寒暄

## 业务约束与红线 (Constraints)
- 任何破坏性系统配置变更前必须得到明确许可`,

  ops_bot: `# OpsBot 运维专员记忆与准则
## 用户画像与核心身份 (Profile)
- 专职企业环境、容器、服务健康监控与运维管理 [user]

## 偏好与工作习惯 (Preferences)
- 发现系统异常时第一时间输出定位指标与修复建议

## 例行约定与流程 (Routines)
- 工作日 18:00 例行巡检代码暂存与工作区状态

## 业务约束与红线 (Constraints)
- 涉及服务重启或容器销毁操作必须由用户最终确认`,

  dev_bot: `# DevBot 研发协同专员记忆与准则
## 用户画像与核心身份 (Profile)
- 专职代码审查、分支合流与构建部署 [user]

## 偏好与工作习惯 (Preferences)
- 遵循 TypeScript 严格模式规范与统一错误处理风格

## 业务约束与红线 (Constraints)
- 严禁未经自动化测试验证直接合并核心生产分支`
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

  public getBotDir(botId: string, userId: string = 'system'): string {
    const sanitizedUser = (userId || 'system').replace(/[^\w-]/g, '_');
    return path.join(this.baseDir, sanitizedUser, 'bots', botId);
  }

  public getMemoryPath(botId: string, userId: string = 'system'): string {
    return path.join(this.getBotDir(botId, userId), 'MEMORY.md');
  }

  public getBackupMemoryPath(botId: string, userId: string = 'system'): string {
    return path.join(this.getBotDir(botId, userId), 'MEMORY.md.bak');
  }

  public getReportsPath(botId: string, userId: string = 'system'): string {
    return path.join(this.getBotDir(botId, userId), 'consolidate_reports.json');
  }

  /**
   * 读取指定员工名下指定 Bot 的记忆文本（预算控制：最多 200 行或 24KB）
   * 若员工尚未初始化该 Bot 记忆，自动写入初始分类模板并返回。
   */
  public getMemory(botId: string, userId: string = 'system'): string {
    const filePath = this.getMemoryPath(botId, userId);
    if (!fs.existsSync(filePath)) {
      const defaultContent = DEFAULT_BOT_TEMPLATES[botId];
      if (defaultContent) {
        this.saveMemory(botId, defaultContent, userId);
        return defaultContent;
      }
      return '';
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
   * 获取指定 Bot 的全部结构化记忆数据（含条目清单、指标与整理历史）
   */
  public getMemoryData(botId: string, userId: string = 'system'): {
    botId: string;
    userId: string;
    content: string;
    items: MemoryItem[];
    stats: MemoryStats;
    reports: TidyReport[];
  } {
    const content = this.getMemory(botId, userId);
    const { items } = parseMemoryMarkdown(content);
    const stats = calculateMemoryStats(content, items);
    const reports = this.getConsolidationHistory(botId, userId);

    return {
      botId,
      userId,
      content,
      items,
      stats,
      reports
    };
  }

  /**
   * 保存或更新指定员工名下指定 Bot 的原始记忆 Markdown
   */
  public saveMemory(botId: string, content: string, userId: string = 'system'): void {
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
   * 新增单条记忆事实（支持分类归档与高相似度去重防护）
   */
  public addMemoryItem(
    botId: string,
    content: string,
    category: MemoryCategory = 'general',
    isUser = true,
    userId: string = 'system'
  ): {
    success: boolean;
    item?: MemoryItem;
    items: MemoryItem[];
    stats: MemoryStats;
    warning?: string;
    error?: string;
  } {
    const trimmed = (content || '').trim();
    if (!trimmed) {
      const data = this.getMemoryData(botId, userId);
      return { success: false, items: data.items, stats: data.stats, error: '记忆内容不能为空' };
    }

    const currentMarkdown = this.getMemory(botId, userId);
    const { items: existingItems } = parseMemoryMarkdown(currentMarkdown);

    // 相似度查重检测
    let warning: string | undefined;
    for (const ex of existingItems) {
      const sim = similarity(ex.content, trimmed);
      if (sim >= 0.9) {
        warning = `检测到极高相似度已有记忆事实：“${ex.content}”，已继续保存但建议定期整理`;
        break;
      }
    }

    const updatedMarkdown = insertItemToMarkdown(currentMarkdown, trimmed, category, isUser);
    this.saveMemory(botId, updatedMarkdown, userId);

    const { items, stats } = this.getMemoryData(botId, userId);
    const newItem = items.find((i) => i.content === trimmed && i.category === category) || items[items.length - 1];

    return {
      success: true,
      item: newItem,
      items,
      stats,
      warning
    };
  }

  /**
   * 编辑/更新单条记忆事实
   */
  public updateMemoryItem(
    botId: string,
    itemId: string,
    newContent: string,
    newCategory?: MemoryCategory,
    userId: string = 'system'
  ): {
    success: boolean;
    item?: MemoryItem;
    items: MemoryItem[];
    stats: MemoryStats;
    error?: string;
  } {
    const trimmed = (newContent || '').trim();
    if (!trimmed) {
      const data = this.getMemoryData(botId, userId);
      return { success: false, items: data.items, stats: data.stats, error: '更新后的记忆内容不能为空' };
    }

    const currentMarkdown = this.getMemory(botId, userId);
    const { newMarkdown, updatedItem } = updateItemInMarkdown(currentMarkdown, itemId, trimmed, newCategory);
    this.saveMemory(botId, newMarkdown, userId);

    const { items, stats } = this.getMemoryData(botId, userId);
    return {
      success: true,
      item: updatedItem,
      items,
      stats
    };
  }

  /**
   * 删除/遗忘单条记忆事实
   */
  public deleteMemoryItem(
    botId: string,
    itemId: string,
    userId: string = 'system',
    force = true
  ): {
    success: boolean;
    items: MemoryItem[];
    stats: MemoryStats;
    error?: string;
  } {
    const currentMarkdown = this.getMemory(botId, userId);
    const { items: currentItems } = parseMemoryMarkdown(currentMarkdown);
    const target = currentItems.find((i) => i.id === itemId);

    if (!target) {
      const data = this.getMemoryData(botId, userId);
      return { success: false, items: data.items, stats: data.stats, error: `未找到 ID 为 ${itemId} 的记忆条目` };
    }

    if (target.source === 'user' && !force) {
      const data = this.getMemoryData(botId, userId);
      return { success: false, items: data.items, stats: data.stats, error: '该条目属于用户核心声明，受保护不可直接删除' };
    }

    const { newMarkdown } = deleteItemFromMarkdown(currentMarkdown, itemId);
    this.saveMemory(botId, newMarkdown, userId);

    const { items, stats } = this.getMemoryData(botId, userId);
    return {
      success: true,
      items,
      stats
    };
  }

  /**
   * 检索指定 Bot 的记忆条目
   */
  public searchMemory(
    botId: string,
    query: string,
    userId: string = 'system',
    options?: { category?: MemoryCategory; userId?: string }
  ): Array<{ item: MemoryItem; score: number }> {
    const content = this.getMemory(botId, userId);
    const { items } = parseMemoryMarkdown(content);
    return searchMemoryItems(items, query, { userId, ...options });
  }

  /**
   * 执行受控长期记忆整理 (Memory Consolidation)
   */
  public async consolidateMemory(
    botId: string,
    llmCaller: (prompt: string) => Promise<string>,
    options: { dryRun?: boolean; budgetShare?: number } = {},
    userId: string = 'system'
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
        dryRun: Boolean(options.dryRun),
        summary: '当前事实少于 2 条，未触发整理'
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
  public undoLastConsolidation(
    botId: string,
    userId: string = 'system'
  ): {
    success: boolean;
    message: string;
    restoredMemory?: string;
    stats?: MemoryStats;
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

      const { stats } = this.getMemoryData(botId, userId);

      return {
        success: true,
        message: '已成功撤销最近一次整理变更，记忆已还原',
        restoredMemory: backupContent,
        stats
      };
    } catch (err: any) {
      return { success: false, message: `撤销失败: ${err.message}` };
    }
  }

  /**
   * 获取指定员工名下指定 Bot 的整理历史记录
   */
  public getConsolidationHistory(botId: string, userId: string = 'system'): TidyReport[] {
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

  private saveReport(botId: string, report: TidyReport, userId: string = 'system'): void {
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
