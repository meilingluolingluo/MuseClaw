import { marked } from 'marked';
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

// 只注册工作台里真实出现的语言：整包 highlight.js 会让首屏多出约 800 KB
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
  yaml,
  yml: yaml,
  sql,
  markdown,
  md: markdown,
  diff,
  ini,
  toml: ini,
  dockerfile
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

/** 只放行明确安全的协议；相对路径与锚点保留 */
function safeHref(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^(javascript|vbscript|data|file):/i.test(value)) return null;
  if (/^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(value)) return value;
  return null;
}

function safeImageSrc(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(value)) return value;
  return /^(https?:\/\/|\/)/i.test(value) ? value : null;
}

const renderer = new marked.Renderer();

// 模型输出里的原始 HTML 一律当文字显示，绝不交给 dangerouslySetInnerHTML
renderer.html = function (token) {
  return escapeHtml(token.text);
};

renderer.table = function ({ header, rows }) {
  const headerHtml = header.map((cell) => `<th class="cell-nowrap">${cell.text}</th>`).join('');
  const bodyHtml = rows
    .map((row) => {
      const rowCells = row.map((cell) => `<td class="cell-nowrap">${cell.text}</td>`).join('');
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
      <img src="${escapeHtml(safe)}"${altAttr}${titleAttr} class="markdown-image" loading="lazy" />
      ${caption}
    </div>
  `;
};

renderer.code = function ({ text, lang }) {
  const language = (lang || '').trim().toLowerCase();
  let highlighted = escapeHtml(text);
  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(text, { language }).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  } else {
    try {
      highlighted = hljs.highlightAuto(text).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  }

  const langLabel = language
    ? `<span class="code-lang">${escapeHtml(language)}</span>`
    : '<span class="code-lang">TEXT</span>';
  return `
    <div class="code-block-wrapper">
      <div class="code-block-header">
        ${langLabel}
        <button class="code-copy-btn" type="button" data-code="${escapeHtml(text)}">复制</button>
      </div>
      <pre><code class="hljs ${escapeHtml(language)}">${highlighted}</code></pre>
    </div>
  `;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true
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
