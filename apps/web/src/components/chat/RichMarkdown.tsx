import React, { useEffect, useMemo, useState } from 'react';
import { escapeHtml, renderMarkdown } from '../../utils/markdown';
import {
  containsMath,
  loadKatex,
  preprocessMath,
  splitMarkdownIntoBlocks,
  type MathToken,
} from '../../utils/markdownBlocks';
import { CodeBlockCard } from './CodeBlockCard';
import { MermaidBlock } from './MermaidBlock';
import { InteractiveTable } from './InteractiveTable';
import { ClarifyCard, DomainCard } from './DomainCard';
import type { LightboxPayload } from './ImageLightbox';

interface RichMarkdownProps {
  content: string;
  live?: boolean;
  onOpenLightbox?: (payload: LightboxPayload) => void;
  onSendPrompt?: (prompt: string) => void;
}

function renderWithMathTokens(
  html: string,
  tokens: MathToken[],
  katex: { renderToString: (tex: string, opts?: any) => string } | null
): string {
  if (tokens.length === 0) return html;
  // eslint-disable-next-line no-control-regex
  return html.replace(/\uE000MM(\d+)\uE001/g, (_m, idxStr) => {
    const token = tokens[Number(idxStr)];
    if (!token) return '';
    if (!katex) {
      const delim = token.display ? '$$' : '$';
      return `<code class="math-fallback">${escapeHtml(`${delim}${token.tex}${delim}`)}</code>`;
    }
    try {
      const rendered = katex.renderToString(token.tex, {
        displayMode: token.display,
        throwOnError: false,
        strict: false,
      });
      return token.display ? `<div class="katex-display-wrap">${rendered}</div>` : rendered;
    } catch {
      return `<code class="math-fallback">${escapeHtml(token.tex)}</code>`;
    }
  });
}

const MarkdownTextBlock: React.FC<{
  raw: string;
  katex: { renderToString: (tex: string, opts?: any) => string } | null;
  onOpenLightbox?: (payload: LightboxPayload) => void;
}> = React.memo(({ raw, katex, onOpenLightbox }) => {
  const html = useMemo(() => {
    const { text, tokens } = preprocessMath(raw);
    const parsedHtml = renderMarkdown(text);
    return renderWithMathTokens(parsedHtml, tokens, katex);
  }, [raw, katex]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const img = target?.closest?.('img.markdown-image') as HTMLImageElement | null;
    if (img && onOpenLightbox) {
      const src = img.getAttribute('data-lightbox-src') || img.getAttribute('src');
      const alt = img.getAttribute('data-lightbox-alt') || img.getAttribute('alt') || '';
      if (src) {
        e.preventDefault();
        onOpenLightbox({ src, alt });
      }
    }
  };

  return (
    <div
      className="markdown-body-chunk"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

const RichMarkdownInner: React.FC<RichMarkdownProps> = ({
  content,
  live = false,
  onOpenLightbox,
  onSendPrompt,
}) => {
  const [katex, setKatex] = useState<{ renderToString: (tex: string, opts?: any) => string } | null>(null);
  const needsMath = useMemo(() => containsMath(content), [content]);

  useEffect(() => {
    if (!needsMath || katex) return;
    let alive = true;
    loadKatex()
      .then((mod) => {
        if (alive) setKatex(mod);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [needsMath, katex]);

  const blocks = useMemo(() => splitMarkdownIntoBlocks(content, live), [content, live]);

  if (blocks.length === 0) return null;

  return (
    <div className={`assistant-text markdown-body${live ? ' is-streaming' : ''}`}>
      {blocks.map((block) => {
        switch (block.type) {
          case 'code':
            return (
              <CodeBlockCard
                key={block.key}
                code={block.code}
                lang={block.lang}
                open={block.open}
              />
            );
          case 'mermaid':
            return (
              <MermaidBlock
                key={block.key}
                code={block.code}
                open={block.open}
                onZoomSvg={(svgHtml, title) => onOpenLightbox?.({ svgHtml, alt: title })}
              />
            );
          case 'table':
            return (
              <InteractiveTable
                key={block.key}
                headers={block.headers}
                alignments={block.alignments}
                rows={block.rows}
              />
            );
          case 'domain-card':
            if (block.kind === 'clarify') {
              return (
                <ClarifyCard
                  key={block.key}
                  data={block.data}
                  onSendPrompt={onSendPrompt}
                />
              );
            }
            return (
              <DomainCard
                key={block.key}
                kind={block.kind}
                data={block.data}
              />
            );
          case 'markdown':
          default:
            return (
              <MarkdownTextBlock
                key={block.key}
                raw={block.raw}
                katex={katex}
                onOpenLightbox={onOpenLightbox}
              />
            );
        }
      })}
      {live && content.trim().length > 0 && <span className="streaming-caret" aria-hidden="true" />}
    </div>
  );
};

export const RichMarkdown = React.memo(RichMarkdownInner);
