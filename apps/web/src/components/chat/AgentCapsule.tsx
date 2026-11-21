import React from 'react';
import type { Bot } from '../../types';
import { BotAvatar } from '../common/BotAvatar';
import { Sparkles, Terminal } from 'lucide-react';

interface AgentCapsuleProps {
  bot?: Bot | null;
  variant?: 'hero' | 'header';
  isStreaming?: boolean;
  streamingReasoning?: string;
  streamingToolsCount?: number;
  size?: number;
  onClick?: () => void;
}

export const AgentCapsule: React.FC<AgentCapsuleProps> = ({
  bot,
  variant = 'header',
  isStreaming = false,
  streamingReasoning = '',
  streamingToolsCount = 0,
  size = 50,
  onClick,
}) => {
  const botName = bot?.name || '小哀';
  const botRole = bot?.role || bot?.description || '企业自驱数字员工';
  const mood = isStreaming ? 'working' : 'idle';

  let statusLine: string | null = null;
  let statusIcon: React.ReactNode = null;
  if (isStreaming) {
    if (streamingReasoning) {
      statusLine = '深度思考中…';
      statusIcon = <Sparkles size={11} className="agent-status-icon spin" />;
    } else if (streamingToolsCount > 0) {
      statusLine = `正在调用工具 (${streamingToolsCount})…`;
      statusIcon = <Terminal size={11} className="agent-status-icon" />;
    } else {
      statusLine = '正在回答…';
    }
  }

  const isHero = variant === 'hero';

  return (
    <div className={`agent-floating-capsule ${isHero ? 'is-hero' : ''}`}>
      {/* 居中悬浮圆盘头像 */}
      <button
        type="button"
        className="agent-floating-avatar-btn"
        onClick={onClick}
        aria-label={`${botName} 的设定与档案`}
        title={`点击查看/配置 ${botName} 的设定与档案`}
      >
        <BotAvatar bot={bot} size={isHero ? 72 : size} mood={mood} motion="avatar-idle" />
      </button>

      {/* 叠挂在下颌处的悬浮身份与状态胶囊 */}
      <button
        type="button"
        className="agent-floating-name-pill"
        onClick={onClick}
        title={`点击查看/配置 ${botName} 的设定与档案`}
      >
        <span className="agent-floating-name-text">{botName}</span>
        {statusLine ? (
          <span className="agent-floating-status-line">
            {statusIcon || <span className="agent-floating-spinner" />}
            <span className="agent-floating-status-text">{statusLine}</span>
          </span>
        ) : (
          isHero && <span className="agent-floating-role-text">{botRole}</span>
        )}
      </button>
    </div>
  );
};