import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Paperclip,
  Slash,
  ArrowUp,
  Square,
  X,
  Image as ImageIcon,
  FileText,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  Check,
<<<<<<< HEAD
  Loader2,
=======
  Mic,
  MicOff,
  Cpu,
  ListPlus,
  Send,
  Pencil,
  Trash2,
  Reply,
  Clock,
  UploadCloud,
>>>>>>> d1461ec0b (feat(chat): widen layout, enrich markdown rendering, and upgrade chat UX)
} from 'lucide-react';
import type { MessageAttachment, Skill } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { CATEGORY_META } from '../skills/skillsMeta';
import { formatFileSize } from '../../utils/format';

type ApprovalModeValue = 'ASK' | 'AUTO_EDITS' | 'FULL';

export interface QueuedChatMessage {
  id: string;
  text: string;
  attachments: MessageAttachment[];
}

export interface QuoteDraft {
  text: string;
  sender: string;
}

const APPROVAL_MODE_OPTIONS: Array<{
  mode: ApprovalModeValue;
  key: 'ask' | 'auto' | 'full';
  label: string;
  desc: string;
  renderIcon: (size?: number) => React.ReactNode;
}> = [
  {
    mode: 'ASK',
    key: 'ask',
    label: '逐项确认',
    desc: '工具调用与敏感操作前逐项确认',
    renderIcon: (size = 14) => <Shield size={size} />,
  },
  {
    mode: 'AUTO_EDITS',
    key: 'auto',
    label: '自动编辑',
    desc: '自动放行常规读写，高危操作需确认',
    renderIcon: (size = 14) => <ShieldCheck size={size} />,
  },
  {
    mode: 'FULL',
    key: 'full',
    label: '允许完全访问',
    desc: '完全自主执行所有工具与命令',
    renderIcon: (size = 14) => <ShieldAlert size={size} />,
  },
];

interface ChatComposerProps {
  onSendMessage: (text: string, attachments: MessageAttachment[]) => void;
  isStreaming: boolean;
  onStop: () => void;
  queuedMessages?: QueuedChatMessage[];
  onEnqueueMessage?: (text: string, attachments: MessageAttachment[]) => void;
  onRemoveQueued?: (id: string) => void;
  onEditQueued?: (id: string) => QueuedChatMessage | undefined;
  onSendQueuedNow?: (id: string) => void;
  quoteDraft?: QuoteDraft | null;
  onClearQuote?: () => void;
  waitingSeconds?: number;
  sentHistory?: string[];
}

interface SlashMenuItem {
  id: string;
  kind: 'skill' | 'system';
  cmd: string;
  desc: string;
  badge: string;
  onSelect: () => void;
}

