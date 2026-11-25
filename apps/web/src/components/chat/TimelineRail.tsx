import React, { useRef, useState } from 'react';

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

interface HoverState {
  idx: number;
  top: number;
}

export const TimelineRail: React.FC<TimelineRailProps> = ({ entries, activeId, onJump }) => {
  const [hoverState, setHoverState] = useState<HoverState | null>(null);
  const railRef = useRef<HTMLElement>(null);

  if (entries.length === 0) return null;

  const hoverIdx = hoverState?.idx ?? null;
  const hoveredEntry = hoverIdx !== null ? entries[hoverIdx] : undefined;

  const handleItemEnter = (idx: number, e: React.MouseEvent<HTMLDivElement>) => {
    const railRect = railRef.current?.getBoundingClientRect();
    const itemRect = e.currentTarget.getBoundingClientRect();
    const top = railRect
      ? itemRect.top - railRect.top + itemRect.height / 2
      : 0;
    setHoverState({ idx, top });
  };

  return (
    <nav
      ref={railRef}
      className="chat-timeline-rail"
      aria-label="对话时间轴导航"
      onMouseLeave={() => setHoverState(null)}
    >
      <div className="chat-timeline-track" onScroll={() => setHoverState(null)}>
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
              onMouseEnter={(e) => handleItemEnter(idx, e)}
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
            </div>
          );
        })}
      </div>

      {hoveredEntry && hoverState && (
        <div
          className="chat-timeline-tooltip"
          role="tooltip"
          style={{ top: `${hoverState.top}px` }}
        >
          <span className="chat-timeline-tooltip-idx">#{hoverState.idx + 1}</span>
          <span className="chat-timeline-tooltip-text">{hoveredEntry.preview}</span>
        </div>
      )}
    </nav>
  );
};
