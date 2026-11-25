import React, { useEffect, useState } from 'react';
import { Check, Code2, Copy, Download, Eye, Maximize2, Workflow } from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';

interface MermaidBlockProps {
  code: string;
  open?: boolean;
  onZoomSvg?: (svgHtml: string, title: string) => void;
}

const MERMAID_CACHE = new Map<string, string>();
const MERMAID_CACHE_MAX = 50;
let mermaidSeq = 0;

function getCurrentTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function hashCode(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const MermaidBlockInner: React.FC<MermaidBlockProps> = ({ code, open = false, onZoomSvg }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>(getCurrentTheme);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string | null>(() => {
    if (open) return null;
    return MERMAID_CACHE.get(`${getCurrentTheme()}:${hashCode(code)}`) || null;
  });

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      setTheme(getCurrentTheme());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (open || !code.trim()) return;
    const cacheKey = `${theme}:${hashCode(code)}`;
    const cached = MERMAID_CACHE.get(cacheKey);
    if (cached) {
      setSvgHtml(cached);
      setError(null);
      return;
    }

    let alive = true;
    import('mermaid')
      .then((mod) => {
        const mermaid = (mod as any).default || mod;
        mermaidSeq += 1;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: theme === 'dark' ? 'dark' : 'default',
          fontFamily: 'var(--font-sans)',
        });
        return mermaid.render(`museclaw-mermaid-${mermaidSeq}`, code);
      })
      .then((res: { svg: string }) => {
        if (!alive) return;
        if (MERMAID_CACHE.size >= MERMAID_CACHE_MAX) {
          const oldest = MERMAID_CACHE.keys().next().value;
          if (oldest) MERMAID_CACHE.delete(oldest);
        }
        MERMAID_CACHE.set(cacheKey, res.svg);
        setSvgHtml(res.svg);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg.length > 220 ? `${msg.slice(0, 220)}…` : msg);
      });

    return () => {
      alive = false;
    };
  }, [code, open, theme]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleDownloadSvg = () => {
    if (!svgHtml) return;
    const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagram-${Date.now()}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="mermaid-card">
      <div className="mermaid-card-header">
        <div className="mermaid-card-title-wrap">
          <Workflow size={13} />
          <span>Mermaid 图表</span>
          {open && <span className="mermaid-card-status">绘制中…</span>}
        </div>
        <div className="mermaid-card-actions">
          {!open && (
            <button
              type="button"
              className={`code-card-btn${showSource ? ' is-active' : ''}`}
              onClick={() => setShowSource((v) => !v)}
              title={showSource ? '查看图表' : '查看源码'}
            >
              {showSource ? <Eye size={12} /> : <Code2 size={12} />}
              <span>{showSource ? '图表' : '源码'}</span>
            </button>
          )}
          {svgHtml && !showSource && onZoomSvg && (
            <button
              type="button"
              className="code-card-btn"
              onClick={() => onZoomSvg(svgHtml, 'Mermaid 图表预览')}
              title="放大查看"
            >
              <Maximize2 size={12} />
              <span>放大</span>
            </button>
          )}
          {svgHtml && (
            <button
              type="button"
              className="code-card-btn"
              onClick={handleDownloadSvg}
              title="下载 SVG"
            >
              <Download size={12} />
              <span>SVG</span>
            </button>
          )}
          <button
            type="button"
            className={`code-card-btn${copied ? ' is-copied' : ''}`}
            onClick={handleCopy}
            title="复制 Mermaid 源码"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        </div>
      </div>

      {open ? (
        <div className="mermaid-card-loading">
          <div className="mermaid-loading-hint">正在接收图表定义并准备渲染…</div>
          <pre className="mermaid-source-pre"><code>{code}</code></pre>
        </div>
      ) : (
        <>
          {error && (
            <div className="mermaid-card-error" role="alert">
              图表语法解析失败：{error}
            </div>
          )}
          {svgHtml && !showSource && !error && (
            <div
              className="mermaid-card-canvas"
              onClick={() => onZoomSvg?.(svgHtml, 'Mermaid 图表预览')}
              title="点击放大查看图表"
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          )}
          {(showSource || !svgHtml || error) && (
            <pre className="mermaid-source-pre"><code>{code}</code></pre>
          )}
        </>
      )}
    </div>
  );
};

export const MermaidBlock = React.memo(MermaidBlockInner);
