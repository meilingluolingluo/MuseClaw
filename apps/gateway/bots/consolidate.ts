/**
 * 受控长期记忆整理与去冗余引擎 (Memory Consolidation)
 * 参考 nanoMuse: nanomuse/memory/consolidate.py
 *
 * 核心原则：模型提议，确定性规则兜底 (Model Proposes, Deterministic Module Decides)
 * 1. 操作原子化：仅支持 merge（合并事实）与 drop（删除碎屑）
 * 2. 实体守恒：严禁 LLM 捏造原事实中未曾出现过的新实体与词汇
 * 3. 用户锚点保护：严禁删除用户亲自录入的声明（[user] 标记）
 * 4. 预算约束：单次整理最多精简存储量的 20%，防止大面积误删
 * 5. 变更留痕与一键撤销：输出结构化 TidyReport，支持原子级 Undo 回滚
 */

export interface MemoryItem {
  id: string; // m_1, m_2, ...
  content: string; // 事实内容
  source: 'user' | 'agent'; // user 为用户亲自录入的声明，不可 drop
  category?: string;
  rawLine: string;
  prefix: string; // 如 "- ", "* ", "1. "
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
}

// 允许在合并时使用的中英文连接词与过渡字符（不算作新捏造事实）
const CONNECTIVE_WORDS = new Set(
  'and with from moved now since previously formerly also both prefers likes the for his her their is was has not no to into of at by using uses used previously originally formerly'.split(
    ' '
  )
);

const CONNECTIVE_CHARS = new Set(
  '在从搬到现以前和与并且喜欢不的了是住工作用曾经后来已改为原偏好（）()，、。；：：+-/—'.split('')
);

/**
 * 将 MEMORY.md 文本解析为结构化条目清单
 */
export function parseMemoryMarkdown(markdown: string): { items: MemoryItem[]; lines: string[] } {
  const rawLines = markdown.split('\n');
  const items: MemoryItem[] = [];
  let itemIndex = 1;

  for (const line of rawLines) {
    const trimmed = line.trim();
    // 忽略空行和标题行作为候选事实
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // 匹配列表前缀: "- ", "* ", "1. ", 等
    const prefixMatch = line.match(/^(\s*[-*]|\s*\d+\.)\s+/);
    const prefix = prefixMatch ? prefixMatch[0] : '- ';
    let text = prefixMatch ? line.slice(prefixMatch[0].length).trim() : trimmed;

    // 识别用户亲自录入的声明标记
    let source: 'user' | 'agent' = 'agent';
    if (text.includes('[user]') || text.includes('[用户声明]') || text.includes('[用户]')) {
      source = 'user';
    }

    const id = `m_${itemIndex++}`;
    items.push({
      id,
      content: text,
      source,
      rawLine: line,
      prefix
    });
  }

  return { items, lines: rawLines };
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
 * 提取大模型回复中的 JSON 数组对象
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
      // 容错进入单对象逐个提取模式
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
 * 确定性死线过滤：审查 LLM 提议并生成受控执行计划
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

      // 死线 1: 严禁新事实捏造
      if (!noNewEntities(content, sources)) {
        skipped.push(`merge of [${ids.join(', ')}]: “${content}” 包含原事实未曾提及的新实体或词汇（触发幻觉拦截）`);
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

      // 死线 2: 用户亲自录入的声明绝对不可删除
      if (item.source === 'user') {
        skipped.push(`drop ${id} (“${item.content}”): 严禁删除用户亲自录入的声明 [User Anchor]`);
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
      ops.push({ op: 'drop', items: [item], reason: String(raw.reason || '过时碎片') });
    } else {
      skipped.push(`未知操作类型: ${op}`);
    }
  }

  return { ops, skipped, more };
}

/**
 * 实际执行整理：基于通过死线审查的 Ops 重塑 MEMORY.md 文本并产出审计报告
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
    dryRun
  };

  if (dryRun) {
    return { newMarkdown: markdown, report };
  }

  // 重构文本：保留原有标题、注释与空行，仅替换/删除目标条目
  const itemMap = new Map<string, MemoryItem>(items.map((i) => [i.rawLine.trim(), i]));
  const originalLines = markdown.split('\n');
  const newLines: string[] = [];

  for (const line of originalLines) {
    const trimmed = line.trim();
    const item = itemMap.get(trimmed);
    if (!item) {
      newLines.push(line);
      continue;
    }

    if (dropItemIds.has(item.id)) {
      // 丢弃此行
      continue;
    }

    if (mergeReplacements.has(item.id)) {
      // 替换为合并后的新内容
      const newText = mergeReplacements.get(item.id)!;
      newLines.push(`${item.prefix}${newText}`);
      continue;
    }

    // 未变动行保留
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
        `- ID: ${m.id} [${m.source === 'user' ? '用户声明(不可删除)' : 'Agent记录'}] 内容: “${m.content}”`
    )
    .join('\n');

  return `你负责维护企业数字员工的长期记忆库：记录关于用户和业务事实的简短要点。以下是当前保存的所有事实清单。请提出整理建议，在不丢失用户任何关键真实信息的前提下，去除过时、重复及矛盾的碎片。

整理规则：
1. merge (合并)：两项或多项陈述相同事实，或存在版本升级/递进更新（如“正在尝试升级到 React 19”与“项目升级到了 React 19”），合并为一条保留所有细节（人名、时间、版本、IP 等）的最新事实。
2. drop (丢弃)：删除一次性跑腿琐事（如已结束的订会议室、查天气、一次性临时排查）、已被后续事实彻底替代且无参考价值的废弃陈述。
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
