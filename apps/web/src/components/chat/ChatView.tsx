import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { MessageBubble } from './MessageBubble';
import { ChatComposer } from './ChatComposer';
import { ClawLogo } from '../../utils/icons';
import type { Message, MessageAttachment } from '../../types';
import { api } from '../../services/api';

export const ChatView: React.FC = () => {
  const { activeSessionId, activeBot, showToast, setTainted } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [streamingTools, setStreamingTools] = useState<any[]>([]);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load message history on active session change
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    api
      .getMessages(activeSessionId)
      .then((res) => {
        setMessages(Array.isArray(res) ? res : []);
        setTimeout(scrollToBottom, 50);
      })
      .catch((err) => {
        console.error('Failed to load messages:', err);
      });
  }, [activeSessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, streamingReasoning]);

  const handleSendMessage = async (text: string, attachments: MessageAttachment[]) => {
    if (!activeSessionId) {
      showToast('请先选择或新建一个会话', 'warning');
      return;
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

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: text,
          text,
          message: text,
          session_id: activeSessionId,
          sessionId: activeSessionId,
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
      let accumulatedText = '';
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
                status: '调用中...',
              });
              setStreamingTools([...toolsAccumulator]);
            } else if (event.type === 'tool:call_end') {
              const last = toolsAccumulator.find((t) => t.tool === event.toolName);
              if (last) last.status = `完成 (${event.durationMs || 0}ms)`;
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
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingReasoning('');
      setStreamingTools([]);
    }
  };

  return (
    <section className="chat-container">
      <div className="chat-history">
        {messages.length === 0 && !isStreaming ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', margin: 'auto', padding: '40px' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '56px',
                height: '56px',
                borderRadius: '18px',
                background: '#ffffff',
                border: '1px solid var(--om-border)',
                boxShadow: '0 4px 14px rgba(0, 100, 212, 0.1)',
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
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
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
              content: streamingContent || (streamingReasoning ? '' : '正在连接并调度 Agent 推理执行...'),
              reasoning: streamingReasoning || undefined,
              toolCalls: streamingTools,
            }}
            bot={activeBot}
          />
        )}

        <div ref={chatBottomRef} />
      </div>

      <ChatComposer
        onSendMessage={handleSendMessage}
        isStreaming={isStreaming}
        onClearMessages={() => setMessages([])}
      />
    </section>
  );
};
