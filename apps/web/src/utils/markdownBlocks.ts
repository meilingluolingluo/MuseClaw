export type DomainCardKind = 'goal' | 'goal-update' | 'feed' | 'routine' | 'memory' | 'clarify';

export type MarkdownBlock =
  | { type: 'markdown'; raw: string; key: string }
  | { type: 'code'; lang: string; code: string; open: boolean; key: string }
  | { type: 'mermaid'; code: string; open: boolean; key: string }
  | {
      type: 'table';
      headers: string[];
      alignments: Array<'left' | 'center' | 'right' | null>;
      rows: string[][];
      raw: string;
      key: string;
    }
  | { type: 'domain-card'; kind: DomainCardKind; data: Record<string, any>; raw: string; key: string };

export interface MathToken {
  id: string;
  tex: string;
  display: boolean;
}

const DOMAIN_LANGS = new Set(['json', 'muse-card', 'goal', 'goal-update', 'feed', 'routine', 'memory', 'clarify', 'question']);

function parseDomainFence(lang: string, code: string): { kind: DomainCardKind; data: Record<string, any> } | null {
  const normalizedLang = lang.trim().toLowerCase();
  if (!DOMAIN_LANGS.has(normalizedLang)) return null;
  const trimmed = code.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, any>;

  if (
    normalizedLang === 'clarify' ||
    normalizedLang === 'question' ||
    (Array.isArray(obj.questions) && obj.questions.length > 0) ||
    (Array.isArray(obj.options) && obj.options.length > 0 && (typeof obj.question === 'string' || typeof obj.title === 'string'))
  ) {
    return { kind: 'clarify', data: obj };
  }

  if (
    normalizedLang === 'goal-update' ||
    (('goal_id' in obj || 'progress' in obj) && 'status' in obj && !('steps' in obj) && !('cronExpr' in obj))
  ) {
    return { kind: 'goal-update', data: obj };
  }

  if (
    normalizedLang === 'goal' ||
    (typeof obj.title === 'string' && ('steps' in obj || 'cadence' in obj || 'why' in obj || 'check_every_hours' in obj))
  ) {
    return { kind: 'goal', data: obj };
  }

  if (
    normalizedLang === 'routine' ||
    ((typeof obj.name === 'string' || typeof obj.title === 'string') && ('cronExpr' in obj || 'schedule' in obj || 'scheduleHumanZh' in obj))
  ) {
    return { kind: 'routine', data: obj };
  }

  if (
    normalizedLang === 'feed' ||
    (typeof obj.title === 'string' && typeof obj.body === 'string' && ('emoji' in obj || 'kind' in obj || 'area' in obj))
  ) {
    return { kind: 'feed', data: obj };
  }

  if (
    normalizedLang === 'memory' ||
    (typeof obj.content === 'string' && typeof obj.category === 'string' && ('memoryId' in obj || 'protected' in obj))
  ) {
    return { kind: 'memory', data: obj };
  }

  return null;
}

const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitTableCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseTableAlignments(sepLine: string, colCount: number): Array<'left' | 'center' | 'right' | null> {
  const cells = splitTableCells(sepLine);
  const result: Array<'left' | 'center' | 'right' | null> = [];
  for (let i = 0; i < colCount; i++) {
    const cell = (cells[i] || '').trim();
    const startsColon = cell.startsWith(':');
    const endsColon = cell.endsWith(':');
    if (startsColon && endsColon) result.push('center');
    else if (endsColon) result.push('right');
    else if (startsColon) result.push('left');
    else result.push(null);
  }
  return result;
}

function isTableCandidateRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('|')) return false;
  if (/^(#{1,6}\s|>|[-*+]\s|\d+\.\s|```|~~~)/.test(trimmed)) return false;
  return true;
}

function flushMarkdownSegment(segment: string, blocks: MarkdownBlock[]): void {
  const lines = segment.split('\n');
  let buffer: string[] = [];
  let i = 0;

  const flushBuffer = () => {
    const text = buffer.join('\n');
    if (text.trim()) {
      // 按双换行进一步拆分为稳定块，流式输出时避免长文前段反复解析
      const chunks = text.split(/\n{2,}/);
      for (const chunk of chunks) {
        if (chunk.trim()) {
          blocks.push({ type: 'markdown', raw: chunk, key: `md_${blocks.length}` });
        }
      }
    }
    buffer = [];
  };

  while (i < lines.length) {
    if (
      i + 1 < lines.length &&
      isTableCandidateRow(lines[i]) &&
      TABLE_SEP_RE.test(lines[i + 1])
    ) {
      const headers = splitTableCells(lines[i]);
      const sepCells = splitTableCells(lines[i + 1]);
      if (headers.length >= 2 && sepCells.length === headers.length) {
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && isTableCandidateRow(lines[j])) {
          const cells = splitTableCells(lines[j]);
          while (cells.length < headers.length) cells.push('');
          rows.push(cells.slice(0, headers.length));
          j += 1;
        }
        if (rows.length > 0) {
          flushBuffer();
          blocks.push({
            type: 'table',
            headers,
            alignments: parseTableAlignments(lines[i + 1], headers.length),
            rows,
            raw: lines.slice(i, j).join('\n'),
            key: `tbl_${blocks.length}`,
          });
          i = j;
          continue;
        }
      }
    }

    buffer.push(lines[i]);
    i += 1;
  }

  flushBuffer();
}

/**
 * 将 Markdown 文本拆分为普通文本、代码块、Mermaid 图表、交互式表格与领域卡片块，
 * 以便流式渲染时已闭合的前置块直接复用缓存。
 */
