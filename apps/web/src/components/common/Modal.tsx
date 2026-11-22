import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  hideHeader?: boolean;
  contentClass?: string;
  zIndex?: number;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  children,
  footer,
  maxWidth = '620px',
  hideHeader = false,
  contentClass = '',
  zIndex = 2000,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    // 打开时把焦点移进对话框，关闭后还给原来的元素
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const getFocusable = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      ).filter((el) => el.offsetParent !== null);
    const firstField = root?.querySelector<HTMLElement>('input, textarea, select');
    (firstField || getFocusable()[0] || root)?.focus?.();

    // 背景不跟着滚
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-overlay"
      style={{ zIndex }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal-content ${contentClass}`}
        style={{ maxWidth, width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {!hideHeader && (
          <div className="modal-header">
            <div className="modal-title-wrap">
              {icon && <span className="modal-header-icon">{icon}</span>}
              <h3 className="modal-title" id={titleId}>
                {title}
              </h3>
            </div>
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        )}

        <div className="modal-body-scroll">
          {children}
        </div>

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};
