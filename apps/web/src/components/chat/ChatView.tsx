import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { MessageBubble } from './MessageBubble';
import { ChatComposer, type QueuedChatMessage, type QuoteDraft } from './ChatComposer';
import { AgentCapsule } from './AgentCapsule';
import { TimelineRail, type TimelineEntry } from './TimelineRail';
import { ChatFindBar } from './ChatFindBar';
import { ImageLightbox, type LightboxPayload } from './ImageLightbox';
import {
  ArrowDown,
  Clock,
  Target,
  Brain,
  Calendar,
  ShieldCheck,
  AlertCircle,
  RotateCcw,
  Home,
  MessageSquare,
  Plus,
  Search,
  Download,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import type { Message, MessageAttachment, AvatarMood, WidgetPayload } from '../../types';
import { api } from '../../services/api';
import { formatDayLabel, getDayKey } from '../../utils/format';

export const ChatView: React.FC = () => {
  const {
    activeSessionId,
    activeSession,
    isMainChat,
    switchToMainChat,
    createNewSideChat,
    clearSession,
    sessionClearedTick,
    activeBot,
    showToast,
    setTainted,
    createNewSession,
    loadSessions,
    setIsBotModalOpen,
    selectSession,
    tab,
  } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const currentStreamingSessionIdRef = useRef<string | null>(null);
  const abortedByUserRef = useRef<boolean>(false);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [streamingTools, setStreamingTools] = useState<any[]>([]);
  const [streamingWidgets, setStreamingWidgets] = useState<WidgetPayload[]>([]);
  const [botMood, setBotMood] = useState<AvatarMood>('idle');

  // 计时、引用、待发队列、灯箱、搜索与时间轴状态
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [liveReasoningSeconds, setLiveReasoningSeconds] = useState(0);
  const turnStartRef = useRef<number>(0);
  const firstTokenReceivedRef = useRef<boolean>(false);
  const reasoningStartRef = useRef<number | null>(null);
  const reasoningEndRef = useRef<number | null>(null);

  const [queuedMessages, setQueuedMessages] = useState<QueuedChatMessage[]>([]);
  const queuedMessagesRef = useRef<QueuedChatMessage[]>([]);
  useEffect(() => {
    queuedMessagesRef.current = queuedMessages;
  }, [queuedMessages]);
  const pendingImmediateSendRef = useRef<QueuedChatMessage | null>(null);

  const [quoteDraft, setQuoteDraft] = useState<QuoteDraft | null>(null);
  const [lightboxPayload, setLightboxPayload] = useState<LightboxPayload | null>(null);

  // 会话内搜索
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [isThreadMoreOpen, setIsThreadMoreOpen] = useState(false);
  const threadMoreRef = useRef<HTMLDivElement>(null);
  const clearedAbortRef = useRef<boolean>(false);

  // 时间轴高亮楼层
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const isInitialSwitchRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [hasNewUnseen, setHasNewUnseen] = useState(false);

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

  // 流式等待计时与思考秒表
  useEffect(() => {
    if (!isStreaming) {
      setWaitingSeconds(0);
      setLiveReasoningSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      const now = Date.now();
      if (!firstTokenReceivedRef.current && turnStartRef.current > 0) {
        setWaitingSeconds(Math.max(0, Math.floor((now - turnStartRef.current) / 1000)));
      } else {
        setWaitingSeconds(0);
      }
      if (reasoningStartRef.current !== null && reasoningEndRef.current === null) {
        setLiveReasoningSeconds(Math.max(0, Math.floor((now - reasoningStartRef.current) / 1000)));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isStreaming]);

  // 响应全局清空会话事件（主聊清空后保持同 ID 立即刷新）
  useEffect(() => {
    if (sessionClearedTick === 0) return;
    if (abortRef.current) {
      clearedAbortRef.current = true;
      abortedByUserRef.current = true;
      abortRef.current.abort();
      abortRef.current = null;
    }
    currentStreamingSessionIdRef.current = null;
    pendingImmediateSendRef.current = null;
    setMessages([]);
    setQueuedMessages([]);
    setQuoteDraft(null);
    setIsStreaming(false);
    setStreamingContent('');
    setStreamingReasoning('');
    setStreamingTools([]);
    setStreamingWidgets([]);
    setBotMood('idle');
    setIsFindOpen(false);
    setFindQuery('');
    setConfirmClear(false);
    setIsThreadMoreOpen(false);
    setActiveTimelineId(null);
  }, [sessionClearedTick]);

  // 点击外部或 Esc 关闭顶部「更多」菜单
  useEffect(() => {
    if (!isThreadMoreOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (threadMoreRef.current && !threadMoreRef.current.contains(e.target as Node)) {
        setIsThreadMoreOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsThreadMoreOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [isThreadMoreOpen]);

  // 全局 Ctrl/Cmd + F 唤起会话内搜索
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (tab !== 'chat') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsFindOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tab]);

  const updateActiveTimelineFromScroll = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const rows = container.querySelectorAll<HTMLElement>('[data-message-role="user"][data-message-id]');
    if (rows.length === 0) {
      setActiveTimelineId(null);
      return;
    }
    const containerTop = container.getBoundingClientRect().top;
    let currentId: string | null = rows[0].dataset.messageId || null;
    for (const row of rows) {
      const top = row.getBoundingClientRect().top - containerTop;
      if (top <= 140) {
        currentId = row.dataset.messageId || currentId;
      } else {
        break;
      }
    }
    setActiveTimelineId(currentId);
  }, []);

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
    updateActiveTimelineFromScroll();
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

  // 切换会话时重置队列、搜索与流状态
  useEffect(() => {
    if (currentStreamingSessionIdRef.current && currentStreamingSessionIdRef.current !== activeSessionId) {
      abortedByUserRef.current = true;
      abortRef.current?.abort();
      abortRef.current = null;
      currentStreamingSessionIdRef.current = null;
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingReasoning('');
      setStreamingTools([]);
      setStreamingWidgets([]);
    }

    setQueuedMessages([]);
    pendingImmediateSendRef.current = null;
    setQuoteDraft(null);
    setIsFindOpen(false);
    setFindQuery('');
    setActiveTimelineId(null);

    if (!activeSessionId) {
      setMessages([]);
      setVisibleCount(PAGE_SIZE);
      setLoadingSession(false);
      setSessionLoadError(null);
      return;
    }

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
        const rawList = Array.isArray(res) ? res : [];
        const msgList = rawList.map((m: Message, idx: number) => ({
          ...m,
          id: m.id || `hist_${idx}_${m.timestamp || 0}`,
        }));
        setMessages(msgList);
        setSessionLoadError(null);
        setVisibleCount(PAGE_SIZE);

        requestAnimationFrame(() => {
          if (cancelled || activeSessionIdRef.current !== activeSessionId) return;
          scrollToBottom('auto');
          setTimeout(() => {
            if (!cancelled && activeSessionIdRef.current === activeSessionId) {
              scrollToBottom('auto');
              isInitialSwitchRef.current = false;
              isAtBottomRef.current = true;
              setShowScrollBottomBtn(false);
              updateActiveTimelineFromScroll();
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
  }, [activeSessionId, showToast, updateActiveTimelineFromScroll]);

  const retryLoadSession = () => {
    if (!activeSessionId) return;
    setLoadingSession(true);
    setSessionLoadError(null);
    api
      .getMessages(activeSessionId)
      .then((res) => {
        const rawList = Array.isArray(res) ? res : [];
        setMessages(rawList.map((m: Message, idx: number) => ({ ...m, id: m.id || `hist_${idx}` })));
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

  useEffect(() => {
    if (isInitialSwitchRef.current) return;

    if (isAtBottomRef.current) {
      if (isStreaming) {
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
    abortedByUserRef.current = false;

    const nowStart = Date.now();
    turnStartRef.current = nowStart;
    firstTokenReceivedRef.current = false;
    reasoningStartRef.current = null;
    reasoningEndRef.current = null;

    if (!isHiddenTurn) {
      const userMessage: Message = {
        id: `usr_${nowStart}`,
        role: 'user',
        content: text,
        attachments,
        timestamp: nowStart,
      };
      setMessages((prev) => [...prev, userMessage]);
    }
    setIsStreaming(true);
    setBotMood('working');
    setStreamingContent('');
    setStreamingReasoning('');
    setStreamingTools([]);
    setStreamingWidgets([]);
    setWaitingSeconds(0);
    setLiveReasoningSeconds(0);
    isAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
    setHasNewUnseen(false);
    setTimeout(() => scrollToBottom('smooth'), 20);

    const controller = new AbortController();
    abortRef.current = controller;
    let accumulatedText = '';
    let turnModel = '';
    let serverTurnMeta: {
      assistantMsgId?: string;
      durationMs?: number;
      reasoningDurationMs?: number;
      model?: string;
    } | null = null;

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

            if (event.type === 'session:init') {
              if (event.model) turnModel = String(event.model);
            } else if (event.type === 'turn:meta') {
              serverTurnMeta = {
                assistantMsgId: event.assistantMsgId,
                durationMs: event.durationMs,
                reasoningDurationMs: event.reasoningDurationMs,
                model: event.model,
              };
            } else if (event.type === 'stream:text-delta') {
              firstTokenReceivedRef.current = true;
              if (reasoningStartRef.current !== null && reasoningEndRef.current === null) {
                reasoningEndRef.current = Date.now();
              }
              accumulatedText += event.text;
              scheduleStreamingUpdate();
            } else if (event.type === 'stream:reasoning-delta') {
              firstTokenReceivedRef.current = true;
              if (reasoningStartRef.current === null) {
                reasoningStartRef.current = Date.now();
              }
              accumulatedReasoning += event.text;
              scheduleStreamingUpdate();
            } else if (event.type === 'agent:error') {
              firstTokenReceivedRef.current = true;
              setBotMood('error');
              const errSnippet = event.text || `\n[执行出错: ${event.error || '未知异常'}]`;
              accumulatedText += errSnippet;
              if (activeSessionIdRef.current === targetSessionId) {
                setStreamingContent(accumulatedText);
                showToast(`执行出错: ${event.error || '未知异常'}`, 'error');
              }
            } else if (event.type === 'tool:call_start') {
              firstTokenReceivedRef.current = true;
              toolsAccumulator.push({
                tool: event.toolName,
                params: event.input,
                status: 'running',
                startedAt: Date.now(),
              });
              if (activeSessionIdRef.current === targetSessionId) {
                setStreamingTools([...toolsAccumulator]);
              }
            } else if (event.type === 'tool:call_end') {
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
              firstTokenReceivedRef.current = true;
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
              firstTokenReceivedRef.current = true;
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
              firstTokenReceivedRef.current = true;
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

      const endTs = Date.now();
      const localDurationMs = Math.max(0, endTs - turnStartRef.current);
      const localReasoningMs =
        reasoningStartRef.current !== null
          ? Math.max(0, (reasoningEndRef.current ?? endTs) - reasoningStartRef.current)
          : undefined;

      if (accumulatedText.trim() || accumulatedReasoning.trim() || widgetsAccumulator.length > 0 || toolsAccumulator.length > 0) {
        const assistantMsg: Message = {
          id: serverTurnMeta?.assistantMsgId || `asst_${endTs}`,
          role: 'assistant',
          content: accumulatedText.trim() || (widgetsAccumulator.length > 0 ? '' : '（Agent 执行完成）'),
          reasoning: accumulatedReasoning || undefined,
          toolCalls: toolsAccumulator.length > 0 ? toolsAccumulator : undefined,
          widgets: widgetsAccumulator.length > 0 ? widgetsAccumulator : undefined,
          timestamp: endTs,
          durationMs: serverTurnMeta?.durationMs ?? localDurationMs,
          reasoningDurationMs: serverTurnMeta?.reasoningDurationMs ?? localReasoningMs,
          model: serverTurnMeta?.model || turnModel || undefined,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setBotMood('happy');
        setTimeout(() => setBotMood('idle'), 2500);
      } else if (!hasApprovalNeeded) {
        setBotMood('idle');
        const fallbackMsg: Message = {
          id: `asst_${endTs}`,
          role: 'assistant',
          content: '⚠️ Agent 未返回任何输出，请检查所选大模型或计算节点连通状态。',
          timestamp: endTs,
        };
        setMessages((prev) => [...prev, fallbackMsg]);
      }
    } catch (err: any) {
      if (activeSessionIdRef.current !== targetSessionId) {
        return;
      }
      if (err?.name === 'AbortError') {
        if (clearedAbortRef.current) {
          clearedAbortRef.current = false;
          return;
        }
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
      if (activeBot?.id) loadSessions(activeBot.id, targetSessionId);
    }
  };

  // 流式结束后优先发送中断插入消息，否则自动消费待发队列
  useEffect(() => {
    if (isStreaming) return;
    const immediate = pendingImmediateSendRef.current;
    if (immediate) {
      pendingImmediateSendRef.current = null;
      const timer = setTimeout(() => {
        void handleSendMessage(immediate.text, immediate.attachments);
      }, 40);
      return () => clearTimeout(timer);
    }
    if (!abortedByUserRef.current && queuedMessagesRef.current.length > 0) {
      const [next, ...rest] = queuedMessagesRef.current;
      setQueuedMessages(rest);
      const timer = setTimeout(() => {
        void handleSendMessage(next.text, next.attachments);
      }, 60);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const handleStop = () => {
    abortedByUserRef.current = true;
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

  const handleEnqueueMessage = useCallback((text: string, attachments: MessageAttachment[]) => {
    setQueuedMessages((prev) => [
      ...prev,
      { id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text, attachments },
    ]);
  }, []);

  const handleRemoveQueued = useCallback((id: string) => {
    setQueuedMessages((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleEditQueued = useCallback((id: string) => {
    const found = queuedMessagesRef.current.find((item) => item.id === id);
    if (found) {
      setQueuedMessages((prev) => prev.filter((item) => item.id !== id));
    }
    return found;
  }, []);

  const handleSendQueuedNow = useCallback((id: string) => {
    const found = queuedMessagesRef.current.find((item) => item.id === id);
    if (!found) return;
    setQueuedMessages((prev) => prev.filter((item) => item.id !== id));
    pendingImmediateSendRef.current = found;
    abortedByUserRef.current = true;
    abortRef.current?.abort();
  }, []);

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

  const handleQuote = useCallback(
    (msg: Message, selectedText?: string) => {
      const raw = (selectedText || msg.content || '').trim();
      if (!raw) return;
      const clipped = raw.length > 240 ? `${raw.slice(0, 240).trimEnd()}…` : raw;
      setQuoteDraft({
        text: clipped,
        sender: msg.role === 'user' ? '我' : activeBot?.name || '数字员工',
      });
    },
    [activeBot?.name]
  );

  const handleRegenerate = useCallback(
    async (msgIdx: number) => {
      if (isStreaming || !activeSessionId) return;
      let userIdx = -1;
      for (let i = msgIdx - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user' && !messages[i]?.hidden) {
          userIdx = i;
          break;
        }
      }
      if (userIdx < 0) {
        showToast('未找到可重新生成的上一条提问', 'warning');
        return;
      }
      const targetUserMsg = messages[userIdx];
      try {
        await api.truncateSession(activeSessionId, userIdx);
      } catch (err: any) {
        showToast(`截断会话历史失败: ${err?.message || err}`, 'error');
        return;
      }
      setMessages((prev) => prev.slice(0, userIdx));
      void handleSendMessage(targetUserMsg.content || '', targetUserMsg.attachments || []);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isStreaming, activeSessionId, messages, showToast]
  );

  const handleEditResend = useCallback(
    async (msgIdx: number, newText: string) => {
      if (isStreaming || !activeSessionId) return;
      const targetMsg = messages[msgIdx];
      if (!targetMsg || targetMsg.role !== 'user') return;
      try {
        await api.truncateSession(activeSessionId, msgIdx);
      } catch (err: any) {
        showToast(`截断会话历史失败: ${err?.message || err}`, 'error');
        return;
      }
      setMessages((prev) => prev.slice(0, msgIdx));
      void handleSendMessage(newText, targetMsg.attachments || []);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isStreaming, activeSessionId, messages, showToast]
  );

  const handleForkSideChat = useCallback(
    async (msgIdx: number) => {
      if (isStreaming || !activeSessionId || !activeBot?.id) return;
      const baseTitle = activeSession?.title && activeSession.title !== '主要聊天'
        ? activeSession.title
        : '主聊';
      try {
        const forked = await api.forkSession(activeSessionId, msgIdx, `${baseTitle} · 分支`);
        await loadSessions(activeBot.id, forked.id);
        selectSession(forked.id);
        showToast('已从此处开启独立旁聊分支', 'success');
      } catch (err: any) {
        showToast(`开启旁聊分支失败: ${err?.message || err}`, 'error');
      }
    },
    [isStreaming, activeSessionId, activeBot?.id, activeSession?.title, loadSessions, selectSession, showToast]
  );

  const handleClearCurrentChat = useCallback(async () => {
    if (messages.length === 0 && !isStreaming) {
      showToast('当前对话已是空的', 'info');
      setConfirmClear(false);
      return;
    }
    if (isStreaming && abortRef.current) {
      clearedAbortRef.current = true;
      abortedByUserRef.current = true;
      abortRef.current.abort();
      abortRef.current = null;
    }
    setConfirmClear(false);
    await clearSession(activeSessionId || undefined);
  }, [activeSessionId, clearSession, isStreaming, messages.length, showToast]);

  const handleClearButtonClick = () => {
    if (confirmClear) {
      void handleClearCurrentChat();
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
    }
  };

  const handleNewChat = useCallback(async () => {
    if (isStreaming && abortRef.current) {
      abortedByUserRef.current = true;
      abortRef.current.abort();
      abortRef.current = null;
    }
    await createNewSideChat('新对话');
  }, [createNewSideChat, isStreaming]);

  const handleExportSession = () => {
    const cleanList = messages.filter((m) => !m.hidden);
    if (cleanList.length === 0) {
      showToast('当前会话暂无可导出的消息', 'info');
      return;
    }
    const title = activeSession?.title || '对话记录';
    const lines = [`# ${title}`, `> 智能体：${activeBot?.name || '数字员工'}`, ''];
    for (const msg of cleanList) {
      const who = msg.role === 'user' ? '我' : activeBot?.name || '数字员工';
      lines.push(`## ${who}`);
      if (msg.content) lines.push(msg.content);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('已导出对话 Markdown 文件', 'success');
  };

  // 构建可见消息及其在完整 messages 数组中的真实索引
  const indexedVisibleMessages = useMemo(() => {
    const list: Array<{ msg: Message; realIndex: number }> = [];
    messages.forEach((msg, realIndex) => {
      if (!msg.hidden) {
        list.push({ msg, realIndex });
      }
    });
    return list;
  }, [messages]);

  const displayedMessages = useMemo(() => {
    if (indexedVisibleMessages.length > visibleCount) {
      return indexedVisibleMessages.slice(indexedVisibleMessages.length - visibleCount);
    }
    return indexedVisibleMessages;
  }, [indexedVisibleMessages, visibleCount]);

  // 用户历史输入（供输入框 ↑↓ 回溯）
  const sentHistory = useMemo(
    () =>
      indexedVisibleMessages
        .filter(({ msg }) => msg.role === 'user' && msg.content.trim())
        .map(({ msg }) => msg.content),
    [indexedVisibleMessages]
  );

  // 时间轴节点（仅展示当前视图中的用户提问）
  const timelineEntries: TimelineEntry[] = useMemo(
    () =>
      displayedMessages
        .filter(({ msg }) => msg.role === 'user' && msg.id)
        .map(({ msg }) => ({
          id: msg.id,
          preview: (msg.content || '附件消息').replace(/\s+/g, ' ').slice(0, 48),
          timestamp: msg.timestamp,
        })),
    [displayedMessages]
  );

  useEffect(() => {
    if (timelineEntries.length === 0) {
      setActiveTimelineId(null);
      return;
    }
    const raf = requestAnimationFrame(() => updateActiveTimelineFromScroll());
    return () => cancelAnimationFrame(raf);
  }, [timelineEntries, updateActiveTimelineFromScroll]);

  const jumpToMessageId = useCallback((id: string) => {
    const container = chatContainerRef.current;
    if (!container) return;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
    const el = container.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('is-jump-highlight');
    setTimeout(() => el.classList.remove('is-jump-highlight'), 1400);
  }, []);

  // 会话内搜索匹配逻辑
  const matchedMessageIds = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return [];
    return indexedVisibleMessages
      .filter(({ msg }) => (msg.content || '').toLowerCase().includes(q))
      .map(({ msg }) => msg.id);
  }, [findQuery, indexedVisibleMessages]);

  const matchedIdSet = useMemo(() => new Set(matchedMessageIds), [matchedMessageIds]);
  const activeMatchId = matchedMessageIds[activeMatchIdx] || null;

  useEffect(() => {
    setActiveMatchIdx(0);
  }, [findQuery]);

  useEffect(() => {
    if (!isFindOpen || !activeMatchId) return;
    // 若匹配消息位于未展开的早期分页中，自动扩充可见范围
    const idxInVisible = indexedVisibleMessages.findIndex(({ msg }) => msg.id === activeMatchId);
    if (idxInVisible >= 0 && indexedVisibleMessages.length - idxInVisible > visibleCount) {
      setVisibleCount(indexedVisibleMessages.length - idxInVisible + 5);
      setTimeout(() => jumpToMessageId(activeMatchId), 60);
    } else {
      jumpToMessageId(activeMatchId);
    }
  }, [activeMatchId, indexedVisibleMessages, isFindOpen, jumpToMessageId, visibleCount]);

  return (
    <div className="chat-stage-wrapper">
      <section className="chat-container">
        {/* 顶部悬浮居中智能体头像与渐变遮罩 */}
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
                onClick={() => void handleNewChat()}
                title="开启一个全新独立对话（旁聊），不污染主聊上下文"
              >
                <Plus size={11} />
                <span>新对话</span>
              </button>
            )}

            {indexedVisibleMessages.length > 0 && (
              <>
                <button
                  type="button"
                  className={`btn-thread-switch btn-thread-clear${confirmClear ? ' is-confirming' : ''}`}
                  onClick={handleClearButtonClick}
                  title={confirmClear ? '再次点击确认清空当前对话记录' : '清空当前对话记录（保留长期记忆）'}
                >
                  <Trash2 size={11} />
                  <span>{confirmClear ? '确认清空?' : '清空'}</span>
                </button>

                <div className="chat-thread-more-wrap" ref={threadMoreRef}>
                  <button
                    type="button"
                    className={`btn-thread-switch btn-thread-icon${isThreadMoreOpen ? ' is-active' : ''}`}
                    onClick={() => setIsThreadMoreOpen((v) => !v)}
                    title="更多会话操作"
                    aria-label="更多会话操作"
                    aria-expanded={isThreadMoreOpen}
                  >
                    <MoreHorizontal size={12} />
                  </button>
                  {isThreadMoreOpen && (
                    <div className="chat-thread-more-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-thread-more-item"
                        onClick={() => {
                          setIsThreadMoreOpen(false);
                          setIsFindOpen((v) => !v);
                        }}
                      >
                        <Search size={13} />
                        <span>搜索当前对话 (Ctrl+F)</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-thread-more-item"
                        onClick={() => {
                          setIsThreadMoreOpen(false);
                          handleExportSession();
                        }}
                      >
                        <Download size={13} />
                        <span>导出为 Markdown</span>
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <ChatFindBar
          isOpen={isFindOpen}
          query={findQuery}
          onQueryChange={setFindQuery}
          matchCount={matchedMessageIds.length}
          activeMatchIdx={activeMatchIdx}
          onPrev={() =>
            setActiveMatchIdx((prev) =>
              matchedMessageIds.length === 0
                ? 0
                : (prev - 1 + matchedMessageIds.length) % matchedMessageIds.length
            )
          }
          onNext={() =>
            setActiveMatchIdx((prev) =>
              matchedMessageIds.length === 0 ? 0 : (prev + 1) % matchedMessageIds.length
            )
          }
          onClose={() => {
            setIsFindOpen(false);
            setFindQuery('');
          }}
        />

        <div className="chat-history" ref={chatContainerRef} onScroll={handleScroll}>
          <div className="chat-history-inner">
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
          ) : indexedVisibleMessages.length === 0 && !isStreaming ? (
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
              {indexedVisibleMessages.length > visibleCount && (
                <div className="chat-history-load-more">
                  <button type="button" onClick={handleLoadMoreHistory}>
                    <Clock size={12} />
                    查看更早的历史记录（还有 {indexedVisibleMessages.length - visibleCount} 条）
                  </button>
                </div>
              )}
              {displayedMessages.map(({ msg, realIndex }, idx) => {
                const prevMsg = idx > 0 ? displayedMessages[idx - 1].msg : null;
                const dayKey = getDayKey(msg.timestamp);
                const prevDayKey = getDayKey(prevMsg?.timestamp);
                const showDaySeparator = Boolean(dayKey && dayKey !== prevDayKey);

                return (
                  <React.Fragment key={msg.id || `${msg.role}-${realIndex}`}>
                    {showDaySeparator && (
                      <div className="chat-day-separator">
                        <span>{formatDayLabel(msg.timestamp)}</span>
                      </div>
                    )}
                    <MessageBubble
                      message={msg}
                      messageIndex={realIndex}
                      bot={activeBot}
                      sessionId={activeSessionId || undefined}
                      isBusy={isStreaming}
                      isSearchMatch={matchedIdSet.has(msg.id)}
                      isSearchActive={activeMatchId === msg.id}
                      onApprovalResolved={handleApprovalResolved}
                      onWidgetPrompt={handleWidgetPrompt}
                      onQuote={handleQuote}
                      onRegenerate={handleRegenerate}
                      onEditResend={handleEditResend}
                      onForkSideChat={handleForkSideChat}
                      onOpenLightbox={setLightboxPayload}
                    />
                  </React.Fragment>
                );
              })}
            </>
          )}

          {/* 实时流式输出占位 */}
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
              isBusy
              liveReasoningSeconds={liveReasoningSeconds}
              onWidgetPrompt={handleWidgetPrompt}
              onOpenLightbox={setLightboxPayload}
              live
            />
          )}

          <div ref={chatBottomRef} />
          </div>
        </div>

        <TimelineRail
          entries={timelineEntries}
          activeId={activeTimelineId}
          onJump={jumpToMessageId}
        />

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
          queuedMessages={queuedMessages}
          onEnqueueMessage={handleEnqueueMessage}
          onRemoveQueued={handleRemoveQueued}
          onEditQueued={handleEditQueued}
          onSendQueuedNow={handleSendQueuedNow}
          quoteDraft={quoteDraft}
          onClearQuote={() => setQuoteDraft(null)}
          waitingSeconds={waitingSeconds}
          sentHistory={sentHistory}
          onClearChat={() => void handleClearCurrentChat()}
          onNewChat={() => void handleNewChat()}
          onOpenFind={() => setIsFindOpen(true)}
          onExportChat={handleExportSession}
          hasMessages={indexedVisibleMessages.length > 0}
        />

        <ImageLightbox
          payload={lightboxPayload}
          onClose={() => setLightboxPayload(null)}
        />
      </section>
    </div>
  );
};
