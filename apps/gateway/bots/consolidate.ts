/**
 * 受控长期记忆整理与去冗余引擎 (Memory Consolidation Engine)
 *
 * 核心设计原则：模型提议，确定性规则兜底 (Model Proposes, Deterministic Rules Decide)
 * 1. 结构化类别支持：包含用户画像、偏好习惯、关键人物、例行流程、业务约束红线与通用事实。
 * 2. 实体守恒：严禁模型提炼时捏造原事实中未曾出现过的新实体与词汇（幻觉硬拦截）。
 * 3. 用户锚点保护：严禁删除带有 [user] 标记的用户显式录入声明。
 * 4. 预算约束与防激进：单次整理最多精简存储量的 20%，防止大面积误删。
 * 5. 变更留痕与一键撤销：输出结构化审计报告，支持原子级 Undo 回滚。
 */

export type MemoryCategory = 'profile' | 'preference' | 'people' | 'routine' | 'constraint' | 'interest' | 'general';

export interface CategoryMeta {
  key: MemoryCategory;
  label: string;
  header: string;
  description: string;
}

export const MEMORY_CATEGORIES: CategoryMeta[] = [
  { key: 'profile', label: '用户画像与身份', header: '## 用户画像与核心身份 (Profile)', description: '核心职业、角色定位、技术背景与专长领域' },
  { key: 'preference', label: '偏好与习惯', header: '## 偏好与工作习惯 (Preferences)', description: '技术偏好、代码规范、沟通风格与工具习惯' },
  { key: 'interest', label: '兴趣与关注', header: '## 兴趣与关注领域 (Interests)', description: '长期关注的技术方向、行业话题与信息订阅偏好' },
  { key: 'people', label: '关键人物与协作', header: '## 关键人物与协作关系 (People)', description: '核心利益相关方、团队成员与角色分工' },
  { key: 'routine', label: '例行约定与流程', header: '## 例行约定与流程 (Routines)', description: '周期性任务、例会时间点与规范流程' },
  { key: 'constraint', label: '业务约束与红线', header: '## 业务约束与红线 (Constraints)', description: '安全准则、权限边界与绝对禁止操作' },
  { key: 'general', label: '通用沉淀知识', header: '## 通用沉淀事实 (General)', description: '环境配置、服务地址、系统固定参数等' }
];

export const CATEGORY_KEYWORDS: Record<MemoryCategory, string[]> = {
  profile: ['profile', '用户画像', '身份', '画像', '角色', '职业', '工号', '姓名', '员工', '核心身份'],
  preference: ['preference', 'preferences', '偏好', '习惯', '工作习惯', '偏好与习惯', '偏好与工作习惯', '风格', '排版', '格式', '响应'],
  interest: ['interest', 'interests', '兴趣', '关注', '爱好', '订阅', '热点', '资讯'],
  people: ['people', '关键人物', '协作', '人物', '领导', '汇报', '同事', '团队', '干系人', '协作关系'],
  routine: ['routine', 'routines', '例行', '约定', '流程', '例会', '巡检', '周期', '日常', '定期'],
  constraint: ['constraint', 'constraints', '约束', '红线', '业务约束', '禁止', '权限', '安全', '许可', '破坏性'],
  general: ['general', '通用', '知识', '事实', '配置', '环境', '参数', '链接']
};

export interface MemoryItem {
  id: string; // m_1, m_2, ...
  content: string; // 事实内容纯文本
  source: 'user' | 'agent'; // user 为用户亲自录入的声明，具有最高保护优先级
  category: MemoryCategory;
  protected: boolean;
  rawLine: string;
  prefix: string; // 如 "- ", "* ", "1. "
  until?: string; // 过期日期 YYYY-MM-DD
  origin?: 'owner' | 'agent' | 'feedback';
  weight?: number; // 权重（默认 1）
}

export interface MemoryStats {
  totalBytes: number;
  maxBytes: number; // 24576 (24KB)
  lineCount: number;
  maxLines: number; // 200
  itemCount: number;
  userAnchorCount: number;
  agentItemCount: number;
  usagePercent: number;
  status: 'healthy' | 'warning' | 'critical';
}

