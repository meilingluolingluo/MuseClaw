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
} from 'lucide-react';
import type { MessageAttachment, Skill } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { CATEGORY_META } from '../skills/skillsMeta';

type ApprovalModeValue = 'ASK' | 'AUTO_EDITS' | 'FULL';

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
}

interface SlashMenuItem {
  id: string;
  kind: 'skill' | 'system';
  cmd: string;
  desc: string;
  badge: string;
  onSelect: () => void;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  onSendMessage,
  isStreaming,
  onStop,
}) => {
  const { showToast, setTab, createNewSession, activeBot, setApprovalMode, tab } = useApp();
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isAttachPopoverOpen, setIsAttachPopoverOpen] = useState(false);
  const [isApprovalPopoverOpen, setIsApprovalPopoverOpen] = useState(false);
  const [isCommandsPopoverOpen, setIsCommandsPopoverOpen] = useState(false);
  const [botSkills, setBotSkills] = useState<Skill[]>([]);
  const [selectedSlashIdx, setSelectedSlashIdx] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);

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

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputText]);

  // Check for chat draft from other views (e.g. Goals)
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

  // Handle outside clicks and ESC key to close popovers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (composerWrapRef.current && !composerWrapRef.current.contains(e.target as Node)) {
        setIsAttachPopoverOpen(false);
        setIsApprovalPopoverOpen(false);
        setIsCommandsPopoverOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAttachPopoverOpen(false);
        setIsApprovalPopoverOpen(false);
        setIsCommandsPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if ((!trimmed && attachments.length === 0) || isStreaming) return;
    // 只发附件时也要给 Agent 一句话上下文
    onSendMessage(trimmed || '请查看附件', attachments);
    setInputText('');
    setAttachments([]);
    setIsAttachPopoverOpen(false);
    setIsApprovalPopoverOpen(false);
    setIsCommandsPopoverOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
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
    // 中文/日文输入法用 Enter 确认候选词，不能当成发送
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

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
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
        // 失败已经用 toast 告诉用户了，控制台只留一条 warning 便于排查
        console.warn('File upload failed:', err?.message || err);
        showToast(`「${file.name}」上传失败：${err?.message || '请重试'}`, 'error');
      }
    }
    setIsAttachPopoverOpen(false);
  };

  // Clipboard paste support for images
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFileUpload([file] as any);
        }
      }
    }
  };

  return (
    <div className="chat-composer-wrap" ref={composerWrapRef}>
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

      {/* Attachments Preview Bar */}
      {attachments.length > 0 && (
        <div className="composer-attachments-bar">
          {attachments.map((att, idx) => (
            <div key={idx} className="composer-attachment-tag">
              <span className="attachment-tag-name">{att.name}</span>
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
        </div>
      )}

      <div className="composer-box">
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          placeholder="向数字员工下达指令（输入 / 快速唤起技能与指令，Enter 发送，Shift+Enter 换行）..."
          rows={2}
          value={inputText}
          onChange={(e) => {
            const val = e.target.value;
            setInputText(val);
            if (/^\/[^\s]*$/.test(val)) {
              setIsCommandsPopoverOpen(true);
              setIsAttachPopoverOpen(false);
              setIsApprovalPopoverOpen(false);
            } else {
              setIsCommandsPopoverOpen(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        <div className="composer-actions">
          <div className="composer-tools">
            {/* Attachment Popover Trigger */}
            <div className="composer-tool-group">
              <button
                type="button"
                className={`composer-tool-btn ${isAttachPopoverOpen ? 'active' : ''}`}
                title="添加图片或上下文附件"
                aria-label="添加附件"
                aria-haspopup="dialog"
                aria-expanded={isAttachPopoverOpen}
                onClick={() => {
                  setIsAttachPopoverOpen((prev) => !prev);
                  setIsApprovalPopoverOpen(false);
                  setIsCommandsPopoverOpen(false);
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
                      <span className="composer-popover-desc">支持 PNG、JPG、WebP</span>
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

            {/* Gatekeeper Approval Mode Selector */}
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

            {/* Quick Slash Commands Trigger */}
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

          {/* 执行中显示停止，空闲时显示发送 */}
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
              disabled={!inputText.trim() && attachments.length === 0}
              onClick={handleSend}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="composer-footer-disclaimer">
        <span className="disclaimer-dot" />
        <span>MuseClaw 数字员工运行于受控微沙箱 · 重要系统指令与配置变更将触发门禁审批</span>
      </div>
    </div>
  );
};
