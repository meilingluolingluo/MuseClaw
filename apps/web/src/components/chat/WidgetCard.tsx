import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Code2, Eye, Maximize2, Download, Sparkles, AlertTriangle, Wrench } from 'lucide-react';
import type { WidgetPayload } from '../../types';
import { Modal } from '../common/Modal';
import {
  buildWidgetSrcDoc,
  clampWidgetHeight,
  readHostThemeVars,
  WIDGET_INTENT_THROTTLE_MS,
  WIDGET_MAX_INTENT_LENGTH
} from '../../utils/widgetSandbox';

interface WidgetCardProps {
  widget: WidgetPayload;
  onSendPrompt?: (prompt: string, opts?: { hidden?: boolean }) => void;
  defaultMode?: 'preview' | 'source';
  inModal?: boolean;
}

interface SandboxFrameProps {
  widget: WidgetPayload;
  onSendPrompt?: (prompt: string, opts?: { hidden?: boolean }) => void;
  onRuntimeError?: (message: string) => void;
  fullHeight?: boolean;
}

const WidgetSandboxFrame: React.FC<SandboxFrameProps> = ({
  widget,
  onSendPrompt,
  onRuntimeError,
  fullHeight = false
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastIntentAtRef = useRef<number>(0);
  const onSendPromptRef = useRef(onSendPrompt);
  onSendPromptRef.current = onSendPrompt;
  const onRuntimeErrorRef = useRef(onRuntimeError);
  onRuntimeErrorRef.current = onRuntimeError;

  const token = useMemo(
    () => `wgt_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`,
    []
  );
  const [frameHeight, setFrameHeight] = useState<number>(() =>
    clampWidgetHeight(widget.height, fullHeight ? 540 : 300)
  );

  useEffect(() => {
    if (widget.height !== undefined) {
      setFrameHeight(clampWidgetHeight(widget.height, fullHeight ? 540 : 300));
    }
  }, [widget.height, widget.id, fullHeight]);

  const srcDoc = useMemo(() => {
    const theme = readHostThemeVars();
    return buildWidgetSrcDoc(widget.html, token, theme, widget.kind);
  }, [widget.html, widget.kind, token]);

  // 同步宿主明暗主题变更至沙箱 iframe
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const root = document.documentElement;
    const pushTheme = () => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'museclaw:widget-theme', token, theme: readHostThemeVars() },
        '*'
      );
    };
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === 'data-theme')) {
        pushTheme();
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [token]);

  // 接收沙箱的高度上报、对话回传意图与运行时异常
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const frameWin = iframeRef.current?.contentWindow;
      if (!frameWin || event.source !== frameWin) return;
      const data = event.data;
      if (!data || data.token !== token) return;

      if (data.type === 'museclaw:widget-size') {
        const nextH = clampWidgetHeight(data.height, frameHeight);
        setFrameHeight(nextH);
        return;
      }

      if (data.type === 'museclaw:widget-error') {
        const msg = typeof data.message === 'string' ? data.message : '组件脚本运行异常';
        const loc =
          typeof data.line === 'number'
            ? ` (第 ${data.line}${typeof data.col === 'number' ? `:${data.col}` : ''} 行)`
            : '';
        onRuntimeErrorRef.current?.(`${msg}${loc}`);
        return;
      }

      if (data.type === 'museclaw:widget-intent') {
        const reply = (ack: Record<string, unknown>) => {
          try {
            frameWin.postMessage(
              { type: 'museclaw:widget-intent-ack', token, id: data.id, ack },
              '*'
            );
          } catch {}
        };

        const rawPrompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
        if (!rawPrompt) {
          reply({ ok: false, error: 'invalid' });
          return;
        }
        if (rawPrompt.length > WIDGET_MAX_INTENT_LENGTH) {
          reply({ ok: false, error: 'too_long', maxLength: WIDGET_MAX_INTENT_LENGTH });
          return;
        }
        if (rawPrompt.startsWith('/')) {
          reply({ ok: false, error: 'command_not_allowed' });
          return;
        }
        const now = Date.now();
        const elapsed = now - lastIntentAtRef.current;
        if (elapsed < WIDGET_INTENT_THROTTLE_MS) {
          reply({ ok: false, error: 'throttled', retryAfterMs: WIDGET_INTENT_THROTTLE_MS - elapsed });
          return;
        }
        if (!onSendPromptRef.current) {
          reply({ ok: false, error: 'undelivered' });
          return;
        }
        lastIntentAtRef.current = now;
        reply({ ok: true });
        onSendPromptRef.current(rawPrompt, { hidden: Boolean(data.hidden) });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [token, frameHeight]);

  return (
    <iframe
      ref={iframeRef}
      title={widget.title}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={`widget-card-frame ${fullHeight ? 'is-fullscreen' : ''}`}
      style={fullHeight ? undefined : { height: `${frameHeight}px` }}
    />
  );
};

