import React, { useState, useEffect, useMemo } from 'react';
import type { Message, Bot } from '../../types';
import { BotAvatar } from '../common/BotAvatar';
import { renderMarkdown } from '../../utils/markdown';
import {
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Check,
  X,
  FileText,
  Copy,
  CheckCheck,
  User as UserIcon,
} from 'lucide-react';
import { ToolTrace } from './ToolTrace';
import { AvatarOptionsCard } from './AvatarOptionsCard';
import { WidgetCard } from './WidgetCard';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatRelativeTime } from '../../utils/format';
import { copyToClipboard } from '../../utils/clipboard';

interface MessageBubbleProps {
  message: Message;
  bot: Bot | null;
  sessionId?: string;
  onApprovalResolved?: (approvalId: string, approved: boolean) => void;
  onWidgetPrompt?: (prompt: string, opts?: { hidden?: boolean }) => void;
  /** 流式占位气泡：工具调用默认展开 */
  live?: boolean;
}

/**
 * 从消息正文中自动解析并分离模型思考过程与正式答复
 */
function extractReasoningAndContent(
  rawContent?: string,
  rawReasoning?: string
): { content: string; reasoning?: string } {
  let content = rawContent || '';
  let reasoning = rawReasoning || '';

  // 1. 匹配并提取全闭合的 <think>...</think> 标签（DeepSeek R1 / 常见推理模型标准格式）
  const thinkTagRegex = /<think>([\s\S]*?)<\/think>/gi;
  let thinkMatch: RegExpExecArray | null;
  while ((thinkMatch = thinkTagRegex.exec(content)) !== null) {
    reasoning = (reasoning ? `${reasoning}\n\n` : '') + thinkMatch[1].trim();
  }
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. 匹配并提取「> 💭 **思考推理**：...」或「> 💭 思考推理：...」引用块格式
  const quoteReasoningRegex = /(?:^|\n)(?:>\s*💭\s*(?:\*\*)?思考推理(?:\*\*)?[：:]?\s*\n(?:>[^\n]*\n?)*)+/g;
  const quoteMatches = content.match(quoteReasoningRegex);
  if (quoteMatches) {
    for (const match of quoteMatches) {
      const extractedLines = match
        .split('\n')
        .map((line) => line.replace(/^>\s*/, ''))
        .filter((line) => !line.includes('💭') && !line.includes('思考推理'))
        .join('\n')
        .trim();
      if (extractedLines) {
        reasoning = (reasoning ? `${reasoning}\n\n` : '') + extractedLines;
      }
    }
    content = content.replace(quoteReasoningRegex, '').trim();
  }

  // 3. 匹配并提取未加引用的「💭 **思考推理**：...」或「💭 思考推理：...」段落
  const unquotedReasoningRegex = /(?:^|\n)💭\s*(?:\*\*)?思考推理(?:\*\*)?[：:]?\s*\n([\s\S]*?)(?=(?:\n\n[^\n]+|$))/g;
  let unquotedMatch: RegExpExecArray | null;
  while ((unquotedMatch = unquotedReasoningRegex.exec(content)) !== null) {
    const th = unquotedMatch[1].trim();
    if (th) {
      reasoning = (reasoning ? `${reasoning}\n\n` : '') + th;
    }
  }
  content = content.replace(unquotedReasoningRegex, '').trim();

  // 4. 处理流式输出中尚未闭合的 <think>... 尾部
  const unclosedThinkMatch = content.match(/<think>([\s\S]*)$/i);
  if (unclosedThinkMatch) {
    reasoning = (reasoning ? `${reasoning}\n\n` : '') + unclosedThinkMatch[1].trim();
    content = content.replace(/<think>[\s\S]*$/i, '').trim();
  }

  return {
    content: content.trim(),
    reasoning: reasoning.trim() || undefined,
  };
}

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({
  message,
  bot,
  sessionId,
  onApprovalResolved,
  onWidgetPrompt,
  live,
}) => {
  const { openSettings, showToast, setIsAvatarStudioOpen } = useApp();
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(() => {
    if (message.approvalRequest?.status === 'approved') return '已批准';
    if (message.approvalRequest?.status === 'rejected') return '已拒绝';
    return null;
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (message.approvalRequest?.status === 'approved') {
      setApprovalStatus('已批准');
    } else if (message.approvalRequest?.status === 'rejected') {
      setApprovalStatus('已拒绝');
    }
  }, [message.approvalRequest?.status]);

  const isUser = message.role === 'user';

  // 严格分离思考过程与正式回复文本
  const { reasoning: effectiveReasoning, content: effectiveContent } = useMemo(() => {
    if (isUser) return { content: message.content || '', reasoning: undefined };
    return extractReasoningAndContent(message.content, message.reasoning);
  }, [isUser, message.content, message.reasoning]);

  const handleCopy = async () => {
    const textToCopy = isUser ? message.content || '' : effectiveContent || message.content || '';
    if (!textToCopy) return;
    const ok = await copyToClipboard(textToCopy);
    if (ok) {
      setCopied(true);
      showToast('内容已复制到剪贴板', 'info');
      setTimeout(() => setCopied(false), 2000);
    } else {
      showToast('复制失败，请手动选中文本复制', 'error');
    }
  };

  const handleDecision = async (approved: boolean) => {
    if (!message.approvalRequest || !sessionId) return;
    try {
      await api.sendDecision(sessionId, message.approvalRequest.actionId, approved ? 'APPROVE' : 'REJECT');
      setApprovalStatus(approved ? '已批准' : '已拒绝');
      onApprovalResolved?.(message.approvalRequest.actionId, approved);
    } catch (err: any) {
      console.error('Failed to submit decision:', err);
      showToast(`审批提交失败: ${err?.message || err}`, 'error');
    }
  };

  const formattedTime = message.timestamp ? formatRelativeTime(message.timestamp) : '';

  // 缓存 Markdown 解析结果，避免同一会话内流式渲染其它气泡时反复解析
  const renderedHtml = useMemo(() => {
    if (isUser || !effectiveContent) return '';
    const displayClean = effectiveContent
      .replace(/<[｜|]{2}DSML[｜|]{2}\s*calls>[\s\S]*?(?:<\/[｜|]{2}DSML[｜|]{2}\s*calls>|$)/gi, '')
      .trim();
    return displayClean ? renderMarkdown(displayClean) : '';
  }, [isUser, effectiveContent]);

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-avatar">
        {isUser ? (
          <div className="user-message-avatar" title="用户">
            <UserIcon size={16} />
          </div>
        ) : (
          <BotAvatar bot={bot} size={36} motion="avatar-idle" />
        )}
      </div>

      <div className="message-bubble">
        {/* 气泡元信息栏（时间戳与快捷复制） */}
        <div className="message-meta-bar">
          <span className="message-sender-name">{isUser ? '我' : bot?.name || '数字员工'}</span>
          {formattedTime && <span className="message-timestamp">{formattedTime}</span>}
          {(effectiveContent || message.content) && (
            <button
              type="button"
              className="message-copy-btn"
              onClick={handleCopy}
              title={copied ? '已复制' : '复制内容'}
              aria-label="复制消息内容"
            >
              {copied ? <CheckCheck size={12} className="copy-success" /> : <Copy size={12} />}
            </button>
          )}
        </div>

        {/* Assistant Reasoning Collapsible Block */}
        {effectiveReasoning && (
          <div className="thinking-card">
            <button
              type="button"
              className="think-toggle-btn"
              onClick={() => setIsReasoningOpen((prev) => !prev)}
              aria-expanded={isReasoningOpen}
            >
              {isReasoningOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="think-title">
                {live ? '思考过程中…' : '思考推理过程'}
              </span>
              {live && <span className="think-pulse-dot" />}
            </button>
            {isReasoningOpen && (
              <div
                className="reasoning-content markdown-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(effectiveReasoning) }}
              />
            )}
          </div>
        )}

        {/* 工具执行过程 */}
        {(() => {
          const tools = message.toolCalls || (message as any).tools;
          if (!tools || tools.length === 0) return null;
          return <ToolTrace tools={tools} live={live} />;
        })()}

        {/* Human Gate Sentinel Approval Prompt */}
        {message.approvalRequest && (
          <div className="approval-card-hazard">
            <div className="approval-card-title">
              <div className="approval-hazard-indicator">
                <ShieldAlert size={16} />
                <span>Sentinel 门禁安全拦截</span>
              </div>
              <button
                type="button"
                className="approval-details-link"
                onClick={() => openSettings('security')}
                title="打开设置中的安全中心查看审计记录"
              >
                查看审计详情 →
              </button>
            </div>
            <div className="approval-card-desc">
              {message.approvalRequest.description}
            </div>
            {message.approvalRequest.command && (
              <div className="approval-details-box">
                <code>{message.approvalRequest.command}</code>
              </div>
            )}
            <div className="approval-actions">
              {approvalStatus ? (
                <span className={`approval-result-pill ${approvalStatus.includes('批准') ? 'approved' : 'rejected'}`}>
                  {approvalStatus}
                </span>
              ) : (
                <>
                  <button type="button" className="btn-reject" onClick={() => handleDecision(false)}>
                    <X size={14} /> 驳回执行
                  </button>
                  <button type="button" className="btn-approve" onClick={() => handleDecision(true)}>
                    <Check size={14} /> 授权执行
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* User Attached Images / Files */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="user-message-images">
            {message.attachments.map((att, idx) =>
              !att.url ? null : att.type === 'image' ? (
                <button
                  key={idx}
                  type="button"
                  className="user-bubble-image-btn"
                  onClick={() => window.open(att.url, '_blank')}
                  title="点击查看原图"
                  aria-label={`查看附图: ${att.name || '图片'}`}
                >
                  <img
                    src={att.url}
                    alt={att.name || '用户附图'}
                    loading="lazy"
                    className="user-bubble-image"
                  />
                </button>
              ) : (
                <a
                  key={idx}
                  className="attachment-file-chip"
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={att.name}
                >
                  <FileText size={14} />
                  <span>{att.name}</span>
                </a>
              )
            )}
          </div>
        )}

        {/* 形象工坊交互卡片 */}
        {message.avatarEvent && (
          <AvatarOptionsCard
            event={message.avatarEvent}
            botName={bot?.name}
            onOpenStudio={() => setIsAvatarStudioOpen(true)}
          />
        )}

        {/* Markdown Rendered Content */}
        {isUser ? (
          <div className="user-text">
            {message.content}
          </div>
        ) : renderedHtml ? (
          <div
            className="assistant-text markdown-body"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        ) : null}

        {/* 内联交互组件卡片 */}
        {!isUser && message.widgets && message.widgets.length > 0 && (
          <div className="message-widgets-list">
            {message.widgets.map((widget) => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                onSendPrompt={onWidgetPrompt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const MessageBubble = React.memo(MessageBubbleComponent);
