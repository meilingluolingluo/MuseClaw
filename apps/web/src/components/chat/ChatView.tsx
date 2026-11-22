import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { MessageBubble } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { AuditDrawer } from '../audit/AuditDrawer';
import { AgentCapsule } from './AgentCapsule';
import { ArrowDown, Clock, Target, Brain, Calendar, ShieldCheck, AlertCircle, RotateCcw } from 'lucide-react';
import type { Message, MessageAttachment } from '../../types';
import { api } from '../../services/api';

export const ChatView: React.FC = () => {
  const {
    activeSessionId,
    activeBot,
    showToast,
    setTainted,
    createNewSession,
    loadSessions,
    isAuditDrawerOpen,
    setIsAuditDrawerOpen,
    setIsBotModalOpen,
  } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const currentStreamingSessionIdRef = useRef<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [streamingTools, setStreamingTools] = useState<any[]>([]);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const isInitialSwitchRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [hasNewUnseen, setHasNewUnseen] = useState(false);

  // 历史消息渐进式分页：初始展示最近 35 条，避免长会话一次性全量挂载引发卡顿
  const PAGE_SIZE = 35;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const pendingScrollAdjustRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);

  const scrollToBottom = (behavior: 'auto' | 'smooth' = 'smooth') => {
    const container = chatContainerRef.current;
    if (!container) return;
    if (behavior === 'auto') {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  const handleScroll = () => {
    const container = chatContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const atBottom = distanceToBottom <= 100;
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      setShowScrollBottomBtn(false);
      setHasNewUnseen(false);
    } else {
      setShowScrollBottomBtn(true);
    }
  };

  const handleLoadMoreHistory = () => {
    const container = chatContainerRef.current;
    if (container) {
      pendingScrollAdjustRef.current = {
        prevScrollHeight: container.scrollHeight,
        prevScrollTop: container.scrollTop,
      };
    }
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, messages.length));
  };

  // 展开更早历史消息时校准滚动高度，确保视觉位置不产生抖动或跳跃
  useEffect(() => {
    if (pendingScrollAdjustRef.current && chatContainerRef.current) {
      const { prevScrollHeight, prevScrollTop } = pendingScrollAdjustRef.current;
      const currentScrollHeight = chatContainerRef.current.scrollHeight;
      chatContainerRef.current.scrollTop = currentScrollHeight - prevScrollHeight + prevScrollTop;
      pendingScrollAdjustRef.current = null;
    }
  }, [visibleCount]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // 切换会话：终止上一个会话可能未完成的流并重置流状态，拉取目标会话的消息记录
  useEffect(() => {
    if (currentStreamingSessionIdRef.current && currentStreamingSessionIdRef.current !== activeSessionId) {
      abortRef.current?.abort();
      abortRef.current = null;
      currentStreamingSessionIdRef.current = null;
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingReasoning('');
      setStreamingTools([]);
    }

    if (!activeSessionId) {
      setMessages([]);
      setVisibleCount(PAGE_SIZE);
      setLoadingSession(false);
      setSessionLoadError(null);
      return;
    }

    // 默认空会话/未落盘草稿优化：无需发起远端查询，直接归零展示，杜绝无意义的网络请求与加载等待
    if (activeSessionId.endsWith('_init') || activeSessionId.endsWith('_default')) {
      setMessages([]);
      setVisibleCount(PAGE_SIZE);
      setLoadingSession(false);
      setSessionLoadError(null);
      isInitialSwitchRef.current = false;
      return;
    }
    let cancelled = false;
    isInitialSwitchRef.current = true;
    setMessages([]);
    setVisibleCount(PAGE_SIZE);
    setLoadingSession(true);
    setSessionLoadError(null);
    setShowScrollBottomBtn(false);
    setHasNewUnseen(false);

    api
      .getMessages(activeSessionId)
      .then((res) => {
        if (cancelled || activeSessionIdRef.current !== activeSessionId) return;
        const msgList = Array.isArray(res) ? res : [];
        setMessages(msgList);
        setSessionLoadError(null);
        setVisibleCount(PAGE_SIZE);

        // 切换会话核心优化：采用 instant / auto 定位到底部最新内容，消除从顶部第1条一路 smooth 滚到底部的视觉眩晕
        requestAnimationFrame(() => {
          if (cancelled || activeSessionIdRef.current !== activeSessionId) return;
          scrollToBottom('auto');
          setTimeout(() => {
            if (!cancelled && activeSessionIdRef.current === activeSessionId) {
              scrollToBottom('auto');
              isInitialSwitchRef.current = false;
              isAtBottomRef.current = true;
              setShowScrollBottomBtn(false);
            }
          }, 50);
        });
      })
      .catch((err) => {
        if (cancelled || activeSessionIdRef.current !== activeSessionId) return;
        console.error('Failed to load messages:', err);
        setSessionLoadError(err.message || '加载会话历史失败');
        showToast(`会话记录载入失败：${err.message}`, 'error');
        isInitialSwitchRef.current = false;
      })
      .finally(() => {
        if (!cancelled && activeSessionIdRef.current === activeSessionId) {
          setLoadingSession(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, showToast]);

  const retryLoadSession = () => {
    if (!activeSessionId) return;
    setLoadingSession(true);
    setSessionLoadError(null);
    api
      .getMessages(activeSessionId)
      .then((res) => {
        setMessages(Array.isArray(res) ? res : []);
        setSessionLoadError(null);
        scrollToBottom('auto');
      })
      .catch((err) => {
        setSessionLoadError(err.message || '加载会话历史失败');
        showToast(`重试加载失败: ${err.message}`, 'error');
      })
      .finally(() => {
        setLoadingSession(false);
      });
  };

  const handleApprovalResolved = useCallback((actionId: string, approved: boolean) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.approvalRequest && m.approvalRequest.actionId === actionId) {
          return {
            ...m,
            approvalRequest: {
              ...m.approvalRequest,
              status: approved ? 'approved' : 'rejected',
              decidedAt: Date.now(),
            },
          };
        }
        return m;
      })
    );
  }, []);

  // 智能吸底：仅当用户处于底部附近时才跟随自动吸底，若用户正在上方阅读历史则不打扰用户
  useEffect(() => {
    if (isInitialSwitchRef.current) return;

    if (isAtBottomRef.current) {
      if (isStreaming) {
        // 流式高频输出时使用 auto 定位，避免高频 smooth 动画导致卡顿与抖动
        scrollToBottom('auto');
      } else {
        scrollToBottom('smooth');
      }
    } else {
      setShowScrollBottomBtn(true);
      if (isStreaming) {
        setHasNewUnseen(true);
      }
    }
  }, [messages, streamingContent, streamingReasoning, isStreaming]);

  const handleScrollToBottomClick = () => {
    scrollToBottom('smooth');
    isAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
    setHasNewUnseen(false);
  };

  const handleSendMessage = async (text: string, attachments: MessageAttachment[] = []) => {
    // 第一条消息不该先让用户「去新建会话」：没有会话就静默开一个
    let sessionId = activeSessionId;
    if (!sessionId) {
      const created = await createNewSession(true);
      sessionId = created?.id ?? null;
      if (!sessionId) {
        showToast('还没有可用的数字员工，请检查 gateway 配置', 'warning');
        return;
      }
      activeSessionIdRef.current = sessionId;
    }

    const targetSessionId = sessionId;
    currentStreamingSessionIdRef.current = targetSessionId;

    const userMessage: Message = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: text,
      attachments,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingReasoning('');
    setStreamingTools([]);
    isAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
    setHasNewUnseen(false);
    setTimeout(() => scrollToBottom('smooth'), 20);

    const controller = new AbortController();
    abortRef.current = controller;
    let accumulatedText = '';

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          prompt: text,
          text,
          message: text,
          session_id: sessionId,
          sessionId,
          bot_id: activeBot?.id,
          botId: activeBot?.id,
          attachments,
        }),
      });

      if (!response.ok) {
        throw new Error(`服务响应异常: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedReasoning = '';
      const toolsAccumulator: any[] = [];

      let updateRafId: number | null = null;
      let hasApprovalNeeded = false;
      const scheduleStreamingUpdate = () => {
        if (updateRafId != null) return;
        updateRafId = requestAnimationFrame(() => {
          updateRafId = null;
          if (activeSessionIdRef.current === targetSessionId) {
            setStreamingContent(accumulatedText);
            setStreamingReasoning(accumulatedReasoning);
          }
        });
      };

      while (true) {
        if (activeSessionIdRef.current !== targetSessionId) {
          try {
            await reader.cancel();
          } catch {}
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        if (activeSessionIdRef.current !== targetSessionId) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          if (activeSessionIdRef.current !== targetSessionId) break;
          const line = block.trim();
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.replace(/^data:\s*/, '');
          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'stream:text-delta') {
              accumulatedText += event.text;
              scheduleStreamingUpdate();
            } else if (event.type === 'stream:reasoning-delta') {
              accumulatedReasoning += event.text;
              scheduleStreamingUpdate();
            } else if (event.type === 'agent:error') {
              const errSnippet = event.text || `\n[执行出错: ${event.error || '未知异常'}]`;
              accumulatedText += errSnippet;
              if (activeSessionIdRef.current === targetSessionId) {
                setStreamingContent(accumulatedText);
                showToast(`执行出错: ${event.error || '未知异常'}`, 'error');
              }
            } else if (event.type === 'tool:call_start') {
              toolsAccumulator.push({
                tool: event.toolName,
                params: event.input,
                status: 'running',
              });
              if (activeSessionIdRef.current === targetSessionId) {
                setStreamingTools([...toolsAccumulator]);
              }
            } else if (event.type === 'tool:call_end') {
              // 同名工具可能连续调用，更新最后一条仍在运行的记录
              const running = [...toolsAccumulator]
                .reverse()
                .find((t) => t.tool === event.toolName && t.status === 'running');
              if (running) {
                const rejected = String(event.output || '').includes('拒绝');
                let isError = rejected;
                if (typeof event.output === 'object' && event.output !== null) {
                  const outObj = event.output as any;
                  if (outObj.error || (outObj.exitCode !== undefined && outObj.exitCode !== 0)) {
                    isError = true;
                  }
                }
                running.status = isError ? (rejected ? 'rejected' : 'failed') : 'done';
                running.ok = !isError;
                running.durationMs = event.durationMs || 0;
                running.result = event.output;
              }
              if (activeSessionIdRef.current === targetSessionId) {
                setStreamingTools([...toolsAccumulator]);
              }
            } else if (event.type === 'sentinel:taint_updated') {
              setTainted(event.isTainted, event.reason);
            } else if (event.type === 'sentinel:approval_needed') {
              hasApprovalNeeded = true;
              if (activeSessionIdRef.current === targetSessionId) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `appr_${Date.now()}`,
                    role: 'assistant',
                    content: '触发安全门禁审批：请审核以下操作是否批准执行。',
                    approvalRequest: {
                      actionId: event.request?.approvalId,
                      description: event.request?.actionSummary,
                      command: event.request?.targetDetails?.command,
                      status: 'pending',
                    },
                  },
                ]);
              }
            }
          } catch (e) {
            console.warn('Failed to parse SSE line:', e);
          }
        }
      }

      if (updateRafId != null) {
        cancelAnimationFrame(updateRafId);
        updateRafId = null;
      }

      if (activeSessionIdRef.current !== targetSessionId) {
        return;
      }

      if (accumulatedText.trim() || accumulatedReasoning.trim()) {
        const assistantMsg: Message = {
          id: `asst_${Date.now()}`,
          role: 'assistant',
          content: accumulatedText.trim() || '（Agent 执行完成）',
          reasoning: accumulatedReasoning || undefined,
          toolCalls: toolsAccumulator.length > 0 ? toolsAccumulator : undefined,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else if (!hasApprovalNeeded) {
        const fallbackMsg: Message = {
          id: `asst_${Date.now()}`,
          role: 'assistant',
          content: '⚠️ Agent 未返回任何输出，请检查所选大模型或计算节点连通状态。',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, fallbackMsg]);
      }
    } catch (err: any) {
      if (activeSessionIdRef.current !== targetSessionId) {
        return;
      }
      if (err?.name === 'AbortError') {
        const partial = accumulatedText.trim();
        setMessages((prev) =>
          prev
            .map((m) => {
              if (m.approvalRequest && m.approvalRequest.status === 'pending') {
                return {
                  ...m,
                  approvalRequest: {
                    ...m.approvalRequest,
                    status: 'cancelled' as const,
                  },
                };
              }
              return m;
            })
            .concat({
              id: `stop_${Date.now()}`,
              role: 'assistant',
              content: partial ? `${partial}\n\n（已停止这一轮，未决审批已失效）` : '（已停止这一轮，未决审批已失效）',
              timestamp: Date.now(),
            })
        );
      } else {
        showToast(`对话失败: ${err.message}`, 'error');
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'assistant',
            content: `❌ 通信异常: ${err.message}`,
            timestamp: Date.now(),
          },
        ]);
      }
    } finally {
      if (activeSessionIdRef.current === targetSessionId) {
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingReasoning('');
        setStreamingTools([]);
      }
      if (currentStreamingSessionIdRef.current === targetSessionId) {
        currentStreamingSessionIdRef.current = null;
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      // 首轮之后标题/条数由服务端生成，刷新侧栏
      if (activeBot?.id) loadSessions(activeBot.id, targetSessionId);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setMessages((prev) =>
      prev.map((m) => {
        if (m.approvalRequest && (!m.approvalRequest.status || m.approvalRequest.status === 'pending')) {
          return {
            ...m,
            approvalRequest: {
              ...m.approvalRequest,
              status: 'rejected',
              description: `${m.approvalRequest.description} (会话已停止，审批已自动取消)`,
              decidedAt: Date.now(),
            },
          };
        }
        return m;
      })
    );
  };

  const displayedMessages =
    messages.length > visibleCount ? messages.slice(messages.length - visibleCount) : messages;

  return (
    <div className="chat-stage-wrapper">
      <section className="chat-container">
        {/* 顶部悬浮居中智能体头像与渐变遮罩 (Scrim) */}
        <div className="chat-floating-header">
          <AgentCapsule
            bot={activeBot}
            variant="header"
            isStreaming={isStreaming}
            streamingReasoning={streamingReasoning}
            streamingToolsCount={streamingTools.length}
            onClick={() => setIsBotModalOpen(true)}
          />
        </div>

        <div className="chat-history" ref={chatContainerRef} onScroll={handleScroll}>
          {loadingSession ? (
            <div className="chat-skeleton-container" role="status" aria-live="polite">
              <div className="chat-skeleton-bubble is-user" />
              <div className="chat-skeleton-bubble is-bot" />
              <div className="chat-loading-notice">
                <span className="chat-loading-dot" />
                <span>正在载入会话记录…</span>
              </div>
            </div>
          ) : sessionLoadError ? (
            <div className="chat-load-error-state" role="alert" style={{ textAlign: 'center', padding: '60px 20px' }}>
              <AlertCircle size={32} style={{ color: 'var(--accent-red)', marginBottom: '12px' }} />
              <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>会话历史加载失败</h3>
              <p style={{ color: 'var(--text-dim)', fontSize: '13px', marginBottom: '16px' }}>{sessionLoadError}</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={retryLoadSession}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <RotateCcw size={13} /> 重新加载
              </button>
            </div>
          ) : messages.length === 0 && !isStreaming ? (
            <div className="chat-empty-state">
              <div className="chat-empty-hero-wrap">
                <AgentCapsule
                  bot={activeBot}
                  variant="hero"
                  onClick={() => setIsBotModalOpen(true)}
                />
              </div>
              <div className="chat-empty-greeting">
                你好，我是 {activeBot?.name || '数字员工'}
              </div>
              <div className="chat-empty-desc">
                已就绪受控长期记忆、长周期目标自驱推演与微沙箱安全执行能力，随时为您效劳。
              </div>
              <div className="chat-starter-grid">
                <button
                  type="button"
                  className="chat-starter-card"
                  disabled={isStreaming}
                  onClick={() => handleSendMessage('帮我梳理并规划长周期目标')}
                >
                  <div className="chat-starter-icon is-goals">
                    <Target size={18} />
                  </div>
                  <div className="chat-starter-content">
                    <div className="chat-starter-title">长周期目标规划</div>
                    <div className="chat-starter-sub">拆解阶段里程碑与多维度目标自驱推进</div>
                  </div>
                </button>
                <button
                  type="button"
                  className="chat-starter-card"
                  disabled={isStreaming}
                  onClick={() => handleSendMessage('查询并记录我常用的工作习惯与偏好')}
                >
                  <div className="chat-starter-icon is-memory">
                    <Brain size={18} />
                  </div>
                  <div className="chat-starter-content">
                    <div className="chat-starter-title">长期记忆沉淀</div>
                    <div className="chat-starter-sub">记录工程习惯、红线约束与工作偏好</div>
                  </div>
                </button>
                <button
                  type="button"
                  className="chat-starter-card"
                  disabled={isStreaming}
                  onClick={() => handleSendMessage('帮我配置一个工作日早上 09:30 的例行巡检任务')}
                >
                  <div className="chat-starter-icon is-routine">
                    <Calendar size={18} />
                  </div>
                  <div className="chat-starter-content">
                    <div className="chat-starter-title">定时巡检与例程</div>
                    <div className="chat-starter-sub">建立自动化周期任务与状态提醒流程</div>
                  </div>
                </button>
                <button
                  type="button"
                  className="chat-starter-card"
                  disabled={isStreaming}
                  onClick={() => handleSendMessage('在原生安全沙箱中执行系统自检与环境连通性验证')}
                >
                  <div className="chat-starter-icon is-security">
                    <ShieldCheck size={18} />
                  </div>
                  <div className="chat-starter-content">
                    <div className="chat-starter-title">微沙箱环境自检</div>
                    <div className="chat-starter-sub">验证隔离子进程与命令行门禁安全状态</div>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <>
              {messages.length > visibleCount && (
                <div className="chat-history-load-more">
                  <button type="button" onClick={handleLoadMoreHistory}>
                    <Clock size={12} />
                    查看更早的历史记录（还有 {messages.length - visibleCount} 条）
                  </button>
                </div>
              )}
              {displayedMessages.map((msg, idx) => (
                <MessageBubble
                  key={msg.id || `${msg.role}-${idx}`}
                  message={msg}
                  bot={activeBot}
                  sessionId={activeSessionId || undefined}
                  onApprovalResolved={handleApprovalResolved}
                />
              ))}
            </>
          )}

          {/* Real-time Streaming Placeholder */}
          {isStreaming && (
            <MessageBubble
              message={{
                id: 'streaming_current',
                role: 'assistant',
                content:
                  streamingContent ||
                  (streamingReasoning
                    ? ''
                    : streamingTools.length > 0
                    ? ''
                    : messages.some((m) => m.approvalRequest && (!m.approvalRequest.status || m.approvalRequest.status === 'pending'))
                    ? '⚠️ 正在等待人工安全审批授权，请在上方门禁卡片中确认或驳回...'
                    : '正在连接并调度 Agent 推理执行...'),
                reasoning: streamingReasoning || undefined,
                toolCalls: streamingTools,
              }}
              bot={activeBot}
              live
            />
          )}

          <div ref={chatBottomRef} />
        </div>

        {showScrollBottomBtn && (
          <button
            type="button"
            className="scroll-to-bottom-btn"
            onClick={handleScrollToBottomClick}
            title="回到底部最新消息"
          >
            <ArrowDown size={14} />
            <span>{hasNewUnseen ? '有新消息' : '回到底部'}</span>
            {hasNewUnseen && <span className="scroll-new-badge" />}
          </button>
        )}

        <ChatComposer
          onSendMessage={handleSendMessage}
          isStreaming={isStreaming}
          onStop={handleStop}
        />
      </section>

      {/* 右侧伴随式审计检查抽屉 */}
      <AuditDrawer
        isOpen={isAuditDrawerOpen}
        onClose={() => setIsAuditDrawerOpen(false)}
        activeSessionId={activeSessionId}
      />
    </div>
  );
};
