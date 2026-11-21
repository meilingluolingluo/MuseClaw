import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  Plus,
  Play,
  Trash2,
  Power,
  Search,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Calendar,
  Copy,
  Terminal,
  Shield,
  Zap,
  ChevronDown,
  ChevronRight,
  Edit3,
  Bot as BotIcon,
  Bell,
  BellOff,
  Loader2,
  Check,
} from 'lucide-react';
import type { Routine, RoutineRun, ScheduleKind, DeliverTarget, OverlapPolicy } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { formatTime } from '../../utils/format';
import { formatCronZh, previewNextRuns, SCHEDULE_PRESETS } from '../../utils/cronHelper';
import { ToolTrace } from '../chat/ToolTrace';

/** 剪贴板 API 不可用时的降级复制 */
function fallbackCopy(text: string, done: () => void): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch {
    console.warn('clipboard copy failed');
  }
}

export const RoutinesView: React.FC = () => {
  const { bots, showToast } = useApp();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [activeRoutineId, setActiveRoutineId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'paused'>('all');
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [isRefreshingRuns, setIsRefreshingRuns] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());

  // Modal State (Used for both Create & Edit)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<'basic' | 'schedule' | 'policies'>('basic');

  // Form Fields
  const [formName, setFormName] = useState('');
  const [formAgentId, setFormAgentId] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formScheduleKind, setFormScheduleKind] = useState<ScheduleKind>('cron');
  const [formCron, setFormCron] = useState('0 9 * * 1-5');
  const [formDeliverTo, setFormDeliverTo] = useState<DeliverTarget>('feed');
  const [formOverlap, setFormOverlap] = useState<OverlapPolicy>('skip');
  const [formDeleteAfterRun, setFormDeleteAfterRun] = useState(false);
  const [formTimeoutSeconds, setFormTimeoutSeconds] = useState(300);

  const loadRoutines = async () => {
    try {
      const data = await api.getRoutines();
      const list = Array.isArray(data) ? data : [];
      setRoutines(list);
      if (list.length > 0 && !activeRoutineId) {
        setActiveRoutineId(list[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load routines:', err);
      showToast(`例行任务加载失败：${err.message}`, 'error');
    } finally {
      setLoadingList(false);
    }
  };

  const loadRuns = async (rId: string) => {
    setIsRefreshingRuns(true);
    try {
      const runList = await api.getRoutineRuns(rId);
      const list = Array.isArray(runList) ? runList : [];
      setRuns(list);
      // 默认展开最新一条运行的工具流水
      if (list.length > 0) {
        setExpandedRunIds(new Set([list[0].id]));
      }
    } catch (err: any) {
      console.error('Failed to load runs:', err);
      showToast(`执行流水加载失败：${err.message}`, 'error');
    } finally {
      setIsRefreshingRuns(false);
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

  const activeRoutine = useMemo(
    () => routines.find((r) => r.id === activeRoutineId) || null,
    [routines, activeRoutineId]
  );

  // 统计指标计算
  const statsSummary = useMemo(() => {
    const total = routines.length;
    const activeCount = routines.filter((r) => r.enabled).length;
    let totalExecutions = 0;
    let successfulExecutions = 0;
    let failedTotal = 0;

    for (const r of routines) {
      if (r.stats) {
        totalExecutions += r.stats.totalRuns || 0;
        successfulExecutions += r.stats.successRuns || 0;
        failedTotal += r.stats.failedRuns || 0;
      }
    }
    const successRate = totalExecutions > 0 ? Math.round((successfulExecutions / totalExecutions) * 100) : 0;

    return {
      total,
      activeCount,
      totalExecutions,
      successRate,
      failedTotal,
    };
  }, [routines]);

  // 过滤列表
  const filteredRoutines = useMemo(() => {
    return routines.filter((r) => {
      if (filterTab === 'active' && !r.enabled) return false;
      if (filterTab === 'paused' && r.enabled) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchName = r.name.toLowerCase().includes(q);
      const matchPrompt = (r.instructions || '').toLowerCase().includes(q);
      const matchCron = (r.cronExpr || '').toLowerCase().includes(q);
      return matchName || matchPrompt || matchCron;
    });
  }, [routines, filterTab, searchQuery]);

  // 打开创建弹窗
  const handleOpenCreate = () => {
    setEditingRoutineId(null);
    setFormName('');
    setFormAgentId(bots[0]?.id || 'muse');
    setFormPrompt('请检查工作站系统资源与各关键服务运行状态，汇总指标并生成巡检结论报告。');
    setFormScheduleKind('cron');
    setFormCron('0 9 * * 1-5');
    setFormDeliverTo('feed');
    setFormOverlap('skip');
    setFormDeleteAfterRun(false);
    setFormTimeoutSeconds(300);
    setModalTab('basic');
    setIsModalOpen(true);
  };

  // 打开编辑弹窗
  const handleOpenEdit = (r: Routine) => {
    setEditingRoutineId(r.id);
    setFormName(r.name);
    const validAgentId = bots.some((b) => b.id === r.agentId) ? r.agentId : bots[0]?.id || 'muse';
    setFormAgentId(validAgentId);
    setFormPrompt(r.instructions || '');
    setFormScheduleKind(r.scheduleKind || 'cron');
    setFormCron(r.cronExpr || '0 9 * * 1-5');
    setFormDeliverTo(r.deliverTo || (r.feedPublish !== false ? 'feed' : 'silent'));
    setFormOverlap(r.overlap || 'skip');
    setFormDeleteAfterRun(Boolean(r.deleteAfterRun));
    setFormTimeoutSeconds(r.timeoutSeconds || 300);
    setModalTab('basic');
    setIsModalOpen(true);
  };

  // 提交保存（新建或编辑）
  const handleSaveRoutine = async () => {
    if (!formName.trim()) {
      showToast('任务名称不能为空', 'warning');
      return;
    }
    if (!formPrompt.trim()) {
      showToast('执行指令提示词不能为空', 'warning');
      return;
    }
    if (!formCron.trim()) {
      showToast('调度周期表达式不能为空', 'warning');
      return;
    }

    try {
      if (editingRoutineId) {
        // 更新逻辑
        const updated = await api.updateRoutine(editingRoutineId, {
          name: formName.trim(),
          agentId: formAgentId,
          instructions: formPrompt.trim(),
          scheduleKind: formScheduleKind,
          cronExpr: formCron.trim(),
          deliverTo: formDeliverTo,
          feedPublish: formDeliverTo !== 'silent',
          overlap: formOverlap,
          deleteAfterRun: formDeleteAfterRun,
          timeoutSeconds: Math.min(3600, Math.max(30, Number(formTimeoutSeconds) || 300)),
        });
        setRoutines((prev) => prev.map((item) => (item.id === editingRoutineId ? updated : item)));
        showToast('例行任务配置已更新', 'success');
      } else {
        // 新建逻辑
        const created = await api.createRoutine({
          name: formName.trim(),
          agentId: formAgentId,
          instructions: formPrompt.trim(),
          scheduleKind: formScheduleKind,
          cronExpr: formCron.trim(),
          deliverTo: formDeliverTo,
          feedPublish: formDeliverTo !== 'silent',
          overlap: formOverlap,
          deleteAfterRun: formDeleteAfterRun,
          timeoutSeconds: Math.min(3600, Math.max(30, Number(formTimeoutSeconds) || 300)),
          enabled: true,
        });
        setRoutines((prev) => [created, ...prev]);
        setActiveRoutineId(created.id);
        showToast('新建例行任务成功', 'success');
      }
      setIsModalOpen(false);
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    }
  };

  // 启停切换
  const handleToggleEnable = async (r: Routine) => {
    try {
      const nextEnabled = !r.enabled;
      await api.updateRoutine(r.id, { enabled: nextEnabled });
      setRoutines((prev) =>
        prev.map((item) =>
          item.id === r.id ? { ...item, enabled: nextEnabled, status: nextEnabled ? 'idle' : 'paused' } : item
        )
      );
      showToast(`任务已${nextEnabled ? '恢复自动调度' : '暂停'}`, 'info');
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`, 'error');
    }
  };

  // 删除任务
  const handleDelete = async (id: string) => {
    if (!confirm('确定彻底删除该例行任务及配置吗？')) return;
    try {
      await api.deleteRoutine(id);
      const remaining = routines.filter((r) => r.id !== id);
      setRoutines(remaining);
      if (activeRoutineId === id) {
        setActiveRoutineId(remaining.length > 0 ? remaining[0].id : null);
      }
      showToast('例行任务已删除', 'success');
    } catch (err: any) {
      showToast(`删除失败: ${err.message}`, 'error');
    }
  };

  // 手动立即触发
  const handleRunNow = async () => {
    if (!activeRoutine) return;
    setIsRunningNow(true);
    showToast(`已向数字员工下发立即执行指令...`, 'info');
    try {
      await api.runRoutine(activeRoutine.id);
      showToast('任务已触发启动，正在沙箱中执行...', 'success');
      // 立即刷新流水展现 running 状态
      loadRuns(activeRoutine.id);
    } catch (err: any) {
      showToast(`触发失败: ${err.message}`, 'error');
      setIsRunningNow(false);
    }
  };

  // 当有正在执行的任务或刚下发任务时，自动轮询刷新流水
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running');
    if (!hasRunning) {
      if (isRunningNow) {
        setIsRunningNow(false);
      }
      return;
    }
    const timer = setInterval(() => {
      if (activeRoutineId) {
        loadRuns(activeRoutineId);
        loadRoutines();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [runs, activeRoutineId, isRunningNow]);

  // 复制文本辅助（非安全上下文降级为 execCommand）
  const copyToClipboard = (text: string, id: string) => {
    const done = () => {
      setCopiedId(id);
      showToast('已复制到剪贴板', 'info');
      setTimeout(() => {
        setCopiedId((cur) => (cur === id ? null : cur));
      }, 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  };

  // 展开折叠流水工具调用详情
  const toggleRunExpand = (runId: string) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  // 解析当前分配的 Bot
  const assignedBot = useMemo(() => {
    if (!activeRoutine) return null;
    return bots.find((b) => b.id === activeRoutine.agentId) || bots[0] || null;
  }, [bots, activeRoutine]);

  // 未来预测触发时间
  const previewRuns = useMemo(() => {
    return previewNextRuns(formCron, 3);
  }, [formCron]);

  return (
    <section className="view-stage routines-view">
      {/* 顶部统计与新建入口 */}
      <div
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid var(--om-border)',
          background: 'var(--om-surface)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <div className="rt-stat">
            <span className="rt-stat-label">例行任务</span>
            <span className="rt-stat-value">
              {statsSummary.total}
              <span className="rt-stat-sub">· {statsSummary.activeCount} 活跃</span>
            </span>
          </div>
          <div className="rt-stat">
            <span className="rt-stat-label">累计执行</span>
            <span className="rt-stat-value">{statsSummary.totalExecutions}</span>
          </div>
          <div className="rt-stat">
            <span className="rt-stat-label">成功率</span>
            <span
              className="rt-stat-value"
              style={{ color: statsSummary.totalExecutions > 0 ? 'var(--accent-green)' : 'var(--om-muted)' }}
            >
              {statsSummary.totalExecutions > 0 ? `${statsSummary.successRate}%` : '—'}
            </span>
          </div>
          <div className="rt-stat">
            <span className="rt-stat-label">失败次数</span>
            <span
              className="rt-stat-value"
              style={{ color: statsSummary.failedTotal > 0 ? 'var(--accent-amber)' : 'var(--om-fg)' }}
            >
              {statsSummary.failedTotal}
            </span>
          </div>
        </div>

        <button type="button" className="om-btn-primary" onClick={handleOpenCreate}>
          <Plus size={15} /> 新建例行任务
        </button>
      </div>

      {/* 主工作区 */}
      <div className="routines-workspace" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧任务列表面板 */}
        <aside className="routines-sidebar">
          {/* 搜索与筛选 */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--om-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: 'var(--om-muted)' }} />
              <input
                type="text"
                placeholder="搜索任务、Cron 或指令..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  border: '1px solid var(--om-border)',
                  background: 'var(--om-surface-2)',
                  fontSize: '12px',
                  color: 'var(--om-fg)',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '4px', background: 'var(--om-surface-2)', padding: '2px', borderRadius: '6px' }}>
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: filterTab === 'all' ? 600 : 400,
                  background: filterTab === 'all' ? 'var(--om-surface)' : 'transparent',
                  color: filterTab === 'all' ? 'var(--om-fg)' : 'var(--om-muted)',
                  boxShadow: filterTab === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                全部 ({routines.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('active')}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: filterTab === 'active' ? 600 : 400,
                  background: filterTab === 'active' ? 'var(--om-surface)' : 'transparent',
                  color: filterTab === 'active' ? 'var(--accent-green)' : 'var(--om-muted)',
                  boxShadow: filterTab === 'active' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                运行中 ({routines.filter((r) => r.enabled).length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('paused')}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: filterTab === 'paused' ? 600 : 400,
                  background: filterTab === 'paused' ? 'var(--om-surface)' : 'transparent',
                  color: filterTab === 'paused' ? 'var(--accent-amber)' : 'var(--om-muted)',
                  boxShadow: filterTab === 'paused' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                已暂停 ({routines.filter((r) => !r.enabled).length})
              </button>
            </div>
          </div>

          {/* 任务项滚动列表 */}
          <div className="routines-list-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {loadingList && routines.length === 0 ? (
              <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }} aria-label="加载中">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      height: '64px',
                      borderRadius: '10px',
                      background: 'linear-gradient(100deg, var(--om-surface-2) 40%, var(--om-border) 50%, var(--om-surface-2) 60%)',
                      backgroundSize: '200% 100%',
                      animation: 'skShimmer 1.3s ease infinite',
                    }}
                  />
                ))}
              </div>
            ) : filteredRoutines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--om-muted)', fontSize: '12px' }}>
                没有匹配的例行任务
              </div>
            ) : (
              filteredRoutines.map((r) => {
                const isActive = r.id === activeRoutineId;
                const botObj = bots.find((b) => b.id === r.agentId);
                const humanZh = r.scheduleHumanZh || formatCronZh(r.cronExpr);

                return (
                  <div
                    key={r.id}
                    onClick={() => setActiveRoutineId(r.id)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      marginBottom: '8px',
                      cursor: 'pointer',
                      background: isActive ? 'var(--om-surface-2)' : 'transparent',
                      border: isActive ? '1px solid var(--om-accent)' : '1px solid var(--om-border)',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--om-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                        {r.name}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 500,
                          background: r.enabled ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                          color: r.enabled ? 'var(--accent-green)' : 'var(--accent-amber)',
                        }}
                      >
                        {r.enabled ? '运行中' : '已暂停'}
                      </span>
                    </div>

                    <div style={{ fontSize: '11.5px', color: 'var(--om-muted)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Calendar size={12} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {humanZh}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--om-muted)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <BotIcon size={12} /> {botObj?.name || r.agentId || '数字员工'}
                      </span>
                      {r.lastRunAt && (
                        <span>上次: {formatTime(r.lastRunAt)}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* 右侧核心详情面板 */}
        <main className="routines-main-content">
          {!activeRoutine ? (
            <div className="routines-empty-state" style={{ textAlign: 'center', padding: '100px 16px', color: 'var(--om-muted)' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏰</div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--om-fg)', marginBottom: '8px' }}>
                选择或创建自动化例行任务
              </div>
              <div style={{ fontSize: '13px', maxWidth: '480px', margin: '0 auto 20px auto', lineHeight: 1.6 }}>
                数字员工将按照设定的周期在沙箱内自主巡检、收集日志、排查风险并在需要时通报结论。
              </div>
              <button type="button" className="btn-primary" onClick={handleOpenCreate}>
                <Plus size={15} /> 立即创建第一个任务
              </button>
            </div>
          ) : (
            <div>
              {/* 顶部标题与快捷操作栏 */}
              <div
                style={{
                  background: 'var(--om-surface)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '14px',
                  padding: '20px 24px',
                  marginBottom: '20px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                  <div style={{ flex: 1, minWidth: '260px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--om-fg)' }}>
                        {activeRoutine.name}
                      </h2>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontWeight: 600,
                          background: activeRoutine.enabled ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                          color: activeRoutine.enabled ? 'var(--accent-green)' : 'var(--accent-amber)',
                        }}
                      >
                        {activeRoutine.enabled ? '● 调度运行中' : '⏸ 调度已暂停'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: 'var(--om-muted)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <BotIcon size={14} /> 责任员工: <strong>{assignedBot?.name || activeRoutine.agentId}</strong>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Calendar size={14} /> 下次触发:{' '}
                        <strong>
                          {!activeRoutine.enabled
                            ? '已暂停调度'
                            : activeRoutine.nextRunAt
                            ? formatTime(activeRoutine.nextRunAt)
                            : '按设定周期'}
                        </strong>
                      </span>
                      {activeRoutine.lastRunAt && (
                        <span>上次运行: {formatTime(activeRoutine.lastRunAt)}</span>
                      )}
                    </div>
                  </div>

                  {/* 动作按钮组 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleRunNow}
                      disabled={isRunningNow}
                      style={{ padding: '7px 14px', fontSize: '12.5px', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      {isRunningNow ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                      {isRunningNow ? '下发中...' : '立即运行'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleToggleEnable(activeRoutine)}
                      style={{ padding: '7px 14px', fontSize: '12.5px', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Power size={14} /> {activeRoutine.enabled ? '暂停调度' : '恢复调度'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleOpenEdit(activeRoutine)}
                      style={{ padding: '7px 12px', fontSize: '12.5px', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Edit3 size={14} /> 编辑
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleDelete(activeRoutine.id)}
                      title="删除任务"
                      style={{ padding: '7px 10px', fontSize: '12.5px', borderRadius: '7px', color: 'var(--accent-red)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 调度详情与高级规则网格 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                {/* 1. 调度周期与执行预测 */}
                <div
                  style={{
                    background: 'var(--om-surface)',
                    border: '1px solid var(--om-border)',
                    borderRadius: '12px',
                    padding: '16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>
                    <Calendar size={15} style={{ color: 'var(--om-accent)' }} /> 调度规划与下步执行
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--om-fg)', marginBottom: '4px' }}>
                    {activeRoutine.scheduleHumanZh || formatCronZh(activeRoutine.cronExpr)}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--om-muted)', marginBottom: '12px' }}>
                    表达式: <code>{activeRoutine.cronExpr}</code> ({activeRoutine.timezone || 'Asia/Shanghai'})
                  </div>

                  <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--om-muted)', marginBottom: '6px' }}>
                    未来预估触发时间:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {(activeRoutine.nextRunTimes && activeRoutine.nextRunTimes.length > 0
                      ? activeRoutine.nextRunTimes.map((t) => formatTime(t))
                      : previewNextRuns(activeRoutine.cronExpr, 3)
                    ).map((timeStr, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: '11.5px',
                          padding: '4px 8px',
                          background: 'var(--om-surface-2)',
                          borderRadius: '6px',
                          color: 'var(--om-fg)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span style={{ color: 'var(--om-muted)' }}>#{idx + 1}</span> {timeStr}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. 交付策略与静默配置 */}
                <div
                  style={{
                    background: 'var(--om-surface)',
                    border: '1px solid var(--om-border)',
                    borderRadius: '12px',
                    padding: '16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px', marginBottom: '10px' }}>
                    <Shield size={15} style={{ color: 'var(--accent-green)' }} /> 交付与防扰策略
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--om-border)' }}>
                      <span style={{ color: 'var(--om-muted)' }}>结果交付目标</span>
                      <span style={{ fontWeight: 500 }}>
                        {activeRoutine.deliverTo === 'silent'
                          ? '静默归档 (仅记日志)'
                          : activeRoutine.deliverTo === 'im_webhook'
                          ? 'IM 群机器人 Webhook'
                          : '团队动态流 (Feed)'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--om-border)' }}>
                      <span style={{ color: 'var(--om-muted)' }}>并发防重叠策略</span>
                      <span style={{ fontWeight: 500 }}>
                        {activeRoutine.overlap === 'queue' ? '排队顺序执行' : '跳过本次执行 (Skip)'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--om-border)' }}>
                      <span style={{ color: 'var(--om-muted)' }}>静默抑制 (Quiet Green)</span>
                      <span style={{ fontWeight: 500 }}>
                        {activeRoutine.deliverTo === 'silent' ? '已开启 · 仅记日志' : '按目标渠道正常送达'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                      <span style={{ color: 'var(--om-muted)' }}>超时时间限制</span>
                      <span>{activeRoutine.timeoutSeconds || 300} 秒</span>
                    </div>
                  </div>
                </div>

                {/* 3. 外部 Webhook 触发直连 */}
                <div
                  style={{
                    background: 'var(--om-surface)',
                    border: '1px solid var(--om-border)',
                    borderRadius: '12px',
                    padding: '16px',
                    gridColumn: '1 / -1',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px' }}>
                      <Terminal size={15} style={{ color: 'var(--om-accent)' }} /> 外部系统 Webhook 触发接口
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--om-muted)' }}>支持外部 CI/CD、Prometheus、或运维脚本随时回调</span>
                  </div>

                  <div
                    style={{
                      background: 'var(--om-surface-2)',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontFamily: 'monospace',
                      fontSize: '11.5px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      color: 'var(--om-fg)',
                      overflowX: 'auto',
                    }}
                  >
                    <span>
                      POST {window.location.origin}/api/routines/{activeRoutine.id}/trigger
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          `curl -X POST "${window.location.origin}/api/routines/${activeRoutine.id}/trigger" -H "Authorization: Bearer ${activeRoutine.webhookSecret || 'secret'}" -H "Content-Type: application/json" -d '{"event":"external_trigger"}'`,
                          'curl_cmd'
                        )
                      }
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '5px',
                        border: '1px solid var(--om-border)',
                        background: 'var(--om-surface)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        flexShrink: 0,
                      }}
                    >
                      {copiedId === 'curl_cmd' ? <Check size={12} color="var(--accent-green)" /> : <Copy size={12} />}
                      {copiedId === 'curl_cmd' ? '已复制' : '复制 Curl 指令'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 执行指令提示词 Prompt 卡片 */}
              <div
                style={{
                  background: 'var(--om-surface)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '24px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>执行指令提示词 (Prompt 指引)</div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(activeRoutine.instructions || '', 'prompt_copy')}
                    style={{
                      fontSize: '11px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--om-accent)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {copiedId === 'prompt_copy' ? <Check size={12} /> : <Copy size={12} />} 复制指令
                  </button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontSize: '12.5px',
                    color: 'var(--om-fg)',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                    background: 'var(--om-surface-2)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--om-border)',
                  }}
                >
                  {activeRoutine.instructions || '（未设置指令）'}
                </pre>
              </div>

              {/* 历史执行流水与工具调用链 (Runs & Execution Traces) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--om-fg)' }}>
                      执行流水与工具轨迹 (Execution Runs)
                    </h3>
                    <span style={{ fontSize: '11px', color: 'var(--om-muted)' }}>({runs.length} 次记录)</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => loadRuns(activeRoutine.id)}
                    disabled={isRefreshingRuns}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      borderRadius: '6px',
                      border: '1px solid var(--om-border)',
                      background: 'var(--om-surface)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <RefreshCw size={12} className={isRefreshingRuns ? 'spin' : ''} /> 刷新流水
                  </button>
                </div>

                {runs.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '40px 16px',
                      background: 'var(--om-surface)',
                      borderRadius: '10px',
                      border: '1px solid var(--om-border)',
                      color: 'var(--om-muted)',
                      fontSize: '12.5px',
                    }}
                  >
                    暂无执行流水记录，可点击上方「立即运行」或等待定时调度触发。
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {runs.map((run) => {
                      const isExpanded = expandedRunIds.has(run.id);
                      const hasToolCalls = run.toolCalls && run.toolCalls.length > 0;

                      return (
                        <div
                          key={run.id}
                          style={{
                            background: 'var(--om-surface)',
                            border: '1px solid var(--om-border)',
                            borderRadius: '12px',
                            padding: '16px',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              flexWrap: 'wrap',
                              gap: '12px',
                              marginBottom: isExpanded ? '12px' : 0,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              {run.status === 'success' ? (
                                <CheckCircle size={17} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                              ) : run.status === 'running' ? (
                                <Loader2 size={17} className="spin" style={{ color: 'var(--om-accent)', flexShrink: 0 }} />
                              ) : (
                                <XCircle size={17} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
                              )}

                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                                  <span
                                    title={run.summary || run.error || ''}
                                    style={{
                                      fontSize: '13px',
                                      fontWeight: 600,
                                      color: 'var(--om-fg)',
                                      display: '-webkit-box',
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                    }}
                                  >
                                    {run.status === 'running'
                                      ? '正在沙箱中执行巡检...'
                                      : run.summary || (run.status === 'success' ? '巡检完成' : run.error || '执行异常')}
                                  </span>
                                  {run.quiet && (
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                        background: 'rgba(16, 185, 129, 0.1)',
                                        color: 'var(--accent-green)',
                                      }}
                                    >
                                      静默无异常
                                    </span>
                                  )}
                                  <span
                                    style={{
                                      fontSize: '10px',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      background: 'var(--om-surface-2)',
                                      color: 'var(--om-muted)',
                                      flexShrink: 0,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {run.triggerSource === 'schedule'
                                      ? '⏰ 定时调度'
                                      : run.triggerSource === 'webhook'
                                      ? '⚡ Webhook 回调'
                                      : '👤 手动触发'}
                                  </span>
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--om-muted)', marginTop: '2px' }}>
                                  {formatTime(run.startedAt)}
                                  {run.durationMs && ` · 耗时 ${(run.durationMs / 1000).toFixed(1)} 秒`}
                                  {hasToolCalls && ` · 调用了 ${run.toolCalls?.length} 个工具`}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <button
                                type="button"
                                onClick={() => toggleRunExpand(run.id)}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '11px',
                                  borderRadius: '5px',
                                  border: '1px solid var(--om-border)',
                                  background: 'var(--om-surface-2)',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                {isExpanded ? '收起详情' : '展开输出'}
                              </button>
                            </div>
                          </div>

                          {/* 展开的详情输出与工具调用链 */}
                          {isExpanded && (
                            <div style={{ marginTop: '12px', borderTop: '1px solid var(--om-border)', paddingTop: '12px' }}>
                              {/* 工具调用链 */}
                              {hasToolCalls && (
                                <div style={{ marginBottom: '12px' }}>
                                  <ToolTrace
                                    tools={(run.toolCalls || []).map((tc: any) => ({
                                      tool: tc.tool,
                                      params: tc.args,
                                      result: tc.output,
                                      status: 'done',
                                    }))}
                                  />
                                </div>
                              )}

                              {/* 最终结论输出 */}
                              <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--om-muted)', marginBottom: '6px' }}>
                                产出报告与执行结论:
                              </div>
                              <pre
                                style={{
                                  margin: 0,
                                  background: 'var(--om-surface-2)',
                                  border: '1px solid var(--om-border)',
                                  borderRadius: '8px',
                                  padding: '12px',
                                  fontSize: '12px',
                                  lineHeight: 1.6,
                                  color: 'var(--om-fg)',
                                  whiteSpace: 'pre-wrap',
                                  maxHeight: '300px',
                                  overflowY: 'auto',
                                }}
                              >
                                {run.status === 'running' ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--om-accent)', padding: '6px 0' }}>
                                    <Loader2 size={14} className="spin" />
                                    <span>数字员工正在受控沙箱中执行命令与生成报告，请稍候...</span>
                                  </div>
                                ) : (
                                  run.output || run.error || '无输出信息'
                                )}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 创建 / 编辑全功能模态框 */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRoutineId ? '编辑例行自动化任务' : '新建例行自动化任务'}
        icon={<Clock size={18} />}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleSaveRoutine}>
              {editingRoutineId ? '更新配置' : '保存并启动调度'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Tab 导航切换 */}
          <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid var(--om-border)', paddingBottom: '8px' }}>
            <button
              type="button"
              onClick={() => setModalTab('basic')}
              style={{
                padding: '6px 12px',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: modalTab === 'basic' ? 600 : 400,
                background: modalTab === 'basic' ? 'var(--om-surface-2)' : 'transparent',
                color: modalTab === 'basic' ? 'var(--om-accent)' : 'var(--om-muted)',
              }}
            >
              1. 核心与责任员工
            </button>
            <button
              type="button"
              onClick={() => setModalTab('schedule')}
              style={{
                padding: '6px 12px',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: modalTab === 'schedule' ? 600 : 400,
                background: modalTab === 'schedule' ? 'var(--om-surface-2)' : 'transparent',
                color: modalTab === 'schedule' ? 'var(--om-accent)' : 'var(--om-muted)',
              }}
            >
              2. 调度周期与预设
            </button>
            <button
              type="button"
              onClick={() => setModalTab('policies')}
              style={{
                padding: '6px 12px',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: modalTab === 'policies' ? 600 : 400,
                background: modalTab === 'policies' ? 'var(--om-surface-2)' : 'transparent',
                color: modalTab === 'policies' ? 'var(--om-accent)' : 'var(--om-muted)',
              }}
            >
              3. 交付与防扰策略
            </button>
          </div>

          {/* Tab 1: 核心与责任员工 */}
          {modalTab === 'basic' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  任务名称 *
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="例如：工作站资源与磁盘空间健康巡检"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  指派执行数字员工 *
                </label>
                <select
                  className="form-control"
                  value={formAgentId}
                  onChange={(e) => setFormAgentId(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.role || '数字员工'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  任务执行指引提示词 (Prompt 指令) *
                </label>
                <textarea
                  className="form-control"
                  rows={4}
                  placeholder="请详细描述数字员工在沙箱内需调用的工具、巡检步骤、判断依据以及汇报格式..."
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                  style={{ width: '100%', fontSize: '12.5px', lineHeight: 1.5 }}
                />
              </div>
            </div>
          )}

          {/* Tab 2: 调度周期与预设 */}
          {modalTab === 'schedule' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  常用业务预设 (一键填入)
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {SCHEDULE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setFormCron(p.cronExpr);
                        setFormScheduleKind(p.kind);
                      }}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '6px',
                        border: formCron === p.cronExpr ? '1px solid var(--om-accent)' : '1px solid var(--om-border)',
                        background: formCron === p.cronExpr ? 'rgba(0, 100, 212, 0.08)' : 'var(--om-surface-2)',
                        color: formCron === p.cronExpr ? 'var(--om-accent)' : 'var(--om-fg)',
                        fontSize: '11.5px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '2px',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{p.label}</span>
                      <span style={{ fontSize: '10px', color: 'var(--om-muted)' }}>{p.cronExpr}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  调度表达式 (标准 5 段式 Cron / @every 间隔 / @at 单次)
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="如: 0 9 * * 1-5 或 */15 * * * * 或 @every 15m"
                  value={formCron}
                  onChange={(e) => setFormCron(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace' }}
                />
              </div>

              {/* 实时自然语言解析提示 */}
              <div
                style={{
                  background: 'var(--om-surface-2)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                }}
              >
                <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--om-muted)', marginBottom: '4px' }}>
                  智能中文识别:
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--om-accent)' }}>
                  📅 {formatCronZh(formCron)}
                </div>

                {previewRuns.length > 0 && (
                  <div style={{ marginTop: '8px', borderTop: '1px solid var(--om-border)', paddingTop: '6px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--om-muted)', marginBottom: '4px' }}>接下来 3 次运行预估:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {previewRuns.map((r, i) => (
                        <div key={i} style={{ fontSize: '11px', color: 'var(--om-fg)' }}>
                          • {r}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 3: 交付与防扰策略 */}
          {modalTab === 'policies' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  结果通报与交付渠道
                </label>
                <select
                  className="form-control"
                  value={formDeliverTo}
                  onChange={(e) => setFormDeliverTo(e.target.value as DeliverTarget)}
                  style={{ width: '100%' }}
                >
                  <option value="feed">团队动态流 (Feed) - 推荐，便于全员协同了解进展</option>
                  <option value="silent">完全静默 (Silent) - 仅写日志与审计，不打扰动态流</option>
                  <option value="im_webhook">外部 IM Webhook - 发往企微/飞书群机器人</option>
                  <option value="all">全渠道推送 (All)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  并发防重叠控制
                </label>
                <select
                  className="form-control"
                  value={formOverlap}
                  onChange={(e) => setFormOverlap(e.target.value as OverlapPolicy)}
                  style={{ width: '100%' }}
                >
                  <option value="skip">跳过本次 (Skip) - 若上次任务尚未完成，丢弃本次调度触发</option>
                  <option value="queue">排队等待 (Queue) - 排入队列顺序等待执行</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="deleteAfterRun"
                  checked={formDeleteAfterRun}
                  onChange={(e) => setFormDeleteAfterRun(e.target.checked)}
                />
                <label htmlFor="deleteAfterRun" style={{ fontSize: '12px', cursor: 'pointer' }}>
                  单次定时完成后自动归档暂停 (适用于 @at 单次任务)
                </label>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  超时保护限制 (秒)
                </label>
                <input
                  type="number"
                  className="form-control"
                  value={formTimeoutSeconds}
                  onChange={(e) => setFormTimeoutSeconds(Number(e.target.value))}
                  style={{ width: '120px' }}
                />
              </div>
            </div>
          )}
        </div>
      </Modal>
    </section>
  );
};
