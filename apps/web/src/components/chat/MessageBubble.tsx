import React, { useState } from 'react';
import type { Message, Bot } from '../../types';
import { BotAvatar } from '../common/BotAvatar';
import { renderMarkdown } from '../../utils/markdown';
import { ChevronDown, ChevronRight, ShieldAlert, Check, X, Terminal } from 'lucide-react';
import { api } from '../../services/api';

interface MessageBubbleProps {
  message: Message;
  bot: Bot | null;
  sessionId?: string;
  onApprovalResolved?: (approvalId: string, approved: boolean) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  bot,
  sessionId,
  onApprovalResolved,
}) => {
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);

  const isUser = message.role === 'user';

  const handleDecision = async (approved: boolean) => {
    if (!message.approvalRequest || !sessionId) return;
    try {
      await api.sendDecision(sessionId, message.approvalRequest.actionId, approved ? 'APPROVE' : 'REJECT');
      setApprovalStatus(approved ? '已批准' : '已拒绝');
      onApprovalResolved?.(message.approvalRequest.actionId, approved);
    } catch (err) {
      console.error('Failed to submit decision:', err);
    }
  };

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isUser ? (
          <div style={{ fontSize: '20px' }}>👤</div>
        ) : (
          <BotAvatar bot={bot} size={36} motion="avatar-idle" />
        )}
      </div>

      <div className="message-bubble">
        {/* Assistant Reasoning Collapsible Block */}
        {message.reasoning && (
          <div className="thinking-card" style={{ marginBottom: '10px' }}>
            <button
              type="button"
              className="think-toggle-btn"
              onClick={() => setIsReasoningOpen((prev) => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '12px',
                cursor: 'pointer',
                padding: '4px 0',
              }}
            >
              {isReasoningOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span style={{ fontWeight: 500 }}>思考过程 (Reasoning)</span>
            </button>
            {isReasoningOpen && (
              <div
                className="reasoning-content"
                style={{
                  fontSize: '12.5px',
                  color: 'var(--text-dim)',
                  borderLeft: '2px solid var(--border-color)',
                  paddingLeft: '10px',
                  marginTop: '4px',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        {/* Tool Calls Display */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="tool-calls-container" style={{ marginBottom: '10px' }}>
            {message.toolCalls.map((tc, idx) => (
              <div
                key={idx}
                className="activity-card"
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: 'var(--om-surface)',
                  border: '1px solid var(--om-border)',
                  marginBottom: '6px',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                    <Terminal size={14} /> 工具调用: {tc.tool}
                  </span>
                  <span className="pill-badge pill-blue" style={{ fontSize: '10px' }}>
                    {tc.status || '执行完成'}
                  </span>
                </div>
                {tc.params && (
                  <pre style={{ margin: '4px 0', fontSize: '11px', color: 'var(--text-dim)', overflowX: 'auto' }}>
                    {JSON.stringify(tc.params, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Human Gate Sentinel Approval Prompt */}
        {message.approvalRequest && (
          <div className="approval-card-hazard" style={{ marginBottom: '12px' }}>
            <div className="approval-card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldAlert size={16} />
              <span>⚠️ Sentinel 门禁动作审批拦截</span>
            </div>
            <div className="approval-card-desc" style={{ margin: '6px 0', fontSize: '12px' }}>
              {message.approvalRequest.description}
            </div>
            {message.approvalRequest.command && (
              <div className="approval-details-box" style={{ fontSize: '12px', marginBottom: '8px' }}>
                <code>{message.approvalRequest.command}</code>
              </div>
            )}
            <div className="approval-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {approvalStatus ? (
                <span style={{ fontSize: '12px', fontWeight: 600, color: approvalStatus.includes('批准') ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {approvalStatus}
                </span>
              ) : (
                <>
                  <button type="button" className="btn-reject" onClick={() => handleDecision(false)}>
                    <X size={14} /> 驳回
                  </button>
                  <button type="button" className="btn-approve" onClick={() => handleDecision(true)}>
                    <Check size={14} /> 批准执行
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* User Attached Images */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="user-message-images" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
            {message.attachments.map((att, idx) => (
              att.url ? (
                <img
                  key={idx}
                  src={att.url}
                  alt={att.name}
                  className="user-bubble-image"
                  style={{ maxWidth: '240px', maxHeight: '180px', borderRadius: '8px', cursor: 'pointer' }}
                  onClick={() => window.open(att.url, '_blank')}
                />
              ) : null
            ))}
          </div>
        )}

        {/* Markdown Rendered Content */}
        {isUser ? (
          <div className="user-text" style={{ whiteSpace: 'pre-wrap' }}>
            {message.content}
          </div>
        ) : (
          <div
            className="assistant-text"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        )}
      </div>
    </div>
  );
};
