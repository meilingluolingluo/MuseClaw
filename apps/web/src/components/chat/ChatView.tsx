import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { MessageBubble } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { AgentCapsule } from './AgentCapsule';
import { ArrowDown, Clock, Target, Brain, Calendar, ShieldCheck, AlertCircle, RotateCcw, Home, MessageSquare, Plus } from 'lucide-react';
import type { Message, MessageAttachment, AvatarMood, WidgetPayload } from '../../types';
import { api } from '../../services/api';

export const ChatView: React.FC = () => {
  const {
    activeSessionId,
    activeSession,
    isMainChat,
    switchToMainChat,
    createNewSideChat,
    activeBot,
    showToast,
    setTainted,
    createNewSession,
    loadSessions,
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
  const [streamingWidgets, setStreamingWidgets] = useState<WidgetPayload[]>([]);
  const [botMood, setBotMood] = useState<AvatarMood>('idle');

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
      setStreamingWidgets([]);
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

  const handleSendMessage = async (
    text: string,
    attachments: MessageAttachment[] = [],
    options?: { hidden?: boolean }
  ) => {
    const isHiddenTurn = Boolean(options?.hidden);
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

    if (!isHiddenTurn) {
      const userMessage: Message = {
        id: `usr_${Date.now()}`,
        role: 'user',
        content: text,
        attachments,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
    }
    setIsStreaming(true);
    setBotMood('working');
    setStreamingContent('');
    setStreamingReasoning('');
    setStreamingTools([]);
    setStreamingWidgets([]);
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
          ...(isHiddenTurn ? { hidden: true } : {}),
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
      const widgetsAccumulator: WidgetPayload[] = [];

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
              setBotMood('error');
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
            } else if (event.type === 'ui:widget' && event.widget) {
              const existingIdx = widgetsAccumulator.findIndex((w) => w.id === event.widget.id);
              if (existingIdx >= 0) {
                widgetsAccumulator[existingIdx] = event.widget;
              } else {
                widgetsAccumulator.push(event.widget);
              }
              if (activeSessionIdRef.current === targetSessionId) {
                setStreamingWidgets([...widgetsAccumulator]);
              }
            } else if (event.type === 'sentinel:taint_updated') {
              setTainted(event.isTainted, event.reason);
            } else if (event.type === 'sentinel:approval_needed') {
              hasApprovalNeeded = true;
              setBotMood('waiting');
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
            } else if (event.type === 'avatar') {
              if (activeSessionIdRef.current === targetSessionId) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `avatar_${event.event?.id || Date.now()}`,
                    role: 'assistant',
                    content: '',
                    avatarEvent: event.event,
                    timestamp: Date.now(),
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

      if (accumulatedText.trim() || accumulatedReasoning.trim() || widgetsAccumulator.length > 0) {
        const assistantMsg: Message = {
          id: `asst_${Date.now()}`,
          role: 'assistant',
          content: accumulatedText.trim() || (widgetsAccumulator.length > 0 ? '' : '（Agent 执行完成）'),
          reasoning: accumulatedReasoning || undefined,
          toolCalls: toolsAccumulator.length > 0 ? toolsAccumulator : undefined,
          widgets: widgetsAccumulator.length > 0 ? widgetsAccumulator : undefined,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setBotMood('happy');
        setTimeout(() => setBotMood('idle'), 2500);
      } else if (!hasApprovalNeeded) {
        setBotMood('idle');
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
        setStreamingWidgets([]);
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

  const handleWidgetPrompt = useCallback(
    (prompt: string, opts?: { hidden?: boolean }) => {
      if (isStreaming) {
        showToast('当前智能体仍在响应中，请稍后再试', 'info');
        return;
      }
      handleSendMessage(prompt, [], opts);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isStreaming, activeSessionId, activeBot?.id]
  );

  const visibleMessages = messages.filter((msg) => !msg.hidden);
  const displayedMessages =
    visibleMessages.length > visibleCount
      ? visibleMessages.slice(visibleMessages.length - visibleCount)
      : visibleMessages;

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
            mood={botMood}
            onClick={() => setIsBotModalOpen(true)}
          />

          {/* 主聊 / 旁聊模式指示器与分支切换入口 */}
          <div className="chat-thread-bar">
            {isMainChat ? (
              <div className="chat-thread-pill is-main" title="当前位于常驻核心主聊，持续沉淀会话记忆">
                <Home size={11} />
                <span>主聊</span>
              </div>
            ) : (
              <div className="chat-thread-pill is-side" title="当前位于独立副任务旁聊，不干扰主会话上下文">
                <MessageSquare size={11} />
                <span>旁聊</span>
                <span className="chat-thread-title-inline">{activeSession?.title || '临时任务'}</span>
              </div>
            )}

            {!isMainChat ? (
              <button
                type="button"
                className="btn-thread-switch"
                onClick={switchToMainChat}
                title="一键切回主要常驻主聊"
              >
                <Home size={11} />
                <span>切回主聊</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-thread-switch"
                onClick={() => createNewSideChat()}
                title="开启一个独立副任务旁聊，不污染当前主聊"
              >
                <Plus size={11} />
                <span>开启旁聊</span>
              </button>
            )}
          </div>
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
            <div className="chat-load-error-state" role="alert">
              <AlertCircle size={32} className="chat-load-error-icon" />
              <h3 className="chat-load-error-title">会话历史加载失败</h3>
              <p className="chat-load-error-desc">{sessionLoadError}</p>
              <button
                type="button"
                className="btn-secondary chat-load-error-retry"
                onClick={retryLoadSession}
              >
                <RotateCcw size={13} /> 重新加载
              </button>
            </div>
          ) : visibleMessages.length === 0 && !isStreaming ? (
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
              {visibleMessages.length > visibleCount && (
                <div className="chat-history-load-more">
                  <button type="button" onClick={handleLoadMoreHistory}>
                    <Clock size={12} />
                    查看更早的历史记录（还有 {visibleMessages.length - visibleCount} 条）
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
                  onWidgetPrompt={handleWidgetPrompt}
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
                  (streamingReasoning || streamingTools.length > 0 || streamingWidgets.length > 0
                    ? ''
                    : messages.some((m) => m.approvalRequest && (!m.approvalRequest.status || m.approvalRequest.status === 'pending'))
                    ? '⚠️ 正在等待人工安全审批授权，请在上方门禁卡片中确认或驳回...'
                    : '正在连接并调度 Agent 推理执行...'),
                reasoning: streamingReasoning || undefined,
                toolCalls: streamingTools,
                widgets: streamingWidgets.length > 0 ? streamingWidgets : undefined,
              }}
              bot={activeBot}
              onWidgetPrompt={handleWidgetPrompt}
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
    </div>
  );
};
