import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

interface ChatFindBarProps {
  isOpen: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  activeMatchIdx: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export const ChatFindBar: React.FC<ChatFindBarProps> = ({
  isOpen,
  query,
  onQueryChange,
  matchCount,
  activeMatchIdx,
  onPrev,
  onNext,
  onClose,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="chat-find-bar" role="search" aria-label="会话内搜索">
      <Search size={14} className="chat-find-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="chat-find-input"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="搜索当前对话消息…"
        aria-label="搜索当前对话消息"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
      />
      <span className="chat-find-count">
        {query.trim()
          ? matchCount > 0
            ? `${activeMatchIdx + 1} / ${matchCount}`
            : '0 / 0'
          : ''}
      </span>
      <button
        type="button"
        className="chat-find-btn"
        disabled={matchCount === 0}
        onClick={onPrev}
        title="上一条匹配 (Shift+Enter)"
        aria-label="上一条匹配"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="chat-find-btn"
        disabled={matchCount === 0}
        onClick={onNext}
        title="下一条匹配 (Enter)"
        aria-label="下一条匹配"
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className="chat-find-btn"
        onClick={onClose}
        title="关闭搜索 (Esc)"
        aria-label="关闭搜索"
      >
        <X size={14} />
      </button>
    </div>
  );
};
