import React, { useState, useEffect } from 'react';
import { Target, Plus, CheckCircle2, PauseCircle, PlayCircle, Trash2, ArrowRight } from 'lucide-react';
import type { Goal } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';

export const GoalsView: React.FC = () => {
  const { showToast } = useApp();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const loadGoals = async () => {
    try {
      const data = await api.getGoals();
      setGoals(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load goals:', err);
    }
  };

  useEffect(() => {
    loadGoals();
  }, []);

  const handleCreateGoal = async () => {
    if (!newTitle.trim()) {
      showToast('先给目标起个名字，再立项', 'warning');
      document.getElementById('goal-title-input')?.focus();
      return;
    }
    try {
      const g = await api.createGoal({
        title: newTitle.trim(),
        description: newDesc.trim(),
        status: 'active',
        progress: 0,
      });
      setGoals((prev) => [g, ...prev]);
      setIsCreateModalOpen(false);
      setNewTitle('');
      setNewDesc('');
      showToast('新自驱目标已立项', 'success');
    } catch (err: any) {
      showToast(`立项失败: ${err.message}`, 'error');
    }
  };

  const handleToggleStatus = async (goal: Goal) => {
    const nextStatus = goal.status === 'active' ? 'paused' : 'active';
    try {
      await api.updateGoal(goal.id, { status: nextStatus });
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, status: nextStatus } : g)));
      showToast(`目标状态已更新为 ${nextStatus === 'active' ? '推进中' : '已暂停'}`, 'info');
    } catch (err: any) {
      showToast(`更新失败: ${err.message}`, 'error');
    }
  };

  const handleDeleteGoal = async (id: string) => {
    if (!confirm('确定删除此自驱目标吗？')) return;
    try {
      await api.deleteGoal(id);
      setGoals((prev) => prev.filter((g) => g.id !== id));
      showToast('目标已移除', 'success');
    } catch (err: any) {
      showToast(`删除失败: ${err.message}`, 'error');
    }
  };

  return (
    <section className="view-stage">
      <div className="view-header">
        <div>
          <div className="view-heading">
            <Target size={18} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }} />
            长周期自驱目标 (Goals)
          </div>
          <div className="view-sub">跨天/周持久化目标，支持定时 Check-in 自主向前推演；受阻时向人类提出计划修订提案 (Proposal)</div>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setIsCreateModalOpen(true)}
        >
          <Plus size={14} /> 规划新目标
        </button>
      </div>

      <div className="goals-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
        {goals.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px 16px', color: 'var(--text-dim)' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎯</div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-muted)' }}>暂无长周期目标</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>点击上方“规划新目标”，让智能体具备跨会话自主驱动能力。</div>
          </div>
        ) : (
          goals.map((goal) => (
            <div
              key={goal.id}
              className="goal-card"
              style={{
                background: 'var(--om-surface)',
                border: '1px solid var(--om-border)',
                borderRadius: '12px',
                padding: '18px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span className={`pill-badge ${goal.status === 'active' ? 'pill-green' : 'pill-amber'}`} style={{ fontSize: '11px' }}>
                    {goal.status === 'active' ? '推进中' : goal.status === 'completed' ? '已完成' : '已暂停'}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(goal)}
                      title={goal.status === 'active' ? '暂停目标' : '恢复目标'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                    >
                      {goal.status === 'active' ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteGoal(goal.id)}
                      title="删除目标"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 600 }}>{goal.title}</h4>
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  {goal.description || '暂无详细描述'}
                </p>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  <span>达成进度</span>
                  <span>{goal.progress || 0}%</span>
                </div>
                <div style={{ height: '6px', background: 'var(--om-surface-2)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${goal.progress || 0}%`,
                      background: 'var(--om-accent)',
                      borderRadius: '3px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="规划新的自驱目标 (Goal)"
        icon={<Target size={18} />}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={() => setIsCreateModalOpen(false)}>取消</button>
            <button type="button" className="btn-primary" onClick={handleCreateGoal} disabled={!newTitle.trim()}>立项并保存</button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label htmlFor="goal-title-input" style={{ fontSize: '12.5px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>目标名称</label>
            <input
              id="goal-title-input"
              type="text"
              className="form-control"
              placeholder="例如：每日清晨自动汇总研发集群日志并生成周报"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label htmlFor="goal-desc-input" style={{ fontSize: '12.5px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>详细指标与推演规范</label>
            <textarea
              id="goal-desc-input"
              className="form-control"
              rows={4}
              placeholder="描述目标的期望产出、检查准则与涉及的模块..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </Modal>
    </section>
  );
};