export interface MemoryChange {
  op: 'merge' | 'drop';
  before: string[];
  after?: string;
  reason?: string;
  timestamp: number;
}

export interface ValidatedOp {
  op: 'merge' | 'drop';
  items: MemoryItem[];
  content?: string;
  reason?: string;
}

export interface TidyReport {
  botId: string;
  timestamp: number;
  considered: number;
  changed: number;
  merged: MemoryChange[];
  dropped: MemoryChange[];
  skipped: string[];
  planned: Array<{
    op: 'merge' | 'drop';
    ids: string[];
    before: string[];
    content?: string;
    reason?: string;
  }>;
  more: boolean;
  dryRun: boolean;
  summary?: string;
}

// 允许在合并时使用的中英文连接词与过渡字符（不算作新捏造事实）
const CONNECTIVE_WORDS = new Set(
  'and with from moved now since previously formerly also both prefers likes the for his her their is was has not no to into of at by using uses used previously originally formerly'.split(
    ' '
  )
);

const CONNECTIVE_CHARS = new Set(
  '在从搬到现以前和与并且喜欢不的了是住工作用曾经后来已改为原偏好于即及至且其等等而（）()，、。；：：+-/—'.split('')
);

/**
 * 识别 Markdown 标题对应的记忆分类
 */
export function detectCategoryFromHeader(headerLine: string): MemoryCategory {
  const lower = headerLine.toLowerCase();
  if (/画像|身份|profile|identity|who/i.test(lower)) return 'profile';
  if (/偏好|习惯|preference|style|habit/i.test(lower)) return 'preference';
  if (/兴趣|关注|interest/i.test(lower)) return 'interest';
  if (/人物|成员|协作|people|team|stakeholder|colleague/i.test(lower)) return 'people';
  if (/例行|约定|流程|routine|schedule|workflow/i.test(lower)) return 'routine';
  if (/约束|规则|红线|安全|constraint|policy|rule|boundary/i.test(lower)) return 'constraint';
  return 'general';
}

/**
 * 将 MEMORY.md 文本解析为结构化条目清单与类别划分
 */
export function parseMemoryMarkdown(markdown: string): { items: MemoryItem[]; lines: string[] } {
  const rawLines = (markdown || '').split('\n');
  const items: MemoryItem[] = [];
  let itemIndex = 1;
  let currentCategory: MemoryCategory = 'general';

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('##')) {
      currentCategory = detectCategoryFromHeader(trimmed);
      continue;
    }

    if (trimmed.startsWith('#')) {
      continue;
    }

    // 匹配列表前缀: "- ", "* ", "1. ", 等
    const prefixMatch = line.match(/^(\s*[-*]|\s*\d+\.)\s+/);
    if (!prefixMatch) {
      continue;
    }

    const prefix = prefixMatch[0];
    let text = line.slice(prefixMatch[0].length).trim();

    // 识别用户亲自录入的声明标记
    let source: 'user' | 'agent' = 'agent';
    if (/\[(user|用户声明|用户)\]/i.test(text)) {
      source = 'user';
      text = text.replace(/\[(user|用户声明|用户)\]/gi, '').trim();
    }

    // 解析时效截止日期 [until:YYYY-MM-DD]
    let until: string | undefined;
    const untilMatch = text.match(/\[until:(\d{4}-\d{2}-\d{2})\]/i);
    if (untilMatch) {
      until = untilMatch[1];
      text = text.replace(/\[until:\d{4}-\d{2}-\d{2}\]/gi, '').trim();
    }

    // 解析来源标记 [origin:owner|agent|feedback]
    let origin: 'owner' | 'agent' | 'feedback' | undefined = source === 'user' ? 'owner' : undefined;
    const originMatch = text.match(/\[origin:(owner|agent|feedback)\]/i);
    if (originMatch) {
      origin = originMatch[1].toLowerCase() as 'owner' | 'agent' | 'feedback';
      text = text.replace(/\[origin:(owner|agent|feedback)\]/gi, '').trim();
    }

    // 解析权重标记 [w:N]
    let weight = 1;
    const weightMatch = text.match(/\[w:(\d+(?:\.\d+)?)\]/i);
    if (weightMatch) {
      const parsedW = Number(weightMatch[1]);
      if (Number.isFinite(parsedW) && parsedW > 0) {
        weight = parsedW;
      }
      text = text.replace(/\[w:\d+(?:\.\d+)?\]/gi, '').trim();
    }

    const id = `m_${itemIndex++}`;
    items.push({
      id,
      content: text,
      source,
      category: currentCategory,
      protected: source === 'user',
      rawLine: line,
      prefix,
      ...(until ? { until } : {}),
      ...(origin ? { origin } : {}),
      weight
    });
  }

  return { items, lines: rawLines };
}

