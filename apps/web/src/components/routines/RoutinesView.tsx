import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Clock,
  Plus,
  Play,
  Square,
  Trash2,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Edit3,
  Loader2,
  Copy,
  Check,
  MessageSquare,
  SlidersHorizontal,
  Link2,
} from 'lucide-react';
import type {
  Routine,
  RoutineRun,
  RoutineRunStatus,
  ScheduleKind,
  DeliverTarget,
  OverlapPolicy,
  MisfirePolicy,
} from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { formatTime } from '../../utils/format';
import { formatCronZh } from '../../utils/cronHelper';
import { renderMarkdown } from '../../utils/markdown';
import { copyToClipboard } from '../../utils/clipboard';
import { ToolTrace } from '../chat/ToolTrace';
import { SchedulePicker } from './SchedulePicker';

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
  { value: 'UTC', label: 'UTC (协调世界时)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'Europe/London', label: 'Europe/London' },
];

const QUICK_TEMPLATES: Array<{
  id: string;
  label: string;
  name: string;
  cron: string;
  kind: ScheduleKind;
  instructions: string;
}> = [
  {
    id: 'sys_health',
    label: '系统巡检',
    name: '工作站资源与服务健康巡检',
    cron: '0 9 * * 1-5',
    kind: 'cron',
    instructions:
      '请检查工作站系统磁盘、内存与关键服务运行状态，若有异常指标重点告警；若一切正常请在结尾注明【无异常】。',
  },
  {
    id: 'freq_monitor',
    label: '服务监控',
    name: '关键端口与服务可用性监控',
    cron: '*/30 * * * *',
    kind: 'every',
    instructions:
      '每隔 30 分钟核查核心端口与依赖服务连通性，发现异常记录排查建议；若无异常输出【正常】。',
  },
  {
    id: 'weekly_report',
    label: '周五周报',
    name: '本周工作与变更汇总周报',
    cron: '0 18 * * 5',
    kind: 'cron',
    instructions:
      '汇总本周工作区变更日志、任务完成情况与待跟进事项，按结构化 Markdown 列表输出周报。',
  },
];

const DELIVER_LABELS: Record<DeliverTarget, string> = {
  feed: '动态流 Feed',
  silent: '仅日志静默',
  im_webhook: '外部 Webhook / IM',
  all: '全渠道通知',
};

const STATUS_LABELS: Record<RoutineRunStatus, string> = {
  running: '执行中',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  cancelled: '已中止',
  interrupted: '重启中断',
};

function isAbnormalRoutine(r: Routine): boolean {
  return Boolean(
    r.circuitBrokenAt ||
      r.lastStatus === 'failed' ||
      r.lastStatus === 'timeout' ||
      r.lastStatus === 'interrupted'
  );
}

function getCustomPolicyNotes(r: Routine): string[] {
  const notes: string[] = [];
  if (r.deliverTo && r.deliverTo !== 'feed') {
    notes.push(`交付: ${DELIVER_LABELS[r.deliverTo] || r.deliverTo}`);
  }
  if (r.overlap === 'queue') {
    notes.push('并发: 排队等待');
  }
  if ((r.maxRetries ?? 0) > 0) {
    notes.push(`重试: ${r.maxRetries} 次`);
  }
  if (r.misfirePolicy === 'run_once') {
    notes.push('过期补跑');
  }
  if ((r.timeoutSeconds || 300) !== 300) {
    notes.push(`超时: ${r.timeoutSeconds}s`);
  }
  if (r.timezone && r.timezone !== 'Asia/Shanghai') {
    notes.push(`时区: ${r.timezone}`);
  }
  if (r.modelOverride) {
    notes.push(`模型: ${r.modelOverride}`);
  }
  return notes;
}