export const WidgetCard: React.FC<WidgetCardProps> = ({
  widget,
  onSendPrompt,
  defaultMode = 'preview',
  inModal = false
}) => {
  const [mode, setMode] = useState<'preview' | 'source'>(defaultMode);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);

  useEffect(() => {
    setRuntimeErrors([]);
  }, [widget.html, widget.id]);

  const handleRuntimeError = useCallback((msg: string) => {
    setRuntimeErrors((prev) => {
      if (prev.includes(msg) || prev.length >= 3) return prev;
      return [...prev, msg];
    });
  }, []);

  const handleDownload = () => {
    const isSvg = widget.kind === 'svg';
    const ext = isSvg ? 'svg' : 'html';
    const mime = isSvg ? 'image/svg+xml;charset=utf-8' : 'text/html;charset=utf-8';
    const safeName = (widget.title || 'widget').replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([widget.html], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAskFix = () => {
    if (!onSendPrompt || runtimeErrors.length === 0) return;
    onSendPrompt(
      `交互组件「${widget.title}」(widget_id: ${widget.id}) 运行时出现异常，请排查并原位修复该组件：\n${runtimeErrors.join('\n')}`
    );
  };

  return (
    <>
      <div className={`widget-card ${inModal ? 'is-in-modal' : ''}`}>
        <div className="widget-card-header">
          <div className="widget-card-title-wrap">
            <Sparkles size={14} className="widget-card-icon" />
            <span className="widget-card-title" title={widget.title}>
              {widget.title}
            </span>
            <span className="widget-card-badge">
              {widget.kind === 'svg' ? 'SVG 图解' : '交互界面'}
            </span>
          </div>

          <div className="widget-card-actions">
            <button
              type="button"
              className="widget-card-btn"
              onClick={() => setMode((m) => (m === 'preview' ? 'source' : 'preview'))}
              title={mode === 'preview' ? '查看源码' : '回到预览'}
            >
              {mode === 'preview' ? <Code2 size={13} /> : <Eye size={13} />}
              <span>{mode === 'preview' ? '源码' : '预览'}</span>
            </button>
            <button
              type="button"
              className="widget-card-btn"
              onClick={handleDownload}
              title={widget.kind === 'svg' ? '下载 SVG 文件' : '下载 HTML 文件'}
            >
              <Download size={13} />
              <span>下载</span>
            </button>
            {!inModal && (
              <button
                type="button"
                className="widget-card-btn"
                onClick={() => setIsFullscreen(true)}
                title="放大预览"
              >
                <Maximize2 size={13} />
                <span>全屏</span>
              </button>
            )}
          </div>
        </div>

        {mode === 'preview' ? (
          <div className="widget-card-frame-wrap">
            <WidgetSandboxFrame
              widget={widget}
              onSendPrompt={onSendPrompt}
              onRuntimeError={handleRuntimeError}
            />
          </div>
        ) : (
          <pre className="widget-card-source">
            <code>{widget.html}</code>
          </pre>
        )}

        {runtimeErrors.length > 0 && (
          <div className="widget-card-error" role="alert">
            <div className="widget-card-error-msg">
              <AlertTriangle size={14} />
              <span>{runtimeErrors[0]}</span>
            </div>
            {onSendPrompt && (
              <button type="button" className="widget-card-error-fix" onClick={handleAskFix}>
                <Wrench size={12} />
                <span>让 AI 修复</span>
              </button>
            )}
          </div>
        )}
      </div>

      {!inModal && isFullscreen && (
        <Modal
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          title={widget.title}
          icon={<Sparkles size={18} />}
          maxWidth="960px"
          contentClass="widget-fullscreen-modal"
        >
          <div className="widget-fullscreen-body">
            <WidgetSandboxFrame
              widget={widget}
              onSendPrompt={(prompt, opts) => {
                setIsFullscreen(false);
                onSendPrompt?.(prompt, opts);
              }}
              onRuntimeError={handleRuntimeError}
              fullHeight
            />
          </div>
        </Modal>
      )}
    </>
  );
};