/**
 * 计算记忆库配额、健康度与压力指标
 */
export function calculateMemoryStats(markdown: string, items: MemoryItem[]): MemoryStats {
  const totalBytes = Buffer.byteLength(markdown || '', 'utf-8');
  const maxBytes = 24 * 1024; // 24KB 严格预算
  const lineCount = (markdown || '').split('\n').filter((l) => l.trim().length > 0).length;
  const maxLines = 200; // 200 行严格预算
  const itemCount = items.length;
  const userAnchorCount = items.filter((i) => i.source === 'user').length;
  const agentItemCount = itemCount - userAnchorCount;

  const bytePercent = Math.round((totalBytes / maxBytes) * 100);
  const linePercent = Math.round((lineCount / maxLines) * 100);
  const usagePercent = Math.max(bytePercent, linePercent);

  let status: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (usagePercent >= 85) {
    status = 'critical';
  } else if (usagePercent >= 60) {
    status = 'warning';
  }

  return {
    totalBytes,
    maxBytes,
    lineCount,
    maxLines,
    itemCount,
    userAnchorCount,
    agentItemCount,
    usagePercent,
    status
  };
}

/**
 * 文本分词器 (支持英文单词与中文 CJK 二元分词)
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  // 提取英文单词与数字
  const words = lower.match(/[a-z0-9_.-]+/g) || [];
  for (const w of words) {
    if (w.length > 1) tokens.add(w);
  }

  // 提取中文二元分词 (CJK Bigram)
  const cjk = lower.match(/[\u4e00-\u9fa5]/g) || [];
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.add(cjk[i] + cjk[i + 1]);
  }
  if (cjk.length === 1) {
    tokens.add(cjk[0]);
  }

  return tokens;
}

/**
 * 计算两段事实文本的 Jaccard 相似度
 */
export function similarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 记忆事实检索与相似度排序
 */
