import React, { useState } from 'react';

export interface TimelineEntry {
  id: string;
  preview: string;
  timestamp?: number;
}

interface TimelineRailProps {
  entries: TimelineEntry[];
  activeId: string | null;
  onJump: (id: string) => void;
}

export const TimelineRail: React.FC<TimelineRailProps> = ({ entries, activeId, onJump }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (entries.length < 3) return null;

  return (
    <nav className="chat-timeline-rail" aria-label="对话时间轴导航" onMouseLeave={() => setHoverIdx(null)}>
      <div className="chat-timeline-track">
        {entries.map((entry, idx) => {
          const isActive = entry.id === activeId;
          const dist = hoverIdx === null ? 99 : Math.abs(hoverIdx - idx);
          const barWidth =
            hoverIdx === null
              ? isActive
                ? 18
                : 10
              : dist === 0
              ? 26
              : dist === 1
              ? 18
              : dist === 2
              ? 13
              : 10;

          return (
            <div
              key={entry.id}
              className={`chat-timeline-item${isActive ? ' is-active' : ''}${hoverIdx === idx ? ' is-hovered' : ''}`}
              onMouseEnter={() => setHoverIdx(idx)}
            >
              <button
                type="button"
                className="chat-timeline-tick"
                onClick={() => onJump(entry.id)}
                aria-label={`跳转到：${entry.preview}`}
                aria-current={isActive ? 'location' : undefined}
              >
                <span
                  className="chat-timeline-bar"
                  style={{ width: `${barWidth}px` }}
                />
              </button>
              {hoverIdx === idx && (
                <div className="chat-timeline-tooltip" role="tooltip">
                  <span className="chat-timeline-tooltip-idx">#{idx + 1}</span>
                  <span className="chat-timeline-tooltip-text">{entry.preview}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
};
