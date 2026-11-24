import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Clock,
  Plus,
  Play,
  Square,
  Trash2,
  Power,
  Search,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Calendar,
  ChevronDown,
  ChevronRight,
  Edit3,
  Bot as BotIcon,
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
    label: '💼 工作日系统巡检',
    name: '工作站资源与服务健康巡检',
    cron: '0 9 * * 1-5',
    kind: 'cron',
    instructions:
      '请检查工作站系统磁盘、内存与关键服务运行状态，若有异常指标重点告警；若一切正常请在结尾注明【无异常】。',
  },
  {
    id: 'freq_monitor',
    label: '⚡ 30 分钟高频监控',
    name: '关键端口与服务可用性监控',
    cron: '*/30 * * * *',
    kind: 'every',
    instructions:
      '每隔 30 分钟核查核心端口与依赖服务连通性，发现异常记录排查建议；若无异常输出【正常】。',
  },
  {
    id: 'weekly_report',
    label: '📋 周五下班周报汇总',
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

export const RoutinesView: React.FC = () => {
  const { bots, showToast, selectSession, setTab, modelsConfig } = useApp();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [activeRoutineId, setActiveRoutineId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'abnormal' | 'paused'>('all');
  const [runFilter, setRunFilter] = useState<'all' | 'abnormal' | 'quiet'>('all');
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
      showToast(`例行任务加载失败：${err.message}`, 'error');
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
        showToast(`执行流水加载失败：${err.message}`, 'error');
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

  // 存在运行中任务时：2s 轮询状态 + 1s 更新实时计时器
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

  // 统计指标
  const statsSummary = useMemo(() => {
    const total = routines.length;
    const activeCount = routines.filter((r) => r.enabled).length;
    const abnormalCount = routines.filter((r) => isAbnormalRoutine(r)).length;
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
    const successRate =
      totalExecutions > 0 ? Math.round((successfulExecutions / totalExecutions) * 100) : 0;

    return {
      total,
      activeCount,
      abnormalCount,
      totalExecutions,
      successRate,
      failedTotal,
    };
  }, [routines]);

  // 左侧列表筛选
  const filteredRoutines = useMemo(() => {
    return routines.filter((r) => {
      if (filterTab === 'active' && !r.enabled) return false;
      if (filterTab === 'abnormal' && !isAbnormalRoutine(r)) return false;
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

  // 右侧流水筛选
  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (runFilter === 'abnormal') {
        return run.status === 'failed' || run.status === 'timeout' || run.status === 'interrupted';
      }
      if (runFilter === 'quiet') {
        return Boolean(run.quiet);
      }
      return true;
    });
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

  // 打开创建弹窗
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

  // 打开编辑弹窗
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
    showToast(`已填充模板「${tpl.label}」`, 'info');
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
        showToast('例行任务配置已更新', 'success');
      } else {
        const created = await api.createRoutine({ ...payload, enabled: true });
        setRoutines((prev) => [created, ...prev]);
        setActiveRoutineId(created.id);
        showToast('新建例行任务成功', 'success');
      }
      setIsModalOpen(false);
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    }
  };

  // 启停 / 熔断恢复切换
  const handleToggleEnable = async (r: Routine, forceEnable?: boolean) => {
    try {
      const nextEnabled = forceEnable !== undefined ? forceEnable : !r.enabled;
      const updated = await api.updateRoutine(r.id, { enabled: nextEnabled });
      setRoutines((prev) => prev.map((item) => (item.id === r.id ? updated : item)));
      showToast(
        forceEnable ? '已重置熔断计数并恢复自动调度' : `任务已${nextEnabled ? '恢复自动调度' : '暂停'}`,
        'info'
      );
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
    setIsTriggering(true);
    try {
      await api.runRoutine(activeRoutine.id);
      showToast('任务已触发启动，正在沙箱中执行...', 'success');
      await loadRuns(activeRoutine.id);
      await loadRoutines();
    } catch (err: any) {
      showToast(`触发失败: ${err.message}`, 'error');
      setIsTriggering(false);
    }
  };

  // 停止执行中的任务
  const handleCancelRun = async (runId?: string) => {
    if (!activeRoutine) return;
    const targetRunId = runId || activeRunningRun?.id;
    if (!targetRunId) return;
    setIsCancelling(true);
    try {
      await api.cancelRoutineRun(targetRunId);
      showToast('已发送停止指令，正在中止任务...', 'info');
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
            <span className="rt-stat-label">异常 / 失败</span>
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
                活跃 ({routines.filter((r) => r.enabled).length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('abnormal')}
                className={`routines-tab-btn ${filterTab === 'abnormal' ? 'active active-red' : ''}`}
              >
                异常 ({statsSummary.abnormalCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('paused')}
                className={`routines-tab-btn ${filterTab === 'paused' ? 'active active-amber' : ''}`}
              >
                暂停 ({routines.filter((r) => !r.enabled).length})
              </button>
            </div>
          </div>

          <div className="routines-list-scroll">
            {loadingList && routines.length === 0 ? (
              <div className="routine-skeleton-list" aria-label="加载中">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="routine-nav-skeleton" />
                ))}
              </div>
            ) : filteredRoutines.length === 0 ? (
              <div className="routine-nav-empty">没有匹配的例行任务</div>
            ) : (
              filteredRoutines.map((r) => {
                const isActive = r.id === activeRoutineId;
                const botObj =
                  bots.find((b) => b.id === r.agentId) || (bots.length > 0 ? bots[0] : null);
                const humanZh = r.scheduleHumanZh || formatCronZh(r.cronExpr);
                const isRunningItem = r.status === 'running';
                const isBroken = Boolean(r.circuitBrokenAt);
                const outcomes = r.recentOutcomes || [];
                const sparkSlots = Array.from({ length: 10 }, (_, idx) => {
                  const outcomeIdx = outcomes.length - 10 + idx;
                  return outcomeIdx >= 0 ? outcomes[outcomeIdx] : null;
                });

                return (
                  <div
                    key={r.id}
                    onClick={() => setActiveRoutineId(r.id)}
                    className={`routine-nav-item ${isActive ? 'is-active' : ''} ${isBroken ? 'is-broken' : ''}`}
                  >
                    <div className="routine-nav-top-row">
                      <span className="routine-nav-name">{r.name}</span>
                      {isRunningItem ? (
                        <span className="routine-nav-status-badge is-executing">
                          <span className="routine-pulse-dot" /> 执行中
                        </span>
                      ) : isBroken ? (
                        <span className="routine-nav-status-badge is-broken">熔断暂停</span>
                      ) : (
                        <span
                          className={`routine-nav-status-badge ${r.enabled ? 'is-running' : 'is-paused'}`}
                        >
                          {r.enabled ? '运行中' : '已暂停'}
                        </span>
                      )}
                    </div>

                    <div className="routine-nav-schedule-line">
                      <Calendar size={12} className="flex-shrink-0" />
                      <span>{humanZh}</span>
                    </div>

                    <div className="routine-nav-meta-line">
                      <span className="routine-nav-bot-tag">
                        <BotIcon size={12} /> {botObj?.name || r.agentId || '数字员工'}
                      </span>
                      <div className="routine-sparkline" title="最近 10 次执行健康轨迹">
                        {sparkSlots.map((st, idx) => (
                          <span
                            key={idx}
                            className={`routine-spark-bar ${
                              st === 'success'
                                ? 'is-success'
                                : st === 'failed' || st === 'timeout' || st === 'interrupted'
                                ? 'is-failed'
                                : st === 'cancelled'
                                ? 'is-cancelled'
                                : 'is-empty'
                            }`}
                          />
                        ))}
                      </div>
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
              <div className="routine-empty-title">选择或创建自动化例行任务</div>
              <div className="routine-empty-desc">
                数字员工将按照设定的周期在受控沙箱内自主巡检、收集日志、排查风险并在需要时通报结论。
              </div>
              <button type="button" className="btn-primary" onClick={handleOpenCreate}>
                <Plus size={15} /> 立即创建第一个任务
              </button>
            </div>
          ) : (
            <div className="routine-detail-wrapper">
              {/* 熔断告警条 */}
              {activeRoutine.circuitBrokenAt && (
                <div className="routine-breaker-banner" role="alert">
                  <div className="routine-breaker-info">
                    <AlertTriangle size={16} />
                    <span>
                      该任务因连续失败 {activeRoutine.consecutiveFailures || 0} 次已自动熔断暂停，避免无效消耗算力。
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary routine-breaker-reset-btn"
                    onClick={() => handleToggleEnable(activeRoutine, true)}
                  >
                    重置并恢复调度
                  </button>
                </div>
              )}

              {/* 顶部标题与快捷操作栏 */}
              <div className="routine-detail-header-card">
                <div className="routine-detail-top-row">
                  <div className="routine-detail-heading-group">
                    <div className="routine-detail-title-line">
                      <h2 className="routine-detail-name">{activeRoutine.name}</h2>
                      {activeRoutine.status === 'running' || activeRunningRun ? (
                        <span className="routine-detail-status-pill is-executing">
                          <span className="routine-pulse-dot" /> 沙箱执行中
                        </span>
                      ) : activeRoutine.circuitBrokenAt ? (
                        <span className="routine-detail-status-pill is-broken">⚠ 已熔断暂停</span>
                      ) : (
                        <span
                          className={`routine-detail-status-pill ${activeRoutine.enabled ? 'is-running' : 'is-paused'}`}
                        >
                          {activeRoutine.enabled ? '● 调度运行中' : '⏸ 调度已暂停'}
                        </span>
                      )}
                      {activeRoutine.hasQueuedRun && (
                        <span className="routine-queued-pill">已排队等待下轮</span>
                      )}
                    </div>

                    <div className="routine-detail-meta-list">
                      <span className="routine-detail-meta-item">
                        <BotIcon size={14} /> 责任员工:{' '}
                        <strong>{assignedBot?.name || activeRoutine.agentId}</strong>
                      </span>
                      <span className="routine-detail-meta-item">
                        <Calendar size={14} /> 调度周期:{' '}
                        <strong>
                          {activeRoutine.scheduleHumanZh || formatCronZh(activeRoutine.cronExpr)}
                        </strong>
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
                        <span className="routine-detail-meta-item">
                          上次运行: {formatTime(activeRoutine.lastRunAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 动作按钮组 */}
                  <div className="routine-detail-actions">
                    {activeRunningRun || activeRoutine.status === 'running' ? (
                      <button
                        type="button"
                        className="btn-secondary routine-action-btn is-danger"
                        onClick={() => handleCancelRun(activeRunningRun?.id)}
                        disabled={isCancelling || !activeRunningRun}
                      >
                        <Square size={13} fill="currentColor" />
                        <span>{isCancelling ? '停止中...' : '停止执行'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary routine-action-btn"
                        onClick={handleRunNow}
                        disabled={isTriggering}
                      >
                        {isTriggering ? (
                          <Loader2 size={14} className="spin" />
                        ) : (
                          <Play size={14} />
                        )}
                        <span>{isTriggering ? '触发中...' : '立即运行'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary routine-action-btn"
                      onClick={() => handleToggleEnable(activeRoutine)}
                    >
                      <Power size={14} />{' '}
                      <span>{activeRoutine.enabled ? '暂停调度' : '恢复调度'}</span>
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

              {/* 任务指令与策略速览卡 */}
              <div className="routine-overview-card">
                <div className="routine-overview-top">
                  <div className="routine-overview-label">执行指令与调度策略</div>
                  <div className="routine-overview-actions">
                    <button
                      type="button"
                      className="routine-overview-copy-btn"
                      onClick={() =>
                        handleCopyText('webhook', webhookCurlCommand, 'Webhook 触发命令')
                      }
                      title="复制带 Bearer 鉴权的 Webhook curl 触发命令"
                    >
                      {copiedKey === 'webhook' ? <Check size={12} /> : <Link2 size={12} />}
                      <span>{copiedKey === 'webhook' ? '已复制 Webhook' : '复制 Webhook'}</span>
                    </button>
                  </div>
                </div>

                <div
                  className={`routine-overview-prompt ${isPromptExpanded ? 'is-expanded' : ''}`}
                >
                  {activeRoutine.instructions}
                </div>
                {(activeRoutine.instructions || '').length > 140 && (
                  <button
                    type="button"
                    className="routine-overview-expand-btn"
                    onClick={() => setIsPromptExpanded((prev) => !prev)}
                  >
                    {isPromptExpanded ? '收起指令' : '展开完整指令'}
                  </button>
                )}

                <div className="routine-policy-chips">
                  <span className="routine-policy-chip">
                    交付: {DELIVER_LABELS[activeRoutine.deliverTo || 'feed'] || '动态流 Feed'}
                  </span>
                  <span className="routine-policy-chip">
                    并发: {activeRoutine.overlap === 'queue' ? '排队等待' : '跳过重叠'}
                  </span>
                  <span className="routine-policy-chip">
                    超时: {activeRoutine.timeoutSeconds || 300}s
                  </span>
                  <span className="routine-policy-chip">
                    重试: {activeRoutine.maxRetries ?? 0} 次
                  </span>
                  <span className="routine-policy-chip">
                    时区: {activeRoutine.timezone || 'Asia/Shanghai'}
                  </span>
                  <span className="routine-policy-chip">
                    过期窗口: {activeRoutine.misfirePolicy === 'run_once' ? '补跑一次' : '跳过过期'}
                  </span>
                  {activeRoutine.modelOverride && (
                    <span className="routine-policy-chip is-accent">
                      模型: {activeRoutine.modelOverride}
                    </span>
                  )}
                </div>
              </div>

              {/* 历史执行流水与工具调用链 */}
              <div className="routine-runs-section">
                <div className="routine-runs-header">
                  <div className="routine-runs-title-group">
                    <h3 className="routine-runs-heading">执行流水与输出报告</h3>
                    <span className="routine-runs-count-badge">({filteredRuns.length} 条)</span>
                  </div>

                  <div className="routine-runs-toolbar">
                    <div className="routine-runs-filter-pills">
                      <button
                        type="button"
                        className={`routine-run-filter-pill ${runFilter === 'all' ? 'is-active' : ''}`}
                        onClick={() => setRunFilter('all')}
                      >
                        全部
                      </button>
                      <button
                        type="button"
                        className={`routine-run-filter-pill ${runFilter === 'abnormal' ? 'is-active' : ''}`}
                        onClick={() => setRunFilter('abnormal')}
                      >
                        仅异常
                      </button>
                      <button
                        type="button"
                        className={`routine-run-filter-pill ${runFilter === 'quiet' ? 'is-active' : ''}`}
                        onClick={() => setRunFilter('quiet')}
                      >
                        静默
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => loadRuns(activeRoutine.id)}
                      disabled={isRefreshingRuns}
                      className="routine-runs-refresh-btn"
                    >
                      <RefreshCw size={12} className={isRefreshingRuns ? 'spin' : ''} /> 刷新
                    </button>
                  </div>
                </div>

                {filteredRuns.length === 0 ? (
                  <div className="routine-runs-empty">
                    {runs.length === 0
                      ? '暂无执行流水记录，可点击上方「立即运行」或等待定时调度触发。'
                      : '当前筛选条件下没有匹配的执行记录。'}
                  </div>
                ) : (
                  <div className="routine-runs-list">
                    {filteredRuns.map((run) => {
                      const isExpanded = expandedRunIds.has(run.id);
                      const hasToolCalls = run.toolCalls && run.toolCalls.length > 0;
                      const isRunning = run.status === 'running';
                      const isErrorState =
                        run.status === 'failed' ||
                        run.status === 'timeout' ||
                        run.status === 'interrupted';
                      const elapsedSeconds = isRunning
                        ? Math.max(0, Math.round((nowTick - run.startedAt) / 1000))
                        : null;
                      const reportContent = run.output || run.error || '';

                      return (
                        <div key={run.id} className="routine-run-card">
                          <div
                            className={`routine-run-summary-row ${isExpanded ? 'is-expanded' : ''}`}
                          >
                            <div className="routine-run-main-info">
                              {run.status === 'success' ? (
                                <CheckCircle size={17} className="routine-run-status-icon is-success" />
                              ) : isRunning ? (
                                <Loader2 size={17} className="spin routine-run-status-icon is-running" />
                              ) : run.status === 'cancelled' ? (
                                <Square size={15} className="routine-run-status-icon is-cancelled" />
                              ) : (
                                <XCircle size={17} className="routine-run-status-icon is-failed" />
                              )}

                              <div className="routine-run-text-col">
                                <div className="routine-run-summary-line">
                                  <span
                                    title={run.summary || run.error || ''}
                                    className="routine-run-title"
                                  >
                                    {isRunning
                                      ? '正在沙箱中执行巡检...'
                                      : run.summary ||
                                        (run.status === 'success'
                                          ? '巡检完成'
                                          : run.error || STATUS_LABELS[run.status])}
                                  </span>
                                  <span className={`routine-run-state-badge is-${run.status}`}>
                                    {STATUS_LABELS[run.status] || run.status}
                                  </span>
                                  {run.quiet && (
                                    <span className="routine-run-quiet-badge">静默无异常</span>
                                  )}
                                  {(run.attempt || 1) > 1 && (
                                    <span className="routine-run-source-badge">
                                      第 {run.attempt}/{run.maxAttempts || run.attempt} 次尝试
                                    </span>
                                  )}
                                  <span className="routine-run-source-badge">
                                    {run.triggerSource === 'schedule'
                                      ? '⏰ 定时'
                                      : run.triggerSource === 'webhook'
                                      ? '⚡ Webhook'
                                      : '👤 手动'}
                                  </span>
                                </div>
                                <div className="routine-run-meta-line">
                                  <span>{formatTime(run.startedAt)}</span>
                                  {isRunning && elapsedSeconds !== null && (
                                    <span> · 已运行 {elapsedSeconds}s</span>
                                  )}
                                  {!isRunning && run.durationMs !== undefined && (
                                    <span> · 耗时 {(run.durationMs / 1000).toFixed(1)}s</span>
                                  )}
                                  {hasToolCalls && (
                                    <span> · 调用了 {run.toolCalls?.length} 个工具</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="routine-run-actions">
                              {isRunning && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelRun(run.id)}
                                  disabled={isCancelling}
                                  className="btn-secondary routine-run-stop-btn"
                                  title="中止本次执行"
                                >
                                  <Square size={11} fill="currentColor" />
                                  <span>停止</span>
                                </button>
                              )}
                              {run.sessionId && !isRunning && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    selectSession(run.sessionId!);
                                    setTab('chat');
                                  }}
                                  className="routine-run-expand-btn"
                                  title="在对话工作台打开本次执行完整会话"
                                >
                                  <MessageSquare size={11} />
                                  <span>查看会话</span>
                                </button>
                              )}
                              {isErrorState && (
                                <button
                                  type="button"
                                  onClick={handleRunNow}
                                  disabled={isTriggering}
                                  className="btn-secondary routine-run-retry-btn"
                                  title="重新触发一次此例行任务"
                                >
                                  <RefreshCw size={11} className={isTriggering ? 'spin' : ''} />
                                  <span>重试</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleRunExpand(run.id)}
                                className="routine-run-expand-btn"
                              >
                                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                <span>{isExpanded ? '收起' : '详情'}</span>
                              </button>
                            </div>
                          </div>

                          {/* 展开的详情输出与工具调用链 */}
                          {isExpanded && (
                            <div className="routine-run-details">
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

                              <div className="routine-run-output-header">
                                <span className="routine-run-output-title">产出报告与执行结论</span>
                                {reportContent && !isRunning && (
                                  <button
                                    type="button"
                                    className="routine-instructions-copy-btn"
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
                              </div>

                              {isRunning ? (
                                <div className="routine-run-output-pre">
                                  <div className="routine-run-running-msg">
                                    <Loader2 size={14} className="spin" />
                                    <span>
                                      数字员工正在受控沙箱中执行任务（已运行 {elapsedSeconds}s）...
                                    </span>
                                  </div>
                                </div>
                              ) : run.output ? (
                                <div
                                  className="markdown-body routine-run-markdown"
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(run.output) }}
                                />
                              ) : (
                                <pre className="routine-run-output-pre">
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
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 精简单页创建 / 编辑模态框 */}
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
              {editingRoutineId ? '保存修改' : '保存并启动调度'}
            </button>
          </div>
        }
      >
        <div className="routine-modal-container">
          {!editingRoutineId && (
            <div className="routine-template-strip">
              <span className="routine-ai-chips-label">常用模板:</span>
              {QUICK_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className="routine-ai-chip-btn"
                  onClick={() => applyTemplate(tpl)}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          )}

          <div className="routine-modal-form-group">
            <div className="routine-form-row-2col">
              <div className="form-group">
                <label className="form-label">任务名称 *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="例如：工作站资源与磁盘空间健康巡检"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">指派执行数字员工 *</label>
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
              <label className="form-label">任务执行指引 (Prompt 指令) *</label>
              <textarea
                className="form-control"
                rows={3}
                placeholder="请描述数字员工在沙箱内需要执行的检查步骤、判断依据以及输出格式；若无异常可提示在结尾标注【无异常】实现静默..."
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
              />
            </div>

            <div className="routine-schedule-section">
              <div className="routine-schedule-section-head">
                <label className="form-label">调度周期与时区</label>
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

            {/* 折叠高级策略区 */}
            <div className="routine-advanced-wrap">
              <button
                type="button"
                className="schedule-ai-advanced-toggle"
                onClick={() => setShowAdvancedPolicies((prev) => !prev)}
                aria-expanded={showAdvancedPolicies}
              >
                <span className="routine-advanced-toggle-title">
                  <SlidersHorizontal size={13} />
                  高级策略（交付渠道、并发队列、超时、重试、熔断、Misfire）
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
                      <label className="form-label">并发防重叠策略</label>
                      <select
                        className="form-control"
                        value={formOverlap}
                        onChange={(e) => setFormOverlap(e.target.value as OverlapPolicy)}
                      >
                        <option value="skip">跳过本次 (Skip)</option>
                        <option value="queue">排队等待 (Queue)</option>
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
                      <label className="form-label">错过窗口策略 (Misfire)</label>
                      <select
                        className="form-control"
                        value={formMisfirePolicy}
                        onChange={(e) => setFormMisfirePolicy(e.target.value as MisfirePolicy)}
                      >
                        <option value="skip">跳过过期触发 (推荐)</option>
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
                      <label className="form-label">超时限制 (秒)</label>
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
                      <label className="form-label">失败重试 (0-3)</label>
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
                      <label className="form-label">熔断阈值 (次)</label>
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
                      <label className="form-label">错峰抖动 (秒)</label>
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
                      单次定时完成后自动归档暂停 (适用于 @at 单次任务)
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </section>
  );
};