export const RoutinesView: React.FC = () => {
  const { bots, showToast, selectSession, setTab, modelsConfig } = useApp();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [activeRoutineId, setActiveRoutineId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'paused'>('all');
  const [runFilter, setRunFilter] = useState<'all' | 'abnormal'>('all');
  const [isTriggering, setIsTriggering] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRefreshingRuns, setIsRefreshingRuns] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 创建 / 编辑模态框状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [showAdvancedPolicies, setShowAdvancedPolicies] = useState(false);

  // 表单字段
  const [formName, setFormName] = useState('');
  const [formAgentId, setFormAgentId] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formScheduleKind, setFormScheduleKind] = useState<ScheduleKind>('cron');
  const [formCron, setFormCron] = useState('0 9 * * 1-5');
  const [formTimezone, setFormTimezone] = useState('Asia/Shanghai');
  const [formDeliverTo, setFormDeliverTo] = useState<DeliverTarget>('feed');
  const [formWebhookUrl, setFormWebhookUrl] = useState('');
  const [formOverlap, setFormOverlap] = useState<OverlapPolicy>('skip');
  const [formMisfirePolicy, setFormMisfirePolicy] = useState<MisfirePolicy>('skip');
  const [formTimeoutSeconds, setFormTimeoutSeconds] = useState(300);
  const [formMaxRetries, setFormMaxRetries] = useState(0);
  const [formBreakerThreshold, setFormBreakerThreshold] = useState(5);
  const [formJitterSeconds, setFormJitterSeconds] = useState(0);
  const [formModelOverride, setFormModelOverride] = useState('');
  const [formDeleteAfterRun, setFormDeleteAfterRun] = useState(false);

  const loadRoutines = useCallback(async () => {
    try {
      const data = await api.getRoutines();
      const list = Array.isArray(data) ? data : [];
      setRoutines(list);
      setActiveRoutineId((prev) => {
        if (prev && list.some((item) => item.id === prev)) return prev;
        return list.length > 0 ? list[0].id : null;
      });
    } catch (err: any) {
      console.error('Failed to load routines:', err);
      showToast(`定时任务加载失败：${err.message}`, 'error');
    } finally {
      setLoadingList(false);
    }
  }, [showToast]);

  const loadRuns = useCallback(
    async (rId: string) => {
      setIsRefreshingRuns(true);
      try {
        const runList = await api.getRoutineRuns(rId);
        const list = Array.isArray(runList) ? runList : [];
        setRuns(list);
        if (list.length > 0) {
          setExpandedRunIds((prev) => (prev.size > 0 ? prev : new Set([list[0].id])));
        }
      } catch (err: any) {
        console.error('Failed to load runs:', err);
        showToast(`执行记录加载失败：${err.message}`, 'error');
      } finally {
        setIsRefreshingRuns(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    loadRoutines();
  }, [loadRoutines]);

  useEffect(() => {
    if (activeRoutineId) {
      setExpandedRunIds(new Set());
      setIsPromptExpanded(false);
      setRunFilter('all');
      loadRuns(activeRoutineId);
    } else {
      setRuns([]);
    }
  }, [activeRoutineId, loadRuns]);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const hasRunningRun = useMemo(() => runs.some((r) => r.status === 'running'), [runs]);

  useEffect(() => {
    if (!hasRunningRun && !isTriggering) return;

    const pollTimer = setInterval(() => {
      if (activeRoutineId) {
        loadRuns(activeRoutineId);
        loadRoutines();
      }
    }, 2000);

    const tickTimer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => {
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, [hasRunningRun, isTriggering, activeRoutineId, loadRuns, loadRoutines]);

  useEffect(() => {
    if (!hasRunningRun && isTriggering) {
      setIsTriggering(false);
    }
  }, [hasRunningRun, isTriggering]);

  const activeRoutine = useMemo(
    () => routines.find((r) => r.id === activeRoutineId) || null,
    [routines, activeRoutineId]
  );

  const activeRunningRun = useMemo(
    () => runs.find((r) => r.status === 'running') || null,
    [runs]
  );

  const modelChoices = useMemo(() => {
    const names = new Set<string>();
    for (const p of modelsConfig?.providers || []) {
      if (p.model) names.add(p.model);
      if (p.modelId) names.add(p.modelId);
      for (const m of p.candidateModels || []) names.add(m);
    }
    return Array.from(names).filter(Boolean);
  }, [modelsConfig]);

  const filteredRoutines = useMemo(() => {
    return routines.filter((r) => {
      if (filterTab === 'active' && !r.enabled) return false;
      if (filterTab === 'paused' && r.enabled) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.name.toLowerCase().includes(q) ||
        (r.instructions || '').toLowerCase().includes(q) ||
        (r.cronExpr || '').toLowerCase().includes(q)
      );
    });
  }, [routines, filterTab, searchQuery]);

  const filteredRuns = useMemo(() => {
    if (runFilter === 'abnormal') {
      return runs.filter(
        (run) =>
          run.status === 'failed' || run.status === 'timeout' || run.status === 'interrupted'
      );
    }
    return runs;
  }, [runs, runFilter]);

  const handleCopyText = async (key: string, text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      showToast(`已复制${label}`, 'success');
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } else {
      showToast('复制失败，请手动复制', 'error');
    }
  };

  const handleOpenCreate = () => {
    setEditingRoutineId(null);
    setFormName('');
    setFormAgentId(bots[0]?.id || 'muse');
    setFormPrompt('请检查工作站系统资源与各关键服务运行状态，汇总指标并生成巡检结论报告。');
    setFormScheduleKind('cron');
    setFormCron('0 9 * * 1-5');
    setFormTimezone('Asia/Shanghai');
    setFormDeliverTo('feed');
    setFormWebhookUrl('');
    setFormOverlap('skip');
    setFormMisfirePolicy('skip');
    setFormTimeoutSeconds(300);
    setFormMaxRetries(0);
    setFormBreakerThreshold(5);
    setFormJitterSeconds(0);
    setFormModelOverride('');
    setFormDeleteAfterRun(false);
    setShowAdvancedPolicies(false);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (r: Routine) => {
    setEditingRoutineId(r.id);
    setFormName(r.name);
    const validAgentId = bots.some((b) => b.id === r.agentId) ? r.agentId : bots[0]?.id || 'muse';
    setFormAgentId(validAgentId);
    setFormPrompt(r.instructions || '');
    setFormScheduleKind(r.scheduleKind || 'cron');
    setFormCron(r.cronExpr || '0 9 * * 1-5');
    setFormTimezone(r.timezone || 'Asia/Shanghai');
    setFormDeliverTo(r.deliverTo || (r.feedPublish !== false ? 'feed' : 'silent'));
    setFormWebhookUrl(r.webhookUrl || '');
    setFormOverlap(r.overlap || 'skip');
    setFormMisfirePolicy(r.misfirePolicy || 'skip');
    setFormTimeoutSeconds(r.timeoutSeconds || 300);
    setFormMaxRetries(r.maxRetries ?? 0);
    setFormBreakerThreshold(r.circuitBreakerThreshold ?? 5);
    setFormJitterSeconds(r.jitterSeconds ?? 0);
    setFormModelOverride(r.modelOverride || '');
    setFormDeleteAfterRun(Boolean(r.deleteAfterRun));
    setShowAdvancedPolicies(false);
    setIsModalOpen(true);
  };

  const applyTemplate = (tpl: (typeof QUICK_TEMPLATES)[number]) => {
    setFormName(tpl.name);
    setFormCron(tpl.cron);
    setFormScheduleKind(tpl.kind);
    setFormPrompt(tpl.instructions);
    showToast(`已填充「${tpl.label}」模板`, 'info');
  };

  const handleSaveRoutine = async () => {
    if (!formName.trim()) {
      showToast('请输入任务名称', 'warning');
      return;
    }
    if (!formPrompt.trim()) {
      showToast('请输入执行指令', 'warning');
      return;
    }
    if (!formCron.trim()) {
      showToast('请配置执行周期', 'warning');
      return;
    }

    const payload: Partial<Routine> = {
      name: formName.trim(),
      agentId: formAgentId,
      instructions: formPrompt.trim(),
      scheduleKind: formScheduleKind,
      cronExpr: formCron.trim(),
      timezone: formTimezone,
      deliverTo: formDeliverTo,
      feedPublish: formDeliverTo === 'feed' || formDeliverTo === 'all',
      webhookUrl: formWebhookUrl.trim() || undefined,
      overlap: formOverlap,
      misfirePolicy: formMisfirePolicy,
      deleteAfterRun: formDeleteAfterRun,
      timeoutSeconds: Math.min(3600, Math.max(10, Number(formTimeoutSeconds) || 300)),
      maxRetries: Math.min(3, Math.max(0, Number(formMaxRetries) || 0)),
      circuitBreakerThreshold: Math.max(1, Number(formBreakerThreshold) || 5),
      jitterSeconds: Math.min(60, Math.max(0, Number(formJitterSeconds) || 0)),
      modelOverride: formModelOverride.trim() || undefined,
    };

    try {
      if (editingRoutineId) {
        const updated = await api.updateRoutine(editingRoutineId, payload);
        setRoutines((prev) => prev.map((item) => (item.id === editingRoutineId ? updated : item)));
        showToast('任务配置已更新', 'success');
      } else {
        const created = await api.createRoutine({ ...payload, enabled: true });
        setRoutines((prev) => [created, ...prev]);
        setActiveRoutineId(created.id);
        showToast('定时任务已创建', 'success');
      }
      setIsModalOpen(false);
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    }
  };

  const handleToggleEnable = async (r: Routine, forceEnable?: boolean) => {
    try {
      const nextEnabled = forceEnable !== undefined ? forceEnable : !r.enabled;
      const updated = await api.updateRoutine(r.id, { enabled: nextEnabled });
      setRoutines((prev) => prev.map((item) => (item.id === r.id ? updated : item)));
      showToast(
        forceEnable ? '已重置熔断并恢复调度' : `任务已${nextEnabled ? '开启调度' : '暂停'}`,
        'info'
      );
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`, 'error');
    }
  };

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
      showToast('定时任务已删除', 'success');
    } catch (err: any) {
      showToast(`删除失败: ${err.message}`, 'error');
    }
  };

  const handleRunNow = async () => {
    if (!activeRoutine) return;
    setIsTriggering(true);
    try {
      await api.runRoutine(activeRoutine.id);
      showToast('已开始执行', 'success');
      await loadRuns(activeRoutine.id);
      await loadRoutines();
    } catch (err: any) {
      showToast(`触发失败: ${err.message}`, 'error');
      setIsTriggering(false);
    }
  };

  const handleCancelRun = async (runId?: string) => {
    if (!activeRoutine) return;
    const targetRunId = runId || activeRunningRun?.id;
    if (!targetRunId) return;
    setIsCancelling(true);
    try {
      await api.cancelRoutineRun(targetRunId);
      showToast('已下发停止指令', 'info');
      await loadRuns(activeRoutine.id);
      await loadRoutines();
    } catch (err: any) {
      showToast(`停止失败: ${err.message}`, 'error');
    } finally {
      setIsCancelling(false);
    }
  };

  const toggleRunExpand = (runId: string) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const assignedBot = useMemo(() => {
    if (!activeRoutine) return null;
    return bots.find((b) => b.id === activeRoutine.agentId) || bots[0] || null;
  }, [bots, activeRoutine]);

  const webhookCurlCommand = useMemo(() => {
    if (!activeRoutine) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3800';
    const token = activeRoutine.webhookSecret || '<TOKEN>';
    return `curl -X POST "${origin}/api/routines/${activeRoutine.id}/trigger" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{}'`;
  }, [activeRoutine]);

  const activePolicyNotes = useMemo(
    () => (activeRoutine ? getCustomPolicyNotes(activeRoutine) : []),
    [activeRoutine]
  );

  return (
    <section className="view-stage routines-view" aria-label="定时任务管理">
      <div className="routines-workspace">
        {/* 左侧精简任务列表 */}
        <aside className="routines-sidebar">
          <div className="rt-sidebar-head">
            <div className="rt-sidebar-title-group">
              <h2 className="rt-sidebar-title">定时任务</h2>
              <span className="rt-sidebar-count">{routines.length}</span>
            </div>
            <button type="button" className="om-btn-primary rt-create-btn" onClick={handleOpenCreate}>
              <Plus size={14} />
              <span>新建</span>
            </button>
          </div>

          <div className="rt-sidebar-controls">
            <div className="routines-search-container">
              <Search size={14} className="routines-search-icon" aria-hidden="true" />
              <input
                type="text"
                placeholder="搜索任务..."
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
                className={`routines-tab-btn ${filterTab === 'active' ? 'active' : ''}`}
              >
                启用 ({routines.filter((r) => r.enabled).length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('paused')}
                className={`routines-tab-btn ${filterTab === 'paused' ? 'active' : ''}`}
              >
                暂停 ({routines.filter((r) => !r.enabled).length})
              </button>
            </div>
          </div>

          <div className="routines-list-scroll rt-list-scroll">
            {loadingList && routines.length === 0 ? (
              <div className="routine-skeleton-list" aria-label="加载中">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="routine-nav-skeleton" />
                ))}
              </div>
            ) : filteredRoutines.length === 0 ? (
              <div className="routine-nav-empty">暂无匹配的定时任务</div>
            ) : (
              filteredRoutines.map((r) => {
                const isActive = r.id === activeRoutineId;
                const botObj =
                  bots.find((b) => b.id === r.agentId) || (bots.length > 0 ? bots[0] : null);
                const humanZh = r.scheduleHumanZh || formatCronZh(r.cronExpr);
                const isRunningItem = r.status === 'running';
                const isError = isAbnormalRoutine(r);

                const dotClass = isRunningItem
                  ? 'is-running'
                  : isError
                  ? 'is-error'
                  : r.enabled
                  ? 'is-active'
                  : 'is-paused';

                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveRoutineId(r.id)}
                    className={`rt-list-item ${isActive ? 'is-active' : ''}`}
                  >
                    <div className="rt-list-item-row">
                      <span className={`rt-status-dot ${dotClass}`} aria-hidden="true" />
                      <span className="rt-list-item-name">{r.name}</span>
                    </div>
                    <div className="rt-list-item-meta">
                      {humanZh} · {botObj?.name || r.agentId || '数字员工'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* 右侧平坦、清晰的工作区 */}
        <main className="routines-main-content">
          {!activeRoutine ? (
            <div className="routines-empty-state">
              <Clock size={28} className="rt-empty-icon" />
              <div className="routine-empty-title">暂无选中的定时任务</div>
              <div className="routine-empty-desc">
                创建一个周期性任务，让数字员工按计划在沙箱内自动巡检并汇报结果。
              </div>
              <button type="button" className="btn-primary" onClick={handleOpenCreate}>
                <Plus size={15} /> 新建定时任务
              </button>
            </div>
          ) : (
            <div className="rt-detail">
              {/* 熔断提示 */}
              {activeRoutine.circuitBrokenAt && (
                <div className="rt-breaker-banner" role="alert">
                  <div className="rt-breaker-info">
                    <AlertTriangle size={15} />
                    <span>
                      连续失败 {activeRoutine.consecutiveFailures || 0} 次，任务已自动暂停。
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary rt-breaker-btn"
                    onClick={() => handleToggleEnable(activeRoutine, true)}
                  >
                    恢复调度
                  </button>
                </div>
              )}

              {/* 头部：标题 + 启停开关 + 主操作 */}
              <header className="rt-detail-head">
                <div className="rt-detail-title-col">
                  <div className="rt-detail-title-row">
                    <h2 className="rt-detail-name">{activeRoutine.name}</h2>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeRoutine.enabled}
                      aria-label={activeRoutine.enabled ? '暂停调度' : '开启调度'}
                      title={activeRoutine.enabled ? '已开启自动调度，点击暂停' : '已暂停，点击开启'}
                      className={`rt-switch ${activeRoutine.enabled ? 'is-on' : ''}`}
                      onClick={() => handleToggleEnable(activeRoutine)}
                    >
                      <span className="rt-switch-thumb" />
                    </button>
                    {(activeRoutine.status === 'running' || activeRunningRun) && (
                      <span className="rt-inline-state is-running">执行中</span>
                    )}
                    {activeRoutine.hasQueuedRun && (
                      <span className="rt-inline-state is-queued">已排队</span>
                    )}
                  </div>

                  <div className="rt-detail-meta">
                    <span>{assignedBot?.name || activeRoutine.agentId}</span>
                    <span className="rt-meta-sep">·</span>
                    <span>{activeRoutine.scheduleHumanZh || formatCronZh(activeRoutine.cronExpr)}</span>
                    <span className="rt-meta-sep">·</span>
                    <span>
                      {!activeRoutine.enabled
                        ? '已暂停'
                        : activeRoutine.nextRunAt
                        ? `下次 ${formatTime(activeRoutine.nextRunAt)}`
                        : '按周期调度'}
                    </span>
                  </div>
                </div>

                <div className="rt-detail-actions">
                  {activeRunningRun || activeRoutine.status === 'running' ? (
                    <button
                      type="button"
                      className="btn-secondary rt-btn-danger"
                      onClick={() => handleCancelRun(activeRunningRun?.id)}
                      disabled={isCancelling || !activeRunningRun}
                    >
                      <Square size={12} fill="currentColor" />
                      <span>{isCancelling ? '停止中...' : '停止执行'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary rt-btn-primary"
                      onClick={handleRunNow}
                      disabled={isTriggering}
                    >
                      {isTriggering ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <Play size={14} />
                      )}
                      <span>{isTriggering ? '启动中...' : '立即运行'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn-secondary rt-btn-secondary"
                    onClick={() => handleOpenEdit(activeRoutine)}
                  >
                    <Edit3 size={14} />
                    <span>编辑</span>
                  </button>

                  <button
                    type="button"
                    className={`btn-secondary rt-btn-icon ${confirmDeleteId === activeRoutine.id ? 'is-confirming' : ''}`}
                    onClick={() => handleDelete(activeRoutine.id)}
                    title={confirmDeleteId === activeRoutine.id ? '再次点击确认删除' : '删除任务'}
                    aria-label="删除任务"
                  >
                    <Trash2 size={14} />
                    {confirmDeleteId === activeRoutine.id && <span>确认删除</span>}
                  </button>
                </div>
              </header>

              {/* 执行指令区 */}
              <section className="rt-section">
                <div className="rt-section-head">
                  <h3 className="rt-section-title">执行指令</h3>
                  <button
                    type="button"
                    className="rt-text-btn"
                    onClick={() =>
                      handleCopyText('webhook', webhookCurlCommand, 'Webhook 触发命令')
                    }
                    title="复制带鉴权的 Webhook curl 命令"
                  >
                    {copiedKey === 'webhook' ? <Check size={12} /> : <Link2 size={12} />}
                    <span>{copiedKey === 'webhook' ? '已复制 Webhook' : '复制 Webhook'}</span>
                  </button>
                </div>

                <div className={`rt-prompt-block ${isPromptExpanded ? 'is-expanded' : ''}`}>
                  {activeRoutine.instructions}
                </div>

                {(activeRoutine.instructions || '').length > 140 && (
                  <button
                    type="button"
                    className="rt-text-btn rt-expand-link"
                    onClick={() => setIsPromptExpanded((prev) => !prev)}
                  >
                    {isPromptExpanded ? '收起' : '展开全文'}
                  </button>
                )}

                {activePolicyNotes.length > 0 && (
                  <div className="rt-custom-policies">
                    {activePolicyNotes.join(' · ')}
                  </div>
                )}
              </section>

              {/* 执行记录区 */}
              <section className="rt-section">
                <div className="rt-section-head">
                  <div className="rt-section-title-group">
                    <h3 className="rt-section-title">执行记录</h3>
                    <span className="rt-section-count">{filteredRuns.length}</span>
                  </div>

                  <div className="rt-runs-controls">
                    <div className="rt-segmented">
                      <button
                        type="button"
                        className={`rt-seg-btn ${runFilter === 'all' ? 'is-active' : ''}`}
                        onClick={() => setRunFilter('all')}
                      >
                        全部
                      </button>
                      <button
                        type="button"
                        className={`rt-seg-btn ${runFilter === 'abnormal' ? 'is-active' : ''}`}
                        onClick={() => setRunFilter('abnormal')}
                      >
                        仅异常
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => loadRuns(activeRoutine.id)}
                      disabled={isRefreshingRuns}
                      className="rt-icon-refresh"
                      title="刷新执行记录"
                      aria-label="刷新执行记录"
                    >
                      <RefreshCw size={13} className={isRefreshingRuns ? 'spin' : ''} />
                    </button>
                  </div>
                </div>

                {filteredRuns.length === 0 ? (
                  <div className="rt-runs-empty">
                    {runs.length === 0
                      ? '暂无执行记录，点击右上角「立即运行」或等待周期触发。'
                      : '当前筛选下无异常记录。'}
                  </div>
                ) : (
                  <div className="rt-runs-table">
                    {filteredRuns.map((run) => {
                      const isExpanded = expandedRunIds.has(run.id);
                      const hasToolCalls = Boolean(run.toolCalls && run.toolCalls.length > 0);
                      const isRunning = run.status === 'running';
                      const isErrorState =
                        run.status === 'failed' ||
                        run.status === 'timeout' ||
                        run.status === 'interrupted';
                      const elapsedSeconds = isRunning
                        ? Math.max(0, Math.round((nowTick - run.startedAt) / 1000))
                        : null;
                      const reportContent = run.output || run.error || '';
                      const triggerLabel =
                        run.triggerSource === 'schedule'
                          ? '定时触发'
                          : run.triggerSource === 'webhook'
                          ? 'Webhook'
                          : '手动触发';

                      return (
                        <div key={run.id} className="rt-run-row">
                          <div
                            className="rt-run-row-head"
                            onClick={() => toggleRunExpand(run.id)}
                            role="button"
                            tabIndex={0}
                            aria-expanded={isExpanded}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleRunExpand(run.id);
                              }
                            }}
                          >
                            <div className="rt-run-row-left">
                              {run.status === 'success' ? (
                                <CheckCircle2 size={16} className="rt-run-icon is-success" />
                              ) : isRunning ? (
                                <Loader2 size={16} className="spin rt-run-icon is-running" />
                              ) : run.status === 'cancelled' ? (
                                <Square size={14} className="rt-run-icon is-cancelled" />
                              ) : run.status === 'timeout' ? (
                                <Clock size={16} className="rt-run-icon is-failed" />
                              ) : (
                                <XCircle size={16} className="rt-run-icon is-failed" />
                              )}

                              <div className="rt-run-summary-wrap">
                                <div className="rt-run-summary-text">
                                  {isRunning
                                    ? '正在执行...'
                                    : run.summary ||
                                      (run.status === 'success'
                                        ? '执行完成'
                                        : run.error || STATUS_LABELS[run.status])}
                                </div>

                                <div className="rt-run-meta-line">
                                  <span>{formatTime(run.startedAt)}</span>
                                  <span>·</span>
                                  <span>
                                    {isRunning && elapsedSeconds !== null
                                      ? `已运行 ${elapsedSeconds}s`
                                      : run.durationMs !== undefined
                                      ? `${(run.durationMs / 1000).toFixed(1)}s`
                                      : '-'}
                                  </span>
                                  <span>·</span>
                                  <span>{triggerLabel}</span>
                                  {run.quiet && <span className="rt-run-tag">静默</span>}
                                  {isErrorState && (
                                    <span className="rt-run-tag is-error">
                                      {STATUS_LABELS[run.status]}
                                    </span>
                                  )}
                                  {run.status === 'cancelled' && (
                                    <span className="rt-run-tag is-warn">已中止</span>
                                  )}
                                  {(run.attempt || 1) > 1 && (
                                    <span className="rt-run-tag">
                                      第 {run.attempt}/{run.maxAttempts || run.attempt} 次尝试
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div
                              className="rt-run-row-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isRunning && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelRun(run.id)}
                                  disabled={isCancelling}
                                  className="rt-run-stop-btn"
                                >
                                  停止
                                </button>
                              )}
                              <button
                                type="button"
                                className="rt-run-chevron-btn"
                                onClick={() => toggleRunExpand(run.id)}
                                aria-label={isExpanded ? '收起详情' : '展开详情'}
                              >
                                {isExpanded ? (
                                  <ChevronDown size={15} />
                                ) : (
                                  <ChevronRight size={15} />
                                )}
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="rt-run-row-body">
                              <div className="rt-run-body-actions">
                                {run.sessionId && !isRunning && (
                                  <button
                                    type="button"
                                    className="rt-text-btn"
                                    onClick={() => {
                                      selectSession(run.sessionId!);
                                      setTab('chat');
                                    }}
                                  >
                                    <MessageSquare size={12} />
                                    <span>查看完整会话</span>
                                  </button>
                                )}
                                {reportContent && !isRunning && (
                                  <button
                                    type="button"
                                    className="rt-text-btn"
                                    onClick={() =>
                                      handleCopyText(`run_${run.id}`, reportContent, '执行报告')
                                    }
                                  >
                                    {copiedKey === `run_${run.id}` ? (
                                      <Check size={12} />
                                    ) : (
                                      <Copy size={12} />
                                    )}
                                    <span>
                                      {copiedKey === `run_${run.id}` ? '已复制' : '复制报告'}
                                    </span>
                                  </button>
                                )}
                                {(isErrorState || run.status === 'cancelled') && (
                                  <button
                                    type="button"
                                    className="rt-text-btn"
                                    onClick={handleRunNow}
                                    disabled={isTriggering}
                                  >
                                    <RefreshCw size={12} className={isTriggering ? 'spin' : ''} />
                                    <span>重新运行</span>
                                  </button>
                                )}
                              </div>

                              {hasToolCalls && (
                                <div className="rt-run-trace-wrap">
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

                              {isRunning ? (
                                <div className="rt-run-running-note">
                                  <Loader2 size={14} className="spin" />
                                  <span>
                                    正在沙箱中执行任务（已运行 {elapsedSeconds}s）...
                                  </span>
                                </div>
                              ) : run.output ? (
                                <div
                                  className="markdown-body rt-run-markdown"
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(run.output) }}
                                />
                              ) : (
                                <pre className="rt-run-error-pre">
                                  {run.error || '无输出信息'}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>

      {/* 精简单页创建 / 编辑模态框 */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRoutineId ? '编辑定时任务' : '新建定时任务'}
        icon={<Clock size={18} />}
        footer={
          <div className="modal-actions-bar">
            <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleSaveRoutine}>
              {editingRoutineId ? '保存修改' : '创建并启用'}
            </button>
          </div>
        }
      >
        <div className="rt-modal-form">
          <div className="routine-form-row-2col">
            <div className="form-group">
              <label className="form-label">任务名称</label>
              <input
                type="text"
                className="form-control"
                placeholder="例如：每日磁盘与服务巡检"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">执行员工</label>
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
          </div>

          <div className="form-group">
            <div className="rt-field-label-row">
              <label className="form-label">执行指令</label>
              {!editingRoutineId && (
                <div className="rt-template-links">
                  {QUICK_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className="rt-template-link"
                      onClick={() => applyTemplate(tpl)}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              className="form-control"
              rows={3}
              placeholder="描述需要执行的操作、排查要点与汇报方式；若正常无需通知可要求在结尾注明【无异常】"
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
            />
          </div>

          <div className="form-group">
            <div className="rt-field-label-row">
              <label className="form-label">执行时间</label>
              <select
                className="form-control routine-tz-select"
                value={formTimezone}
                onChange={(e) => setFormTimezone(e.target.value)}
                aria-label="调度时区"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
            <SchedulePicker
              value={formCron}
              timezone={formTimezone}
              onChange={(nextCron, kind) => {
                setFormCron(nextCron);
                if (kind) setFormScheduleKind(kind);
              }}
            />
          </div>

          <div className="routine-advanced-wrap">
            <button
              type="button"
              className="schedule-ai-advanced-toggle"
              onClick={() => setShowAdvancedPolicies((prev) => !prev)}
              aria-expanded={showAdvancedPolicies}
            >
              <span className="routine-advanced-toggle-title">
                <SlidersHorizontal size={13} />
                更多设置
              </span>
              {showAdvancedPolicies ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {showAdvancedPolicies && (
              <div className="routine-advanced-panel">
                <div className="routine-form-row-2col">
                  <div className="form-group">
                    <label className="form-label">结果交付渠道</label>
                    <select
                      className="form-control"
                      value={formDeliverTo}
                      onChange={(e) => setFormDeliverTo(e.target.value as DeliverTarget)}
                    >
                      <option value="feed">团队动态流 (Feed)</option>
                      <option value="silent">完全静默 (仅写日志)</option>
                      <option value="im_webhook">外部 IM / Webhook</option>
                      <option value="all">全渠道推送</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">并发重叠处理</label>
                    <select
                      className="form-control"
                      value={formOverlap}
                      onChange={(e) => setFormOverlap(e.target.value as OverlapPolicy)}
                    >
                      <option value="skip">跳过本次</option>
                      <option value="queue">排队等待</option>
                    </select>
                  </div>
                </div>

                {(formDeliverTo === 'im_webhook' || formDeliverTo === 'all') && (
                  <div className="form-group">
                    <label className="form-label">外部回调 Webhook URL（可选）</label>
                    <input
                      type="url"
                      className="form-control"
                      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                      value={formWebhookUrl}
                      onChange={(e) => setFormWebhookUrl(e.target.value)}
                    />
                  </div>
                )}

                <div className="routine-form-row-2col">
                  <div className="form-group">
                    <label className="form-label">错过窗口策略</label>
                    <select
                      className="form-control"
                      value={formMisfirePolicy}
                      onChange={(e) => setFormMisfirePolicy(e.target.value as MisfirePolicy)}
                    >
                      <option value="skip">跳过过期触发</option>
                      <option value="run_once">服务恢复后补跑一次</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">专属模型覆盖（可选）</label>
                    <input
                      type="text"
                      list="routine-model-choices"
                      className="form-control"
                      placeholder="留空则跟随员工默认模型"
                      value={formModelOverride}
                      onChange={(e) => setFormModelOverride(e.target.value)}
                    />
                    <datalist id="routine-model-choices">
                      {modelChoices.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="routine-form-row-4col">
                  <div className="form-group">
                    <label className="form-label">超时 (秒)</label>
                    <input
                      type="number"
                      min={10}
                      max={3600}
                      className="form-control"
                      value={formTimeoutSeconds}
                      onChange={(e) => setFormTimeoutSeconds(Number(e.target.value))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">重试次数</label>
                    <input
                      type="number"
                      min={0}
                      max={3}
                      className="form-control"
                      value={formMaxRetries}
                      onChange={(e) => setFormMaxRetries(Number(e.target.value))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">熔断阈值</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className="form-control"
                      value={formBreakerThreshold}
                      onChange={(e) => setFormBreakerThreshold(Number(e.target.value))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">抖动 (秒)</label>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      className="form-control"
                      value={formJitterSeconds}
                      onChange={(e) => setFormJitterSeconds(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="form-group-checkbox">
                  <input
                    type="checkbox"
                    id="deleteAfterRun"
                    checked={formDeleteAfterRun}
                    onChange={(e) => setFormDeleteAfterRun(e.target.checked)}
                  />
                  <label htmlFor="deleteAfterRun" className="checkbox-label">
                    单次定时完成后自动暂停归档
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </section>
  );
};
