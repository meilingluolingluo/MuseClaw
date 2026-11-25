import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { Message, Bot } from '../../types';
import { BotAvatar } from '../common/BotAvatar';
import { renderMarkdown } from '../../utils/markdown';
import {
  ChevronRight,
  ShieldAlert,
  Check,
  X,
  FileText,
  Copy,
  CheckCheck,
  User as UserIcon,
  Reply,
  RotateCcw,
  GitBranch,
  Code2,
  Download,
  Pencil,
  Brain,
} from 'lucide-react';
import { ToolTrace } from './ToolTrace';
import { AvatarOptionsCard } from './AvatarOptionsCard';
import { WidgetCard } from './WidgetCard';
import { RichMarkdown } from './RichMarkdown';
import { ChangedFilesCard } from './ChangedFilesCard';
import { DomainCard, extractToolDomainCards } from './DomainCard';
import type { LightboxPayload } from './ImageLightbox';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatRelativeTime } from '../../utils/format';
import { copyToClipboard } from '../../utils/clipboard';

interface MessageBubbleProps {
  message: Message;
  messageIndex?: number;
  bot: Bot | null;
  sessionId?: string;
  isBusy?: boolean;
  isSearchMatch?: boolean;
  isSearchActive?: boolean;
  liveReasoningSeconds?: number;
  onApprovalResolved?: (approvalId: string, approved: boolean) => void;
  onWidgetPrompt?: (prompt: string, opts?: { hidden?: boolean }) => void;
  onQuote?: (message: Message, selectedText?: string) => void;
  onRegenerate?: (messageIndex: number) => void;
  onEditResend?: (messageIndex: number, newText: string) => void;
  onForkSideChat?: (messageIndex: number) => void;
  onOpenLightbox?: (payload: LightboxPayload) => void;
  /** 流式占位气泡 */
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
  messageIndex = -1,
  bot,
  sessionId,
  isBusy = false,
  isSearchMatch = false,
  isSearchActive = false,
  liveReasoningSeconds = 0,
  onApprovalResolved,
  onWidgetPrompt,
  onQuote,
  onRegenerate,
  onEditResend,
  onForkSideChat,
  onOpenLightbox,
  live,
}) => {
  const { openSettings, showToast, setIsAvatarStudioOpen } = useApp();
  const isUser = message.role === 'user';

  // 严格分离思考过程与正式回复文本
  const { reasoning: effectiveReasoning, content: effectiveContent } = useMemo(() => {
    if (isUser) return { content: message.content || '', reasoning: undefined };
    return extractReasoningAndContent(message.content, message.reasoning);
  }, [isUser, message.content, message.reasoning]);

  const [userToggledReasoning, setUserToggledReasoning] = useState(false);
  const [isReasoningOpen, setIsReasoningOpen] = useState(Boolean(live && effectiveReasoning && !effectiveContent));
  const [showRawMarkdown, setShowRawMarkdown] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content || '');
  const [approvalStatus, setApprovalStatus] = useState<string | null>(() => {
    if (message.approvalRequest?.status === 'approved') return '已批准';
    if (message.approvalRequest?.status === 'rejected') return '已拒绝';
    return null;
  });
  const [copied, setCopied] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const reasoningBodyRef = useRef<HTMLDivElement>(null);

  // 流式思考阶段自动展开，正文输出或结束后自动折叠（保留用户手动开关）
  useEffect(() => {
    if (userToggledReasoning) return;
    if (live && effectiveReasoning && !effectiveContent) {
      setIsReasoningOpen(true);
    } else if (!live || (effectiveContent && effectiveContent.trim().length > 0)) {
      setIsReasoningOpen(false);
    }
  }, [live, effectiveReasoning, effectiveContent, userToggledReasoning]);

  // 思考流式输出时保持滚动跟随最新推理片段
  useEffect(() => {
    if (live && isReasoningOpen && reasoningBodyRef.current) {
      reasoningBodyRef.current.scrollTop = reasoningBodyRef.current.scrollHeight;
    }
  }, [live, isReasoningOpen, effectiveReasoning]);

  useEffect(() => {
    if (message.approvalRequest?.status === 'approved') {
      setApprovalStatus('已批准');
    } else if (message.approvalRequest?.status === 'rejected') {
      setApprovalStatus('已拒绝');
    }
  }, [message.approvalRequest?.status]);
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

  const handleQuoteClick = () => {
    if (!onQuote) return;
    let selected = '';
    const sel = window.getSelection();
    if (sel && sel.toString().trim() && bubbleRef.current) {
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      if ((anchor && bubbleRef.current.contains(anchor)) || (focus && bubbleRef.current.contains(focus))) {
        selected = sel.toString().trim();
      }
    }
    onQuote(message, selected || undefined);
  };

  const handleExportSingle = () => {
    const clean = (isUser ? message.content || '' : effectiveContent || message.content || '').trim();
    if (!clean) return;
    const header = `# ${bot?.name || '数字员工'} 回复\n\n`;
    const blob = new Blob([header + clean], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reply-${Date.now()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleSaveEdit = () => {
    const trimmed = editDraft.trim();
    if (!trimmed || isBusy || messageIndex < 0) return;
    setIsEditing(false);
    onEditResend?.(messageIndex, trimmed);
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

  const displayClean = useMemo(() => {
    if (isUser || !effectiveContent) return '';
    return effectiveContent
      .replace(/<[｜|]{2}DSML[｜|]{2}\s*calls>[\s\S]*?(?:<\/[｜|]{2}DSML[｜|]{2}\s*calls>|$)/gi, '')
      .trim();
  }, [isUser, effectiveContent]);

  const reasoningHtml = useMemo(() => {
    const r = effectiveReasoning || message.reasoning;
    if (!r || !isReasoningOpen) return '';
    return renderMarkdown(r);
  }, [effectiveReasoning, message.reasoning, isReasoningOpen]);


  const tools = message.toolCalls || (message as any).tools;
  const toolDomainCards = useMemo(() => {
    if (isUser || live) return [];
    return extractToolDomainCards(tools);
  }, [isUser, live, tools]);

  const reasoningTitle = live && !displayClean ? '深度思考中…' : '思考过程';

  const reasoningMeta = useMemo(() => {
    if (live && !displayClean) {
      return liveReasoningSeconds > 0 ? `${liveReasoningSeconds}s` : '';
    }
    if (message.reasoningDurationMs && message.reasoningDurationMs > 0) {
      return `用时 ${(message.reasoningDurationMs / 1000).toFixed(1)}s`;
    }
    return '';
  }, [live, displayClean, liveReasoningSeconds, message.reasoningDurationMs]);

  const turnMetaLabel = useMemo(() => {
    if (isUser || live) return '';
    const parts: string[] = [];
    if (message.durationMs && message.durationMs > 0) {
      parts.push(
        message.durationMs < 1000
          ? `${message.durationMs}ms`
          : `${(message.durationMs / 1000).toFixed(1)}s`
      );
    }
    if (message.model) {
      parts.push(message.model);
    }
    return parts.join(' · ');
  }, [isUser, live, message.durationMs, message.model]);

  return (
    <div
      className={`message-row ${message.role}${isSearchMatch ? ' is-search-match' : ''}${isSearchActive ? ' is-search-active' : ''}`}
      data-message-id={message.id}
      data-message-index={messageIndex >= 0 ? messageIndex : undefined}
      data-message-role={message.role}
    >
      <div className="message-bubble" ref={bubbleRef}>
        <div className="message-meta-bar">
          {isUser ? (
            <span className="message-inline-user-avatar" aria-hidden="true">
              <UserIcon size={12} />
            </span>
          ) : (
            <span className="message-inline-avatar" aria-hidden="true">
              <BotAvatar bot={bot} size={24} motion="avatar-idle" />
            </span>
          )}
          <span className="message-sender-name">{isUser ? '我' : bot?.name || '数字员工'}</span>
          {formattedTime && <span className="message-timestamp">{formattedTime}</span>}
        </div>

        {/* 思考过程折叠卡片 */}
        {(effectiveReasoning || message.reasoning) && (
          <div
            className={`thinking-card${isReasoningOpen ? ' is-open' : ''}${
              live && !displayClean ? ' is-thinking-live' : ''
            }`}
          >
            <button
              type="button"
              className="think-toggle-btn"
              onClick={() => {
                setUserToggledReasoning(true);
                setIsReasoningOpen((prev) => !prev);
              }}
              aria-expanded={isReasoningOpen}
            >
              <span className="think-icon-badge" aria-hidden="true">
                <Brain size={12} className="think-brain-icon" />
              </span>
              <span className="think-title">{reasoningTitle}</span>
              {reasoningMeta && <span className="think-meta">{reasoningMeta}</span>}
              {live && !displayClean && <span className="think-pulse-dot" />}
              <ChevronRight size={13} className="think-chevron" />
            </button>
            {isReasoningOpen && (
              <div className="thinking-body">
                <div
                  ref={reasoningBodyRef}
                  className="reasoning-content markdown-body"
                  dangerouslySetInnerHTML={{ __html: reasoningHtml }}
                />
              </div>
            )}
          </div>
        )}

        {/* 工具执行过程 */}
        {tools && tools.length > 0 && <ToolTrace tools={tools} live={live} />}

        {/* 安全门禁审批 */}
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

        {/* 用户上传的图片 / 文件 */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="user-message-images">
            {message.attachments.map((att, idx) =>
              !att.url ? null : att.type === 'image' ? (
                <button
                  key={idx}
                  type="button"
                  className="user-bubble-image-btn"
                  onClick={() => {
                    if (onOpenLightbox) {
                      onOpenLightbox({ src: att.url, alt: att.name || '用户附图' });
                    } else {
                      window.open(att.url, '_blank');
                    }
                  }}
                  title="点击放大查看"
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

        {/* 消息正文（支持用户行内编辑与助手富文本 / 原文切换） */}
        {isUser ? (
          isEditing ? (
            <div className="message-inline-editor">
              <textarea
                className="message-inline-textarea"
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={3}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                    setEditDraft(message.content || '');
                  } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                }}
              />
              <div className="message-inline-editor-actions">
                <span className="message-inline-editor-hint">Ctrl/⌘ + Enter 提交重发 · Esc 取消</span>
                <div className="message-inline-editor-btns">
                  <button
                    type="button"
                    className="message-inline-btn is-cancel"
                    onClick={() => {
                      setIsEditing(false);
                      setEditDraft(message.content || '');
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="message-inline-btn is-submit"
                    disabled={!editDraft.trim() || isBusy}
                    onClick={handleSaveEdit}
                  >
                    保存并重发
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="user-text">{message.content}</div>
          )
        ) : displayClean ? (
          showRawMarkdown ? (
            <pre className="message-raw-markdown"><code>{displayClean}</code></pre>
          ) : (
            <RichMarkdown
              content={displayClean}
              live={live}
              onOpenLightbox={onOpenLightbox}
              onSendPrompt={(prompt) => onWidgetPrompt?.(prompt)}
            />
          )
        ) : null}

        {/* 工具变更文件摘要卡 & 领域内联卡 */}
        {!isUser && !live && <ChangedFilesCard toolCalls={tools} />}
        {!isUser && toolDomainCards.length > 0 && (
          <div className="message-domain-cards">
            {toolDomainCards.map((card, idx) => (
              <DomainCard key={`${card.kind}-${idx}`} kind={card.kind} data={card.data} />
            ))}
          </div>
        )}

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

        {/* 消息底部操作栏 */}
        {!live && !isEditing && (message.content || (tools && tools.length > 0)) && (
          <div className="message-actions-bar">
            <div className="message-actions-left">
              {message.content && (
                <button
                  type="button"
                  className={`msg-action-btn${copied ? ' is-active' : ''}`}
                  onClick={handleCopy}
                  title="复制内容"
                >
                  {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              )}

              {onQuote && message.content && (
                <button
                  type="button"
                  className="msg-action-btn"
                  onClick={handleQuoteClick}
                  title="引用此段内容追问"
                >
                  <Reply size={13} />
                  <span>引用</span>
                </button>
              )}

              {isUser && onEditResend && messageIndex >= 0 && (
                <button
                  type="button"
                  className="msg-action-btn"
                  disabled={isBusy}
                  onClick={() => {
                    setEditDraft(message.content || '');
                    setIsEditing(true);
                  }}
                  title="编辑此条消息并重新发送"
                >
                  <Pencil size={13} />
                  <span>编辑</span>
                </button>
              )}

              {!isUser && onRegenerate && messageIndex >= 0 && (
                <button
                  type="button"
                  className="msg-action-btn"
                  disabled={isBusy}
                  onClick={() => onRegenerate(messageIndex)}
                  title="重新生成本轮回答"
                >
                  <RotateCcw size={13} />
                  <span>重新生成</span>
                </button>
              )}

              {!isUser && onForkSideChat && messageIndex >= 0 && (
                <button
                  type="button"
                  className="msg-action-btn"
                  disabled={isBusy}
                  onClick={() => onForkSideChat(messageIndex)}
                  title="从此处分叉出一个独立旁聊"
                >
                  <GitBranch size={13} />
                  <span>开启旁聊</span>
                </button>
              )}

              {!isUser && displayClean && (
                <button
                  type="button"
                  className={`msg-action-btn${showRawMarkdown ? ' is-active' : ''}`}
                  onClick={() => setShowRawMarkdown((v) => !v)}
                  title={showRawMarkdown ? '恢复富文本排版' : '查看 Markdown 原文'}
                >
                  <Code2 size={13} />
                  <span>{showRawMarkdown ? '排版' : '原文'}</span>
                </button>
              )}

              {!isUser && displayClean && (
                <button
                  type="button"
                  className="msg-action-btn"
                  onClick={handleExportSingle}
                  title="导出本条回答为 Markdown"
                >
                  <Download size={13} />
                  <span>导出</span>
                </button>
              )}
            </div>

            {turnMetaLabel && (
              <span className="message-turn-meta" title="响应耗时与模型">
                {turnMetaLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const MessageBubble = React.memo(MessageBubbleComponent);