export function searchMemoryItems(
  items: MemoryItem[],
  query: string,
  options?: { category?: MemoryCategory; userId?: string }
): Array<{ item: MemoryItem; score: number }> {
  const q = (query || '').trim().toLowerCase();
  const targetCategory = options?.category;
  const targetUser = (options?.userId || '').trim().toLowerCase();

  const isBroadQuery =
    !q ||
    q === '*' ||
    ['all', '全部', '所有', '记忆', '长期记忆', '受控记忆', '清单', 'list', '用户记忆', '全部记忆', '备忘', '准则'].includes(q);

  const isUserQuery =
    Boolean(targetUser && (q === targetUser || q.includes(targetUser))) ||
    ['我', '我的', '本人', '用户', '自己', 'me', 'my', 'user'].includes(q);

  if (isBroadQuery || isUserQuery) {
    return items
      .filter((item) => (!targetCategory ? true : item.category === targetCategory))
      .map((item) => {
        let score = 1;
        if (isUserQuery && (item.source === 'user' || item.category === 'profile')) {
          score = 1.0;
        } else if (isUserQuery) {
          score = 0.85;
        }
        return { item, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  const rawTerms = q.split(/[\s,，;；|、]+/g).map((t) => t.trim()).filter(Boolean);
  const results: Array<{ item: MemoryItem; score: number }> = [];

  for (const item of items) {
    if (targetCategory && item.category !== targetCategory) {
      continue;
    }

    const text = item.content.toLowerCase();
    let score = 0;

    // 1. 全文子串完全匹配
    if (text.includes(q)) {
      score += 0.85;
    }

    // 2. 分词子串匹配
    for (const term of rawTerms) {
      if (text.includes(term)) {
        score += term.length >= 2 ? 0.4 : 0.2;
      }
    }

    // 3. 类别与关键词语义关联
    const catKeywords = CATEGORY_KEYWORDS[item.category] || [];
    const catMeta = MEMORY_CATEGORIES.find((c) => c.key === item.category);
    let matchedCategory = false;

    if (rawTerms.length > 0) {
      for (const term of rawTerms) {
        if (
          catKeywords.some((kw) => kw.includes(term) || term.includes(kw)) ||
          (catMeta && (catMeta.label.toLowerCase().includes(term) || catMeta.header.toLowerCase().includes(term)))
        ) {
          matchedCategory = true;
          break;
        }
      }
    } else if (
      catKeywords.some((kw) => kw.includes(q) || q.includes(kw)) ||
      (catMeta && (catMeta.label.toLowerCase().includes(q) || catMeta.header.toLowerCase().includes(q)))
    ) {
      matchedCategory = true;
    }

    if (matchedCategory) {
      score += 0.75;
    }

    // 4. Jaccard 相似度兜底
    const sim = similarity(text, q);
    score += sim * 0.4;
    for (const term of rawTerms) {
      if (term.length >= 2) {
        score += similarity(text, term) * 0.2;
      }
    }

    // 5. 用户声明加权
    if (item.source === 'user' && (q.includes('用户') || q.includes('user') || q.includes('我'))) {
      score += 0.2;
    }

    if (score > 0.05) {
      results.push({ item, score: Math.min(1, Math.round(score * 100) / 100) });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export interface InsertItemOptions {
  until?: string;
  origin?: 'owner' | 'agent' | 'feedback';
  weight?: number;
}

/**
 * 组装单条记忆的 Markdown 行文本
 */
export function formatMemoryItemLine(
  prefix: string,
  content: string,
  isUser: boolean,
  options?: InsertItemOptions
): string {
  const tags: string[] = [];
  if (isUser) tags.push('[user]');
  if (options?.until && /^\d{4}-\d{2}-\d{2}$/.test(options.until)) {
    tags.push(`[until:${options.until}]`);
  }
  if (options?.origin && !(isUser && options.origin === 'owner')) {
    tags.push(`[origin:${options.origin}]`);
  }
  if (options?.weight !== undefined && options.weight !== 1 && Number.isFinite(options.weight) && options.weight > 0) {
    tags.push(`[w:${Math.round(options.weight * 100) / 100}]`);
  }
  return `${prefix}${content.trim()}${tags.length > 0 ? ` ${tags.join(' ')}` : ''}`;
}

/**
 * 向 Markdown 文本中追加或插入单条记忆事实
 */
export function insertItemToMarkdown(
  markdown: string,
  content: string,
  category: MemoryCategory = 'general',
  isUser = false,
  options?: InsertItemOptions
): string {
  const trimmedContent = content.trim();
  const lineToAdd = formatMemoryItemLine('- ', trimmedContent, isUser, options);
  const targetCategoryMeta =
    MEMORY_CATEGORIES.find((c) => c.key === category) ||
    MEMORY_CATEGORIES.find((c) => c.key === 'general')!;

  const lines = (markdown || '').split('\n');
  let headerIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('##')) {
      const cat = detectCategoryFromHeader(l);
      if (cat === category) {
        headerIndex = i;
        break;
      }
    }
  }

  if (headerIndex !== -1) {
    // 找到分类标题，定位到该 section 的尾部
    let insertIndex = lines.length;
    for (let i = headerIndex + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('##')) {
        insertIndex = i;
        break;
      }
    }
    while (insertIndex > headerIndex + 1 && lines[insertIndex - 1].trim() === '') {
      insertIndex--;
    }
    lines.splice(insertIndex, 0, lineToAdd);
    return lines.join('\n');
  }

  // 若未找到对应分类标题，在文本末尾追加该分类区块
  const clean = (markdown || '').trim();
  return `${clean}\n\n${targetCategoryMeta.header}\n${lineToAdd}\n`;
}

/**
 * 更新 Markdown 中的指定条目
 */
export function updateItemInMarkdown(
  markdown: string,
  itemId: string,
  newContent: string,
  newCategory?: MemoryCategory,
  options?: InsertItemOptions
): { newMarkdown: string; updatedItem?: MemoryItem } {
  const { items, lines } = parseMemoryMarkdown(markdown);
  const target = items.find((i) => i.id === itemId);
  if (!target) {
    return { newMarkdown: markdown };
  }

  const categoryChanged = newCategory && newCategory !== target.category;
  const isUser = target.source === 'user';
  const mergedOptions: InsertItemOptions = {
    until: options?.until !== undefined ? options.until : target.until,
    origin: options?.origin !== undefined ? options.origin : target.origin,
    weight: options?.weight !== undefined ? options.weight : target.weight
  };

  if (!categoryChanged) {
    // 同分类下就地替换内容
    const updatedLine = formatMemoryItemLine(target.prefix, newContent.trim(), isUser, mergedOptions);
    const newLines = lines.map((l) => (l.trim() === target.rawLine.trim() ? updatedLine : l));
    return {
      newMarkdown: newLines.join('\n'),
      updatedItem: { ...target, content: newContent.trim(), rawLine: updatedLine, ...mergedOptions }
    };
  }

  // 跨分类移动：先移除原位置，再插入目标分类
  const filteredLines = lines.filter((l) => l.trim() !== target.rawLine.trim());
  const removedMarkdown = filteredLines.join('\n');
  const finalMarkdown = insertItemToMarkdown(removedMarkdown, newContent, newCategory, isUser, mergedOptions);

  return {
    newMarkdown: finalMarkdown,
    updatedItem: { ...target, content: newContent.trim(), category: newCategory, ...mergedOptions }
  };
}

/**
 * 删除 Markdown 中的指定记忆条目
 */
export function deleteItemFromMarkdown(
  markdown: string,
  itemId: string
): { newMarkdown: string; deletedItem?: MemoryItem } {
  const { items, lines } = parseMemoryMarkdown(markdown);
  const target = items.find((i) => i.id === itemId);
  if (!target) {
    return { newMarkdown: markdown };
  }

  const newLines = lines.filter((l) => l.trim() !== target.rawLine.trim());
  return { newMarkdown: newLines.join('\n'), deletedItem: target };
}

/**
 * 校验合并后的内容是否捏造了原事实中完全未曾出现的新生造实体词或字符
 */
export function noNewEntities(merged: string, sources: MemoryItem[]): boolean {
  // 1. 中文字符集校验 (CJK)
  const sourceChars = new Set<string>();
  for (const s of sources) {
    const chars = s.content.match(/[\u4e00-\u9fa5]/g) || [];
    for (const c of chars) sourceChars.add(c);
  }

  const mergedChars = merged.match(/[\u4e00-\u9fa5]/g) || [];
  const newChars = mergedChars.filter((c) => !sourceChars.has(c) && !CONNECTIVE_CHARS.has(c));
  if (newChars.length > 0) {
    return false;
  }

  // 2. 英文与数字词汇校验
  const sourceWords = new Set<string>();
  for (const s of sources) {
    const words = s.content.match(/[A-Za-z0-9_-]+/g) || [];
    for (const w of words) sourceWords.add(w.toLowerCase());
  }

  const mergedWords = (merged.match(/[A-Za-z0-9_-]+/g) || []).map((w) => w.toLowerCase());
  const newWords = mergedWords.filter(
    (w) => !sourceWords.has(w) && !CONNECTIVE_WORDS.has(w) && !/^\d+$/.test(w)
  );
  if (newWords.length > 0) {
    return false;
  }

  return true;
}

/**
 * 提取模型回复中的 JSON 数组对象
 */
export function extractJsonProposals(rawReply: string): Array<Record<string, unknown>> {
  let cleaned = rawReply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*|```\s*$/g, '').trim();

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        return parsed.filter((p) => typeof p === 'object' && p !== null);
      }
    } catch {
      // 容错进入逐个提取模式
    }
  }

  const result: Array<Record<string, unknown>> = [];
  const regex = /\{[\s\S]*?\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    try {
      const obj = JSON.parse(match[0]);
      if (typeof obj === 'object' && obj !== null && (obj.op === 'merge' || obj.op === 'drop')) {
        result.push(obj);
      }
    } catch {}
  }
  return result;
}

/**
 * 确定性规则过滤：审查模型提议并生成受控执行计划
 */
export function planConsolidation(
  items: MemoryItem[],
  proposals: Array<Record<string, unknown>>,
  budgetShare = 0.2
): { ops: ValidatedOp[]; skipped: string[]; more: boolean } {
  const byId = new Map<string, MemoryItem>(items.map((i) => [i.id, i]));
  const ops: ValidatedOp[] = [];
  const skipped: string[] = [];
  const touchedIds = new Set<string>();

  // 单次精简最多允许减少的行数 (预算上限: 至少 1 行，最多 20%)
  const budget = Math.max(1, Math.floor(items.length * budgetShare));
  let removedCount = 0;
  let more = false;

  for (const raw of proposals) {
    const op = String(raw.op || '').toLowerCase();

    if (op === 'merge') {
      const rawIds = Array.isArray(raw.ids) ? raw.ids.map(String) : [];
      const ids = Array.from(new Set(rawIds)).filter((id) => byId.has(id));
      const content = String(raw.content || '').trim();

      if (ids.length < 2 || !content) {
        skipped.push(`merge of ${JSON.stringify(raw.ids)}: 需要至少两个有效条目 ID 和合并后内容`);
        continue;
      }

      if (ids.some((id) => touchedIds.has(id))) {
        skipped.push(`merge of [${ids.join(', ')}]: 包含已被其他操作占用的条目`);
        continue;
      }

      const sources = ids.map((id) => byId.get(id)!);

      // 死线 1: 严禁新实体捏造
      if (!noNewEntities(content, sources)) {
        skipped.push(`merge of [${ids.join(', ')}]: “${content}” 包含原事实未曾提及的新词汇（触发幻觉硬拦截）`);
        continue;
      }

      // 死线 3: 20% 预算控制 (k 个合并为 1 个，实际减少 k - 1 行)
      const cost = ids.length - 1;
      if (removedCount + cost > budget) {
        skipped.push(`merge of [${ids.join(', ')}]: 超出单次 20% 精简预算限制，延后至下个周期`);
        more = true;
        continue;
      }

      for (const id of ids) touchedIds.add(id);
      removedCount += cost;
      ops.push({ op: 'merge', items: sources, content });
    } else if (op === 'drop') {
      const id = String(raw.id || '').trim();
      const item = byId.get(id);

      if (!item) {
        skipped.push(`drop ${id}: 未知条目 ID`);
        continue;
      }

      if (touchedIds.has(id)) {
        skipped.push(`drop ${id}: 该条目已在其他操作中处理`);
        continue;
      }

      // 死线 2: 用户显式录入的声明绝不可删除
      if (item.source === 'user') {
        skipped.push(`drop ${id} (“${item.content}”): 严禁删除用户核心声明 [User Anchor Protection]`);
        continue;
      }

      // 死线 3: 20% 预算控制
      if (removedCount + 1 > budget) {
        skipped.push(`drop ${id}: 超出单次 20% 精简预算限制，延后至下个周期`);
        more = true;
        continue;
      }

      touchedIds.add(id);
      removedCount += 1;
      ops.push({ op: 'drop', items: [item], reason: String(raw.reason || '过时琐碎信息') });
    } else {
      skipped.push(`未知操作类型: ${op}`);
    }
  }

  return { ops, skipped, more };
}

/**
 * 实际执行整理：重构 MEMORY.md 并输出审计报告
 */
export function applyConsolidation(
  markdown: string,
  items: MemoryItem[],
  ops: ValidatedOp[],
  botId: string,
  skipped: string[],
  more: boolean,
  dryRun = false
): { newMarkdown: string; report: TidyReport } {
  const mergedChanges: MemoryChange[] = [];
  const droppedChanges: MemoryChange[] = [];
  const planned: TidyReport['planned'] = [];
  const timestamp = Date.now();

  const dropItemIds = new Set<string>();
  const mergeReplacements = new Map<string, string>(); // primaryId -> newContent

  for (const op of ops) {
    if (op.op === 'drop') {
      const it = op.items[0];
      dropItemIds.add(it.id);
      droppedChanges.push({
        op: 'drop',
        before: [it.content],
        reason: op.reason,
        timestamp
      });
      planned.push({
        op: 'drop',
        ids: [it.id],
        before: [it.content],
        reason: op.reason
      });
    } else if (op.op === 'merge') {
      const primary = op.items[0];
      const others = op.items.slice(1);
      mergeReplacements.set(primary.id, op.content!);
      for (const o of others) {
        dropItemIds.add(o.id);
      }
      mergedChanges.push({
        op: 'merge',
        before: op.items.map((i) => i.content),
        after: op.content,
        timestamp
      });
      planned.push({
        op: 'merge',
        ids: op.items.map((i) => i.id),
        before: op.items.map((i) => i.content),
        content: op.content
      });
    }
  }

  const summary = `审阅 ${items.length} 条事实，变更 ${mergedChanges.length + droppedChanges.length} 条 (合并 ${mergedChanges.length} 组，精简 ${droppedChanges.length} 条，忽略/跳过 ${skipped.length} 条)`;

  const report: TidyReport = {
    botId,
    timestamp,
    considered: items.length,
    changed: mergedChanges.length + droppedChanges.length,
    merged: mergedChanges,
    dropped: droppedChanges,
    skipped,
    planned,
    more,
    dryRun,
    summary
  };

  if (dryRun) {
    return { newMarkdown: markdown, report };
  }

  // 重构文本：保留原有标题、注释与空行，替换或移除目标条目
  const itemMap = new Map<string, MemoryItem>(items.map((i) => [i.rawLine.trim(), i]));
  const originalLines = (markdown || '').split('\n');
  const newLines: string[] = [];

  for (const line of originalLines) {
    const trimmed = line.trim();
    const item = itemMap.get(trimmed);
    if (!item) {
      newLines.push(line);
      continue;
    }

    if (dropItemIds.has(item.id)) {
      continue;
    }

    if (mergeReplacements.has(item.id)) {
      const newText = mergeReplacements.get(item.id)!;
      newLines.push(`${item.prefix}${newText}${item.source === 'user' ? ' [user]' : ''}`);
      continue;
    }

    newLines.push(line);
  }

  return { newMarkdown: newLines.join('\n').trim() + '\n', report };
}

/**
 * 构造发送给大模型的提炼 Prompt
 */
export function buildTidyPrompt(items: MemoryItem[]): string {
  const linesFormatted = items
    .map(
      (m) =>
        `- ID: ${m.id} [分类: ${m.category}] [${m.source === 'user' ? '用户声明(绝对不可删除)' : 'Agent记录'}] 内容: “${m.content}”`
    )
    .join('\n');

  return `你负责维护企业数字员工的长期记忆库：记录关于用户和业务事实的简短要点。以下是当前保存的所有事实清单。请提出整理建议，在不丢失用户任何关键真实信息的前提下，去除过时、重复及矛盾的碎片。

整理规则：
1. merge (合并)：两项或多项陈述相同事实，或存在版本升级/递进更新（如“正在尝试升级到 React 19”与“项目升级到了 React 19”），合并为一条保留所有细节（人名、时间、版本、IP 等）的最新事实。
2. drop (丢弃)：删除一次性跑腿琐事（如已结束的排查、一次性命令测试）、已被后续事实彻底替代且无参考价值的废弃陈述。
3. 绝对约束：
   - 严禁捏造新事实！合并后的文本只能包含原已有词汇和实体，不得凭空补充未经提及的新信息。
   - 用户亲自录入的声明（带有 [user] 或 [用户声明] 标记）绝对禁止删除 (drop)！
   - 如无必要改动的条目请保持原样。

当前记忆条目 (${items.length} 条)：
${linesFormatted}

请仅输出合法 JSON 数组，不要包含任何多余文字或 Markdown 说明，格式如下：
[
  {"op": "merge", "ids": ["m_1", "m_2"], "content": "合并后的最新事实"},
  {"op": "drop", "id": "m_3", "reason": "一次性已解决琐碎事项"}
]`;
}
