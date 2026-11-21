import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { MessageBubble } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { AuditDrawer } from '../audit/AuditDrawer';
import { AgentCapsule } from './AgentCapsule';
import { ClawLogo } from '../../utils/icons';
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
  const abortRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const currentStreamingSessionIdRef = useRef<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [streamingTools, setStreamingTools] = useState<any[]>([]);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

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
      setLoadingSession(false);
      return;
    }
    let cancelled = false;
    setMessages([]);
    setLoadingSession(true);
    api
      .getMessages(activeSessionId)
      .then((res) => {
        if (cancelled || activeSessionIdRef.current !== activeSessionId) return;
        setMessages(Array.isArray(res) ? res : []);
        setTimeout(scrollToBottom, 50);
      })
      .catch((err) => {
        if (cancelled || activeSessionIdRef.current !== activeSessionId) return;
        console.error('Failed to load messages:', err);
        showToast(`会话记录载入失败：${err.message}`, 'error');
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

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, streamingReasoning]);

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
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (activeSessionIdRef.current !== targetSessionId) break;
          const line = block.trim();
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'stream:text-delta') {
              accumulatedText += event.text;
              if (activeSessionIdRef.current === targetSessionId) {
                setStreamingContent(accumulatedText);
              }
            } else if (event.type === 'stream:reasoning-delta') {
              accumulatedReasoning += event.text;
              if (activeSessionIdRef.current === targetSessionId) {
                setStreamingReasoning(accumulatedReasoning);
              }
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
      } else {
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
        setMessages((prev) => [
          ...prev,
          {
            id: `stop_${Date.now()}`,
            role: 'assistant',
            content: partial ? `${partial}\n\n（已停止这一轮）` : '（已停止这一轮）',
            timestamp: Date.now(),
          },
        ]);
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
      if (activeBot?.id) loadSessions(activeBot.id);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

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

        <div className="chat-history">
          {loadingSession ? (
            <div className="chat-loading" role="status" aria-live="polite">
              <span className="chat-loading-dot" />
              正在载入会话记录…
            </div>
          ) : messages.length === 0 && !isStreaming ? (
            <div className="chat-empty-state">
              <div className="chat-empty-greeting">
                你好，我是 {activeBot?.name || '数字员工'}
              </div>
              <div className="chat-empty-desc">
                我具备长期记忆、多维度目标自主推进及安全沙箱工具执行能力，随时为您效劳。
              </div>
              <div className="chat-empty-starters">
                <button
                  type="button"
                  className="chat-starter-btn"
                  onClick={() => handleSendMessage('帮我梳理并规划长周期目标')}
                >
                  🎯 帮我梳理并规划长周期目标
                </button>
                <button
                  type="button"
                  className="chat-starter-btn"
                  onClick={() => handleSendMessage('查询并记录我常用的工作习惯与偏好')}
                >
                  🧠 记录我的长期工作偏好
                </button>
                <button
                  type="button"
                  className="chat-starter-btn"
                  onClick={() => handleSendMessage('查询明天从北京到上海的高铁车次与票价')}
                >
                  🚄 查询高铁车次与票价
                </button>
                <button
                  type="button"
                  className="chat-starter-btn"
                  onClick={() => handleSendMessage('在 Bubblewrap 原生安全沙箱中执行系统自检')}
                >
                  🛡️ 沙箱环境系统健康检查
                </button>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <MessageBubble
                key={msg.id || `${msg.role}-${idx}`}
                message={msg}
                bot={activeBot}
                sessionId={activeSessionId || undefined}
              />
            ))
          )}

          {/* Real-time Streaming Placeholder */}
          {isStreaming && (
            <MessageBubble
              message={{
                id: 'streaming_current',
                role: 'assistant',
                content: streamingContent || (streamingReasoning ? '' : (streamingTools.length > 0 ? '' : '正在连接并调度 Agent 推理执行...')),
                reasoning: streamingReasoning || undefined,
                toolCalls: streamingTools,
              }}
              bot={activeBot}
              live
            />
          )}

          <div ref={chatBottomRef} />
        </div>

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
