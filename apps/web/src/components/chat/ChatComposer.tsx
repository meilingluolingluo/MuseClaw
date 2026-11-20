import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Slash, ArrowUp, Square, X, Image as ImageIcon, FileText, Package } from 'lucide-react';
import type { MessageAttachment } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

interface ChatComposerProps {
  onSendMessage: (text: string, attachments: MessageAttachment[]) => void;
  isStreaming: boolean;
  onStop: () => void;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  onSendMessage,
  isStreaming,
  onStop,
}) => {
  const { showToast, setTab, createNewSession } = useApp();
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isAttachPopoverOpen, setIsAttachPopoverOpen] = useState(false);
  const [isCommandsPopoverOpen, setIsCommandsPopoverOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputText]);

  // Handle outside clicks to close popovers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (composerWrapRef.current && !composerWrapRef.current.contains(e.target as Node)) {
        setIsAttachPopoverOpen(false);
        setIsCommandsPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if ((!trimmed && attachments.length === 0) || isStreaming) return;
    // 只发附件时也要给 Agent 一句话上下文
    onSendMessage(trimmed || '请查看附件', attachments);
    setInputText('');
    setAttachments([]);
    setIsAttachPopoverOpen(false);
    setIsCommandsPopoverOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文/日文输入法用 Enter 确认候选词，不能当成发送
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
        console.error('File upload error:', err);
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

  const slashCommands = [
    { cmd: '/new', desc: '开一个新会话', action: () => createNewSession() },
    { cmd: '/feed', desc: '跳转查看智能体每日动态与简报', action: () => setTab('feed') },
    { cmd: '/goals', desc: '进入长周期自驱目标管理看板', action: () => setTab('goals') },
    { cmd: '/routines', desc: '进入定时任务与主动巡检工作台', action: () => setTab('routines') },
    { cmd: '/memory', desc: '查看并管理受控长期记忆库', action: () => setTab('memory') },
  ];

  return (
    <div className="chat-composer-wrap" ref={composerWrapRef}>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
      />
      <input
        type="file"
        ref={imageInputRef}
        style={{ display: 'none' }}
        accept="image/*"
        multiple
        onChange={(e) => handleFileUpload(e.target.files)}
      />

      {/* Attachments Preview Bar */}
      {attachments.length > 0 && (
        <div className="composer-attachments-bar" style={{ display: 'flex', gap: '8px', padding: '8px 12px' }}>
          {attachments.map((att, idx) => (
            <div key={idx} className="composer-attachment-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span className="attachment-tag-name">{att.name}</span>
              <button
                type="button"
                className="attachment-tag-remove"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
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
          placeholder="向数字员工下达指令（输入 / 快速唤起常用指令，Enter 发送，Shift+Enter 换行）..."
          rows={2}
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            if (e.target.value === '/') {
              setIsCommandsPopoverOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        <div className="composer-actions">
          <div className="composer-tools">
            {/* Attachment Popover Trigger */}
            <div className="composer-tool-group" style={{ position: 'relative' }}>
              <button
                type="button"
                className={`composer-tool-btn ${isAttachPopoverOpen ? 'active' : ''}`}
                title="添加图片或上下文附件"
                onClick={() => {
                  setIsAttachPopoverOpen((prev) => !prev);
                  setIsCommandsPopoverOpen(false);
                }}
              >
                <Paperclip size={15} />
                <span className="composer-tool-label">附件 / 图片</span>
              </button>

              {isAttachPopoverOpen && (
                <div className="composer-popover" style={{ display: 'flex', flexDirection: 'column' }}>
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

            {/* Quick Slash Commands Trigger */}
            <div className="composer-tool-group" style={{ position: 'relative' }}>
              <button
                type="button"
                className={`composer-tool-btn ${isCommandsPopoverOpen ? 'active' : ''}`}
                title="智能体常用指令"
                onClick={() => {
                  setIsCommandsPopoverOpen((prev) => !prev);
                  setIsAttachPopoverOpen(false);
                }}
              >
                <Slash size={15} />
                <span className="composer-tool-label">快捷指令</span>
              </button>

              {isCommandsPopoverOpen && (
                <div className="composer-popover composer-commands-popover" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="composer-popover-header">智能体常用指令</div>
                  <div className="composer-commands-list">
                    {slashCommands.map((item) => (
                      <div
                        key={item.cmd}
                        className="composer-command-item"
                        onClick={() => {
                          setIsCommandsPopoverOpen(false);
                          item.action();
                        }}
                        style={{ cursor: 'pointer', padding: '6px 8px' }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--om-accent)' }}>{item.cmd}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                          {item.desc}
                        </span>
                      </div>
                    ))}
                  </div>
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
