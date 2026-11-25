import React, { useEffect, useRef, useState } from 'react';
import { Download, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

export interface LightboxPayload {
  src?: string;
  svgHtml?: string;
  alt?: string;
}

interface ImageLightboxProps {
  payload: LightboxPayload | null;
  onClose: () => void;
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({ payload, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(1);
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (payload) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [payload]);

  // 针对暂不支持 closedby 属性的浏览器提供坐标边界点击降级关闭
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || ('closedBy' in HTMLDialogElement.prototype)) return;

    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = contentRef.current?.getBoundingClientRect() || dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) {
        dialog.close();
      }
    };

    dialog.addEventListener('click', handleBackdropClick);
    return () => dialog.removeEventListener('click', handleBackdropClick);
  }, []);

  const handleDownload = () => {
    if (!payload) return;
    const baseName = (payload.alt || 'image').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'preview';
    if (payload.svgHtml) {
      const blob = new Blob([payload.svgHtml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (payload.src) {
      const a = document.createElement('a');
      a.href = payload.src;
      a.download = baseName;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    }
  };

  const adjustScale = (delta: number) => {
    setScale((prev) => Math.min(3, Math.max(0.5, Number((prev + delta).toFixed(2)))));
  };

  return (
    <dialog
      ref={dialogRef}
      className="image-lightbox-dialog"
      aria-label={payload?.alt || '图片放大预览'}
      onClose={onClose}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {payload && (
        <div
          ref={contentRef}
          className="image-lightbox-shell"
          onWheel={(e) => {
            e.preventDefault();
            adjustScale(e.deltaY < 0 ? 0.15 : -0.15);
          }}
        >
          <div className="image-lightbox-toolbar">
            <span className="image-lightbox-title">{payload.alt || '图片预览'}</span>
            <div className="image-lightbox-controls">
              <button
                type="button"
                className="image-lightbox-btn"
                onClick={() => adjustScale(-0.25)}
                title="缩小"
                aria-label="缩小"
              >
                <ZoomOut size={15} />
              </button>
              <span className="image-lightbox-zoom">{Math.round(scale * 100)}%</span>
              <button
                type="button"
                className="image-lightbox-btn"
                onClick={() => adjustScale(0.25)}
                title="放大"
                aria-label="放大"
              >
                <ZoomIn size={15} />
              </button>
              <button
                type="button"
                className="image-lightbox-btn"
                onClick={() => setScale(1)}
                title="重置比例"
                aria-label="重置比例"
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                className="image-lightbox-btn"
                onClick={handleDownload}
                title="下载"
                aria-label="下载"
              >
                <Download size={14} />
              </button>
              <button
                type="button"
                className="image-lightbox-btn is-close"
                onClick={() => dialogRef.current?.close()}
                title="关闭 (Esc)"
                aria-label="关闭预览"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="image-lightbox-viewport">
            {payload.svgHtml ? (
              <div
                className="image-lightbox-svg"
                style={{ transform: `scale(${scale})` }}
                dangerouslySetInnerHTML={{ __html: payload.svgHtml }}
              />
            ) : (
              <img
                src={payload.src}
                alt={payload.alt || '预览图片'}
                className="image-lightbox-img"
                style={{ transform: `scale(${scale})` }}
              />
            )}
          </div>
        </div>
      )}
    </dialog>
  );
};
