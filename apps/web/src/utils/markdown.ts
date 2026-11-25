import { marked, type Tokens } from 'marked';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import powershell from 'highlight.js/lib/languages/powershell';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import graphql from 'highlight.js/lib/languages/graphql';
import makefile from 'highlight.js/lib/languages/makefile';
import nginx from 'highlight.js/lib/languages/nginx';

// 注册工作台常用编程语言：按需引入单语言定义避免全量打包
const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  sh: bash,
  shell: bash,
  zsh: bash,
  javascript,
  js: javascript,
  jsx: javascript,
  typescript,
  ts: typescript,
  tsx: typescript,
  json,
  python,
  py: python,
  css,
  html: xml,
  xml,
  svg: xml,
  yaml,
  yml: yaml,
  sql,
  markdown,
  md: markdown,
  diff,
  ini,
  toml: ini,
  dockerfile,
  docker: dockerfile,
  go,
  golang: go,
  rust,
  rs: rust,
  java,
  c,
  cpp,
  'c++': cpp,
  cc: cpp,
  cxx: cpp,
  csharp,
  cs: csharp,
  'c#': csharp,
  powershell,
  ps1: powershell,
  ruby,
  rb: ruby,
  php,
  swift,
  kotlin,
  kt: kotlin,
  graphql,
  gql: graphql,
  makefile,
  make: makefile,
  nginx,
  conf: nginx,
};

for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}

export function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function highlightCode(text: string, lang?: string): { html: string; language: string } {
  const language = (lang || '').trim().toLowerCase();
  if (language && hljs.getLanguage(language)) {
    try {
      return { html: hljs.highlight(text, { language }).value, language };
    } catch {
      return { html: escapeHtml(text), language };
    }
  }
  if (!language || ['text', 'txt', 'plaintext', 'plain'].includes(language)) {
    return { html: escapeHtml(text), language: language || 'text' };
  }
  try {
    return { html: hljs.highlightAuto(text).value, language };
  } catch {
    return { html: escapeHtml(text), language };
  }
}

/** 只放行明确安全的协议；相对路径与锚点保留 */
export function safeHref(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^(javascript|vbscript|data|file):/i.test(value)) return null;
  if (/^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(value)) return value;
  return null;
}

export function safeImageSrc(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(value)) return value;
  return /^(https?:\/\/|\/)/i.test(value) ? value : null;
}

type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

const ALERT_META: Record<AlertKind, { label: string; iconSvg: string }> = {
  note: {
    label: '提示',
    iconSvg:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  },
  tip: {
    label: '技巧',
    iconSvg:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  },
  important: {
    label: '重要',
    iconSvg:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/></svg>',
  },
  warning: {
    label: '注意',
    iconSvg:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  },
  caution: {
    label: '警告',
    iconSvg:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  },
};

const ALERT_BLOCK_RE = /^\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<\/p>\s*|(?:\s*<br\s*\/?>|\r?\n)+)/i;

const renderer = new marked.Renderer();

// 模型输出里的原始 HTML 一律当文字显示，绝不交给 dangerouslySetInnerHTML
renderer.html = function (token) {
  return escapeHtml(token.text);
};

renderer.blockquote = function ({ tokens }: Tokens.Blockquote) {
  const bodyHtml = this.parser.parse(tokens);
  const match = ALERT_BLOCK_RE.exec(bodyHtml);
  if (!match) {
    return `<blockquote>${bodyHtml}</blockquote>`;
  }
  const kind = match[1].toLowerCase() as AlertKind;
  const meta = ALERT_META[kind];
  const isStandaloneParagraph = /<\/p>\s*$/i.test(match[0]);
  const strippedBody = isStandaloneParagraph
    ? bodyHtml.slice(match[0].length)
    : `<p>${bodyHtml.slice(match[0].length)}`;

  return `<div class="markdown-alert markdown-alert-${kind}" role="note"><div class="markdown-alert-title"><span class="markdown-alert-icon">${meta.iconSvg}</span><span>${meta.label}</span></div><div class="markdown-alert-content">${strippedBody}</div></div>`;
};

renderer.table = function ({ header, rows }) {
  const parseCell = (cell: any) => {
    if (cell.tokens && cell.tokens.length > 0) {
      return (this.parser as any).parseInline(cell.tokens);
    }
    if (cell.text) {
      return marked.parseInline(cell.text) as string;
    }
    return '';
  };

  const getCellClass = (cell: any) => {
    const raw = String(cell?.text || '').trim();
    return raw.length > 0 && raw.length <= 16 && !raw.includes('\n') ? ' class="cell-nowrap"' : '';
  };

  const headerHtml = header
    .map((cell) => `<th${getCellClass(cell)}>${parseCell(cell)}</th>`)
    .join('');
  const bodyHtml = rows
    .map((row) => {
      const rowCells = row
        .map((cell) => `<td${getCellClass(cell)}>${parseCell(cell)}</td>`)
        .join('');
      return `<tr>${rowCells}</tr>`;
    })
    .join('');

  return `<div class="markdown-table-wrapper"><table class="markdown-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
};

renderer.link = function ({ href, title, text }) {
  const safe = safeHref(href);
  if (!safe) return text;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(safe)}"${titleAttr} target="_blank" rel="noopener noreferrer" class="markdown-link">${text}</a>`;
};