interface BrowserSpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => BrowserSpeechRecognition) | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  onSendMessage,
  isStreaming,
  onStop,
  queuedMessages = [],
  onEnqueueMessage,
  onRemoveQueued,
  onEditQueued,
  onSendQueuedNow,
  quoteDraft = null,
  onClearQuote,
  waitingSeconds = 0,
  sentHistory = [],
}) => {
  const {
    showToast,
    setTab,
    createNewSession,
    activeBot,
    setApprovalMode,
    tab,
    modelsConfig,
    loadModelsConfig,
    setIsModelModalOpen,
  } = useApp();
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isAttachPopoverOpen, setIsAttachPopoverOpen] = useState(false);
  const [isApprovalPopoverOpen, setIsApprovalPopoverOpen] = useState(false);
  const [isCommandsPopoverOpen, setIsCommandsPopoverOpen] = useState(false);
  const [isModelPopoverOpen, setIsModelPopoverOpen] = useState(false);
  const [botSkills, setBotSkills] = useState<Skill[]>([]);
  const [selectedSlashIdx, setSelectedSlashIdx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // 历史输入上下键回溯状态
  const historyIdxRef = useRef<number>(-1);
  const draftBeforeHistoryRef = useRef<string>('');
  const dragCounterRef = useRef<number>(0);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const dictationBaseRef = useRef<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);

  const speechSupported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  // 引用内容变化时自动聚焦输入框
  useEffect(() => {
    if (quoteDraft) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [quoteDraft]);

  // 加载当前数字员工已启用且就绪的技能规程，供 / 自动补全使用
  useEffect(() => {
    if (tab !== 'chat') return;
    let cancelled = false;
    api
      .getSkills({ botId: activeBot?.id, enabled: true })
      .then((res) => {
        if (cancelled) return;
        const readyList = (res.skills || []).filter(
          (s) => s.readiness?.ready !== false && s.usage?.lifecycleState !== 'archived'
        );
        setBotSkills(readyList);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeBot?.id, tab]);

  // 自动调节文本域高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputText]);

  // 接收跨页面草稿
  useEffect(() => {
    const draft = sessionStorage.getItem('museclaw_chat_draft');
    if (draft) {
      sessionStorage.removeItem('museclaw_chat_draft');
      setInputText(draft);
      textareaRef.current?.focus();
    }
    const handleDraftEvent = (e: CustomEvent<string>) => {
      if (e.detail) {
        setInputText(e.detail);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('museclaw:chat_draft' as any, handleDraftEvent);
    return () => window.removeEventListener('museclaw:chat_draft' as any, handleDraftEvent);
  }, []);

  // 点击外部或 Esc 关闭弹出菜单
  useEffect(() => {
    const closeAll = () => {
      setIsAttachPopoverOpen(false);
      setIsApprovalPopoverOpen(false);
      setIsCommandsPopoverOpen(false);
      setIsModelPopoverOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (composerWrapRef.current && !composerWrapRef.current.contains(e.target as Node)) {
        closeAll();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAll();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const buildOutboundText = (rawText: string): string => {
    const trimmed = rawText.trim();
    if (!quoteDraft) return trimmed || '请查看附件';
    const quotedLines = quoteDraft.text
      .split('\n')
      .slice(0, 6)
      .map((line) => `> ${line}`)
      .join('\n');
    const body = trimmed || '请针对以上引用内容进一步说明';
    return `${quotedLines}\n\n${body}`;
  };

  const resetComposerAfterSubmit = () => {
    setInputText('');
    setAttachments([]);
    onClearQuote?.();
    historyIdxRef.current = -1;
    draftBeforeHistoryRef.current = '';
    setIsAttachPopoverOpen(false);
    setIsApprovalPopoverOpen(false);
    setIsCommandsPopoverOpen(false);
    setIsModelPopoverOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed && attachments.length === 0) return;
    const finalText = buildOutboundText(trimmed);

    if (isStreaming) {
      if (onEnqueueMessage) {
        onEnqueueMessage(finalText, attachments);
        resetComposerAfterSubmit();
        showToast('已加入待发队列，当前轮次完成后将自动发送', 'info');
      }
      return;
    }

    onSendMessage(finalText, attachments);
    resetComposerAfterSubmit();
  };

  const slashCommands = useMemo(
    () => [
      { cmd: '/new', desc: '开一个新会话', action: () => createNewSession() },
      { cmd: '/feed', desc: '跳转查看智能体每日动态与简报', action: () => setTab('feed') },
      { cmd: '/goals', desc: '进入长周期自驱目标管理看板', action: () => setTab('goals') },
      { cmd: '/routines', desc: '进入定时任务与主动巡检工作台', action: () => setTab('routines') },
      { cmd: '/memory', desc: '查看并管理受控长期记忆库', action: () => setTab('memory') },
      { cmd: '/skills', desc: '进入技能规程库与依赖配置工作台', action: () => setTab('skills') },
    ],
    [createNewSession, setTab]
  );

  const rawApprovalMode = (activeBot?.approvalMode || 'ASK').toUpperCase();
  const currentApprovalOption =
    APPROVAL_MODE_OPTIONS.find((opt) => opt.mode === rawApprovalMode) || APPROVAL_MODE_OPTIONS[0];

  const activeProvider = useMemo(() => {
    if (!modelsConfig?.providers?.length) return null;
    return (
      modelsConfig.providers.find((p) => p.id === modelsConfig.activeProviderId) ||
      modelsConfig.providers[0]
    );
  }, [modelsConfig]);

  const currentModelDisplay = activeBot?.model || activeProvider?.model || activeProvider?.name || '未配置模型';

  const handleQuickSwitchModel = async (providerId: string, modelName: string) => {
    setIsModelPopoverOpen(false);
    try {
      await api.saveModelsConfig({
        activeProviderId: providerId,
        provider: { id: providerId, model: modelName },
      });
      await loadModelsConfig();
      showToast(`已切换模型为 ${modelName}`, 'success');
    } catch (err: any) {
      showToast(`切换模型失败: ${err?.message || err}`, 'error');
    }
  };

  const slashFilterQuery = useMemo(() => {
    const m = inputText.match(/^\/([^\s]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [inputText]);

  const slashMenuItems = useMemo<{ skills: SlashMenuItem[]; system: SlashMenuItem[]; flat: SlashMenuItem[] }>(() => {
    const q = slashFilterQuery ?? '';
    const matchedSkills: SlashMenuItem[] = botSkills
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
      .slice(0, 10)
      .map((s) => ({
        id: `skill:${s.name}`,
        kind: 'skill',
        cmd: `/${s.name}`,
        desc: s.description,
        badge: CATEGORY_META[s.category]?.label || s.category || '技能',
        onSelect: () => {
          setInputText(`/${s.name} `);
          setIsCommandsPopoverOpen(false);
          requestAnimationFrame(() => textareaRef.current?.focus());
        },
      }));

    const matchedSystem: SlashMenuItem[] = slashCommands
      .filter((c) => !q || c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q))
      .map((c) => ({
        id: `sys:${c.cmd}`,
        kind: 'system',
        cmd: c.cmd,
        desc: c.desc,
        badge: '指令',
        onSelect: () => {
          setIsCommandsPopoverOpen(false);
          if (slashFilterQuery !== null) setInputText('');
          c.action();
        },
      }));

    return {
      skills: matchedSkills,
      system: matchedSystem,
      flat: [...matchedSkills, ...matchedSystem],
    };
  }, [botSkills, slashCommands, slashFilterQuery]);

  useEffect(() => {
    setSelectedSlashIdx(0);
  }, [slashFilterQuery, isCommandsPopoverOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (isCommandsPopoverOpen && slashMenuItems.flat.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIdx((prev) => (prev + 1) % slashMenuItems.flat.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIdx((prev) => (prev - 1 + slashMenuItems.flat.length) % slashMenuItems.flat.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const chosen = slashMenuItems.flat[selectedSlashIdx] || slashMenuItems.flat[0];
        chosen?.onSelect();
        return;
      }
    }

    // 历史输入上下键回溯
    const el = textareaRef.current;
    if (!isCommandsPopoverOpen && sentHistory.length > 0 && el) {
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const atEnd = el.selectionStart === inputText.length && el.selectionEnd === inputText.length;
      if (e.key === 'ArrowUp' && (inputText === '' || (atStart && historyIdxRef.current >= 0))) {
        e.preventDefault();
        if (historyIdxRef.current === -1) {
          draftBeforeHistoryRef.current = inputText;
          historyIdxRef.current = sentHistory.length - 1;
        } else if (historyIdxRef.current > 0) {
          historyIdxRef.current -= 1;
        }
        setInputText(sentHistory[historyIdxRef.current] || '');
        return;
      }
      if (e.key === 'ArrowDown' && historyIdxRef.current >= 0 && atEnd) {
        e.preventDefault();
        if (historyIdxRef.current < sentHistory.length - 1) {
          historyIdxRef.current += 1;
          setInputText(sentHistory[historyIdxRef.current] || '');
        } else {
          historyIdxRef.current = -1;
          setInputText(draftBeforeHistoryRef.current);
        }
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
<<<<<<< HEAD
    setIsUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const uploadRes = await api.uploadFile(file);
          setAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              size: file.size,
              type: file.type.startsWith('image/') ? 'image' : 'file',
              url: uploadRes.url,
            },
          ]);
        } catch (err: any) {
          console.warn('File upload failed:', err?.message || err);
          showToast(`「${file.name}」上传失败：${err?.message || '请重试'}`, 'error');
        }
=======
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const uploadRes = await api.uploadFile(file);
        setAttachments((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            type: file.type.startsWith('image/') ? 'image' : 'file',
            url: uploadRes.url,
          },
        ]);
      } catch (err: any) {
        console.warn('File upload failed:', err?.message || err);
        showToast(`「${file.name}」上传失败：${err?.message || '请重试'}`, 'error');
>>>>>>> d1461ec0b (feat(chat): widen layout, enrich markdown rendering, and upgrade chat UX)
      }
    } finally {
      setIsUploading(false);
      setIsAttachPopoverOpen(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const filesToUpload: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) filesToUpload.push(file);
      }
    }
    if (filesToUpload.length > 0) {
      e.preventDefault();
      void handleFileUpload(filesToUpload);
    }
  };

  const toggleSpeech = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = document.documentElement.lang || navigator.language || 'zh-CN';
    rec.interimResults = true;
    rec.continuous = true;
    dictationBaseRef.current = inputText ? `${inputText.trimEnd()} ` : '';

    rec.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i]?.[0]?.transcript || '';
      }
      if (transcript.trim()) {
        setInputText(dictationBaseRef.current + transcript.trim());
      }
    };
    rec.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
      showToast('语音识别不可用或未授予麦克风权限', 'warning');
    };
    rec.onend = () => {
      if (recognitionRef.current === rec) {
        setIsListening(false);
        recognitionRef.current = null;
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  };

  const hasDraft = Boolean(inputText.trim() || attachments.length > 0);

  return (
    <div
      className={`chat-composer-wrap${isDragging ? ' drag-active' : ''}`}
      ref={composerWrapRef}
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        dragCounterRef.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) setIsDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragging(false);
        void handleFileUpload(e.dataTransfer.files);
      }}
    >
      {isDragging && (
        <div className="composer-drag-overlay" aria-hidden="true">
          <UploadCloud size={20} />
          <span>松开即可上传图片或上下文附件</span>
        </div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        className="hidden-file-input"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
      />
      <input
        type="file"
        ref={imageInputRef}
        className="hidden-file-input"
        accept="image/*"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
      />

<<<<<<< HEAD
      {/* Attachments Preview Bar */}
      {(attachments.length > 0 || isUploading) && (
=======
      {/* 首字等待安抚提示 */}
      {isStreaming && waitingSeconds >= 8 && (
        <div className="composer-wait-line" role="status">
          <Clock size={13} />
          <span>模型正在思考或排队响应中，已等待 {waitingSeconds}s</span>
          <button type="button" className="composer-wait-cancel" onClick={onStop}>
            取消本轮
          </button>
        </div>
      )}

      {/* 流式执行期待发队列 */}
      {queuedMessages.length > 0 && (
        <div className="composer-queue-bar" aria-label="待发送消息队列">
          <div className="composer-queue-header">
            <ListPlus size={13} />
            <span>待发送队列（{queuedMessages.length} 条，本轮完成后自动按序发出）</span>
          </div>
          <div className="composer-queue-list">
            {queuedMessages.map((item) => (
              <div key={item.id} className="composer-queue-item">
                <span className="composer-queue-text" title={item.text}>
                  {item.text}
                  {item.attachments.length > 0 ? ` [${item.attachments.length} 附件]` : ''}
                </span>
                <div className="composer-queue-actions">
                  {onSendQueuedNow && (
                    <button
                      type="button"
                      className="composer-queue-btn"
                      onClick={() => onSendQueuedNow(item.id)}
                      title="中断当前轮次并立即发送此条"
                    >
                      <Send size={11} />
                      <span>立即发送</span>
                    </button>
                  )}
                  {onEditQueued && (
                    <button
                      type="button"
                      className="composer-queue-btn"
                      onClick={() => {
                        const popped = onEditQueued(item.id);
                        if (popped) {
                          setInputText(popped.text);
                          if (popped.attachments.length > 0) {
                            setAttachments((prev) => [...prev, ...popped.attachments]);
                          }
                          requestAnimationFrame(() => textareaRef.current?.focus());
                        }
                      }}
                      title="回填到输入框继续编辑"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                  {onRemoveQueued && (
                    <button
                      type="button"
                      className="composer-queue-btn is-danger"
                      onClick={() => onRemoveQueued(item.id)}
                      title="移出队列"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 引用回复预览条 */}
      {quoteDraft && (
        <div className="composer-quote-bar">
          <Reply size={13} className="composer-quote-icon" />
          <div className="composer-quote-body">
            <span className="composer-quote-sender">引用 {quoteDraft.sender}：</span>
            <span className="composer-quote-text">{quoteDraft.text}</span>
          </div>
          {onClearQuote && (
            <button
              type="button"
              className="composer-quote-close"
              onClick={onClearQuote}
              aria-label="取消引用"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* 附件预览条 */}
      {attachments.length > 0 && (
>>>>>>> d1461ec0b (feat(chat): widen layout, enrich markdown rendering, and upgrade chat UX)
        <div className="composer-attachments-bar">
          {attachments.map((att, idx) => (
            <div
              key={idx}
<<<<<<< HEAD
              className={`composer-attachment-tag ${att.type === 'image' ? 'composer-attachment-image' : ''}`}
            >
              {att.type === 'image' && att.url ? (
                <img
                  src={att.url}
                  alt={att.name}
                  className="attachment-thumbnail"
                  onClick={() => window.open(att.url, '_blank')}
                  title="点击查看原图"
                />
              ) : (
                <span className="attachment-tag-icon">
                  <Paperclip size={12} />
                </span>
              )}
              <span className="attachment-tag-name" title={att.name}>{att.name}</span>
=======
              className={`composer-attachment-tag${att.type === 'image' ? ' composer-attachment-image' : ''}`}
            >
              {att.type === 'image' && att.url ? (
                <img src={att.url} alt={att.name} className="attachment-thumbnail" />
              ) : (
                <FileText size={13} className="attachment-tag-icon" />
              )}
              <span className="attachment-tag-name">{att.name}</span>
              {att.size ? <span className="attachment-tag-size">{formatFileSize(att.size)}</span> : null}
>>>>>>> d1461ec0b (feat(chat): widen layout, enrich markdown rendering, and upgrade chat UX)
              <button
                type="button"
                className="attachment-tag-remove"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                aria-label={`移除附件 ${att.name}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {isUploading && (
            <div className="composer-attachment-tag is-uploading">
              <Loader2 size={12} className="spin-icon" />
              <span className="attachment-tag-name">正在上传中...</span>
            </div>
          )}
        </div>
      )}

      <div className="composer-box">
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          placeholder={
            isStreaming
              ? 'Agent 正在回复，继续输入并按 Enter 可加入待发队列…'
              : '向数字员工下达指令（输入 / 唤起技能与指令，↑↓ 回溯历史，Enter 发送，Shift+Enter 换行）...'
          }
          rows={2}
          value={inputText}
          onChange={(e) => {
            const val = e.target.value;
            setInputText(val);
            if (/^\/[^\s]*$/.test(val)) {
              setIsCommandsPopoverOpen(true);
              setIsAttachPopoverOpen(false);
              setIsApprovalPopoverOpen(false);
              setIsModelPopoverOpen(false);
            } else {
              setIsCommandsPopoverOpen(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        <div className="composer-actions">
          <div className="composer-tools">
            {/* 附件按钮 */}
            <div className="composer-tool-group">
              <button
                type="button"
                className={`composer-tool-btn ${isAttachPopoverOpen ? 'active' : ''}`}
                title="添加图片或上下文附件（也支持拖拽文件到此区域）"
                aria-label="添加附件"
                aria-haspopup="dialog"
                aria-expanded={isAttachPopoverOpen}
                onClick={() => {
                  setIsAttachPopoverOpen((prev) => !prev);
                  setIsApprovalPopoverOpen(false);
                  setIsCommandsPopoverOpen(false);
                  setIsModelPopoverOpen(false);
                }}
              >
                <Paperclip size={15} />
                <span className="composer-tool-label">附件 / 图片</span>
              </button>

              {isAttachPopoverOpen && (
                <div className="composer-popover" role="dialog" aria-label="添加会话上下文">
                  <div className="composer-popover-header">添加会话上下文</div>
                  <button
                    type="button"
                    className="composer-popover-item"
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <span className="composer-popover-icon"><ImageIcon size={16} /></span>
                    <div className="composer-popover-text">
                      <span className="composer-popover-title">上传图片 / 截屏</span>
                      <span className="composer-popover-desc">支持 PNG、JPG、WebP 或直接 Ctrl+V 粘贴</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="composer-popover-item"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="composer-popover-icon"><FileText size={16} /></span>
                    <div className="composer-popover-text">
                      <span className="composer-popover-title">上传文档 / 代码</span>
                      <span className="composer-popover-desc">导入 Markdown、JSON、源码文件</span>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* 门禁审核模式选择器 */}
            <div className="composer-tool-group">
              <button
                type="button"
                className={`composer-tool-btn composer-approval-btn is-${currentApprovalOption.key} ${isApprovalPopoverOpen ? 'active' : ''}`}
                title={`门禁审核模式：${currentApprovalOption.label}`}
                aria-label="切换门禁审核模式"
                aria-haspopup="listbox"
                aria-expanded={isApprovalPopoverOpen}
                onClick={() => {
                  setIsApprovalPopoverOpen((prev) => !prev);
                  setIsAttachPopoverOpen(false);
                  setIsCommandsPopoverOpen(false);
                  setIsModelPopoverOpen(false);
                }}
              >
                {currentApprovalOption.renderIcon(14)}
                <span className="composer-tool-label">{currentApprovalOption.label}</span>
                <ChevronDown size={13} />
              </button>

              {isApprovalPopoverOpen && (
                <div
                  className="composer-popover composer-approval-popover"
                  role="listbox"
                  aria-label="选择门禁审核模式"
                >
                  <div className="composer-popover-header">门禁审核模式</div>
                  {APPROVAL_MODE_OPTIONS.map((opt) => {
                    const isSelected = opt.mode === currentApprovalOption.mode;
                    return (
                      <button
                        key={opt.mode}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`composer-approval-option is-${opt.key} ${isSelected ? 'is-active' : ''}`}
                        onClick={() => {
                          setIsApprovalPopoverOpen(false);
                          setApprovalMode(opt.mode);
                        }}
                      >
                        <span className="composer-approval-option-icon">
                          {opt.renderIcon(15)}
                        </span>
                        <div className="composer-popover-text">
                          <span className="composer-approval-option-title">{opt.label}</span>
                          <span className="composer-approval-option-desc">{opt.desc}</span>
                        </div>
                        {isSelected && (
                          <span className="composer-approval-check" aria-hidden="true">
                            <Check size={14} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 快捷模型切换器 */}
            <div className="composer-tool-group">
              <button
                type="button"
                className={`composer-tool-btn composer-model-btn${isModelPopoverOpen ? ' active' : ''}`}
                title={`当前模型：${currentModelDisplay}`}
                aria-label="快捷切换大模型"
                aria-haspopup="dialog"
                aria-expanded={isModelPopoverOpen}
                onClick={() => {
                  setIsModelPopoverOpen((prev) => !prev);
                  setIsAttachPopoverOpen(false);
                  setIsApprovalPopoverOpen(false);
                  setIsCommandsPopoverOpen(false);
                }}
              >
                <Cpu size={14} />
                <span className="composer-tool-label composer-model-name">{currentModelDisplay}</span>
                <ChevronDown size={13} />
              </button>

              {isModelPopoverOpen && (
                <div className="composer-popover composer-model-popover" role="dialog" aria-label="快捷切换模型">
                  <div className="composer-popover-header">切换当前对话模型</div>
                  <div className="composer-model-list">
                    {(modelsConfig?.providers || [])
                      .filter((p) => p.hasKey || p.isLocalAgent || p.id === modelsConfig?.activeProviderId)
                      .slice(0, 6)
                      .map((provider) => {
                        const candidates = Array.from(
                          new Set([provider.model, ...(provider.candidateModels || [])].filter(Boolean))
                        ).slice(0, 5) as string[];
                        const isActiveProvider = provider.id === modelsConfig?.activeProviderId;
                        return (
                          <div key={provider.id} className="composer-model-group">
                            <div className="composer-model-provider-title">{provider.name}</div>
                            {candidates.map((m) => {
                              const selected = isActiveProvider && (provider.model === m);
                              return (
                                <button
                                  key={`${provider.id}:${m}`}
                                  type="button"
                                  className={`composer-model-item${selected ? ' is-selected' : ''}`}
                                  onClick={() => handleQuickSwitchModel(provider.id, m)}
                                >
                                  <span className="composer-model-item-name">{m}</span>
                                  {selected && <Check size={13} />}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                  </div>
                  <button
                    type="button"
                    className="composer-model-settings-link"
                    onClick={() => {
                      setIsModelPopoverOpen(false);
                      setIsModelModalOpen(true);
                    }}
                  >
                    打开完整模型配置中心…
                  </button>
                </div>
              )}
            </div>

            {/* 快捷指令触发器 */}
            <div className="composer-tool-group">
              <button
                type="button"
                className={`composer-tool-btn ${isCommandsPopoverOpen ? 'active' : ''}`}
                title="智能体常用指令"
                aria-label="智能体常用指令"
                aria-haspopup="dialog"
                aria-expanded={isCommandsPopoverOpen}
                onClick={() => {
                  setIsCommandsPopoverOpen((prev) => !prev);
                  setIsAttachPopoverOpen(false);
                  setIsApprovalPopoverOpen(false);
                  setIsModelPopoverOpen(false);
                }}
              >
                <Slash size={15} />
                <span className="composer-tool-label">快捷指令</span>
              </button>

              {isCommandsPopoverOpen && (
                <div className="composer-popover composer-commands-popover" role="dialog" aria-label="快捷技能与指令列表">
                  {slashMenuItems.flat.length === 0 ? (
                    <div className="composer-commands-empty">未匹配到可用技能或系统指令</div>
                  ) : (
                    <>
                      {slashMenuItems.skills.length > 0 && (
                        <>
                          <div className="composer-popover-header">可用技能规程（Tab / Enter 补全）</div>
                          <div className="composer-commands-list">
                            {slashMenuItems.skills.map((item) => {
                              const idx = slashMenuItems.flat.findIndex((f) => f.id === item.id);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  className={`composer-command-item composer-skill-item${idx === selectedSlashIdx ? ' is-selected' : ''}`}
                                  onMouseEnter={() => setSelectedSlashIdx(idx)}
                                  onClick={item.onSelect}
                                >
                                  <div className="composer-command-main">
                                    <span className="composer-command-name">{item.cmd}</span>
                                    <span className="composer-command-desc">{item.desc}</span>
                                  </div>
                                  <span className="composer-command-badge">{item.badge}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}

                      {slashMenuItems.system.length > 0 && (
                        <>
                          <div className="composer-popover-header">工作台快捷指令</div>
                          <div className="composer-commands-list">
                            {slashMenuItems.system.map((item) => {
                              const idx = slashMenuItems.flat.findIndex((f) => f.id === item.id);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  className={`composer-command-item${idx === selectedSlashIdx ? ' is-selected' : ''}`}
                                  onMouseEnter={() => setSelectedSlashIdx(idx)}
                                  onClick={item.onSelect}
                                >
                                  <div className="composer-command-main">
                                    <span className="composer-command-name">{item.cmd}</span>
                                    <span className="composer-command-desc">{item.desc}</span>
                                  </div>
                                  <span className="composer-command-badge">{item.badge}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {speechSupported && (
              <button
                type="button"
                className={`composer-tool-btn composer-tool-btn-icon-only${isListening ? ' is-listening' : ''}`}
                title={isListening ? '停止语音输入' : '语音输入'}
                aria-label={isListening ? '停止语音输入' : '语音输入'}
                aria-pressed={isListening}
                onClick={toggleSpeech}
              >
                {isListening ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
            )}

            {inputText.length > 0 && (
              <button
                type="button"
                className="composer-tool-btn composer-tool-btn-icon-only"
                title="清空当前输入"
                onClick={() => setInputText('')}
              >
                <X size={14} />
              </button>
            )}

            <div className="composer-tool-divider" />

            <div className="composer-hotkey-hint">
              <span className="hotkey-pill"><kbd>Shift</kbd> + <kbd>↵</kbd> 换行</span>
            </div>
          </div>

          {/* 右侧发送 / 入队 / 停止按钮组 */}
          <div className="composer-submit-group">
            {isStreaming && hasDraft && onEnqueueMessage && (
              <button
                className="btn-enqueue"
                type="button"
                title="加入待发队列 (Enter)"
                aria-label="加入待发队列"
                onClick={handleSend}
              >
                <ListPlus size={15} />
              </button>
            )}

            {isStreaming ? (
              <button
                className="btn-send is-stop"
                type="button"
                title="停止本轮执行"
                aria-label="停止本轮执行"
                onClick={onStop}
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                className="btn-send"
                type="button"
                title="发送指令 (Enter)"
                disabled={!hasDraft}
                onClick={handleSend}
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="composer-footer-disclaimer">
        <span className="disclaimer-dot" />
        <span>MuseClaw 数字员工运行于受控微沙箱 · 重要系统指令与配置变更将触发门禁审批</span>
      </div>
    </div>
  );
};