export function splitMarkdownIntoBlocks(content: string, isStreaming = false): MarkdownBlock[] {
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];

  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let textLines: string[] = [];

  let inFence = false;
  let fenceChar = '`';
  let fenceLen = 3;
  let fenceLang = '';
  let fenceLines: string[] = [];

  const flushText = () => {
    if (textLines.length === 0) return;
    flushMarkdownSegment(textLines.join('\n'), blocks);
    textLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const openMatch = line.match(/^\s{0,3}(`{3,}|~{3,})([^\n]*)$/);
      if (openMatch) {
        const marker = openMatch[1];
        const info = openMatch[2].trim();
        // 行内反引号嵌套同一行闭合的情况不视为围栏
        if (marker[0] === '`' && info.includes('`')) {
          textLines.push(line);
          continue;
        }
        flushText();
        inFence = true;
        fenceChar = marker[0];
        fenceLen = marker.length;
        fenceLang = info.split(/\s+/)[0] || '';
        fenceLines = [];
        continue;
      }
      textLines.push(line);
    } else {
      const closeMatch = line.match(new RegExp(`^\\s{0,3}${fenceChar}{${fenceLen},}\\s*$`));
      if (closeMatch) {
        const code = fenceLines.join('\n');
        const lowerLang = fenceLang.toLowerCase();
        if (lowerLang === 'mermaid') {
          blocks.push({ type: 'mermaid', code, open: false, key: `mmd_${blocks.length}` });
        } else {
          const domain = parseDomainFence(lowerLang, code);
          if (domain) {
            blocks.push({
              type: 'domain-card',
              kind: domain.kind,
              data: domain.data,
              raw: code,
              key: `dom_${blocks.length}`,
            });
          } else {
            blocks.push({ type: 'code', lang: fenceLang, code, open: false, key: `code_${blocks.length}` });
          }
        }
        inFence = false;
        fenceLang = '';
        fenceLines = [];
        continue;
      }
      fenceLines.push(line);
    }
  }

  if (inFence) {
    const code = fenceLines.join('\n');
    const lowerLang = fenceLang.toLowerCase();
    if (lowerLang === 'mermaid') {
      blocks.push({ type: 'mermaid', code, open: isStreaming, key: `mmd_${blocks.length}` });
    } else {
      blocks.push({ type: 'code', lang: fenceLang, code, open: isStreaming, key: `code_${blocks.length}` });
    }
  } else {
    flushText();
  }

  return blocks;
}

const CURRENCY_PREFIX_RE = /(?:R|US|AU|A|CA|C|NZ|HK|SG|S|MX|NT|BZ|Z)\$$/;

/**
 * 保护行内代码并提取 LaTeX 公式为安全占位符，避免货币金额 $100 等被误识别为数学公式
 */
export function preprocessMath(markdown: string): { text: string; tokens: MathToken[] } {
  const tokens: MathToken[] = [];
  if (!markdown || (!markdown.includes('$') && !markdown.includes('\\(') && !markdown.includes('\\['))) {
    return { text: markdown, tokens };
  }

  // 1. 保护行内代码与转义美元符
  const protectedSpans: string[] = [];
  const hold = (val: string) => {
    const placeholder = `\uE000CP${protectedSpans.length}\uE001`;
    protectedSpans.push(val);
    return placeholder;
  };

  let working = markdown.replace(/(`+)([\s\S]*?)\1/g, (m) => hold(m));
  working = working.replace(/\\\$/g, () => hold('\\$'));

  const pushMath = (tex: string, display: boolean): string => {
    const id = `\uE000MM${tokens.length}\uE001`;
    tokens.push({ id, tex: tex.trim(), display });
    return id;
  };

  // 2. 提取 \[...\] 与 \(...\)
  working = working
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => pushMath(tex, true))
    .replace(/\\\(([^\n]+?)\\\)/g, (_m, tex: string) => pushMath(tex, false));

  // 3. 提取 $$...$$ 块级公式
  working = working.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => pushMath(tex, true));

  // 4. 扫描行内单 $...$，遵守边界与货币规则
  if (working.includes('$')) {
    let out = '';
    let i = 0;
    while (i < working.length) {
      if (working[i] !== '$') {
        out += working[i];
        i += 1;
        continue;
      }

      // 判断是否为货币前缀（如 US$100）或后跟空白
      const beforeWithDollar = working.slice(Math.max(0, i - 3), i + 1);
      const nextChar = working[i + 1] ?? '';
      if (CURRENCY_PREFIX_RE.test(beforeWithDollar) || !nextChar || /\s/.test(nextChar)) {
        out += '$';
        i += 1;
        continue;
      }

      // 查找同一段落内的闭合 $
      let closeIdx = -1;
      for (let j = i + 1; j < working.length; j++) {
        if (working[j] === '\\') {
          j += 1;
          continue;
        }
        if (working[j] === '\n' && /^\s*\n/.test(working.slice(j + 1))) {
          break;
        }
        if (working[j] === '$') {
          const prevChar = working[j - 1] ?? '';
          const afterClose = working[j + 1] ?? '';
          if (!/\s/.test(prevChar) && !/\d/.test(afterClose)) {
            closeIdx = j;
          }
          break;
        }
      }

      if (closeIdx > i + 1) {
        const inner = working.slice(i + 1, closeIdx);
        // 额外避免纯数字/逗号价格区间如 "$10-$20"
        if (/^\d[\d,.\s]*$/.test(inner.trim())) {
          out += '$';
          i += 1;
        } else {
          out += pushMath(inner, false);
          i = closeIdx + 1;
        }
      } else {
        out += '$';
        i += 1;
      }
    }
    working = out;
  }

  // 5. 还原行内代码与转义美元符
  // eslint-disable-next-line no-control-regex
  working = working.replace(/\uE000CP(\d+)\uE001/g, (_m, idx) => protectedSpans[Number(idx)] ?? '');

  return { text: working, tokens };
}

export function containsMath(text: string): boolean {
  if (!text) return false;
  return preprocessMath(text).tokens.length > 0;
}

type KatexModule = typeof import('katex');
let katexInstance: KatexModule['default'] | null = null;
let katexLoading: Promise<KatexModule['default']> | null = null;

/**
 * 按需懒加载 KaTeX 引擎及其样式表，避免影响首屏体积
 */
export function loadKatex(): Promise<KatexModule['default']> {
  if (katexInstance) return Promise.resolve(katexInstance);
  if (!katexLoading) {
    katexLoading = Promise.all([
      import('katex'),
      typeof document !== 'undefined' ? import('katex/dist/katex.min.css') : Promise.resolve(),
    ])
      .then(([mod]) => {
        katexInstance = (mod as any).default || mod;
        return katexInstance!;
      })
      .catch((err) => {
        katexLoading = null;
        throw err;
      });
  }
  return katexLoading;
}
