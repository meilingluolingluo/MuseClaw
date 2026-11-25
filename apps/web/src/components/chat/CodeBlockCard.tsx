import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Download, WrapText } from 'lucide-react';
import { escapeHtml, highlightCode } from '../../utils/markdown';
import { copyToClipboard } from '../../utils/clipboard';

interface CodeBlockCardProps {
  code: string;
  lang?: string;
  open?: boolean;
}

const COLLAPSE_THRESHOLD = 25;
const COLLAPSE_PREVIEW_LINES = 14;

const EXT_MAP: Record<string, string> = {
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  python: 'py',
  py: 'py',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  zsh: 'sh',
  powershell: 'ps1',
  ps1: 'ps1',
  json: 'json',
  yaml: 'yml',
  yml: 'yml',
  toml: 'toml',
  ini: 'ini',
  sql: 'sql',
  html: 'html',
  xml: 'xml',
  css: 'css',
  markdown: 'md',
  md: 'md',
  go: 'go',
  golang: 'go',
  rust: 'rs',
  rs: 'rs',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  csharp: 'cs',
  cs: 'cs',
  ruby: 'rb',
  rb: 'rb',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  kt: 'kt',
  graphql: 'graphql',
  diff: 'diff',
  dockerfile: 'Dockerfile',
};

const CodeBlockCardInner: React.FC<CodeBlockCardProps> = ({ code, lang = '', open = false }) => {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => code.split('\n'), [code]);
  const lineCount = lines.length;
  const isLong = !open && lineCount > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);

  const normalizedLang = lang.trim().toLowerCase();
  const isDiff = normalizedLang === 'diff' || normalizedLang === 'patch';

  const displayCode = useMemo(() => {
    if (isLong && !expanded) {
      return lines.slice(0, COLLAPSE_PREVIEW_LINES).join('\n');
    }
    return code;
  }, [code, expanded, isLong, lines]);

  const highlightedHtml = useMemo(() => {
    if (open) return escapeHtml(displayCode);
    if (isDiff) return '';
    return highlightCode(displayCode, normalizedLang).html;
  }, [displayCode, isDiff, normalizedLang, open]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownload = () => {
    const ext = EXT_MAP[normalizedLang] || 'txt';
    const filename = ext === 'Dockerfile' ? 'Dockerfile' : `snippet.${ext}`;
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className={`code-card${wrap ? ' is-wrap' : ''}${isLong && !expanded ? ' is-collapsed' : ''}`}>
      <div className="code-card-header">
        <div className="code-card-meta">
          <span className="code-card-lang">{normalizedLang ? normalizedLang.toUpperCase() : 'TEXT'}</span>
          <span className="code-card-lines">{lineCount} 行</span>
          {open && <span className="code-card-streaming">输出中…</span>}
        </div>
        <div className="code-card-actions">
          <button
            type="button"
            className={`code-card-btn${wrap ? ' is-active' : ''}`}
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
            title={wrap ? '取消自动换行' : '自动换行'}
          >
            <WrapText size={12} />
            <span>换行</span>
          </button>
          {isLong && (
            <button
              type="button"
              className="code-card-btn"
              onClick={() => setExpanded((e) => !e)}
              title={expanded ? '收起代码' : `展开全部 ${lineCount} 行`}
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              <span>{expanded ? '收起' : '展开'}</span>
            </button>
          )}
          <button
            type="button"
            className="code-card-btn"
            onClick={handleDownload}
            title="下载源码文件"
            aria-label="下载源码文件"
          >
            <Download size={12} />
            <span>下载</span>
          </button>
          <button
            type="button"
            className={`code-card-btn code-card-copy-btn${copied ? ' is-copied' : ''}`}
            onClick={handleCopy}
            title="复制代码"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      </div>

      {isDiff ? (
        <pre className="code-card-pre is-diff">
          <code className="code-card-code">
            {(isLong && !expanded ? lines.slice(0, COLLAPSE_PREVIEW_LINES) : lines).map((line, idx) => {
              const cls = line.startsWith('+') && !line.startsWith('+++')
                ? 'diff-line-add'
                : line.startsWith('-') && !line.startsWith('---')
                ? 'diff-line-del'
                : line.startsWith('@@')
                ? 'diff-line-hunk'
                : 'diff-line-ctx';
              return (
                <span key={idx} className={`diff-line ${cls}`}>
                  {line || ' '}
                  {'\n'}
                </span>
              );
            })}
          </code>
        </pre>
      ) : (
        <pre className="code-card-pre">
          <code
            className={`hljs ${escapeHtml(normalizedLang)}`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      )}

      {isLong && !expanded && (
        <button
          type="button"
          className="code-card-expand-footer"
          onClick={() => setExpanded(true)}
        >
          <ChevronDown size={13} />
          <span>展开剩余 {lineCount - COLLAPSE_PREVIEW_LINES} 行（共 {lineCount} 行）</span>
        </button>
      )}
    </div>
  );
};

export const CodeBlockCard = React.memo(CodeBlockCardInner);
