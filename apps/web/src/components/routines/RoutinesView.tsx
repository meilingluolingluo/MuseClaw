import React, { useState, useEffect, useMemo, useRef, useCallback, useId } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Edit3,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  Bot,
  DeliverTarget,
  Routine,
  RoutineRun,
  RoutineRunStatus,
  ScheduleKind,
} from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { BotAvatar } from '../common/BotAvatar';
import { ToolTrace } from '../chat/ToolTrace';
import { formatRelativeTime, formatTime } from '../../utils/format';
import {
  formatCronZh,
  formatNextRunFriendly,
  validateCronExpr,
} from '../../utils/cronHelper';
import { renderMarkdown } from '../../utils/markdown';
import { copyToClipboard } from '../../utils/clipboard';
import { SchedulePicker } from './SchedulePicker';
import { RoutineDetailDrawer } from './RoutineDetailDrawer';

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
  { value: 'UTC', label: 'UTC (协调世界时)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'Europe/London', label: 'Europe/London' },
];

interface QuickTemplate {
  id: string;
  label: string;
  name: string;
  desc: string;
  cron: string;
  kind: ScheduleKind;
  instructions: string;
}

const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    id: 'daily_brief',
    label: '每日简报',
    name: '每日工作与日程简报',
    desc: '每天早间汇总待办事项与昨日进展',
    cron: '0 9 * * 1-5',
    kind: 'cron',
    instructions:
      '请汇总今日待跟进目标、近期动态摘要与需要关注的异常事项，输出结构清晰的晨间简报。',
  },
  {
    id: 'git_inspect',
    label: '代码巡检',
    name: '工作区与 Git 未提交巡检',
    desc: '下班前核查未提交变更与分支状态',
    cron: '0 18 * * 1-5',
    kind: 'cron',
    instructions:
      '执行 git status 检查当前工作区暂存与未暂存文件，列出当日遗留变更并给出清理或提交建议。',
  },
  {
    id: 'sys_health',
    label: '服务健康',
    name: '工作站资源与端口健康检查',
    desc: '定期检查磁盘、内存与核心端口可用性',
    cron: '*/30 * * * *',
    kind: 'every',
    instructions:
      '检查工作站磁盘空间、内存余量及核心服务端口连通性；若指标正常请在结尾注明【无异常】，发现问题重点告警。',
  },
  {
    id: 'weekly_report',
    label: '周五周报',
    name: '本周工作与变更汇总周报',
    desc: '每周五自动整理本周成果与下周计划',
    cron: '0 18 * * 5',
    kind: 'cron',
    instructions:
      '汇总本周完成的主要工作、代码与文档变更记录及下周待跟进项，按 Markdown 列表输出周报。',
  },
];

const EMPTY_STARTER_IDS = ['daily_brief', 'git_inspect', 'sys_health'];

const STATUS_LABELS: Record<RoutineRunStatus, string> = {
  running: '执行中',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  cancelled: '已中止',
  interrupted: '重启中断',
};

const TRIGGER_LABELS: Record<string, string> = {
  schedule: '定时',
  webhook: 'Webhook',
  manual: '手动',
};

function isAbnormalRoutine(r: Routine): boolean {
  return Boolean(
    r.circuitBrokenAt ||
      r.lastStatus === 'failed' ||
      r.lastStatus === 'timeout' ||
      r.lastStatus === 'interrupted'
  );
}

function resolveBot(bots: Bot[], agentId?: string): Bot | null {
  if (bots.length === 0) return null;
  if (!agentId) return bots[0];
  return bots.find((b) => b.id === agentId) || bots[0];
}

