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
  type InsertItemOptions,
  type MemoryCategory,
  type MemoryItem,
  type MemoryStats,
  type TidyReport
} from './consolidate.ts';

export interface MemoryTopicSummary {
  slug: string;
  name: string;
  description: string;
  aliases: string[];
  readOnly: boolean;
  entryCount: number;
  updatedAt: number;
}

export interface MemoryTopicDetail extends MemoryTopicSummary {
  content: string;
  items: MemoryItem[];
}

export interface StandingIntent {
  id: string;
  description: string;
  triggers: string[];
  cooldownSeconds: number;
  maxFires: number;
  fireCount: number;
  lastFiredAt?: number;
  expiresAt: number;
  status: 'armed' | 'done' | 'expired' | 'cancelled';
  createdAt: number;
}

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

const DEFAULT_USER_PROFILE_TEMPLATE = `# 用户共享核心画像与兴趣 (User Profile)
## 用户画像与核心身份 (Profile)

## 偏好与工作习惯 (Preferences)

## 兴趣与关注领域 (Interests)
`;

const MAX_USER_PROFILE_ITEMS = 40;
const DEFAULT_INTENT_COOLDOWN_SEC = 86400;
const DEFAULT_INTENT_MAX_FIRES = 3;
const DEFAULT_INTENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function todayIsoLocal(now = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsCjk(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(text);
}

function matchesTriggerPhrase(normalizedText: string, rawTrigger: string): boolean {
  const trigger = rawTrigger.trim().toLowerCase().normalize('NFC');
  if (!trigger) return false;
  const terms = trigger.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return false;
  return terms.every((term) => {
    if (containsCjk(term)) {
      return normalizedText.includes(term);
    }
    const regex = new RegExp(`(?:^|[^a-z0-9_])${escapeRegExp(term)}(?:$|[^a-z0-9_])`, 'i');
    return regex.test(normalizedText);
  });
}

function parseTopicFrontmatter(raw: string, fallbackSlug: string): {
  name: string;
  description: string;
  aliases: string[];
  readOnly: boolean;
  updatedAt: number;
  body: string;
} {
  const lines = (raw || '').split('\n');
  let name = fallbackSlug;
  let description = '';
  let aliases: string[] = [];
  let readOnly = false;
  let updatedAt = 0;
  let body = raw || '';

  if (lines[0]?.trim() === '---') {
    const endIdx = lines.indexOf('---', 1);
    if (endIdx > 0) {
      for (const line of lines.slice(1, endIdx)) {
        const sep = line.indexOf(':');
        if (sep < 0) continue;
        const k = line.slice(0, sep).trim().toLowerCase();
        const v = line.slice(sep + 1).trim();
        if (k === 'name' && v) name = v.replace(/^["']|["']$/g, '');
        if (k === 'description') description = v.replace(/^["']|["']$/g, '');
        if (k === 'read_only') readOnly = v.toLowerCase() === 'true';
        if (k === 'updated_at') {
          const n = Number(v);
          if (Number.isFinite(n)) updatedAt = n;
        }
        if (k === 'aliases') {
          const inner = v.replace(/^\[|\]$/g, '');
          aliases = inner
            .split(',')
            .map((a) => a.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
        }
      }
      body = lines.slice(endIdx + 1).join('\n').trim();
    }
  }

  return { name, description, aliases, readOnly, updatedAt, body };
}

function serializeTopicDocument(meta: {
  name: string;
  description: string;
  aliases: string[];
  readOnly?: boolean;
  updatedAt: number;
}, body: string): string {
  const cleanName = meta.name.replace(/[\r\n]+/g, ' ').trim();
  const cleanDesc = meta.description.replace(/[\r\n]+/g, ' ').trim();
  const cleanAliases = Array.from(new Set(meta.aliases.map((a) => a.replace(/[\r\n,\[\]]+/g, ' ').trim()).filter(Boolean))).slice(0, 10);
  const fm = [
    '---',
    `name: ${cleanName}`,
    `description: ${cleanDesc}`,
    `aliases: [${cleanAliases.join(', ')}]`,
    ...(meta.readOnly ? ['read_only: true'] : []),
    `updated_at: ${meta.updatedAt}`,
    '---'
  ].join('\n');
  return `${fm}\n\n${body.trim()}\n`;
}

/**
 * 员工专属 Bot 记忆管理器
 * 数据按用户严格物理隔离，落盘于 data/users/<userId>/ 目录下（含共享 USER.md、Bot 核心记忆、主题知识库与前瞻意图）。
 */
export class BotMemoryManager {
  private baseDir: string;
  private sessionSnapshots = new Map<string, { botId: string; userId: string; context: string; createdAt: number }>();

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
    userId: string = 'system',
    options?: InsertItemOptions
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

    const updatedMarkdown = insertItemToMarkdown(currentMarkdown, trimmed, category, isUser, options);
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

  // =========================================================================
  // L0: 跨 Bot 共享用户核心档案 (USER.md)
  // =========================================================================

  public getUserDir(userId: string = 'system'): string {
    const sanitizedUser = (userId || 'system').replace(/[^\w-]/g, '_');
    return path.join(this.baseDir, sanitizedUser);
  }

  public getUserProfilePath(userId: string = 'system'): string {
    return path.join(this.getUserDir(userId), 'USER.md');
  }

  public getUserProfile(userId: string = 'system'): string {
    const filePath = this.getUserProfilePath(userId);
    if (!fs.existsSync(filePath)) {
      return DEFAULT_USER_PROFILE_TEMPLATE;
    }
    try {
      return fs.readFileSync(filePath, 'utf-8').trim();
    } catch {
      return DEFAULT_USER_PROFILE_TEMPLATE;
    }
  }

  public getUserProfileItems(userId: string = 'system'): MemoryItem[] {
    const raw = this.getUserProfile(userId);
    return parseMemoryMarkdown(raw).items;
  }

  public saveUserProfile(userId: string = 'system', content: string): void {
    const filePath = this.getUserProfilePath(userId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  /**
   * 向跨 Bot 共享的用户档案新增或提权条目（受 40 条上限约束，重复主题自动去重/提升权重）
   */
  public addUserProfileItem(
    userId: string = 'system',
    content: string,
    category: MemoryCategory = 'profile',
    options?: InsertItemOptions & { isUser?: boolean }
  ): { success: boolean; added: boolean; boosted?: boolean; item?: MemoryItem; error?: string } {
    const trimmed = (content || '').trim();
    if (!trimmed) {
      return { success: false, added: false, error: '内容不能为空' };
    }
    const current = this.getUserProfile(userId);
    const { items } = parseMemoryMarkdown(current);

    for (const existing of items) {
      const sim = similarity(existing.content, trimmed);
      const exactSub =
        existing.content.toLowerCase() === trimmed.toLowerCase() ||
        (trimmed.length >= 4 && existing.content.toLowerCase().includes(trimmed.toLowerCase()));
      if (sim >= 0.78 || exactSub) {
        if (options?.weight && options.weight > 0) {
          const nextWeight = Math.min(10, Math.round(((existing.weight || 1) + options.weight) * 100) / 100);
          const { newMarkdown, updatedItem } = updateItemInMarkdown(current, existing.id, existing.content, existing.category, {
            weight: nextWeight,
            origin: options.origin || existing.origin
          });
          this.saveUserProfile(userId, newMarkdown);
          return { success: true, added: false, boosted: true, item: updatedItem };
        }
        return { success: true, added: false, item: existing };
      }
    }

    let nextMarkdown = current;
    if (items.length >= MAX_USER_PROFILE_ITEMS) {
      const droppable = [...items]
        .filter((i) => !i.protected)
        .sort((a, b) => (a.weight || 1) - (b.weight || 1))[0];
      if (!droppable) {
        return { success: false, added: false, error: '共享用户档案已达 40 条上限' };
      }
      nextMarkdown = deleteItemFromMarkdown(nextMarkdown, droppable.id).newMarkdown;
    }

    nextMarkdown = insertItemToMarkdown(nextMarkdown, trimmed, category, Boolean(options?.isUser), {
      until: options?.until,
      origin: options?.origin || (options?.isUser ? 'owner' : 'agent'),
      weight: options?.weight
    });
    this.saveUserProfile(userId, nextMarkdown);
    const updatedItems = this.getUserProfileItems(userId);
    const item = updatedItems.find((i) => i.content === trimmed) || updatedItems[updatedItems.length - 1];
    return { success: true, added: true, item };
  }

  // =========================================================================
  // L1: 主题知识库 (topics/*.md)
  // =========================================================================

  public getTopicsDir(botId: string, userId: string = 'system'): string {
    return path.join(this.getBotDir(botId, userId), 'topics');
  }

  public normalizeTopicSlug(raw: string): string {
    const cleaned = (raw || '')
      .trim()
      .toLowerCase()
      .replace(/\.md$/i, '')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    if (!cleaned || cleaned === 'memory' || cleaned === 'archive' || cleaned === 'user') {
      return 'general-topic';
    }
    return cleaned;
  }

  public listTopics(botId: string, userId: string = 'system'): MemoryTopicSummary[] {
    const dir = this.getTopicsDir(botId, userId);
    if (!fs.existsSync(dir)) return [];
    const results: MemoryTopicSummary[] = [];
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const slug = file.replace(/\.md$/i, '');
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = parseTopicFrontmatter(raw, slug);
        const { items } = parseMemoryMarkdown(parsed.body);
        results.push({
          slug,
          name: parsed.name,
          description: parsed.description,
          aliases: parsed.aliases,
          readOnly: parsed.readOnly,
          entryCount: items.length,
          updatedAt: parsed.updatedAt || stat.mtimeMs
        });
      }
    } catch (err: any) {
      console.warn(`[BotMemory] 列举主题记忆失败: ${err.message}`);
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getTopic(botId: string, slugOrName: string, userId: string = 'system'): MemoryTopicDetail | null {
    const dir = this.getTopicsDir(botId, userId);
    if (!fs.existsSync(dir)) return null;
    const normalized = this.normalizeTopicSlug(slugOrName);
    let targetPath = path.join(dir, `${normalized}.md`);
    let resolvedSlug = normalized;

    if (!fs.existsSync(targetPath)) {
      const q = (slugOrName || '').trim().toLowerCase();
      const matched = this.listTopics(botId, userId).find(
        (t) =>
          t.slug.toLowerCase() === q ||
          t.name.toLowerCase() === q ||
          t.aliases.some((a) => a.toLowerCase() === q)
      );
      if (!matched) return null;
      resolvedSlug = matched.slug;
      targetPath = path.join(dir, `${resolvedSlug}.md`);
    }

    try {
      const stat = fs.statSync(targetPath);
      const raw = fs.readFileSync(targetPath, 'utf-8');
      const parsed = parseTopicFrontmatter(raw, resolvedSlug);
      const { items } = parseMemoryMarkdown(parsed.body);
      return {
        slug: resolvedSlug,
        name: parsed.name,
        description: parsed.description,
        aliases: parsed.aliases,
        readOnly: parsed.readOnly,
        entryCount: items.length,
        updatedAt: parsed.updatedAt || stat.mtimeMs,
        content: parsed.body,
        items
      };
    } catch {
      return null;
    }
  }

  public upsertTopicEntry(
    botId: string,
    topicName: string,
    entry: string,
    meta: { description?: string; aliases?: string[]; until?: string; origin?: 'owner' | 'agent' | 'feedback' } = {},
    userId: string = 'system'
  ): { success: boolean; topic?: MemoryTopicDetail; error?: string } {
    const trimmedEntry = (entry || '').trim();
    if (!trimmedEntry) {
      return { success: false, error: '主题记忆条目内容不能为空' };
    }

    const dir = this.getTopicsDir(botId, userId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const slug = this.normalizeTopicSlug(topicName);
    const filePath = path.join(dir, `${slug}.md`);
    const existing = this.getTopic(botId, slug, userId);

    if (existing?.readOnly && meta.origin !== 'owner') {
      return { success: false, error: `主题「${existing.name}」受 read_only 保护，禁止代理自动写入` };
    }

    const now = Date.now();
    const displayName = (existing?.name || topicName || slug).trim();
    const nextDesc =
      (meta.description && meta.description.trim()) ||
      existing?.description ||
      `关于「${displayName}」的专项背景、偏好与事实记录`;
    const nextAliases = Array.from(
      new Set([...(existing?.aliases || []), ...(meta.aliases || []), displayName].filter(Boolean))
    );

    let body = existing?.content || `# ${displayName}`;
    const existingItems = existing?.items || [];
    const duplicate = existingItems.some((item) => similarity(item.content, trimmedEntry) >= 0.85);
    if (!duplicate) {
      const line = insertItemToMarkdown(body, trimmedEntry, 'general', meta.origin === 'owner', {
        until: meta.until,
        origin: meta.origin || 'agent'
      });
      body = line;
    }

    const doc = serializeTopicDocument(
      {
        name: displayName,
        description: nextDesc,
        aliases: nextAliases,
        readOnly: existing?.readOnly,
        updatedAt: now
      },
      body
    );
    const tmp = `${filePath}.tmp.${now}`;
    fs.writeFileSync(tmp, doc, 'utf-8');
    fs.renameSync(tmp, filePath);

    return { success: true, topic: this.getTopic(botId, slug, userId) || undefined };
  }

  public matchTopicsForQuery(botId: string, query: string, userId: string = 'system'): MemoryTopicDetail[] {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    const topics = this.listTopics(botId, userId);
    const matched: MemoryTopicDetail[] = [];
    for (const t of topics) {
      const hit =
        q.includes(t.slug.toLowerCase()) ||
        q.includes(t.name.toLowerCase()) ||
        t.aliases.some((alias) => alias.length >= 2 && q.includes(alias.toLowerCase()));
      if (hit) {
        const detail = this.getTopic(botId, t.slug, userId);
        if (detail) matched.push(detail);
      }
    }
    return matched;
  }

  // =========================================================================
  // L2: 时效过期自动清理 (until < today)
  // =========================================================================

  public pruneExpiredMemories(
    botId: string,
    userId: string = 'system',
    today: string = todayIsoLocal()
  ): { removedCount: number; removedItems: MemoryItem[] } {
    const removedItems: MemoryItem[] = [];

    const pruneFile = (
      currentContent: string,
      saveFn: (next: string) => void
    ) => {
      const { items } = parseMemoryMarkdown(currentContent);
      const expired = items.filter((item) => item.until && item.until < today && !item.protected);
      if (expired.length === 0) return;
      let next = currentContent;
      for (const item of expired) {
        next = deleteItemFromMarkdown(next, item.id).newMarkdown;
        removedItems.push(item);
      }
      saveFn(next);
    };

    pruneFile(this.getMemory(botId, userId), (next) => this.saveMemory(botId, next, userId));
    if (fs.existsSync(this.getUserProfilePath(userId))) {
      pruneFile(this.getUserProfile(userId), (next) => this.saveUserProfile(userId, next));
    }

    return { removedCount: removedItems.length, removedItems };
  }

  // =========================================================================
  // 前瞻性事件意图 (Standing Intents)
  // =========================================================================

  private getIntentsPath(botId: string, userId: string = 'system'): string {
    return path.join(this.getBotDir(botId, userId), 'intents.json');
  }

  private saveIntents(botId: string, intents: StandingIntent[], userId: string = 'system'): void {
    const filePath = this.getIntentsPath(botId, userId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(intents.slice(0, 100), null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  public listIntents(botId: string, userId: string = 'system', now: number = Date.now()): StandingIntent[] {
    const filePath = this.getIntentsPath(botId, userId);
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw: StandingIntent[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(raw)) return [];
      let dirty = false;
      const normalized = raw.map((item) => {
        if (item.status === 'armed' && item.expiresAt <= now) {
          dirty = true;
          return { ...item, status: 'expired' as const };
        }
        return item;
      });
      if (dirty) {
        this.saveIntents(botId, normalized, userId);
      }
      return normalized;
    } catch {
      return [];
    }
  }

  public createIntent(
    botId: string,
    input: {
      description: string;
      triggers: string[];
      cooldownSeconds?: number;
      maxFires?: number;
      expiresAt?: number;
    },
    userId: string = 'system',
    now: number = Date.now()
  ): { success: boolean; intent?: StandingIntent; error?: string } {
    const description = (input.description || '').replace(/[\r\n]+/g, ' ').trim();
    const triggers = Array.isArray(input.triggers)
      ? Array.from(new Set(input.triggers.map((t) => String(t || '').trim()).filter((t) => t.length >= 2)))
      : [];
    if (!description) {
      return { success: false, error: '事件意图描述 description 不能为空' };
    }
    if (triggers.length === 0) {
      return { success: false, error: '至少需要提供一个不少于 2 个字符的触发关键词 triggers' };
    }

    const cooldownSeconds =
      typeof input.cooldownSeconds === 'number' && Number.isFinite(input.cooldownSeconds) && input.cooldownSeconds >= 0
        ? Math.floor(input.cooldownSeconds)
        : DEFAULT_INTENT_COOLDOWN_SEC;
    const maxFires =
      typeof input.maxFires === 'number' && Number.isInteger(input.maxFires) && input.maxFires >= 1
        ? input.maxFires
        : DEFAULT_INTENT_MAX_FIRES;
    const expiresAt =
      typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt) && input.expiresAt > now
        ? input.expiresAt
        : now + DEFAULT_INTENT_TTL_MS;

    const intent: StandingIntent = {
      id: `int_${now}_${Math.random().toString(36).slice(2, 6)}`,
      description,
      triggers,
      cooldownSeconds,
      maxFires,
      fireCount: 0,
      expiresAt,
      status: 'armed',
      createdAt: now
    };

    const current = this.listIntents(botId, userId, now);
    current.unshift(intent);
    this.saveIntents(botId, current, userId);
    return { success: true, intent };
  }

  public cancelIntent(botId: string, intentId: string, userId: string = 'system'): { success: boolean; error?: string } {
    const current = this.listIntents(botId, userId);
    const target = current.find((i) => i.id === intentId);
    if (!target) {
      return { success: false, error: `未找到事件意图 ${intentId}` };
    }
    target.status = 'cancelled';
    this.saveIntents(botId, current, userId);
    return { success: true };
  }

  /**
   * 在用户输入时零模型开销匹配前瞻意图，遵守冷却与触发次数上限
   */
  public matchAndFireIntents(
    botId: string,
    userText: string,
    userId: string = 'system',
    now: number = Date.now()
  ): Array<{ id: string; description: string }> {
    const normalizedText = (userText || '').trim().toLowerCase().normalize('NFC');
    if (!normalizedText) return [];

    const intents = this.listIntents(botId, userId, now);
    if (intents.length === 0) return [];

    const fired: Array<{ id: string; description: string }> = [];
    let modified = false;

    for (const intent of intents) {
      if (intent.status !== 'armed') continue;
      if (intent.expiresAt <= now) {
        intent.status = 'expired';
        modified = true;
        continue;
      }
      if (intent.fireCount >= intent.maxFires) {
        intent.status = 'done';
        modified = true;
        continue;
      }
      if (intent.lastFiredAt && now - intent.lastFiredAt < intent.cooldownSeconds * 1000) {
        continue;
      }

      const matched = intent.triggers.some((trigger) => matchesTriggerPhrase(normalizedText, trigger));
      if (matched) {
        intent.fireCount += 1;
        intent.lastFiredAt = now;
        if (intent.fireCount >= intent.maxFires) {
          intent.status = 'done';
        }
        modified = true;
        fired.push({ id: intent.id, description: intent.description });
      }
    }

    if (modified) {
      this.saveIntents(botId, intents, userId);
    }
    return fired;
  }

  // =========================================================================
  // 会话级冻结快照与兴趣摘要提取
  // =========================================================================

  /**
   * 构建并缓存会话级冻结记忆快照：L0 共享用户画像 + Bot 核心记忆 + L1 主题目录索引
   * 同一会话中途变更记忆会落盘，但不改动当前会话快照以保持 Prompt Prefix Cache 命中
   */
  public getFrozenMemoryContext(sessionId: string, botId: string, userId: string = 'system'): string {
    const cacheKey = `${userId}::${botId}::${sessionId}`;
    const cached = this.sessionSnapshots.get(cacheKey);
    if (cached) {
      return cached.context;
    }

    this.pruneExpiredMemories(botId, userId);

    const sections: string[] = [];
    const userProfile = this.getUserProfile(userId);
    const userItems = parseMemoryMarkdown(userProfile).items;
    if (userItems.length > 0) {
      sections.push(`[Shared User Profile (USER.md)]:\n${userProfile}`);
    }

    const botMemory = this.getMemory(botId, userId);
    if (botMemory) {
      sections.push(`[Bot Core Memory (MEMORY.md)]:\n${botMemory}`);
    }

    const topics = this.listTopics(botId, userId);
    if (topics.length > 0) {
      const topicLines = topics
        .slice(0, 20)
        .map(
          (t) =>
            `- ${t.slug} (${t.name}, ${t.entryCount}条): ${t.description}${
              t.aliases.length > 0 ? ` [关键词: ${t.aliases.join(', ')}]` : ''
            }`
        )
        .join('\n');
      sections.push(
        `<memory_topics>\n以下为主题级扩展记忆索引，默认仅展示摘要以节省上下文；当对话涉及对应主题时，可调用 memory(action="open_topic", topic="<slug>") 按需加载细节：\n${topicLines}\n</memory_topics>`
      );
    }

    const context = sections.join('\n\n');
    this.sessionSnapshots.set(cacheKey, { botId, userId, context, createdAt: Date.now() });
    return context;
  }

  public invalidateSessionSnapshot(sessionId: string): void {
    for (const key of this.sessionSnapshots.keys()) {
      if (key.endsWith(`::${sessionId}`)) {
        this.sessionSnapshots.delete(key);
      }
    }
  }

  public invalidateBotSnapshots(botId: string, userId: string = 'system'): void {
    const prefix = `${userId}::${botId}::`;
    for (const key of this.sessionSnapshots.keys()) {
      if (key.startsWith(prefix)) {
        this.sessionSnapshots.delete(key);
      }
    }
  }

  /**
   * 汇总用户的有序兴趣与关注领域（供动态生成引擎与主动引擎消费）
   */
  public getUserInterests(userId: string = 'system', botId: string = 'muse'): string[] {
    const userItems = this.getUserProfileItems(userId);
    const botItems = parseMemoryMarkdown(this.getMemory(botId, userId)).items;
    const allItems = [...userItems, ...botItems];

    const scored = new Map<string, number>();
    for (const item of allItems) {
      if (item.category !== 'interest' && item.category !== 'preference') continue;
      const baseWeight = item.weight || 1;
      const bonus = item.category === 'interest' ? 2 : 0;
      const key = item.content.trim();
      if (!key) continue;
      scored.set(key, Math.max(scored.get(key) || 0, baseWeight + bonus));
    }

    return Array.from(scored.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([content]) => content);
  }
}
