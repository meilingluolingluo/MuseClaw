import { marked } from 'marked';
import hljs from 'highlight.js';

export function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const renderer = new marked.Renderer();

renderer.table = function ({ header, rows }) {
  const headerHtml = header.map(cell => `<th class="cell-nowrap">${cell.text}</th>`).join('');
  const bodyHtml = rows.map(row => {
    const rowCells = row.map(cell => `<td class="cell-nowrap">${cell.text}</td>`).join('');
    return `<tr>${rowCells}</tr>`;
  }).join('');

  return `<div class="markdown-table-wrapper"><table class="markdown-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
};

renderer.link = function ({ href, title, text }) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer" class="markdown-link">${text}</a>`;
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

  const langLabel = language ? `<span class="code-lang">${escapeHtml(language)}</span>` : '<span class="code-lang">TEXT</span>';
  return `
    <div class="code-block-wrapper">
      <div class="code-block-header">
        ${langLabel}
        <button class="code-copy-btn" type="button" data-code="${escapeHtml(text)}">复制</button>
      </div>
      <pre><code class="hljs ${language}">${highlighted}</code></pre>
    </div>
  `;
};

renderer.image = function ({ href, title, text }) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  const altAttr = text ? ` alt="${escapeHtml(text)}"` : ' alt="image"';
  const safeHref = escapeHtml(href);
  const caption = text ? `<div class="markdown-image-caption">${escapeHtml(text)}</div>` : '';
  return `
    <div class="markdown-image-wrapper">
      <img src="${safeHref}"${altAttr}${titleAttr} class="markdown-image" loading="lazy" />
      ${caption}
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