export const RoutinesView: React.FC = () => {
  const { bots, showToast, selectSession, setTab, modelsConfig } = useApp();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeSubView, setActiveSubView] = useState<'tasks' | 'runs'>('tasks');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'abnormal'>('all');

  // 详情抽屉状态
  const [drawerRoutineId, setDrawerRoutineId] = useState<string | null>(null);
  const [drawerRuns, setDrawerRuns] = useState<RoutineRun[]>([]);
  const [loadingDrawerRuns, setLoadingDrawerRuns] = useState(false);

  // 全局最近执行状态
  const [globalRuns, setGlobalRuns] = useState<RoutineRun[]>([]);
  const [loadingGlobalRuns, setLoadingGlobalRuns] = useState(false);
  const [globalRunFilter, setGlobalRunFilter] = useState<'all' | 'abnormal'>('all');
  const [expandedGlobalRunIds, setExpandedGlobalRunIds] = useState<Set<string>>(new Set());

  // 操作繁忙状态
  const [triggeringIds, setTriggeringIds] = useState<Set<string>>(new Set());
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 新建 / 编辑弹窗
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [savingForm, setSavingForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isScheduleValid, setIsScheduleValid] = useState(true);

  const [formName, setFormName] = useState('');
  const [formAgentId, setFormAgentId] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formScheduleKind, setFormScheduleKind] = useState<ScheduleKind>('cron');
  const [formCron, setFormCron] = useState('0 9 * * 1-5');
  const [formDeliverTo, setFormDeliverTo] = useState<DeliverTarget>('feed');
  const [formWebhookUrl, setFormWebhookUrl] = useState('');
  const [formModelOverride, setFormModelOverride] = useState('');
  const [formTimezone, setFormTimezone] = useState('Asia/Shanghai');

  const nameInputId = useId();
  const promptInputId = useId();
  const deliverSelectId = useId();
  const webhookInputId = useId();
  const modelInputId = useId();
  const modelListId = useId();
  const timezoneSelectId = useId();

  const loadRoutines = useCallback(async (silent = false) => {
    try {
      const data = await api.getRoutines();
      const list = Array.isArray(data) ? data : [];
      setRoutines(list);
      setLoadError(null);
    } catch (err: any) {
      console.error('Failed to load routines:', err);
      const msg = err?.message || '定时任务加载失败';
      setLoadError(msg);
      if (!silent) {
        showToast(`定时任务加载失败：${msg}`, 'error');
      }
    } finally {
      setLoadingList(false);
    }
  }, [showToast]);

  const loadAllRuns = useCallback(async (silent = false) => {
    if (!silent) setLoadingGlobalRuns(true);
    try {
      const list = await api.getAllRoutineRuns();
      setGlobalRuns(Array.isArray(list) ? list : []);
    } catch (err: any) {
      console.error('Failed to load all routine runs:', err);
      if (!silent) {
        showToast(`执行记录加载失败：${err?.message || '请求异常'}`, 'error');
      }
    } finally {
      setLoadingGlobalRuns(false);
    }
  }, [showToast]);

  const loadDrawerRuns = useCallback(
    async (routineId: string, silent = false) => {
      if (!silent) setLoadingDrawerRuns(true);
      try {
        const list = await api.getRoutineRuns(routineId);
        setDrawerRuns(Array.isArray(list) ? list : []);
      } catch (err: any) {
        console.error('Failed to load routine runs:', err);
        if (!silent) {
          showToast(`执行记录加载失败：${err?.message || '请求异常'}`, 'error');
        }
      } finally {
        setLoadingDrawerRuns(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    void loadRoutines();
    void loadAllRuns(true);
  }, [loadRoutines, loadAllRuns]);

  useEffect(() => {
    if (drawerRoutineId) {
      void loadDrawerRuns(drawerRoutineId);
    } else {
      setDrawerRuns([]);
    }
  }, [drawerRoutineId, loadDrawerRuns]);

  useEffect(() => {
    if (activeSubView === 'runs') {
      void loadAllRuns();
    }
  }, [activeSubView, loadAllRuns]);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const hasAnyRunning = useMemo(
    () =>
      routines.some((r) => r.status === 'running') ||
      globalRuns.some((run) => run.status === 'running') ||
      drawerRuns.some((run) => run.status === 'running') ||
      triggeringIds.size > 0,
    [routines, globalRuns, drawerRuns, triggeringIds]
  );

  useEffect(() => {
    if (!hasAnyRunning) return;

    const pollTimer = setInterval(() => {
      void loadRoutines(true);
      void loadAllRuns(true);
      if (drawerRoutineId) {
        void loadDrawerRuns(drawerRoutineId, true);
      }
    }, 2500);

    const tickTimer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => {
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, [hasAnyRunning, drawerRoutineId, loadRoutines, loadAllRuns, loadDrawerRuns]);

  const drawerRoutine = useMemo(
    () => (drawerRoutineId ? routines.find((r) => r.id === drawerRoutineId) || null : null),
    [routines, drawerRoutineId]
  );

  const modelChoices = useMemo(() => {
    const names = new Set<string>();
    for (const p of modelsConfig?.instances || []) {
      if (p.model) names.add(p.model);
      for (const m of p.snapshot?.models || []) names.add(m.slug);
      for (const m of p.customModels || []) names.add(m);
    }
    return Array.from(names).filter(Boolean);
  }, [modelsConfig]);

  const summaryStats = useMemo(() => {
    const activeCount = routines.filter((r) => r.enabled).length;
    const pausedCount = routines.length - activeCount;
    const abnormalCount = routines.filter(isAbnormalRoutine).length;
    const runningCount = routines.filter((r) => r.status === 'running').length;
    return { activeCount, pausedCount, abnormalCount, runningCount };
  }, [routines]);

  const filteredRoutines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return routines.filter((r) => {
      if (statusFilter === 'active' && !r.enabled) return false;
      if (statusFilter === 'paused' && r.enabled) return false;
      if (statusFilter === 'abnormal' && !isAbnormalRoutine(r)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.instructions || '').toLowerCase().includes(q) ||
        (r.scheduleHumanZh || '').toLowerCase().includes(q)
      );
    });
  }, [routines, statusFilter, searchQuery]);

  const filteredGlobalRuns = useMemo(() => {
    if (globalRunFilter === 'abnormal') {
      return globalRuns.filter(
        (run) =>
          run.status === 'failed' || run.status === 'timeout' || run.status === 'interrupted'
      );
    }
    return globalRuns;
  }, [globalRuns, globalRunFilter]);

  const openCreateModal = (preset?: QuickTemplate) => {
    setEditingRoutineId(null);
    setFormName(preset ? preset.name : '');
    setFormAgentId(bots[0]?.id || 'muse');
    setFormPrompt(preset ? preset.instructions : '');
    setFormScheduleKind(preset ? preset.kind : 'cron');
    setFormCron(preset ? preset.cron : '0 9 * * 1-5');
    setFormDeliverTo('feed');
    setFormWebhookUrl('');
    setFormModelOverride('');
    setFormTimezone('Asia/Shanghai');
    setShowAdvanced(false);
    setIsScheduleValid(true);
    setIsModalOpen(true);
  };

  const openEditModal = (r: Routine) => {
    setEditingRoutineId(r.id);
    setFormName(r.name);
    const validAgentId = bots.some((b) => b.id === r.agentId) ? r.agentId : bots[0]?.id || 'muse';
    setFormAgentId(validAgentId);
    setFormPrompt(r.instructions || '');
    setFormScheduleKind(r.scheduleKind || 'cron');
    setFormCron(r.cronExpr || '0 9 * * 1-5');
    setFormDeliverTo(r.deliverTo || (r.feedPublish !== false ? 'feed' : 'silent'));
    setFormWebhookUrl(r.webhookUrl || '');
    setFormModelOverride(r.modelOverride || '');
    setFormTimezone(r.timezone || 'Asia/Shanghai');
    setShowAdvanced(
      Boolean(
        (r.deliverTo && r.deliverTo !== 'feed') ||
          r.modelOverride ||
          (r.timezone && r.timezone !== 'Asia/Shanghai')
      )
    );
    setIsScheduleValid(validateCronExpr(r.cronExpr || '').valid);
    setIsModalOpen(true);
  };

  const applyTemplateInModal = (tpl: QuickTemplate) => {
    if (!formName.trim()) {
      setFormName(tpl.name);
    }
    setFormPrompt(tpl.instructions);
    setFormCron(tpl.cron);
    setFormScheduleKind(tpl.kind);
    setIsScheduleValid(true);
    showToast(`已填入「${tpl.label}」模板`, 'info');
  };

  const handleSaveRoutine = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (savingForm) return;
    if (!formName.trim()) {
      showToast('请输入任务名称', 'warning');
      return;
    }
    if (!formPrompt.trim()) {
      showToast('请输入执行指令', 'warning');
      return;
    }
    const cronCheck = validateCronExpr(formCron);
    if (!isScheduleValid || !cronCheck.valid) {
      showToast(cronCheck.error || '执行周期表达式无效', 'warning');
      return;
    }

    const payload: Partial<Routine> = {
      name: formName.trim(),
      agentId: formAgentId || bots[0]?.id || 'muse',
      instructions: formPrompt.trim(),
      scheduleKind: formScheduleKind,
      cronExpr: formCron.trim(),
      timezone: formTimezone,
      deliverTo: formDeliverTo,
      feedPublish: formDeliverTo === 'feed' || formDeliverTo === 'all',
      webhookUrl:
        formDeliverTo === 'im_webhook' || formDeliverTo === 'all'
          ? formWebhookUrl.trim() || undefined
          : undefined,
      modelOverride: formModelOverride.trim() || undefined,
      deleteAfterRun: formScheduleKind === 'at',
    };

    setSavingForm(true);
    try {
      if (editingRoutineId) {
        const updated = await api.updateRoutine(editingRoutineId, payload);
        setRoutines((prev) => prev.map((item) => (item.id === editingRoutineId ? updated : item)));
        showToast('任务配置已更新', 'success');
      } else {
        const created = await api.createRoutine({ ...payload, enabled: true });
        setRoutines((prev) => [created, ...prev]);
        showToast('定时任务已创建并启用', 'success');
      }
      setIsModalOpen(false);
    } catch (err: any) {
      showToast(`保存失败：${err?.message || '请稍后重试'}`, 'error');
    } finally {
      setSavingForm(false);
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
      showToast(`操作失败：${err?.message || '请求异常'}`, 'error');
    }
  };

  const handleRunNow = async (r: Routine) => {
    setTriggeringIds((prev) => new Set(prev).add(r.id));
    try {
      await api.runRoutine(r.id);
      showToast(`已开始执行「${r.name}」`, 'success');
      await Promise.all([
        loadRoutines(true),
        loadAllRuns(true),
        drawerRoutineId === r.id ? loadDrawerRuns(r.id, true) : Promise.resolve(),
      ]);
    } catch (err: any) {
      showToast(`触发失败：${err?.message || '请求异常'}`, 'error');
    } finally {
      setTriggeringIds((prev) => {
        const next = new Set(prev);
        next.delete(r.id);
        return next;
      });
    }
  };

  const handleCancelRun = async (routineId: string, runId?: string) => {
    setCancellingIds((prev) => new Set(prev).add(routineId));
    try {
      if (runId) {
        await api.cancelRoutineRun(runId);
      } else {
        await api.cancelRoutine(routineId);
      }
      showToast('已下发停止指令', 'info');
      await Promise.all([
        loadRoutines(true),
        loadAllRuns(true),
        drawerRoutineId === routineId ? loadDrawerRuns(routineId, true) : Promise.resolve(),
      ]);
    } catch (err: any) {
      showToast(`停止失败：${err?.message || '请求异常'}`, 'error');
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(routineId);
        return next;
      });
    }
  };

  const handleDeleteRoutine = async (id: string) => {
    try {
      await api.deleteRoutine(id);
      setRoutines((prev) => prev.filter((r) => r.id !== id));
      if (drawerRoutineId === id) {
        setDrawerRoutineId(null);
      }
      setConfirmDeleteId(null);
      showToast('定时任务已删除', 'success');
    } catch (err: any) {
      showToast(`删除失败：${err?.message || '请求异常'}`, 'error');
    }
  };

  const handleInlineDeleteClick = (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3500);
      return;
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    void handleDeleteRoutine(id);
  };

  const handleOpenSession = (sessionId: string) => {
    setDrawerRoutineId(null);
    selectSession(sessionId);
    setTab('chat');
  };

  const handleDebugInChat = (routine: Routine) => {
    const draft = routine.instructions || '';
    try {
      sessionStorage.setItem('museclaw_chat_draft', draft);
    } catch {
      // ignore storage failure in restricted modes
    }
    window.dispatchEvent(new CustomEvent('museclaw:chat_draft', { detail: draft }));
    setDrawerRoutineId(null);
    setTab('chat');
    showToast('已将任务指令带入对话输入框', 'info');
  };

  const handleCopyGlobalReport = async (runId: string, text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedRunId(runId);
      showToast('已复制执行报告', 'success');
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedRunId(null), 2000);
    } else {
      showToast('复制失败，请手动复制', 'error');
    }
  };

  const toggleGlobalRunExpand = (runId: string) => {
    setExpandedGlobalRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const hasActiveTaskFilter =
    statusFilter !== 'all' || Boolean(searchQuery.trim());

  const starterTemplates = useMemo(
    () => QUICK_TEMPLATES.filter((t) => EMPTY_STARTER_IDS.includes(t.id)),
    []
  );

  return (
    <section className="view-stage rt-page" aria-label="定时任务管理">
      {/* 紧凑单行页头 */}
      <header className="rt-header">
        <div className="rt-header-main">
          <div className="rt-title-row">
            <h1 className="rt-title">定时任务</h1>
            {routines.length > 0 && (
              <span className="rt-summary-meta">
                <span>{summaryStats.activeCount} 个启用</span>
                <span aria-hidden="true">·</span>
                <span>{summaryStats.pausedCount} 个暂停</span>
              </span>
            )}
            {summaryStats.runningCount > 0 && (
              <span className="rt-head-pill is-running">
                <span className="rt-head-dot" />
                {summaryStats.runningCount} 个执行中
              </span>
            )}
            {summaryStats.abnormalCount > 0 && (
              <span className="rt-head-pill is-error">
                <span className="rt-head-dot" />
                {summaryStats.abnormalCount} 个异常
              </span>
            )}
          </div>
          <p className="rt-subtitle">
            让数字员工按计划自动执行巡检、汇总与监控任务。
          </p>
        </div>

        <button
          type="button"
          className="om-btn-primary rt-create-btn"
          onClick={() => openCreateModal()}
        >
          <Plus size={15} />
          <span>新建任务</span>
        </button>
      </header>

      {loadError && (
        <div className="view-load-error rt-error-banner" role="alert">
          <AlertTriangle size={14} />
          <span>定时任务加载失败：{loadError}</span>
          <button
            type="button"
            onClick={() => void loadRoutines()}
            disabled={loadingList}
          >
            重试
          </button>
        </div>
      )}

      {/* 轻量化视角切换与筛选工具栏 */}
      <div className="rt-toolbar">
        <div className="rt-view-tabs" role="tablist" aria-label="视图切换">
          <button
            type="button"
            role="tab"
            aria-selected={activeSubView === 'tasks'}
            className={`rt-view-tab ${activeSubView === 'tasks' ? 'is-active' : ''}`}
            onClick={() => setActiveSubView('tasks')}
          >
            <span>任务列表</span>
            <span className="rt-view-tab-count">{routines.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubView === 'runs'}
            className={`rt-view-tab ${activeSubView === 'runs' ? 'is-active' : ''}`}
            onClick={() => setActiveSubView('runs')}
          >
            <span>最近执行</span>
            <span className="rt-view-tab-count">{globalRuns.length}</span>
          </button>
        </div>

        {activeSubView === 'tasks' && routines.length > 0 && (
          <div className="rt-toolbar-filters">
            <div className="rt-search-box">
              <Search size={14} className="rt-search-icon" aria-hidden="true" />
              <input
                type="search"
                className="rt-search-input"
                placeholder="搜索任务名称或指令..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="搜索定时任务"
              />
            </div>

            <div className="rt-segmented" role="group" aria-label="状态筛选">
              <button
                type="button"
                className={`rt-seg-btn ${statusFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                全部
              </button>
              <button
                type="button"
                className={`rt-seg-btn ${statusFilter === 'active' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('active')}
              >
                运行中
              </button>
              <button
                type="button"
                className={`rt-seg-btn ${statusFilter === 'paused' ? 'is-active' : ''}`}
                onClick={() => setStatusFilter('paused')}
              >
                已暂停
              </button>
              {summaryStats.abnormalCount > 0 && (
                <button
                  type="button"
                  className={`rt-seg-btn is-alert ${statusFilter === 'abnormal' ? 'is-active' : ''}`}
                  onClick={() => setStatusFilter('abnormal')}
                >
                  异常 ({summaryStats.abnormalCount})
                </button>
              )}
            </div>
          </div>
        )}

        {activeSubView === 'runs' && (
          <div className="rt-toolbar-filters">
            <div className="rt-segmented" role="group" aria-label="执行状态筛选">
              <button
                type="button"
                className={`rt-seg-btn ${globalRunFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setGlobalRunFilter('all')}
              >
                全部
              </button>
              <button
                type="button"
                className={`rt-seg-btn ${globalRunFilter === 'abnormal' ? 'is-active' : ''}`}
                onClick={() => setGlobalRunFilter('abnormal')}
              >
                仅异常
              </button>
            </div>
            <button
              type="button"
              className="rt-icon-refresh"
              onClick={() => void loadAllRuns()}
              disabled={loadingGlobalRuns}
              title="刷新执行记录"
              aria-label="刷新执行记录"
            >
              <RefreshCw size={13} className={loadingGlobalRuns ? 'spin' : ''} />
            </button>
          </div>
        )}
      </div>

      {/* 视角一：任务列表 */}
      {activeSubView === 'tasks' && (
        <div className="rt-content-area">
          {loadingList && routines.length === 0 ? (
            <div className="rt-skeleton-stack" aria-label="正在加载定时任务">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="rt-skeleton-row" />
              ))}
            </div>
          ) : routines.length === 0 ? (
            <div className="rt-empty-board">
              <div className="rt-empty-head">
                <Clock size={26} className="rt-empty-icon" />
                <h2 className="rt-empty-title">还没有配置定时任务</h2>
                <p className="rt-empty-desc">
                  选择一个常用场景快速开始，或点击右上角「新建任务」自定义调度规则。
                </p>
              </div>
              <div className="rt-starter-grid">
                {starterTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="rt-starter-card"
                    onClick={() => openCreateModal(tpl)}
                  >
                    <div className="rt-starter-title">{tpl.name}</div>
                    <div className="rt-starter-desc">{tpl.desc}</div>
                    <div className="rt-starter-meta">
                      <span>{formatCronZh(tpl.cron)}</span>
                      <span className="rt-starter-cta">一键使用</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : filteredRoutines.length === 0 ? (
            <div className="rt-filtered-empty">
              <p>当前筛选条件下没有匹配的定时任务</p>
              {hasActiveTaskFilter && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setStatusFilter('all');
                    setSearchQuery('');
                  }}
                >
                  重置筛选
                </button>
              )}
            </div>
          ) : (
            <div className="rt-task-list" role="list">
              {filteredRoutines.map((r) => {
                const bot = resolveBot(bots, r.agentId);
                const isRunning = r.status === 'running' || triggeringIds.has(r.id);
                const isCancelling = cancellingIds.has(r.id);
                const isBroken = Boolean(r.circuitBrokenAt);
                const isLastError =
                  r.lastStatus === 'failed' ||
                  r.lastStatus === 'timeout' ||
                  r.lastStatus === 'interrupted';
                const scheduleText = r.scheduleHumanZh || formatCronZh(r.cronExpr);

                return (
                  <div
                    key={r.id}
                    role="listitem"
                    className={`rt-task-row ${!r.enabled ? 'is-paused' : ''} ${
                      drawerRoutineId === r.id ? 'is-selected' : ''
                    }`}
                    onClick={() => setDrawerRoutineId(r.id)}
                  >
                    {/* 列 1：员工与任务身份 */}
                    <div className="rt-col-identity">
                      <BotAvatar bot={bot} size={34} still />
                      <div className="rt-identity-text">
                        <div className="rt-identity-title-row">
                          <button
                            type="button"
                            className="rt-task-name-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDrawerRoutineId(r.id);
                            }}
                          >
                            {r.name}
                          </button>
                          {isRunning && (
                            <span className="rt-status-pill is-running">
                              <span className="rt-head-dot" />
                              执行中
                            </span>
                          )}
                          {isBroken && (
                            <span className="rt-status-pill is-error">连续失败已暂停</span>
                          )}
                        </div>
                        <div className="rt-identity-sub">
                          <span className="rt-bot-label">{bot?.name || r.agentId}</span>
                          {r.modelOverride && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="rt-model-tag">{r.modelOverride}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="rt-instruction-preview">{r.instructions}</span>
                        </div>
                      </div>
                    </div>

                    {/* 列 2：调度周期与下次触发 */}
                    <div className="rt-col-schedule">
                      <div className="rt-schedule-human" title={r.cronExpr}>
                        {scheduleText}
                      </div>
                      <div className="rt-schedule-next">
                        {!r.enabled
                          ? '已暂停调度'
                          : r.nextRunAt
                          ? `下次：${formatNextRunFriendly(r.nextRunAt)}`
                          : '按周期调度'}
                      </div>
                    </div>

                    {/* 列 3：最近运行状态 */}
                    <div className="rt-col-status">
                      {isBroken ? (
                        <div className="rt-last-broken" onClick={(e) => e.stopPropagation()}>
                          <span className="rt-last-label is-error">
                            失败 {r.consecutiveFailures || 0} 次
                          </span>
                          <button
                            type="button"
                            className="rt-inline-recover-btn"
                            onClick={() => void handleToggleEnable(r, true)}
                          >
                            恢复
                          </button>
                        </div>
                      ) : isRunning ? (
                        <div className="rt-last-row">
                          <Loader2 size={13} className="spin rt-run-icon is-running" />
                          <span className="rt-last-label is-running">正在运行...</span>
                        </div>
                      ) : r.lastRunAt ? (
                        <div className="rt-last-row">
                          {r.lastStatus === 'success' ? (
                            <CheckCircle2 size={13} className="rt-run-icon is-success" />
                          ) : isLastError ? (
                            <XCircle size={13} className="rt-run-icon is-failed" />
                          ) : (
                            <Clock size={13} className="rt-run-icon is-cancelled" />
                          )}
                          <span
                            className={`rt-last-label ${
                              isLastError
                                ? 'is-error'
                                : r.lastStatus === 'success'
                                ? 'is-success'
                                : ''
                            }`}
                          >
                            {STATUS_LABELS[(r.lastStatus as RoutineRunStatus) || 'success'] ||
                              '已完成'}
                          </span>
                          <span className="rt-last-time">{formatRelativeTime(r.lastRunAt)}</span>
                        </div>
                      ) : (
                        <span className="rt-last-never">从未运行</span>
                      )}
                    </div>

                    {/* 列 4：快捷操作 */}
                    <div className="rt-col-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.enabled}
                        aria-label={r.enabled ? `暂停 ${r.name}` : `启用 ${r.name}`}
                        title={r.enabled ? '点击暂停调度' : '点击开启调度'}
                        className={`rt-switch ${r.enabled ? 'is-on' : ''}`}
                        onClick={() => void handleToggleEnable(r)}
                      >
                        <span className="rt-switch-thumb" />
                      </button>

                      {isRunning ? (
                        <button
                          type="button"
                          className="rt-icon-btn is-danger"
                          onClick={() => void handleCancelRun(r.id)}
                          disabled={isCancelling}
                          title="停止执行"
                          aria-label={`停止 ${r.name}`}
                        >
                          <Square size={13} fill="currentColor" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rt-icon-btn"
                          onClick={() => void handleRunNow(r)}
                          title="立即运行"
                          aria-label={`立即运行 ${r.name}`}
                        >
                          <Play size={14} />
                        </button>
                      )}

                      <button
                        type="button"
                        className="rt-icon-btn"
                        onClick={() => openEditModal(r)}
                        title="编辑任务"
                        aria-label={`编辑 ${r.name}`}
                      >
                        <Edit3 size={14} />
                      </button>

                      <button
                        type="button"
                        className={`rt-icon-btn ${
                          confirmDeleteId === r.id ? 'is-confirming' : ''
                        }`}
                        onClick={() => handleInlineDeleteClick(r.id)}
                        title={confirmDeleteId === r.id ? '再次点击确认删除' : '删除任务'}
                        aria-label={
                          confirmDeleteId === r.id ? `确认删除 ${r.name}` : `删除 ${r.name}`
                        }
                      >
                        <Trash2 size={14} />
                        {confirmDeleteId === r.id && <span className="rt-confirm-txt">确认?</span>}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 视角二：全局最近执行 */}
      {activeSubView === 'runs' && (
        <div className="rt-content-area">
          {loadingGlobalRuns && globalRuns.length === 0 ? (
            <div className="rt-skeleton-stack" aria-label="正在加载执行记录">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="rt-skeleton-row" />
              ))}
            </div>
          ) : filteredGlobalRuns.length === 0 ? (
            <div className="rt-runs-empty">
              {globalRuns.length === 0
                ? '暂无任何定时执行记录，点击任务的运行按钮或等待周期触发。'
                : '当前筛选下无异常执行记录。'}
            </div>
          ) : (
            <div className="rt-runs-table rt-global-runs">
              {filteredGlobalRuns.map((run) => {
                const isExpanded = expandedGlobalRunIds.has(run.id);
                const parentRoutine = routines.find((r) => r.id === run.routineId) || null;
                const bot = resolveBot(bots, run.agentId || parentRoutine?.agentId);
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
                const triggerLabel = TRIGGER_LABELS[run.triggerSource || 'manual'] || '手动';

                return (
                  <div key={run.id} className={`rt-run-row ${isRunning ? 'is-running' : ''}`}>
                    <div
                      className="rt-run-row-head"
                      onClick={() => toggleGlobalRunExpand(run.id)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleGlobalRunExpand(run.id);
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
                          <div className="rt-global-run-title-row">
                            {parentRoutine ? (
                              <button
                                type="button"
                                className="rt-global-run-task-link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDrawerRoutineId(parentRoutine.id);
                                }}
                              >
                                {run.routineName || parentRoutine.name}
                              </button>
                            ) : (
                              <span className="rt-global-run-task-name">
                                {run.routineName || '已删除任务'}
                              </span>
                            )}
                            <span className="rt-run-summary-sep" aria-hidden="true">
                              ·
                            </span>
                            <span className="rt-run-summary-text">
                              {isRunning
                                ? '正在执行中...'
                                : run.summary ||
                                  (run.status === 'success'
                                    ? '执行完成'
                                    : run.error || STATUS_LABELS[run.status])}
                            </span>
                          </div>

                          <div className="rt-run-meta-line">
                            <span>{bot?.name || run.agentId || '数字员工'}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatTime(run.startedAt)}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {isRunning && elapsedSeconds !== null
                                ? `已运行 ${elapsedSeconds}s`
                                : run.durationMs !== undefined
                                ? `${(run.durationMs / 1000).toFixed(1)}s`
                                : '-'}
                            </span>
                            <span aria-hidden="true">·</span>
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
                          </div>
                        </div>
                      </div>

                      <div className="rt-run-row-right" onClick={(e) => e.stopPropagation()}>
                        {isRunning && (
                          <button
                            type="button"
                            onClick={() => void handleCancelRun(run.routineId, run.id)}
                            disabled={cancellingIds.has(run.routineId)}
                            className="rt-run-stop-btn"
                          >
                            停止
                          </button>
                        )}
                        <button
                          type="button"
                          className="rt-run-chevron-btn"
                          onClick={() => toggleGlobalRunExpand(run.id)}
                          aria-label={isExpanded ? '收起详情' : '展开详情'}
                        >
                          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
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
                              onClick={() => handleOpenSession(run.sessionId!)}
                            >
                              <MessageSquare size={12} />
                              <span>查看完整会话</span>
                            </button>
                          )}
                          {reportContent && !isRunning && (
                            <button
                              type="button"
                              className="rt-text-btn"
                              onClick={() => void handleCopyGlobalReport(run.id, reportContent)}
                            >
                              {copiedRunId === run.id ? <Check size={12} /> : <Copy size={12} />}
                              <span>{copiedRunId === run.id ? '已复制' : '复制报告'}</span>
                            </button>
                          )}
                          {(isErrorState || run.status === 'cancelled') && parentRoutine && (
                            <button
                              type="button"
                              className="rt-text-btn"
                              onClick={() => void handleRunNow(parentRoutine)}
                              disabled={triggeringIds.has(parentRoutine.id)}
                            >
                              <RefreshCw
                                size={12}
                                className={triggeringIds.has(parentRoutine.id) ? 'spin' : ''}
                              />
                              <span>重新运行</span>
                            </button>
                          )}
                        </div>

                        {hasToolCalls && (
                          <div className="rt-run-trace-wrap">
                            <ToolTrace
                              tools={(run.toolCalls || []).map((tc) => ({
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
                            <span>正在沙箱中执行任务（已运行 {elapsedSeconds}s）...</span>
                          </div>
                        ) : run.output ? (
                          <div
                            className="markdown-body rt-run-markdown"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(run.output) }}
                          />
                        ) : (
                          <pre className="rt-run-error-pre">{run.error || '无输出信息'}</pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 右侧任务详情与执行历史抽屉 */}
      <RoutineDetailDrawer
        routine={drawerRoutine}
        bot={drawerRoutine ? resolveBot(bots, drawerRoutine.agentId) : null}
        runs={drawerRuns}
        loadingRuns={loadingDrawerRuns}
        isTriggering={drawerRoutine ? triggeringIds.has(drawerRoutine.id) : false}
        isCancelling={drawerRoutine ? cancellingIds.has(drawerRoutine.id) : false}
        nowTick={nowTick}
        onClose={() => setDrawerRoutineId(null)}
        onToggleEnable={(r, force) => void handleToggleEnable(r, force)}
        onRunNow={(r) => void handleRunNow(r)}
        onCancelRun={(rId, runId) => void handleCancelRun(rId, runId)}
        onEdit={(r) => openEditModal(r)}
        onDelete={(id) => void handleDeleteRoutine(id)}
        onRefreshRuns={(rId) => void loadDrawerRuns(rId)}
        onOpenSession={handleOpenSession}
        onDebugInChat={handleDebugInChat}
        onNotify={(msg, type) => showToast(msg, type)}
      />

      {/* 精简新建 / 编辑定时任务弹窗 */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRoutineId ? '编辑定时任务' : '新建定时任务'}
        icon={<Clock size={18} />}
        maxWidth="580px"
        footer={
          <div className="modal-actions-bar">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsModalOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleSaveRoutine()}
              disabled={savingForm || !isScheduleValid}
            >
              {savingForm ? '保存中...' : editingRoutineId ? '保存修改' : '创建并启用'}
            </button>
          </div>
        }
      >
        <form className="rt-modal-form" onSubmit={(e) => void handleSaveRoutine(e)}>
          <div className="form-group">
            <label htmlFor={nameInputId} className="form-label">
              任务名称
            </label>
            <input
              id={nameInputId}
              type="text"
              className="form-control"
              placeholder="例如：每日工作简报、代码仓库巡检"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <span className="form-label">执行员工</span>
            <div className="rt-bot-pills" role="radiogroup" aria-label="选择执行员工">
              {(bots.length > 0
                ? bots
                : [{ id: 'muse', name: '数字员工', role: '默认' } as Bot]
              ).map((b) => {
                const selected = formAgentId === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`rt-bot-pill ${selected ? 'is-selected' : ''}`}
                    onClick={() => setFormAgentId(b.id)}
                  >
                    <BotAvatar bot={b} size={22} still />
                    <span>{b.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="form-group">
            <div className="rt-field-label-row">
              <label htmlFor={promptInputId} className="form-label">
                执行指令
              </label>
              {!editingRoutineId && (
                <div className="rt-template-links">
                  {QUICK_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className="rt-template-link"
                      onClick={() => applyTemplateInModal(tpl)}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <textarea
              id={promptInputId}
              className="form-control"
              rows={3}
              placeholder="用自然语言说明任务要检查什么、如何汇总输出；若正常无需打扰，可要求结尾注明【无异常】"
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
            />
          </div>

          <div className="form-group">
            <span className="form-label">执行周期</span>
            <SchedulePicker
              value={formCron}
              timezone={formTimezone}
              onChange={(nextCron, kind) => {
                setFormCron(nextCron);
                setFormScheduleKind(kind);
              }}
              onValidityChange={setIsScheduleValid}
            />
          </div>

          <div className="rt-advanced-wrap">
            <button
              type="button"
              className="rt-advanced-toggle"
              onClick={() => setShowAdvanced((prev) => !prev)}
              aria-expanded={showAdvanced}
            >
              <span className="rt-advanced-title">
                <SlidersHorizontal size={13} />
                <span>高级选项（通知渠道 / 指定模型 / 时区）</span>
              </span>
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {showAdvanced && (
              <div className="rt-advanced-panel">
                <div className="rt-advanced-grid">
                  <div className="form-group">
                    <label htmlFor={deliverSelectId} className="form-label">
                      结果通知
                    </label>
                    <select
                      id={deliverSelectId}
                      className="form-control"
                      value={formDeliverTo}
                      onChange={(e) => setFormDeliverTo(e.target.value as DeliverTarget)}
                    >
                      <option value="feed">团队动态流 (默认)</option>
                      <option value="silent">仅记录不打扰</option>
                      <option value="im_webhook">外部 IM / Webhook</option>
                      <option value="all">全渠道通知</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor={timezoneSelectId} className="form-label">
                      调度时区
                    </label>
                    <select
                      id={timezoneSelectId}
                      className="form-control"
                      value={formTimezone}
                      onChange={(e) => setFormTimezone(e.target.value)}
                    >
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                          {tz.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {(formDeliverTo === 'im_webhook' || formDeliverTo === 'all') && (
                  <div className="form-group">
                    <label htmlFor={webhookInputId} className="form-label">
                      外部回调 Webhook URL（可选）
                    </label>
                    <input
                      id={webhookInputId}
                      type="url"
                      className="form-control"
                      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                      value={formWebhookUrl}
                      onChange={(e) => setFormWebhookUrl(e.target.value)}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor={modelInputId} className="form-label">
                    指定模型（可选）
                  </label>
                  <input
                    id={modelInputId}
                    type="text"
                    list={modelListId}
                    className="form-control"
                    placeholder="留空则跟随执行员工默认模型"
                    value={formModelOverride}
                    onChange={(e) => setFormModelOverride(e.target.value)}
                  />
                  <datalist id={modelListId}>
                    {modelChoices.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
              </div>
            )}
          </div>
        </form>
      </Modal>
    </section>
  );
};
