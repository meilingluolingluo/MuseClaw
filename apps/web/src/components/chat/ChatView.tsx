import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { MessageBubble } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { AuditDrawer } from '../audit/AuditDrawer';
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
  } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [streamingTools, setStreamingTools] = useState<any[]>([]);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 切换会话：先清空再拉取，并丢弃过期响应（避免快速切换时串话）
  useEffect(() => {
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
        if (cancelled) return;
        setMessages(Array.isArray(res) ? res : []);
        setTimeout(scrollToBottom, 50);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load messages:', err);
        showToast(`会话记录载入失败：${err.message}`, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoadingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, showToast]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, streamingReasoning]);

  const handleSendMessage = async (text: string, attachments: MessageAttachment[]) => {
    // 第一条消息不该先让用户「去新建会话」：没有会话就静默开一个
    let sessionId = activeSessionId;
    if (!sessionId) {
      const created = await createNewSession(true);
      sessionId = created?.id ?? null;
      if (!sessionId) {
        showToast('还没有可用的数字员工，请检查 gateway 配置', 'warning');
        return;
      }
    }

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
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const line = block.trim();
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'stream:text-delta') {
              accumulatedText += event.text;
              setStreamingContent(accumulatedText);
            } else if (event.type === 'stream:reasoning-delta') {
              accumulatedReasoning += event.text;
              setStreamingReasoning(accumulatedReasoning);
            } else if (event.type === 'agent:error') {
              const errSnippet = event.text || `\n[执行出错: ${event.error || '未知异常'}]`;
              accumulatedText += errSnippet;
              setStreamingContent(accumulatedText);
              showToast(`执行出错: ${event.error || '未知异常'}`, 'error');
            } else if (event.type === 'tool:call_start') {
              toolsAccumulator.push({
                tool: event.toolName,
                params: event.input,
                status: 'running',
              });
              setStreamingTools([...toolsAccumulator]);
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
              setStreamingTools([...toolsAccumulator]);
            } else if (event.type === 'sentinel:taint_updated') {
              setTainted(event.isTainted, event.reason);
            } else if (event.type === 'sentinel:approval_needed') {
              // Add approval request item to messages
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
          } catch (e) {
            console.warn('Failed to parse SSE line:', e);
          }
        }
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
      abortRef.current = null;
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingReasoning('');
      setStreamingTools([]);
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
        <div className="chat-history">
          {loadingSession ? (
            <div className="chat-loading" role="status" aria-live="polite">
              <span className="chat-loading-dot" />
              正在载入会话记录…
            </div>
          ) : messages.length === 0 && !isStreaming ? (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', margin: 'auto', padding: '40px' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '56px',
                  height: '56px',
                  borderRadius: '18px',
                  background: 'var(--om-surface)',
                  border: '1px solid var(--om-border)',
                  boxShadow: '0 4px 14px color-mix(in srgb, var(--om-accent) 12%, transparent)',
                  marginBottom: '16px',
                }}
              >
                <ClawLogo size={28} color="var(--om-accent)" />
              </div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-muted)' }}>随时为您服务</div>
              <div style={{ fontSize: '13px', marginTop: '6px' }}>
                输入指令即可调遣数字员工执行任务、自动分析或沉淀工件
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
