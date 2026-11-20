import React, { useEffect } from 'react';
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
  zIndex = 1000,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-overlay"
      style={{ zIndex }}
      onClick={onClose}
    >
      <div
        className={`modal-content ${contentClass}`}
        style={{ maxWidth, width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {!hideHeader && (
          <div className="modal-header">
            <div className="modal-title-wrap">
              {icon && <span className="modal-header-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
              <h3 className="modal-title">
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

        <div className="modal-body-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </div>

        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};
