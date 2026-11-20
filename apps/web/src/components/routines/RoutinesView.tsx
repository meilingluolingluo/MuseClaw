import React, { useState, useEffect } from 'react';
import { Clock, Plus, Play, Trash2, Power, Search, CheckCircle, XCircle } from 'lucide-react';
import type { Routine, RoutineRun } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { formatTime } from '../../utils/format';

export const RoutinesView: React.FC = () => {
  const { bots, showToast } = useApp();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [activeRoutineId, setActiveRoutineId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRunningNow, setIsRunningNow] = useState(false);

  // Create routine modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [prompt, setPrompt] = useState('');
  const [targetBotId, setTargetBotId] = useState('');

  const loadRoutines = async () => {
    try {
      const data = await api.getRoutines();
      const list = Array.isArray(data) ? data : [];
      setRoutines(list);
      if (list.length > 0 && !activeRoutineId) {
        setActiveRoutineId(list[0].id);
      }
    } catch (err) {
      console.error('Failed to load routines:', err);
    }
  };

  const loadRuns = async (rId: string) => {
    try {
      const runList = await api.getRoutineRuns(rId);
      setRuns(Array.isArray(runList) ? runList : []);
    } catch (err) {
      console.error('Failed to load runs:', err);
    }
  };

  useEffect(() => {
    loadRoutines();
  }, []);

  useEffect(() => {
    if (activeRoutineId) {
      loadRuns(activeRoutineId);
    }
  }, [activeRoutineId]);

  const activeRoutine = routines.find((r) => r.id === activeRoutineId) || null;

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) return;
    try {
      const created = await api.createRoutine({
        name: name.trim(),
        cron: cron.trim(),
        prompt: prompt.trim(),
        targetBotId: targetBotId || (bots[0] ? bots[0].id : 'default'),
        enabled: true,
      });
      setRoutines((prev) => [...prev, created]);
      setActiveRoutineId(created.id);
      setIsCreateOpen(false);
      setName('');
      setPrompt('');
      showToast('新建定时任务成功', 'success');
    } catch (err: any) {
      showToast(`创建失败: ${err.message}`, 'error');
    }
  };

  const handleToggleEnable = async (r: Routine) => {
    try {
      const nextEnabled = !r.enabled;
      await api.updateRoutine(r.id, { enabled: nextEnabled });
      setRoutines((prev) => prev.map((item) => (item.id === r.id ? { ...item, enabled: nextEnabled } : item)));
      showToast(`任务已${nextEnabled ? '启用' : '暂停'}`, 'info');
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该定时任务吗？')) return;
    try {
      await api.deleteRoutine(id);
      const remaining = routines.filter((r) => r.id !== id);
      setRoutines(remaining);
      if (activeRoutineId === id) {
        setActiveRoutineId(remaining.length > 0 ? remaining[0].id : null);
      }
      showToast('定时任务已删除', 'success');
    } catch (err: any) {
      showToast(`删除失败: ${err.message}`, 'error');
    }
  };

  const handleRunNow = async () => {
    if (!activeRoutine) return;
    setIsRunningNow(true);
    showToast('已下发立即执行指令...', 'info');
    try {
      const run = await api.runRoutine(activeRoutine.id);
      setRuns((prev) => [run, ...prev]);
      showToast('执行完成！', 'success');
    } catch (err: any) {
      showToast(`执行失败: ${err.message}`, 'error');
    } finally {
      setIsRunningNow(false);
    }
  };

  const filtered = routines.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.prompt && r.prompt.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <section className="view-stage" style={{ padding: 0, height: 'calc(100vh - 54px)', overflow: 'hidden' }}>
      <div className="routines-workspace" style={{ display: 'flex', height: '100%' }}>
        {/* Left column list */}
        <aside
          className="routines-sidebar"
          style={{
            width: '280px',
            minWidth: '220px',
            flexShrink: 0,
            borderRight: '1px solid var(--om-border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--om-surface)',
          }}
        >
          <div
            className="routines-sidebar-header"
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--om-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '14px' }}>
              <Clock size={16} />
              <span>定时任务</span>
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsCreateOpen(true)}
              style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '6px', whiteSpace: 'nowrap' }}
            >
              <Plus size={12} /> 新建
            </button>
          </div>

          <div style={{ padding: '10px 14px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="搜索任务..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: '30px',
                  height: '32px',
                  borderRadius: '6px',
                  border: '1px solid var(--om-border)',
                  background: 'var(--om-surface-2)',
                  fontSize: '12px',
                }}
              />
            </div>
          </div>

          <div className="routines-list-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
            {filtered.map((r) => {
              const isActive = r.id === activeRoutineId;
              return (
                <div
                  key={r.id}
                  onClick={() => setActiveRoutineId(r.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    marginBottom: '6px',
                    cursor: 'pointer',
                    background: isActive ? 'var(--om-surface-2)' : 'transparent',
                    border: isActive ? '1px solid var(--om-border)' : '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--om-fg)' }}>{r.name}</span>
                    <span className={`pill-badge ${r.enabled ? 'pill-green' : 'pill-amber'}`} style={{ fontSize: '10px' }}>
                      {r.enabled ? '运行中' : '暂停'}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
                    {r.cron || '周期调度'}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right column detail */}
        <main className="routines-main-content" style={{ flex: 1, minWidth: '380px', overflowY: 'auto', padding: '24px' }}>
          {!activeRoutine ? (
            <div style={{ textAlign: 'center', padding: '60px 16px', color: 'var(--text-dim)' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>⏰</div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-muted)' }}>选择或创建定时任务</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>
                数字员工将按设定周期在受控沙箱中执行自动化巡检或数据处理。
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', gap: '16px' }}>
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 600 }}>{activeRoutine.name}</h3>
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>调度表达式: <code>{activeRoutine.cron}</code></div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleToggleEnable(activeRoutine)}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <Power size={14} /> {activeRoutine.enabled ? '暂停任务' : '恢复任务'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleRunNow}
                    disabled={isRunningNow}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <Play size={14} /> {isRunningNow ? '执行中...' : '立即运行'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleDelete(activeRoutine.id)}
                    title="删除"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--om-surface)', border: '1px solid var(--om-border)', borderRadius: '10px', padding: '16px', marginBottom: '24px' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 600, marginBottom: '6px' }}>执行指令提示词 (Prompt)</div>
                <pre style={{ margin: 0, fontSize: '12px', color: 'var(--text-main)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {activeRoutine.prompt}
                </pre>
              </div>

              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>历史执行流水 (Runs)</h4>
                {runs.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>暂无执行流水记录</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {runs.map((run) => (
                      <div
                        key={run.id}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid var(--om-border)',
                          background: 'var(--om-surface)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, overflow: 'hidden' }}>
                          {run.status === 'success' ? (
                            <CheckCircle size={15} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                          ) : (
                            <XCircle size={15} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
                          )}
                          <span style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {run.summary || '巡检执行完成'}
                          </span>
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--text-dim)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {formatTime(run.startedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="新建定时例行任务"
        icon={<Clock size={18} />}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={() => setIsCreateOpen(false)}>取消</button>
            <button type="button" className="btn-primary" onClick={handleCreate}>保存并调度</button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>任务名称</label>
            <input
              type="text"
              className="form-control"
              placeholder="例如：每日清晨环境健康度巡检"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Cron 定时调度表达式</label>
            <input
              type="text"
              className="form-control"
              placeholder="0 9 * * * (每天上午 9 点)"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>执行指令提示词</label>
            <textarea
              className="form-control"
              rows={3}
              placeholder="指定数字员工在沙箱内执行的具体步骤与产出..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </Modal>
    </section>
  );
};
