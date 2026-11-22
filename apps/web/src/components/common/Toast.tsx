import React from 'react';
import { X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="toast-container" role="log" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          role={toast.type === 'error' ? 'alert' : 'status'}
          style={{ cursor: 'default', userSelect: 'text' }}
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.type === 'success' && '✓'}
            {toast.type === 'error' && '✕'}
            {toast.type === 'warning' && '⚠'}
            {toast.type === 'info' && 'ℹ'}
          </span>
          <span className="toast-text" style={{ userSelect: 'text' }}>{toast.message}</span>
          <button
            type="button"
            className="toast-close-btn"
            onClick={() => onDismiss(toast.id)}
            aria-label="关闭提示"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'currentColor',
              padding: '2px 4px',
              marginLeft: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              opacity: 0.7,
            }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
};
