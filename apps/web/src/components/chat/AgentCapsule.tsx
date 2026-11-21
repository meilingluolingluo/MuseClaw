import React from 'react';
import type { Bot } from '../../types';
import { BotAvatar } from '../common/BotAvatar';

interface AgentCapsuleProps {
  bot?: Bot | null;
  variant?: 'hero' | 'header';
  isStreaming?: boolean;
  onClick?: () => void;
}

export const AgentCapsule: React.FC<AgentCapsuleProps> = ({
  bot,
  variant = 'hero',
  isStreaming = false,
  onClick,
}) => {
  const botName = bot?.name || '小哀';
  const mood = isStreaming ? 'working' : 'idle';

  if (variant === 'header') {
    return (
      <div
        className="agent-capsule-inline"
        onClick={onClick}
        title={`点击打开 ${botName} 的设定与档案`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.();
          }
        }}
      >
        <div className="agent-inline-logo">
          <BotAvatar bot={bot} size={36} mood={mood} motion="avatar-idle" />
        </div>
        <span className="agent-inline-name">{botName}</span>
      </div>
    );
  }

  // 空会话时同样只展示大 Logo 与名称，保持与顶部悬浮标识一致
  return (
    <div
      className="agent-capsule-inline is-hero"
      onClick={onClick}
      title={`点击打开 ${botName} 的设定与档案`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="agent-inline-logo">
        <BotAvatar bot={bot} size={60} mood={mood} motion="avatar-idle" />
      </div>
      <span className="agent-inline-name">{botName}</span>
    </div>

  );
};