renderer.image = function ({ href, title, text }) {
  const safe = safeImageSrc(href);
  if (!safe) return escapeHtml(text || '');
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  const altAttr = text ? ` alt="${escapeHtml(text)}"` : ' alt="image"';
  const caption = text ? `<div class="markdown-image-caption">${escapeHtml(text)}</div>` : '';
  return `
    <div class="markdown-image-wrapper">
      <img src="${escapeHtml(safe)}"${altAttr}${titleAttr} data-lightbox-src="${escapeHtml(safe)}" data-lightbox-alt="${escapeHtml(text || '')}" class="markdown-image" loading="lazy" />
      ${caption}
    </div>
  `;
};

renderer.code = function ({ text, lang }) {
  const { html: highlighted, language } = highlightCode(text, lang);
  const langLabel = language && language !== 'text'
    ? `<span class="code-lang">${escapeHtml(language)}</span>`
    : '<span class="code-lang">TEXT</span>';
  return `
    <div class="code-block-wrapper">
      <div class="code-block-header">
        ${langLabel}
        <button class="code-copy-btn" type="button" data-code="${escapeHtml(text)}" title="复制代码" aria-label="复制代码">复制</button>
      </div>
      <pre><code class="hljs ${escapeHtml(language)}">${highlighted}</code></pre>
    </div>
  `;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
});

export function renderMarkdown(content: string): string {
  if (!content) return '';
  try {
    return marked.parse(content) as string;
  } catch (err) {
    console.error('Markdown parse error:', err);
    return `<p>${escapeHtml(content)}</p>`;
  }
}

export function renderInlineMarkdown(content: string): string {
  if (!content) return '';
  try {
    return marked.parseInline(content) as string;
  } catch {
    return escapeHtml(content);
  }
}

const ANSI_FG_MAP: Record<number, string> = {
  30: 'ansi-fg-black',
  31: 'ansi-fg-red',
  32: 'ansi-fg-green',
  33: 'ansi-fg-yellow',
  34: 'ansi-fg-blue',
  35: 'ansi-fg-magenta',
  36: 'ansi-fg-cyan',
  37: 'ansi-fg-white',
  90: 'ansi-fg-bright-black',
  91: 'ansi-fg-bright-red',
  92: 'ansi-fg-bright-green',
  93: 'ansi-fg-bright-yellow',
  94: 'ansi-fg-bright-blue',
  95: 'ansi-fg-bright-magenta',
  96: 'ansi-fg-bright-cyan',
  97: 'ansi-fg-bright-white',
};

/**
 * 将包含 ANSI SGR 转义序列的终端文本安全渲染为带语义样式类名的 HTML
 */
export function ansiToHtml(raw: string): string {
  const source = String(raw || '');
  // eslint-disable-next-line no-control-regex
  const sgrRe = /\x1b\[([0-9;]*)m/g;
  // eslint-disable-next-line no-control-regex
  const otherEscRe = /\x1b\[[0-9;?]*[A-Za-z]/g;

  let result = '';
  let lastIdx = 0;
  let fgClass = '';
  let bold = false;
  let dim = false;
  let spanOpen = false;

  const closeSpan = () => {
    if (spanOpen) {
      result += '</span>';
      spanOpen = false;
    }
  };

  const openSpanIfNeeded = () => {
    const classes: string[] = [];
    if (fgClass) classes.push(fgClass);
    if (bold) classes.push('ansi-bold');
    if (dim) classes.push('ansi-dim');
    if (classes.length > 0) {
      result += `<span class="${classes.join(' ')}">`;
      spanOpen = true;
    }
  };

  let match: RegExpExecArray | null;
  while ((match = sgrRe.exec(source)) !== null) {
    const chunk = source.slice(lastIdx, match.index).replace(otherEscRe, '');
    if (chunk) {
      result += escapeHtml(chunk);
    }
    lastIdx = sgrRe.lastIndex;

    const params = match[1] ? match[1].split(';').map((n) => parseInt(n, 10)) : [0];
    for (const code of params) {
      if (Number.isNaN(code) || code === 0) {
        fgClass = '';
        bold = false;
        dim = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) {
        fgClass = '';
      } else if (ANSI_FG_MAP[code]) {
        fgClass = ANSI_FG_MAP[code];
      }
    }

    closeSpan();
    openSpanIfNeeded();
  }

  const tail = source.slice(lastIdx).replace(otherEscRe, '');
  if (tail) {
    result += escapeHtml(tail);
  }
  closeSpan();
  return result;
}
