import React, { useState, useEffect } from 'react';
import { Brain, Edit3, Undo2, Sparkles } from 'lucide-react';
import type { MemoryItem, MemoryReport } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { renderMarkdown } from '../../utils/markdown';

export const MemoryView: React.FC = () => {
  const { activeBot, showToast } = useApp();
  const [content, setContent] = useState('');
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [reports, setReports] = useState<MemoryReport[]>([]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [isConsolidating, setIsConsolidating] = useState(false);

  const loadMemory = async () => {
    if (!activeBot) return;
    try {
      const data = await api.getMemory(activeBot.id);
      setContent(data.content || '');
      setItems(Array.isArray(data.items) ? data.items : []);
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (err) {
      console.error('Failed to load memory:', err);
    }
  };

  useEffect(() => {
    loadMemory();
  }, [activeBot?.id]);

  const handleSaveEdit = async () => {
    if (!activeBot) return;
    try {
      await api.updateMemory(activeBot.id, editBuffer);
      setContent(editBuffer);
      setIsEditModalOpen(false);
      showToast('记忆文件 MEMORY.md 已更新', 'success');
      loadMemory();
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    }
  };

  const handleConsolidate = async (dryRun: boolean) => {
    if (!activeBot) return;
    setIsConsolidating(true);
    showToast(dryRun ? '正在预检自整理...' : '正在正式精炼整理...', 'info');
    try {
      const res = await api.consolidateMemory(activeBot.id, dryRun);
      showToast(res.summary || '整理完毕', 'success');
      loadMemory();
    } catch (err: any) {
      showToast(`整理异常: ${err.message}`, 'error');
    } finally {
      setIsConsolidating(false);
    }
  };

  const handleUndo = async () => {
    if (!activeBot) return;
    if (!confirm('确定撤销上一次的记忆整理变动吗？')) return;
    try {
      await api.undoMemory(activeBot.id);
      showToast('已撤销上一次整理变更', 'success');
      loadMemory();
    } catch (err: any) {
      showToast(`撤销失败: ${err.message}`, 'error');
    }
  };

  return (
    <section className="view-stage">
      <div className="view-header">
        <div>
          <div className="view-heading">
            <Brain size={18} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }} />
            受控长期记忆库 (Memory)
            <span style={{ color: 'var(--om-accent)', fontWeight: 600, marginLeft: '6px' }}>
              {activeBot ? `[${activeBot.name}]` : ''}
            </span>
          </div>
          <div className="view-sub">结构化 MEMORY.md 事实存储，[user] 声明严格受守卫保护，支持预算精简与一键 Undo 撤销</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0, whiteSpace: 'nowrap' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setEditBuffer(content);
              setIsEditModalOpen(true);
            }}
            style={{ whiteSpace: 'nowrap' }}
          >
            <Edit3 size={14} /> 编辑记忆
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleUndo}
            style={{ whiteSpace: 'nowrap' }}
          >
            <Undo2 size={14} /> 一键撤销 (Undo)
          </button>
        </div>
      </div>

      <div className="memory-layout" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
        <div className="memory-items-box" style={{ background: 'var(--om-surface)', border: '1px solid var(--om-border)', borderRadius: '12px', padding: '18px' }}>
          <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '12px' }}>
            常驻记忆事实 (MEMORY.md)
          </div>
          {content ? (
            <div
              className="memory-markdown-body"
              style={{ fontSize: '13px', lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          ) : (
            <div style={{ color: 'var(--text-dim)', fontSize: '13px', padding: '24px 0', textAlign: 'center' }}>
              暂无已沉淀的长期记忆条目
            </div>
          )}
        </div>

        <div className="memory-control-panel" style={{ background: 'var(--om-surface)', border: '1px solid var(--om-border)', borderRadius: '12px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontWeight: 600, fontSize: '14px' }}>记忆受控自整理 (Consolidation)</div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
            采用确定性准则与预算保护：严禁捏造新事实，严禁删除用户声明，单次预算上限 20%。
          </p>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleConsolidate(true)}
              disabled={isConsolidating}
              style={{ flex: 1 }}
            >
              整理预检 (Dry-Run)
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleConsolidate(false)}
              disabled={isConsolidating}
              style={{ flex: 1 }}
            >
              <Sparkles size={14} /> 执行精炼
            </button>
          </div>

          <div style={{ marginTop: '12px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>最近整理审计记录</span>
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-dim)' }}>
              {reports.length === 0 ? (
                '暂无整理记录'
              ) : (
                reports.map((rep) => (
                  <div key={rep.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--om-border)' }}>
                    <div>{rep.summary}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="编辑受控长期记忆 (MEMORY.md)"
        icon={<Brain size={18} />}
        maxWidth="720px"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={() => setIsEditModalOpen(false)}>取消</button>
            <button type="button" className="btn-primary" onClick={handleSaveEdit}>保存记忆</button>
          </div>
        }
      >
        <div>
          <textarea
            className="form-control"
            rows={16}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '12.5px', lineHeight: 1.5 }}
            value={editBuffer}
            onChange={(e) => setEditBuffer(e.target.value)}
          />
        </div>
      </Modal>
    </section>
  );
};
