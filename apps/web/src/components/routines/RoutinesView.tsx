import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock,
  Plus,
  Play,
  Trash2,
  Power,
  Search,
  CheckCircle,
  XCircle,
  RefreshCw,
  Calendar,
  ChevronDown,
  ChevronRight,
  Edit3,
  Bot as BotIcon,
  Loader2,
  Sparkles,
} from 'lucide-react';
import type { Routine, RoutineRun, ScheduleKind, DeliverTarget, OverlapPolicy } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { formatTime } from '../../utils/format';
import { formatCronZh, parseNaturalLanguageRoutine } from '../../utils/cronHelper';
import { ToolTrace } from '../chat/ToolTrace';
import { SchedulePicker } from './SchedulePicker';

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
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimerRef = useRef<any>(null);

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
  const [aiQuickPrompt, setAiQuickPrompt] = useState('');

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
    setAiQuickPrompt('');
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
    setAiQuickPrompt('');
    setModalTab('basic');
    setIsModalOpen(true);
  };

  // AI 自然语言一句话提炼并填入任务
  const handleAiQuickFill = (presetText?: string) => {
    const text = presetText || aiQuickPrompt;
    if (!text.trim()) {
      showToast('请输入自然语言任务描述', 'warning');
      return;
    }
    const result = parseNaturalLanguageRoutine(text.trim());
    setFormName(result.name);
    setFormPrompt(result.instructions);
    setFormCron(result.cronExpr);
    setFormScheduleKind(result.scheduleKind);
    showToast(`✨ AI 已智能提炼并填入：${result.humanZh}`, 'success');
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
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3500);
      return;
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    setConfirmDeleteId(null);

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

  return (
    <section className="view-stage routines-view" aria-label="例行任务与自动化巡检">
      {/* 顶部统计与新建入口 */}
      <div className="routines-top-bar">
        <div className="routines-stat-group">
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
              className={`rt-stat-value ${statsSummary.totalExecutions > 0 ? 'is-success' : 'is-muted'}`}
            >
              {statsSummary.totalExecutions > 0 ? `${statsSummary.successRate}%` : '—'}
            </span>
          </div>
          <div className="rt-stat">
            <span className="rt-stat-label">失败次数</span>
            <span
              className={`rt-stat-value ${statsSummary.failedTotal > 0 ? 'is-warning' : ''}`}
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
      <div className="routines-workspace">
        {/* 左侧任务列表面板 */}
        <aside className="routines-sidebar">
          {/* 搜索与筛选 */}
          <div className="routines-filter-box">
            <div className="routines-search-container">
              <Search size={14} className="routines-search-icon" aria-hidden="true" />
              <input
                type="text"
                placeholder="搜索任务、Cron 或指令..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="routines-search-input"
              />
            </div>

            <div className="routines-tabs-row">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`routines-tab-btn ${filterTab === 'all' ? 'active' : ''}`}
              >
                全部 ({routines.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('active')}
                className={`routines-tab-btn ${filterTab === 'active' ? 'active active-green' : ''}`}
              >
                运行中 ({routines.filter((r) => r.enabled).length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('paused')}
                className={`routines-tab-btn ${filterTab === 'paused' ? 'active active-amber' : ''}`}
              >
                已暂停 ({routines.filter((r) => !r.enabled).length})
              </button>
            </div>
          </div>

          {/* 任务项滚动列表 */}
          <div className="routines-list-scroll">
            {loadingList && routines.length === 0 ? (
              <div className="routine-skeleton-list" aria-label="加载中">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="routine-nav-skeleton" />
                ))}
              </div>
            ) : filteredRoutines.length === 0 ? (
              <div className="routine-nav-empty">
                没有匹配的例行任务
              </div>
            ) : (
              filteredRoutines.map((r) => {
                const isActive = r.id === activeRoutineId;
                const botObj = bots.find((b) => b.id === r.agentId) || (bots.length > 0 ? bots[0] : null);
                const humanZh = r.scheduleHumanZh || formatCronZh(r.cronExpr);

                return (
                  <div
                    key={r.id}
                    onClick={() => setActiveRoutineId(r.id)}
                    className={`routine-nav-item ${isActive ? 'is-active' : ''}`}
                  >
                    <div className="routine-nav-top-row">
                      <span className="routine-nav-name">
                        {r.name}
                      </span>
                      <span className={`routine-nav-status-badge ${r.enabled ? 'is-running' : 'is-paused'}`}>
                        {r.enabled ? '运行中' : '已暂停'}
                      </span>
                    </div>

                    <div className="routine-nav-schedule-line">
                      <Calendar size={12} className="flex-shrink-0" />
                      <span>{humanZh}</span>
                    </div>

                    <div className="routine-nav-meta-line">
                      <span className="routine-nav-bot-tag">
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
            <div className="routines-empty-state">
              <div className="routine-empty-icon">⏰</div>
              <div className="routine-empty-title">
                选择或创建自动化例行任务
              </div>
              <div className="routine-empty-desc">
                数字员工将按照设定的周期在沙箱内自主巡检、收集日志、排查风险并在需要时通报结论。
              </div>
              <button type="button" className="btn-primary" onClick={handleOpenCreate}>
                <Plus size={15} /> 立即创建第一个任务
              </button>
            </div>
          ) : (
            <div className="routine-detail-wrapper">
              {/* 顶部标题与快捷操作栏 */}
              <div className="routine-detail-header-card">
                <div className="routine-detail-top-row">
                  <div className="routine-detail-heading-group">
                    <div className="routine-detail-title-line">
                      <h2 className="routine-detail-name">
                        {activeRoutine.name}
                      </h2>
                      <span className={`routine-detail-status-pill ${activeRoutine.enabled ? 'is-running' : 'is-paused'}`}>
                        {activeRoutine.enabled ? '● 调度运行中' : '⏸ 调度已暂停'}
                      </span>
                    </div>

                    <div className="routine-detail-meta-list">
                      <span className="routine-detail-meta-item">
                        <BotIcon size={14} /> 责任员工: <strong>{assignedBot?.name || activeRoutine.agentId}</strong>
                      </span>
                      <span className="routine-detail-meta-item">
                        <Calendar size={14} /> 调度周期: <strong>{activeRoutine.scheduleHumanZh || formatCronZh(activeRoutine.cronExpr)}</strong>
                      </span>
                      <span className="routine-detail-meta-item">
                        <Clock size={14} /> 下次触发:{' '}
                        <strong>
                          {!activeRoutine.enabled
                            ? '已暂停调度'
                            : activeRoutine.nextRunAt
                            ? formatTime(activeRoutine.nextRunAt)
                            : '按设定周期'}
                        </strong>
                      </span>
                      {activeRoutine.lastRunAt && (
                        <span className="routine-detail-meta-item">上次运行: {formatTime(activeRoutine.lastRunAt)}</span>
                      )}
                    </div>
                  </div>

                  {/* 动作按钮组 */}
                  <div className="routine-detail-actions">
                    <button
                      type="button"
                      className="btn-primary routine-action-btn"
                      onClick={handleRunNow}
                      disabled={isRunningNow}
                    >
                      {isRunningNow ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                      <span>{isRunningNow ? '下发中...' : '立即运行'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary routine-action-btn"
                      onClick={() => handleToggleEnable(activeRoutine)}
                    >
                      <Power size={14} /> <span>{activeRoutine.enabled ? '暂停调度' : '恢复调度'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary routine-action-btn"
                      onClick={() => handleOpenEdit(activeRoutine)}
                    >
                      <Edit3 size={14} /> <span>编辑</span>
                    </button>
                    <button
                      type="button"
                      className={`btn-secondary routine-action-btn is-danger ${confirmDeleteId === activeRoutine.id ? 'is-confirming' : ''}`}
                      onClick={() => handleDelete(activeRoutine.id)}
                      title={confirmDeleteId === activeRoutine.id ? '再次点击确认删除' : '删除任务'}
                    >
                      <Trash2 size={14} />
                      {confirmDeleteId === activeRoutine.id && <span>确认删除？</span>}
                    </button>
                  </div>
                </div>
              </div>

              {/* 历史执行流水与工具调用链 (Runs & Execution Traces) */}
              <div className="routine-runs-section">
                <div className="routine-runs-header">
                  <div className="routine-runs-title-group">
                    <h3 className="routine-runs-heading">
                      执行流水与工具轨迹 (Execution Runs)
                    </h3>
                    <span className="routine-runs-count-badge">({runs.length} 次记录)</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => loadRuns(activeRoutine.id)}
                    disabled={isRefreshingRuns}
                    className="routine-runs-refresh-btn"
                  >
                    <RefreshCw size={12} className={isRefreshingRuns ? 'spin' : ''} /> 刷新流水
                  </button>
                </div>

                {runs.length === 0 ? (
                  <div className="routine-runs-empty">
                    暂无执行流水记录，可点击上方「立即运行」或等待定时调度触发。
                  </div>
                ) : (
                  <div className="routine-runs-list">
                    {runs.map((run) => {
                      const isExpanded = expandedRunIds.has(run.id);
                      const hasToolCalls = run.toolCalls && run.toolCalls.length > 0;

                      return (
                        <div
                          key={run.id}
                          className="routine-run-card"
                        >
                          <div
                            className={`routine-run-summary-row ${isExpanded ? 'is-expanded' : ''}`}
                          >
                            <div className="routine-run-main-info">
                              {run.status === 'success' ? (
                                <CheckCircle size={17} className="routine-run-status-icon is-success" />
                              ) : run.status === 'running' ? (
                                <Loader2 size={17} className="spin routine-run-status-icon is-running" />
                              ) : (
                                <XCircle size={17} className="routine-run-status-icon is-failed" />
                              )}

                              <div>
                                <div className="routine-run-summary-line">
                                  <span
                                    title={run.summary || run.error || ''}
                                    className="routine-run-title"
                                  >
                                    {run.status === 'running'
                                      ? '正在沙箱中执行巡检...'
                                      : run.summary || (run.status === 'success' ? '巡检完成' : run.error || '执行异常')}
                                  </span>
                                  {run.quiet && (
                                    <span className="routine-run-quiet-badge">
                                      静默无异常
                                    </span>
                                  )}
                                  <span className="routine-run-source-badge">
                                    {run.triggerSource === 'schedule'
                                      ? '⏰ 定时调度'
                                      : run.triggerSource === 'webhook'
                                      ? '⚡ Webhook 回调'
                                      : '👤 手动触发'}
                                  </span>
                                </div>
                                <div className="routine-run-meta-line">
                                  <span>{formatTime(run.startedAt)}</span>
                                  {run.durationMs && <span> · 耗时 {(run.durationMs / 1000).toFixed(1)} 秒</span>}
                                  {hasToolCalls && <span> · 调用了 {run.toolCalls?.length} 个工具</span>}
                                </div>
                              </div>
                            </div>

                            <div className="routine-run-actions">
                              {run.status === 'failed' && (
                                <button
                                  type="button"
                                  onClick={handleRunNow}
                                  disabled={isRunningNow}
                                  className="btn-secondary routine-run-retry-btn"
                                  title="重新触发一次此例行任务"
                                >
                                  <RefreshCw size={11} className={isRunningNow ? 'spin' : ''} />
                                  <span>重试</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleRunExpand(run.id)}
                                className="routine-run-expand-btn"
                              >
                                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                <span>{isExpanded ? '收起详情' : '展开输出'}</span>
                              </button>
                            </div>
                          </div>

                          {/* 展开的详情输出与工具调用链 */}
                          {isExpanded && (
                            <div className="routine-run-details">
                              {/* 工具调用链 */}
                              {hasToolCalls && (
                                <div className="routine-run-trace-wrap">
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
                              <div className="routine-run-output-title">
                                产出报告与执行结论:
                              </div>
                              <pre className="routine-run-output-pre">
                                {run.status === 'running' ? (
                                  <div className="routine-run-running-msg">
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
          <div className="modal-actions-bar">
            <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleSaveRoutine}>
              {editingRoutineId ? '更新配置' : '保存并启动调度'}
            </button>
          </div>
        }
      >
        <div className="routine-modal-container">
          {/* AI 一句话智能速建 (仅在新建任务时展示) */}
          {!editingRoutineId && (
            <div className="routine-ai-magic-bar">
              <div className="routine-ai-magic-header">
                <span className="routine-ai-sparkle-pill">
                  <Sparkles size={12} /> AI 智能自然语言速建
                </span>
                <span className="routine-ai-magic-hint">
                  输入大白话，AI 自动提炼任务名称、执行指令与调度周期
                </span>
              </div>
              <div className="routine-ai-magic-input-row">
                <input
                  type="text"
                  placeholder="例如：每个工作日早上9点巡检服务器系统资源与各关键服务，汇总异常"
                  value={aiQuickPrompt}
                  onChange={(e) => setAiQuickPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAiQuickFill();
                  }}
                  className="routine-ai-magic-input"
                />
                <button
                  type="button"
                  className="btn-primary routine-ai-magic-btn"
                  onClick={() => handleAiQuickFill()}
                >
                  <Sparkles size={13} /> 智能解析填入
                </button>
              </div>
              <div className="routine-ai-magic-chips">
                <span className="routine-ai-chips-label">速填范例:</span>
                <button
                  type="button"
                  className="routine-ai-chip-btn"
                  onClick={() =>
                    handleAiQuickFill('工作日早晨9点巡检工作站系统资源与各关键服务，汇总异常并生成结论')
                  }
                >
                  💼 工作日系统巡检
                </button>
                <button
                  type="button"
                  className="routine-ai-chip-btn"
                  onClick={() =>
                    handleAiQuickFill('每隔30分钟监控一次关键服务与网络端口状态，记录异常')
                  }
                >
                  ⚡ 30分钟高频监控
                </button>
                <button
                  type="button"
                  className="routine-ai-chip-btn"
                  onClick={() =>
                    handleAiQuickFill('每周五傍晚18点汇总本周团队日志与开发进展，生成周报')
                  }
                >
                  📋 周五下班周报汇总
                </button>
              </div>
            </div>
          )}

          {/* Tab 导航切换 */}
          <div className="routine-modal-tabs">
            <button
              type="button"
              onClick={() => setModalTab('basic')}
              className={`routine-modal-tab-btn ${modalTab === 'basic' ? 'is-active' : ''}`}
            >
              1. 核心与责任员工
            </button>
            <button
              type="button"
              onClick={() => setModalTab('schedule')}
              className={`routine-modal-tab-btn ${modalTab === 'schedule' ? 'is-active' : ''}`}
            >
              2. 调度周期 (AI 语言识别)
            </button>
            <button
              type="button"
              onClick={() => setModalTab('policies')}
              className={`routine-modal-tab-btn ${modalTab === 'policies' ? 'is-active' : ''}`}
            >
              3. 交付与防扰策略
            </button>
          </div>

          {/* Tab 1: 核心与责任员工 */}
          {modalTab === 'basic' && (
            <div className="routine-modal-form-group">
              <div className="form-group">
                <label className="form-label">
                  任务名称 *
                </label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="例如：工作站资源与磁盘空间健康巡检"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  指派执行数字员工 *
                </label>
                <select
                  className="form-control"
                  value={formAgentId}
                  onChange={(e) => setFormAgentId(e.target.value)}
                >
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.role || '数字员工'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  任务执行指引提示词 (Prompt 指令) *
                </label>
                <textarea
                  className="form-control"
                  rows={4}
                  placeholder="请详细描述数字员工在沙箱内需调用的工具、巡检步骤、判断依据以及汇报格式..."
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Tab 2: 调度周期与预设 */}
          {modalTab === 'schedule' && (
            <div className="routine-modal-form-group">
              <SchedulePicker
                value={formCron}
                onChange={(nextCron, kind) => {
                  setFormCron(nextCron);
                  if (kind) {
                    setFormScheduleKind(kind);
                  }
                }}
              />
            </div>
          )}

          {/* Tab 3: 交付与防扰策略 */}
          {modalTab === 'policies' && (
            <div className="routine-modal-form-group">
              <div className="form-group">
                <label className="form-label">
                  结果通报与交付渠道
                </label>
                <select
                  className="form-control"
                  value={formDeliverTo}
                  onChange={(e) => setFormDeliverTo(e.target.value as DeliverTarget)}
                >
                  <option value="feed">团队动态流 (Feed) - 推荐，便于全员协同了解进展</option>
                  <option value="silent">完全静默 (Silent) - 仅写日志与审计，不打扰动态流</option>
                  <option value="im_webhook">外部 IM Webhook - 发往企微/飞书群机器人</option>
                  <option value="all">全渠道推送 (All)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  并发防重叠控制
                </label>
                <select
                  className="form-control"
                  value={formOverlap}
                  onChange={(e) => setFormOverlap(e.target.value as OverlapPolicy)}
                >
                  <option value="skip">跳过本次 (Skip) - 若上次任务尚未完成，丢弃本次调度触发</option>
                  <option value="queue">排队等待 (Queue) - 排入队列顺序等待执行</option>
                </select>
              </div>

              <div className="form-group-checkbox">
                <input
                  type="checkbox"
                  id="deleteAfterRun"
                  checked={formDeleteAfterRun}
                  onChange={(e) => setFormDeleteAfterRun(e.target.checked)}
                />
                <label htmlFor="deleteAfterRun" className="checkbox-label">
                  单次定时完成后自动归档暂停 (适用于 @at 单次任务)
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">
                  超时保护限制 (秒)
                </label>
                <input
                  type="number"
                  className="form-control w-32"
                  value={formTimeoutSeconds}
                  onChange={(e) => setFormTimeoutSeconds(Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>
      </Modal>
    </section>
  );
};
