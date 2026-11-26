import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Target,
  Plus,
  Play,
  FastForward,
  Pause,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
  Sparkles,
  MessageCircle,
  Loader2,
  CalendarDays,
  Bell,
  Search,
  Square,
  SquareCheck,
  Edit3,
  ListTodo,
  UserCheck,
  Bot as BotIcon,
  FolderPlus,
  Link2,
  X,
  Gauge,
  CheckCheck,
  Repeat,
  ExternalLink
} from 'lucide-react';
import type {
  Goal,
  GoalArtifact,
  GoalMode,
  GoalStep,
  Routine,
  StepOwner,
  StepStatus
} from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import {
  ARTIFACT_KINDS,
  CATEGORIES,
  CATEGORY_PRESETS,
  GOAL_MODES,
  MODE_STARTERS,
  artifactKindDef,
  categoryOf,
  describeCadence,
  dueLabel,
  modeOf
} from '../../utils/goals';

type StatusFilter = 'all' | 'active' | 'attention' | 'done' | 'paused';
type ModeFilter = 'all' | GoalMode;

function needsAttention(goal: Goal): boolean {
  if (goal.status === 'done' || goal.status === 'cancelled') return false;
  if (goal.proposal && goal.proposal.status === 'pending') return true;
  const steps = goal.steps || [];
  if (steps.some((s) => s.status === 'blocked')) return true;
  const activeStep =
    steps.find((s) => s.status === 'in_progress') ||
    steps.find((s) => s.status === 'pending');
  return Boolean(activeStep && activeStep.owner === 'human');
}

function attentionSummary(goal: Goal): string {
  if (goal.proposal && goal.proposal.status === 'pending') {
    return '有待审批的计划修订提案';
  }
  const steps = goal.steps || [];
  const blocked = steps.find((s) => s.status === 'blocked');
  if (blocked) {
    return `步骤受阻：${blocked.title}`;
  }
  const activeHuman =
    steps.find((s) => s.status === 'in_progress' && s.owner === 'human') ||
    steps.find((s) => s.status === 'pending' && s.owner === 'human');
  if (activeHuman) {
    return `等待你处理：${activeHuman.title}`;
  }
  return '需要关注';
}

export const GoalsView: React.FC = () => {
  const { showToast, setTab, activeBot, activeBotId, selectBot, bots, selectSession, loadSessions } = useApp();
  const botName = activeBot?.name || '数字员工';

  const [goals, setGoals] = useState<Goal[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const [statusGoalId, setStatusGoalId] = useState<string | null>(null);
  const [updatingStepId, setUpdatingStepId] = useState<string | null>(null);
  const [addingStepGoalId, setAddingStepGoalId] = useState<string | null>(null);
  const [resolvingProposalId, setResolvingProposalId] = useState<string | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);

  const expandedInitRef = useRef(false);
  const [selectedMode, setSelectedMode] = useState<ModeFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(new Set());
  const [advancingGoalId, setAdvancingGoalId] = useState<string | null>(null);
  const [runningGoalId, setRunningGoalId] = useState<string | null>(null);

  // 新建目标弹窗状态
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newMode, setNewMode] = useState<GoalMode>('delivery');
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCriteria, setNewCriteria] = useState('');
  const [newCategory, setNewCategory] = useState<string>('delivery');
  const [newDue, setNewDue] = useState('');
  const [newCadence, setNewCadence] = useState('');
  const [newShowCadence, setNewShowCadence] = useState(false);
  const [newMetricLabel, setNewMetricLabel] = useState('');
  const [newMetricCurrent, setNewMetricCurrent] = useState('');
  const [newMetricTarget, setNewMetricTarget] = useState('');
  const [newMetricUnit, setNewMetricUnit] = useState('');
  const [newStepsText, setNewStepsText] = useState('');

  // 编辑目标弹窗状态
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [editMode, setEditMode] = useState<GoalMode>('delivery');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCriteria, setEditCriteria] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editCadence, setEditCadence] = useState('');
  const [editMetricLabel, setEditMetricLabel] = useState('');
  const [editMetricCurrent, setEditMetricCurrent] = useState('');
  const [editMetricTarget, setEditMetricTarget] = useState('');
  const [editMetricUnit, setEditMetricUnit] = useState('');

  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);
  const deleteGoalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 行内添加新步骤输入与责任方选择
  const [inlineStepInputs, setInlineStepInputs] = useState<Record<string, string>>({});
  const [inlineStepOwners, setInlineStepOwners] = useState<Record<string, StepOwner>>({});
  const [inlineStepBots, setInlineStepBots] = useState<Record<string, string>>({});

  // 行内登记交付物状态
  const [artifactDraftOpen, setArtifactDraftOpen] = useState<Record<string, boolean>>({});
  const [artifactTitleInputs, setArtifactTitleInputs] = useState<Record<string, string>>({});
  const [artifactKindInputs, setArtifactKindInputs] = useState<Record<string, GoalArtifact['kind']>>({});
  const [artifactRefInputs, setArtifactRefInputs] = useState<Record<string, string>>({});
  const [artifactSummaryInputs, setArtifactSummaryInputs] = useState<Record<string, string>>({});
  const [artifactContentInputs, setArtifactContentInputs] = useState<Record<string, string>>({});
  const [savingArtifactGoalId, setSavingArtifactGoalId] = useState<string | null>(null);

  // 行内挂载 Routine 选择器
  const [routinePickerOpen, setRoutinePickerOpen] = useState<Record<string, boolean>>({});

  // 现场指引重试弹窗
  const [guidanceModal, setGuidanceModal] = useState<{
    isOpen: boolean;
    goalId: string;
    stepId?: string;
    stepTitle?: string;
    guidance: string;
  }>({
    isOpen: false,
    goalId: '',
    guidance: ''
  });

  // 退回历史步骤弹窗
  const [rollbackModal, setRollbackModal] = useState<{
    isOpen: boolean;
    goalId: string;
    targetStepId: string;
    steps: GoalStep[];
  }>({
    isOpen: false,
    goalId: '',
    targetStepId: '',
    steps: []
  });

  const loadGoals = async () => {
    setLoading(true);
    try {
      const [goalData, routineData] = await Promise.all([
        api.getGoals(),
        api.getRoutines().catch(() => [] as Routine[])
      ]);
      const list = Array.isArray(goalData) ? goalData : [];
      setGoals(list);
      setRoutines(Array.isArray(routineData) ? routineData : []);
      setLoadError(null);
      if (!expandedInitRef.current) {
        setExpandedGoalIds(new Set(list.filter((g) => g.status !== 'done').map((g) => g.id)));
        expandedInitRef.current = true;
      }
    } catch (err: any) {
      console.error('Failed to load goals:', err);
      setLoadError(err.message || '目标列表加载失败');
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  useEffect(() => {
    loadGoals();
  }, []);

  const toggleExpand = (goalId: string) => {
    setExpandedGoalIds((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  };

  // 需要用户处理的目标列表
  const attentionGoals = useMemo(() => {
    return goals.filter((g) => needsAttention(g));
  }, [goals]);

  // 待审批修订提案列表
  const pendingProposals = useMemo(() => {
    return goals.filter((g) => g.proposal && g.proposal.status === 'pending');
  }, [goals]);

  // 过滤后的目标列表
  const filteredGoals = useMemo(() => {
    return goals.filter((g) => {
      const gMode: GoalMode = g.mode || 'delivery';
      if (selectedMode !== 'all' && gMode !== selectedMode) return false;

      if (selectedStatus === 'active' && g.status !== 'active') return false;
      if (selectedStatus === 'done' && g.status !== 'done') return false;
      if (selectedStatus === 'paused' && g.status !== 'paused') return false;
      if (selectedStatus === 'attention' && !needsAttention(g)) return false;

      if (selectedCategory && g.category?.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchTitle = g.title.toLowerCase().includes(q);
        const matchDesc = g.description?.toLowerCase().includes(q);
        const matchCriteria = g.successCriteria?.toLowerCase().includes(q);
        const matchStep = (g.steps || []).some((s) => s.title.toLowerCase().includes(q));
        const matchArtifact = (g.artifacts || []).some((a) => a.title.toLowerCase().includes(q));
        if (!matchTitle && !matchDesc && !matchCriteria && !matchStep && !matchArtifact) {
          return false;
        }
      }

      return true;
    });
  }, [goals, selectedMode, selectedStatus, selectedCategory, searchQuery]);

  const hasActiveFilter =
    selectedMode !== 'all' ||
    selectedStatus !== 'all' ||
    Boolean(selectedCategory) ||
    Boolean(searchQuery.trim());

  const resetFilters = () => {
    setSelectedMode('all');
    setSelectedStatus('all');
    setSelectedCategory('');
    setSearchQuery('');
  };

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of goals) {
      const cat = (g.category || 'other').toLowerCase();
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [goals]);

  const modeCounts = useMemo(() => {
    const counts: Record<GoalMode, number> = { delivery: 0, watch: 0, portfolio: 0 };
    for (const g of goals) {
      const m: GoalMode = g.mode || 'delivery';
      counts[m] = (counts[m] || 0) + 1;
    }
    return counts;
  }, [goals]);

  const handleToggleGoalDone = async (goal: Goal) => {
    if (statusGoalId) return;
    const nextStatus = goal.status === 'done' ? 'active' : 'done';
    setStatusGoalId(goal.id);
    try {
      await api.updateGoal(goal.id, { status: nextStatus });
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, status: nextStatus } : g)));
      showToast(nextStatus === 'done' ? '目标已标记达成' : '目标已重新激活', 'success');
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`, 'error');
    } finally {
      setStatusGoalId(null);
    }
  };

  const handleTogglePause = async (goal: Goal) => {
    if (statusGoalId) return;
    const nextStatus = goal.status === 'active' ? 'paused' : 'active';
    setStatusGoalId(goal.id);
    try {
      await api.updateGoal(goal.id, { status: nextStatus });
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, status: nextStatus } : g)));
      showToast(`目标已${nextStatus === 'active' ? '恢复推进' : '暂停'}`, 'info');
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`, 'error');
    } finally {
      setStatusGoalId(null);
    }
  };

  const handleToggleStepStatus = async (goal: Goal, step: GoalStep) => {
    if (updatingStepId) return;
    const nextStatus: StepStatus = step.status === 'done' ? 'pending' : 'done';
    setUpdatingStepId(step.id);
    try {
      await api.updateGoal(goal.id, {
        step_index: step.idx || 1,
        step_id: step.id,
        step_status: nextStatus
      });
      await loadGoals();
      showToast(`步骤「${step.title}」已${nextStatus === 'done' ? '完成' : '重置为待办'}`, 'success');
    } catch (err: any) {
      showToast(`更新步骤失败: ${err.message}`, 'error');
    } finally {
      setUpdatingStepId(null);
    }
  };

  const handleAdvance = async (goalId: string) => {
    if (advancingGoalId || runningGoalId) return;
    setAdvancingGoalId(goalId);
    try {
      const res = await api.advanceGoal(goalId);
      if (res.awaitingHuman) {
        showToast(`当前步骤需人工确认：${res.stepTitle || '请补充输入或确认完成'}`, 'info');
      } else if (res.status === 'blocked') {
        showToast(`推进受阻，执行过程已写入绑定旁聊：${res.blockedReason || '需处理阻碍或修订'}`, 'warning');
      } else if (res.goalCompleted) {
        showToast('目标已全部推进完成，成果与执行过程已同步至工件页及绑定旁聊', 'success');
      } else {
        showToast(`步骤 [${res.stepTitle || '当前阶段'}] 已完成，过程已同步写入绑定旁聊与工件页`, 'success');
      }
      await loadGoals();
    } catch (err: any) {
      showToast(`推进失败: ${err.message}`, 'error');
    } finally {
      setAdvancingGoalId(null);
    }
  };

  const handleRunGoal = async (goalId: string) => {
    if (advancingGoalId || runningGoalId) return;
    setRunningGoalId(goalId);
    try {
      const res = await api.runGoal(goalId, { maxRounds: 4 });
      const rounds = res.roundsExecuted || 1;
      if (res.goalCompleted) {
        showToast(`连续推进 ${rounds} 步，目标已全部达成（过程与产出已写入旁聊与工件页）`, 'success');
      } else if (res.awaitingHuman) {
        showToast(`已推进 ${rounds} 轮，当前停在人工确认步骤：${res.stepTitle || ''}`, 'info');
      } else if (res.status === 'blocked') {
        showToast(`推进 ${rounds} 轮后受阻，详情已记录至绑定旁聊：${res.blockedReason || '需人工协助'}`, 'warning');
      } else {
        showToast(`已连续完成 ${rounds} 步推进，过程已写入绑定旁聊与工件页`, 'success');
      }
      await loadGoals();
    } catch (err: any) {
      showToast(`连续推进失败: ${err.message}`, 'error');
    } finally {
      setRunningGoalId(null);
    }
  };

  const handleAddInlineStep = async (goalId: string) => {
    const text = (inlineStepInputs[goalId] || '').trim();
    if (!text || addingStepGoalId) return;
    const owner = inlineStepOwners[goalId] || 'agent';
    const assigneeBotId = owner === 'agent' ? inlineStepBots[goalId] || undefined : undefined;
    setAddingStepGoalId(goalId);
    try {
      await api.addGoalStep(goalId, {
        title: text,
        description: text,
        owner,
        assigneeBotId
      });
      setInlineStepInputs((prev) => ({ ...prev, [goalId]: '' }));
      showToast(`已添加步骤「${text}」`, 'success');
      await loadGoals();
    } catch (err: any) {
      showToast(`添加步骤失败: ${err.message}`, 'error');
    } finally {
      setAddingStepGoalId(null);
    }
  };

  const handleAddArtifact = async (goalId: string) => {
    const title = (artifactTitleInputs[goalId] || '').trim();
    if (!title || savingArtifactGoalId) return;
    const kind = artifactKindInputs[goalId] || 'doc';
    const ref = (artifactRefInputs[goalId] || '').trim() || undefined;
    const summary = (artifactSummaryInputs[goalId] || '').trim() || undefined;
    const content = (artifactContentInputs[goalId] || '').trim() || undefined;
    setSavingArtifactGoalId(goalId);
    try {
      await api.addGoalArtifact(goalId, { title, kind, ref, summary, content });
      setArtifactTitleInputs((prev) => ({ ...prev, [goalId]: '' }));
      setArtifactRefInputs((prev) => ({ ...prev, [goalId]: '' }));
      setArtifactSummaryInputs((prev) => ({ ...prev, [goalId]: '' }));
      setArtifactContentInputs((prev) => ({ ...prev, [goalId]: '' }));
      setArtifactDraftOpen((prev) => ({ ...prev, [goalId]: false }));
      showToast(`已归档成果「${title}」并同步至工件页`, 'success');
      await loadGoals();
    } catch (err: any) {
      showToast(`归档成果失败: ${err.message}`, 'error');
    } finally {
      setSavingArtifactGoalId(null);
    }
  };

  const handleOpenArtifactInView = (goal: Goal, art: GoalArtifact) => {
    sessionStorage.setItem(
      'museclaw_artifact_focus',
      JSON.stringify({
        goalId: goal.id,
        filename: art.filename
      })
    );
    setTab('artifacts');
  };

  const handleDeleteArtifact = async (goalId: string, artifactId: string) => {
    try {
      await api.deleteGoalArtifact(goalId, artifactId);
      showToast('已移除成果记录', 'info');
      await loadGoals();
    } catch (err: any) {
      showToast(`移除失败: ${err.message}`, 'error');
    }
  };

  const handleToggleRoutineLink = async (goalId: string, routineId: string, linked: boolean) => {
    try {
      await api.updateGoalRoutineLink(goalId, routineId, linked ? 'unlink' : 'link');
      showToast(linked ? '已解除关联例行任务' : '已挂载例行巡检任务', 'success');
      await loadGoals();
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`, 'error');
    }
  };

  const handleOpenGoalSession = async (goal: Goal) => {
    if (openingSessionId) return;
    setOpeningSessionId(goal.id);
    try {
      const res = await api.openGoalSession(goal.id);
      const targetBot = goal.botId || activeBotId || 'muse';
      if (targetBot && targetBot !== activeBotId) {
        selectBot(targetBot);
      }
      await loadSessions(targetBot, res.sessionId);
      selectSession(res.sessionId);

      // 若目标专属旁聊尚无消息，预填上下文开场草稿方便直接开聊
      if (!res.session?.messageCount || res.session.messageCount === 0) {
        const draft = `围绕目标【${goal.title}】继续推进${goal.successCriteria ? `（验收标准：${goal.successCriteria}）` : ''}。请帮我盘点当前状态并开始下一步。`;
        sessionStorage.setItem('museclaw_chat_draft', draft);
        window.dispatchEvent(new CustomEvent('museclaw:chat_draft', { detail: draft }));
      }
      setTab('chat');
    } catch (err: any) {
      showToast(`打开目标旁聊失败: ${err.message}`, 'error');
    } finally {
      setOpeningSessionId(null);
    }
  };

  const handleResolveProposal = async (goalId: string, accept: boolean) => {
    if (resolvingProposalId) return;
    setResolvingProposalId(goalId);
    try {
      const res = await api.resolveProposal(goalId, accept);
      showToast(res.message || (accept ? '已采纳计划修订方案' : '已保留原计划'), 'info');
      await loadGoals();
    } catch (err: any) {
      showToast(`处理提案失败: ${err.message}`, 'error');
    } finally {
      setResolvingProposalId(null);
    }
  };

  const handleRetryWithGuidance = async () => {
    const { goalId, stepId, guidance } = guidanceModal;
    if (!guidance.trim()) {
      showToast('请输入补充确认或指导说明', 'warning');
      return;
    }
    try {
      setGuidanceModal((prev) => ({ ...prev, isOpen: false }));
      setAdvancingGoalId(goalId);
      const res = await api.retryGoal(goalId, { stepId, guidance: guidance.trim() });
      if (res.status === 'blocked') {
        showToast(`重试推进仍受阻: ${res.blockedReason || '请继续调整'}`, 'warning');
      } else {
        showToast('带着新输入已顺利推进', 'success');
      }
      await loadGoals();
    } catch (err: any) {
      showToast(`重试失败: ${err.message}`, 'error');
    } finally {
      setAdvancingGoalId(null);
    }
  };

  const handleRollback = async () => {
    const { goalId, targetStepId } = rollbackModal;
    if (!targetStepId || rollbackBusy) return;
    setRollbackBusy(true);
    try {
      await api.rollbackGoal(goalId, { targetStepId, reason: '用户手动发起打回重做' });
      setRollbackModal((prev) => ({ ...prev, isOpen: false }));
      showToast('已退回到所选步骤', 'info');
      await loadGoals();
    } catch (err: any) {
      showToast(`退回失败: ${err.message}`, 'error');
    } finally {
      setRollbackBusy(false);
    }
  };

  const handleDeleteGoal = async (goal: Goal) => {
    if (deletingGoalId !== goal.id) {
      setDeletingGoalId(goal.id);
      if (deleteGoalTimerRef.current) clearTimeout(deleteGoalTimerRef.current);
      deleteGoalTimerRef.current = setTimeout(() => setDeletingGoalId(null), 3500);
      return;
    }
    if (deleteGoalTimerRef.current) clearTimeout(deleteGoalTimerRef.current);
    setDeletingGoalId(null);

    try {
      await api.deleteGoal(goal.id);
      setGoals((prev) => prev.filter((g) => g.id !== goal.id));
      showToast('目标已删除', 'success');
    } catch (err: any) {
      showToast(`删除失败: ${err.message}`, 'error');
    }
  };

  const handleOpenCreateModal = (starter?: {
    mode?: GoalMode;
    category?: string;
    prefill?: boolean;
  }) => {
    const mode: GoalMode = starter?.mode || 'delivery';
    const mDef = modeOf(mode);
    const targetCat = starter?.category || mDef.defaultCategory;
    setCreateError('');
    setNewMode(mode);
    setNewCategory(targetCat);
    setNewDue('');
    setNewCadence('');
    setNewShowCadence(false);

    if (starter?.prefill) {
      const preset = MODE_STARTERS.find((s) => s.mode === mode);
      setNewTitle(preset?.title || '');
      setNewDesc(preset?.description || '');
      setNewCriteria(preset?.successCriteria || '');
      setNewStepsText((preset?.steps || []).join('\n'));
      setNewMetricLabel(preset?.metric?.label || '');
      setNewMetricCurrent(preset?.metric?.current || '');
      setNewMetricTarget(preset?.metric?.target || '');
      setNewMetricUnit(preset?.metric?.unit || '');
    } else {
      setNewTitle('');
      setNewDesc('');
      setNewCriteria('');
      setNewStepsText('');
      setNewMetricLabel('');
      setNewMetricCurrent('');
      setNewMetricTarget('');
      setNewMetricUnit('');
    }
    setIsCreateModalOpen(true);
  };

  const handleSelectModeInModal = (mode: GoalMode) => {
    setNewMode(mode);
    const mDef = modeOf(mode);
    setNewCategory(mDef.defaultCategory);
    if (mode === 'watch' && !newCadence) {
      setNewShowCadence(true);
    }
  };

  const handleApplyStarterPreset = () => {
    const modeStarter = MODE_STARTERS.find((s) => s.mode === newMode);
    const starter = modeStarter || CATEGORY_PRESETS[newCategory];
    if (!starter) return;
    setNewTitle(starter.title);
    setNewDesc(starter.description);
    setNewCriteria(starter.successCriteria || '');
    setNewStepsText((starter.steps || []).join('\n'));
    if (modeStarter?.metric) {
      setNewMetricLabel(modeStarter.metric.label);
      setNewMetricCurrent(modeStarter.metric.current);
      setNewMetricTarget(modeStarter.metric.target);
      setNewMetricUnit(modeStarter.metric.unit || '');
    }
  };

  const handleAskAgentPlan = () => {
    if (!newTitle.trim()) {
      showToast('请先输入想达成的目标名称', 'warning');
      return;
    }
    const catDef = categoryOf(newCategory);
    const mDef = modeOf(newMode);
    const extras: string[] = [`目标形态: ${mDef.label}`, `所属领域: ${catDef.label}`];
    if (newCriteria.trim()) extras.push(`验收标准: ${newCriteria.trim()}`);
    if (newDue) extras.push(`期望截止日期: ${newDue}`);
    if (newCadence) extras.push(`巡检周期: ${describeCadence(newCadence)}`);
    if (newDesc.trim()) extras.push(`背景说明: ${newDesc.trim()}`);

    const prompt = `帮我规划一个${mDef.label}型目标：“${newTitle.trim()}”（${extras.join('，')}）。请调用 goals 工具创建该目标，合理设定验收标准，仅在需要多步推进时拆解具体执行步骤（区分哪些由 AI 自动执行、哪些需我人工确认），并在对话中向我汇报。`;

    sessionStorage.setItem('museclaw_chat_draft', prompt);
    window.dispatchEvent(new CustomEvent('museclaw:chat_draft', { detail: prompt }));
    setIsCreateModalOpen(false);
    setTab('chat');
    showToast(`已将目标规划意向转交给 ${botName}`, 'info');
  };

  const parseStepsInput = (text: string): Partial<GoalStep>[] => {
    return text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line, idx) => {
        const isHuman = /（人工确认）|\(人工确认\)|\[人工\]|\[human\]/i.test(line);
        const cleanTitle = line
          .replace(/（人工确认）|\(人工确认\)|\[人工\]|\[human\]/gi, '')
          .trim();
        return {
          id: `s_${idx + 1}`,
          idx: idx + 1,
          title: cleanTitle || line,
          description: cleanTitle || line,
          owner: isHuman ? 'human' : 'agent',
          status: 'pending',
          updatedAt: Date.now()
        };
      });
  };

  const handleDirectCreate = async () => {
    const title = newTitle.trim();
    if (!title) {
      setCreateError('请填写目标名称');
      return;
    }
    if (title.length > 80) {
      setCreateError('目标名称不超过 80 个字');
      return;
    }
    if (creating) return;
    setCreateError('');
    setCreating(true);

    const formattedSteps = parseStepsInput(newStepsText);
    const hasMetric = newMetricLabel.trim() && newMetricTarget.trim();

    try {
      const created = await api.createGoal({
        title,
        description: newDesc.trim() || title,
        mode: newMode,
        successCriteria: newCriteria.trim() || undefined,
        metric: hasMetric
          ? {
              label: newMetricLabel.trim(),
              current: newMetricCurrent.trim() || '0',
              target: newMetricTarget.trim(),
              unit: newMetricUnit.trim() || undefined
            }
          : undefined,
        category: newCategory,
        due: newDue || undefined,
        cadence: newShowCadence ? newCadence : '',
        steps: formattedSteps.length > 0 ? (formattedSteps as GoalStep[]) : undefined,
        status: 'active'
      });
      setGoals((prev) => [created, ...prev]);
      setExpandedGoalIds((prev) => new Set([...prev, created.id]));
      setSelectedMode('all');
      setSelectedStatus('all');
      setSelectedCategory('');
      setSearchQuery('');
      setIsCreateModalOpen(false);
      showToast('目标已建立，可随时进入专属对话或推进', 'success');
    } catch (err: any) {
      setCreateError(err.message || '创建失败，请重试');
      showToast(`创建失败: ${err.message}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenEditModal = (goal: Goal) => {
    setEditError('');
    setEditingGoal(goal);
    setEditMode(goal.mode || 'delivery');
    setEditTitle(goal.title);
    setEditDesc(goal.description || '');
    setEditCriteria(goal.successCriteria || '');
    setEditCategory(goal.category || 'other');
    setEditDue(goal.due || '');
    setEditCadence(goal.cadence || '');
    setEditMetricLabel(goal.metric?.label || '');
    setEditMetricCurrent(goal.metric?.current || '');
    setEditMetricTarget(goal.metric?.target || '');
    setEditMetricUnit(goal.metric?.unit || '');
  };

  const handleSaveEdit = async () => {
    if (!editingGoal || savingEdit) return;
    const title = editTitle.trim();
    if (!title) {
      setEditError('目标名称不能为空');
      return;
    }
    if (title.length > 80) {
      setEditError('目标名称不超过 80 个字');
      return;
    }
    setEditError('');
    setSavingEdit(true);
    const hasMetric = editMetricLabel.trim() && editMetricTarget.trim();
    try {
      const updated = await api.updateGoal(editingGoal.id, {
        title,
        description: editDesc.trim(),
        mode: editMode,
        successCriteria: editCriteria.trim() || undefined,
        metric: hasMetric
          ? {
              label: editMetricLabel.trim(),
              current: editMetricCurrent.trim() || '0',
              target: editMetricTarget.trim(),
              unit: editMetricUnit.trim() || undefined
            }
          : undefined,
        category: editCategory,
        due: editDue,
        cadence: editCadence
      });
      setGoals((prev) => prev.map((g) => (g.id === editingGoal.id ? { ...g, ...updated } : g)));
      if (selectedCategory && selectedCategory !== editCategory) setSelectedCategory('');
      setEditingGoal(null);
      showToast('目标信息已更新', 'success');
    } catch (err: any) {
      setEditError(err.message || '保存失败，请重试');
      showToast(`更新失败: ${err.message}`, 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const closeEditModal = () => {
    if (!editingGoal) return;
    setEditError('');
    setEditingGoal(null);
  };

  return (
    <section className="view-stage goals-stage" aria-label="目标与成果工作区">
      {/* 顶部主标题栏 */}
      <div className="view-header goal-header-wrap">
        <div>
          <div className="view-heading goal-heading">
            <Target size={22} className="goal-heading-icon" />
            <span>目标与交付</span>
          </div>
          <div className="view-sub">
            结果导向的跨会话持久工作区：支持阶段交付、追踪观察与长期沉淀，保留专属上下文、归集真实产出并按需联动例行巡检。
          </div>
        </div>
        <div className="view-header-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => handleOpenCreateModal()}
          >
            <Plus size={16} /> 新建目标
          </button>
        </div>
      </div>

      {loadError && (
        <div className="goal-load-error" role="alert">
          <AlertTriangle size={14} />
          <span>目标加载失败：{loadError}</span>
          <button type="button" onClick={loadGoals} disabled={loading}>重试</button>
        </div>
      )}

      {/* 待你处理置顶聚焦栏 */}
      {attentionGoals.length > 0 && (
        <div className="goal-attention-bar">
          <div className="goal-attention-head">
            <UserCheck size={15} />
            <span>待你介入 ({attentionGoals.length})</span>
            <span className="goal-attention-sub">其他目标保持静默，以下目标需要你确认或解阻后方可继续</span>
          </div>
          <div className="goal-attention-items">
            {attentionGoals.map((g) => (
              <button
                key={g.id}
                type="button"
                className="goal-attention-pill"
                onClick={() => {
                  setExpandedGoalIds((prev) => new Set([...prev, g.id]));
                  setSelectedStatus('attention');
                }}
              >
                <strong>{g.title}</strong>
                <span>{attentionSummary(g)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 待审批修订提案横幅 */}
      {pendingProposals.length > 0 && (
        <div className="goal-proposals-container">
          {pendingProposals.map((goal) => {
            const p = goal.proposal!;
            const pSteps = p.proposedSteps || [];
            return (
              <div key={goal.id} className="goal-proposal-banner">
                <div className="goal-proposal-title-row">
                  <div className="goal-proposal-title">
                    <Sparkles size={16} />
                    <span>{botName} 建议调整目标【{goal.title}】的推进计划</span>
                  </div>
                  <span className="goal-proposal-status-badge">
                    等待确认决策
                  </span>
                </div>
                <div className="goal-proposal-reason">
                  <strong>调整原因：</strong>{p.reason}
                </div>
                <div className="goal-proposal-steps">
                  <strong>修订后的后续步骤：</strong>
                  <ol className="goal-proposal-step-list">
                    {pSteps.map((st, i) => (
                      <li key={i}>
                        {typeof st === 'string' ? st : st.title}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="goal-proposal-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => handleResolveProposal(goal.id, true)}
                    disabled={Boolean(resolvingProposalId)}
                  >
                    采纳修订方案并更新步骤
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleResolveProposal(goal.id, false)}
                    disabled={Boolean(resolvingProposalId)}
                  >
                    保留原计划 (驳回)
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 模式切换 + 状态过滤 + 搜索工具栏 */}
      <div className="goal-filter-toolbar">
        <div className="goal-status-tabs" role="tablist" aria-label="目标形态筛选">
          {[
            { id: 'all', label: '全部形态', count: goals.length },
            ...GOAL_MODES.map((m) => ({ id: m.id, label: m.label, count: modeCounts[m.id] }))
          ].map((mTab) => (
            <button
              key={mTab.id}
              type="button"
              onClick={() => setSelectedMode(mTab.id as ModeFilter)}
              aria-pressed={selectedMode === mTab.id}
              className={`goal-status-tab-btn ${selectedMode === mTab.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {mTab.label}
              <span className="goal-status-tab-count">{mTab.count}</span>
            </button>
          ))}
        </div>

        <div className="goal-status-tabs">
          {[
            { id: 'all', label: '全部状态', count: goals.length },
            { id: 'active', label: '推进中', count: goals.filter((g) => g.status === 'active').length },
            { id: 'attention', label: '待处理', count: attentionGoals.length },
            { id: 'done', label: '已达成', count: goals.filter((g) => g.status === 'done').length },
            { id: 'paused', label: '已暂停', count: goals.filter((g) => g.status === 'paused').length }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedStatus(tab.id as StatusFilter)}
              aria-pressed={selectedStatus === tab.id}
              className={`goal-status-tab-btn ${selectedStatus === tab.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {tab.label}
              <span className="goal-status-tab-count">{tab.count}</span>
            </button>
          ))}
        </div>

        {hasActiveFilter && (
          <span className="goal-count" aria-live="polite">
            匹配 {filteredGoals.length} / {goals.length} 个
          </span>
        )}

        <div className="goal-search-wrapper">
          <Search size={14} className="goal-search-icon" aria-hidden="true" />
          <input
            type="text"
            aria-label="搜索目标、验收标准、步骤或成果"
            placeholder="搜索目标、验收标准或成果..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="goal-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              className="goal-search-clear"
              aria-label="清空搜索"
              onClick={() => setSearchQuery('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 领域分类胶囊栏 */}
      <div className="goal-cat-row">
        <button
          type="button"
          onClick={() => setSelectedCategory('')}
          className={`goal-cat-chip ${selectedCategory === '' ? 'active' : ''}`}
        >
          全部领域 ({goals.length})
        </button>
        {CATEGORIES.map((c) => {
          const count = categoryCounts[c.id.toLowerCase()] || 0;
          const isActive = selectedCategory.toLowerCase() === c.id.toLowerCase();
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCategory(isActive ? '' : c.id)}
              className={`goal-cat-chip ${isActive ? 'active' : ''}`}
            >
              {c.icon({ size: 14 })}
              <span>{c.label}</span>
              {count > 0 && <span className="goal-cat-chip-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* 目标卡片列表 */}
      <div className="goals-list-container">
        {!loaded && goals.length === 0 ? (
          <div className="goals-loading" aria-label="加载中">
            {[0, 1, 2].map((i) => <div key={i} className="goal-skeleton" />)}
          </div>
        ) : filteredGoals.length === 0 ? (
          <div className="goal-empty-panel">
            <div className="goal-empty-icon">
              <Target size={32} />
            </div>
            <div className="goal-empty-title">
              {hasActiveFilter ? '未找到符合条件的目标' : '还没有建立目标工作区'}
            </div>
            <div className="goal-empty-desc">
              {hasActiveFilter
                ? '换个筛选条件，或清空后查看全部目标。'
                : '按实际诉求选择一种形态快速起步——不再强绑定时闹钟，专注于清晰验收标准与真实成果沉淀。'}
            </div>

            {hasActiveFilter ? (
              <button
                type="button"
                className="om-btn-subtle goal-clear-filter-btn"
                onClick={resetFilters}
              >
                清空筛选条件
              </button>
            ) : (
              <div className="goal-presets-grid">
                {GOAL_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      handleOpenCreateModal({
                        mode: m.id,
                        category: m.defaultCategory,
                        prefill: true
                      })
                    }
                    className="goal-preset-card hover-card"
                  >
                    <div className="goal-preset-title">
                      {m.icon({ size: 16 })}
                      <span>{m.label}</span>
                      <span className="goal-preset-tag">{m.tagline}</span>
                    </div>
                    <div className="goal-preset-desc">{m.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          filteredGoals.map((goal) => {
            const gMode: GoalMode = goal.mode || 'delivery';
            const modeDef = modeOf(gMode);
            const isAdvancing = advancingGoalId === goal.id;
            const isRunning = runningGoalId === goal.id;
            const isBusy = isAdvancing || isRunning;
            const isExpanded = expandedGoalIds.has(goal.id);
            const steps = goal.steps || [];
            const artifacts = goal.artifacts || [];
            const linkedIds = goal.linkedRoutineIds || [];
            const linkedRoutines = routines.filter((r) => linkedIds.includes(r.id));
            const isDone = goal.status === 'done';
            const isPaused = goal.status === 'paused';
            const catDef = categoryOf(goal.category || 'other');
            const dueInfo = dueLabel(goal.due);
            const activeStep =
              steps.find((s) => s.status === 'in_progress' || s.status === 'blocked') ||
              steps.find((s) => s.status === 'pending');
            const progress = goal.progress || 0;
            const isPortfolio = gMode === 'portfolio';

            return (
              <div
                key={goal.id}
                className={`goal-card ${isDone ? 'is-done' : ''} ${needsAttention(goal) ? 'is-attention' : ''}`}
              >
                {/* 卡片头部 */}
                <div className="goal-card-head">
                  <div className="goal-card-badges">
                    <button
                      type="button"
                      onClick={() => handleToggleGoalDone(goal)}
                      className={`goal-check-btn ${isDone ? 'is-checked' : ''}`}
                      title={isDone ? '重新激活目标' : '标记目标已达成'}
                      aria-label={isDone ? '重新开启目标' : '标记目标已达成'}
                      disabled={Boolean(statusGoalId)}
                    >
                      {isDone ? (
                        <SquareCheck size={20} className="goal-icon-done" />
                      ) : (
                        <Square size={20} />
                      )}
                    </button>

                    <span className={`goal-badge-item goal-mode-badge is-${gMode}`}>
                      {modeDef.icon({ size: 12 })}
                      <span>{modeDef.label}</span>
                    </span>

                    <span className="goal-badge-item">
                      {catDef.icon({ size: 12 })}
                      <span>{catDef.label}</span>
                    </span>

                    {goal.due && (
                      <span
                        className={`goal-badge-item goal-due-badge ${dueInfo.isOverdue ? 'is-overdue' : ''}`}
                      >
                        <CalendarDays size={12} />
                        <span>{dueInfo.label}</span>
                      </span>
                    )}

                    {goal.cadence && (
                      <span className="goal-badge-item">
                        <Bell size={12} />
                        <span>{describeCadence(goal.cadence)}</span>
                      </span>
                    )}

                    {linkedRoutines.length > 0 && (
                      <span className="goal-badge-item goal-routine-badge">
                        <Repeat size={12} />
                        <span>已挂 {linkedRoutines.length} 个巡检</span>
                      </span>
                    )}

                    <span
                      className={`goal-status-chip ${isDone ? 'is-done' : isPaused ? 'is-paused' : 'is-active'}`}
                    >
                      {isDone ? '已达成' : isPaused ? '已暂停' : '推进中'}
                    </span>
                  </div>

                  {/* 右侧操作区 */}
                  <div className="goal-card-actions">
                    <button
                      type="button"
                      className="btn-secondary goal-session-btn"
                      disabled={openingSessionId === goal.id}
                      onClick={() => handleOpenGoalSession(goal)}
                      title="打开该目标单独绑定的旁聊会话，查看完整执行过程与对话记录"
                    >
                      {openingSessionId === goal.id ? (
                        <Loader2 size={13} className="spin-icon" />
                      ) : (
                        <MessageCircle size={13} />
                      )}
                      <span>{goal.sessionId ? '查看执行旁聊' : '开启执行旁聊'}</span>
                    </button>

                    {!isDone && !isPortfolio && (
                      <>
                        <button
                          type="button"
                          className="btn-secondary goal-advance-btn"
                          disabled={isBusy}
                          onClick={() => handleAdvance(goal.id)}
                          title="推进当前单个步骤"
                        >
                          {isAdvancing ? (
                            <Loader2 size={13} className="spin-icon" />
                          ) : (
                            <Play size={13} />
                          )}
                          <span>{isAdvancing ? '推演中...' : '推进一步'}</span>
                        </button>

                        <button
                          type="button"
                          className="btn-primary goal-advance-btn"
                          disabled={isBusy}
                          onClick={() => handleRunGoal(goal.id)}
                          title="连续自动推进 AI 步骤，直到完成或遇到人工确认步骤"
                        >
                          {isRunning ? (
                            <Loader2 size={13} className="spin-icon" />
                          ) : (
                            <FastForward size={13} />
                          )}
                          <span>{isRunning ? '连续推进中...' : '连续推进'}</span>
                        </button>
                      </>
                    )}

                    {!isDone && (
                      <button
                        type="button"
                        className="btn-secondary goal-action-icon-btn"
                        onClick={() => handleTogglePause(goal)}
                        disabled={Boolean(statusGoalId)}
                        aria-label={isPaused ? '恢复目标' : '暂停目标'}
                        title={isPaused ? '恢复目标' : '暂停目标'}
                      >
                        {isPaused ? <Play size={14} /> : <Pause size={14} />}
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-secondary goal-action-icon-btn"
                      onClick={() => handleOpenEditModal(goal)}
                      aria-label="编辑目标"
                      title="编辑目标"
                    >
                      <Edit3 size={14} />
                    </button>

                    <button
                      type="button"
                      className={`btn-secondary goal-action-icon-btn is-danger ${deletingGoalId === goal.id ? 'is-confirming' : ''}`}
                      onClick={() => handleDeleteGoal(goal)}
                      aria-label="删除目标"
                      title={deletingGoalId === goal.id ? '再次点击确认删除' : '删除目标'}
                    >
                      <Trash2 size={14} />
                      {deletingGoalId === goal.id && (
                        <span className="inline-confirm-text">确认？</span>
                      )}
                    </button>
                  </div>
                </div>

                {/* 标题、描述、验收标准与量化指标 */}
                <div className="goal-info-section">
                  <div className={`goal-card-title ${isDone ? 'is-done' : ''}`}>
                    {goal.title}
                  </div>
                  {goal.description && goal.description !== goal.title && (
                    <div className="goal-card-desc">{goal.description}</div>
                  )}

                  {goal.successCriteria && (
                    <div className="goal-criteria-box">
                      <CheckCheck size={14} className="goal-criteria-icon" />
                      <div>
                        <span className="goal-criteria-label">验收标准：</span>
                        <span>{goal.successCriteria}</span>
                      </div>
                    </div>
                  )}

                  {goal.metric && (
                    <div className="goal-metric-chip">
                      <Gauge size={14} />
                      <span className="goal-metric-name">{goal.metric.label}:</span>
                      <span className="goal-metric-values">
                        {goal.metric.current} → {goal.metric.target}
                        {goal.metric.unit ? ` ${goal.metric.unit}` : ''}
                      </span>
                    </div>
                  )}

                  {activeStep && !isDone && (
                    <div
                      className={`goal-active-step ${activeStep.owner === 'human' ? 'is-human' : ''}`}
                    >
                      {activeStep.owner === 'human' ? (
                        <UserCheck size={14} />
                      ) : (
                        <BotIcon size={14} />
                      )}
                      <span>
                        当前阶段 [{activeStep.idx || 1}] {activeStep.title}
                        {activeStep.owner === 'human' ? '（等待你确认或补充输入）' : ''}
                      </span>
                    </div>
                  )}
                </div>

                {/* 进度条（有步骤时展示） */}
                {steps.length > 0 && (
                  <div className="goal-progress-section">
                    <div className="goal-progress-meta">
                      <span>
                        阶段进度:{' '}
                        {steps.filter((s) => s.status === 'done' || s.status === 'skipped').length}{' '}
                        / {steps.length} 步骤
                      </span>
                      <span
                        className={`goal-progress-percent ${progress === 100 ? 'is-complete' : ''}`}
                      >
                        {progress}%
                      </span>
                    </div>
                    <div className="goal-progress-track">
                      <div
                        className={`goal-progress-bar ${progress === 100 ? 'is-complete' : ''}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {steps.length > 0 &&
                  steps.every((st) => st.status === 'done' || st.status === 'skipped') &&
                  !isDone && (
                    <div className="goal-complete-hint">
                      <CheckCircle2 size={14} />
                      <span>所有步骤已完成，确认达成验收标准后可标记结项</span>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={Boolean(statusGoalId)}
                        onClick={() => handleToggleGoalDone(goal)}
                      >
                        标记达成
                      </button>
                    </div>
                  )}

                {/* 成果与证据沉淀区 */}
                <div className="goal-artifacts-section">
                  <div className="goal-section-bar">
                    <div className="goal-section-title">
                      <FolderPlus size={14} />
                      <span>已沉淀成果与证据 ({artifacts.length})</span>
                    </div>
                    <button
                      type="button"
                      className="goal-link-btn"
                      onClick={() =>
                        setArtifactDraftOpen((prev) => ({
                          ...prev,
                          [goal.id]: !prev[goal.id]
                        }))
                      }
                    >
                      {artifactDraftOpen[goal.id] ? '收起' : '+ 归档成果'}
                    </button>
                  </div>

                  {artifacts.length > 0 ? (
                    <div className="goal-artifacts-list">
                      {artifacts.map((art) => {
                        const kDef = artifactKindDef(art.kind);
                        const hasStoredArtifact = Boolean(art.filename || art.url);
                        return (
                          <div key={art.id} className="goal-artifact-item">
                            <span className="goal-artifact-kind">
                              {kDef.icon({ size: 12 })}
                              <span>{kDef.label}</span>
                            </span>
                            <div className="goal-artifact-main">
                              <div className="goal-artifact-title">{art.title}</div>
                              {art.summary && (
                                <div className="goal-artifact-summary">{art.summary}</div>
                              )}
                              {art.ref && <div className="goal-artifact-ref">{art.ref}</div>}
                            </div>
                            {hasStoredArtifact && (
                              <button
                                type="button"
                                className="btn-secondary goal-btn-xs goal-artifact-open-btn"
                                title="跳转到工件页预览与下载"
                                onClick={() => handleOpenArtifactInView(goal, art)}
                              >
                                <ExternalLink size={12} />
                                <span>工件页预览</span>
                              </button>
                            )}
                            <button
                              type="button"
                              className="goal-artifact-remove"
                              aria-label={`删除成果 ${art.title}`}
                              onClick={() => handleDeleteArtifact(goal.id, art.id)}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    !artifactDraftOpen[goal.id] && (
                      <div className="goal-artifacts-empty">
                        {isPortfolio
                          ? '随手点击右上角“+ 归档成果”，把散落的方案、数据与复盘攒到这里。'
                          : '推进过程中的文档、代码路径或验收报告可归档在此处。'}
                      </div>
                    )
                  )}

                  {artifactDraftOpen[goal.id] && (
                    <div className="goal-artifact-form">
                      <div className="goal-artifact-form-row">
                        <select
                          aria-label="成果类型"
                          value={artifactKindInputs[goal.id] || 'doc'}
                          onChange={(e) =>
                            setArtifactKindInputs((prev) => ({
                              ...prev,
                              [goal.id]: e.target.value as GoalArtifact['kind']
                            }))
                          }
                          className="goal-form-select goal-artifact-kind-select"
                        >
                          {ARTIFACT_KINDS.map((k) => (
                            <option key={k.id} value={k.id}>
                              {k.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="成果标题（如：压测对比报告、PR #142 链接）"
                          value={artifactTitleInputs[goal.id] || ''}
                          onChange={(e) =>
                            setArtifactTitleInputs((prev) => ({
                              ...prev,
                              [goal.id]: e.target.value
                            }))
                          }
                          className="goal-form-input"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="路径或链接（选填，如 docs/report.md 或 URL）"
                        value={artifactRefInputs[goal.id] || ''}
                        onChange={(e) =>
                          setArtifactRefInputs((prev) => ({
                            ...prev,
                            [goal.id]: e.target.value
                          }))
                        }
                        className="goal-form-input"
                      />
                      <div className="goal-artifact-form-row">
                        <input
                          type="text"
                          placeholder="核心结论或数据摘要（选填）"
                          value={artifactSummaryInputs[goal.id] || ''}
                          onChange={(e) =>
                            setArtifactSummaryInputs((prev) => ({
                              ...prev,
                              [goal.id]: e.target.value
                            }))
                          }
                          className="goal-form-input"
                        />
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={
                            savingArtifactGoalId === goal.id ||
                            !(artifactTitleInputs[goal.id] || '').trim()
                          }
                          onClick={() => handleAddArtifact(goal.id)}
                        >
                          {savingArtifactGoalId === goal.id ? '保存中…' : '确认归档'}
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        placeholder="可选：填写成果 Markdown 正文，将直接落盘到「工件」页供预览与下载"
                        value={artifactContentInputs[goal.id] || ''}
                        onChange={(e) =>
                          setArtifactContentInputs((prev) => ({
                            ...prev,
                            [goal.id]: e.target.value
                          }))
                        }
                        className="goal-form-textarea"
                      />
                    </div>
                  )}
                </div>

                {/* 关联例行自动化区 */}
                <div className="goal-routines-section">
                  <div className="goal-section-bar">
                    <div className="goal-section-title">
                      <Link2 size={14} />
                      <span>关联例行巡检 ({linkedRoutines.length})</span>
                    </div>
                    <div className="goal-section-actions">
                      <button
                        type="button"
                        className="goal-link-btn"
                        onClick={() =>
                          setRoutinePickerOpen((prev) => ({
                            ...prev,
                            [goal.id]: !prev[goal.id]
                          }))
                        }
                      >
                        {routinePickerOpen[goal.id] ? '收起挂载' : '+ 挂载 Routine'}
                      </button>
                      <button
                        type="button"
                        className="goal-link-btn"
                        onClick={() => setTab('routines')}
                      >
                        管理例行任务
                      </button>
                    </div>
                  </div>

                  {linkedRoutines.length > 0 && (
                    <div className="goal-linked-routines">
                      {linkedRoutines.map((r) => (
                        <div key={r.id} className="goal-routine-chip">
                          <Repeat size={12} />
                          <span>{r.name}</span>
                          <span className="goal-routine-schedule">
                            {r.scheduleHumanZh || r.cronExpr}
                          </span>
                          <button
                            type="button"
                            className="goal-routine-unlink"
                            title="解除挂载"
                            onClick={() => handleToggleRoutineLink(goal.id, r.id, true)}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {routinePickerOpen[goal.id] && (
                    <div className="goal-routine-picker">
                      {routines.length === 0 ? (
                        <div className="goal-artifacts-empty">
                          暂无例行任务，可前往「例行自动化」页面创建后挂载到本目标。
                        </div>
                      ) : (
                        routines.map((r) => {
                          const isLinked = linkedIds.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              className={`goal-routine-option ${isLinked ? 'is-linked' : ''}`}
                              onClick={() => handleToggleRoutineLink(goal.id, r.id, isLinked)}
                            >
                              <span>{r.name}</span>
                              <span className="goal-routine-schedule">
                                {isLinked ? '已挂载 · 点击解绑' : r.scheduleHumanZh || r.cronExpr}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* 执行步骤清单折叠区 */}
                <div className="goal-steps-section">
                  <div
                    className="goal-steps-toggle-btn"
                    onClick={() => toggleExpand(goal.id)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpand(goal.id);
                      }
                    }}
                  >
                    <div className="goal-steps-toggle-label">
                      <ListTodo size={15} />
                      <span>
                        {isPortfolio
                          ? `可选里程碑清单 (${steps.length})`
                          : `执行步骤清单 (${steps.length})`}
                      </span>
                    </div>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>

                  {isExpanded && (
                    <div className="goal-steps-list">
                      {steps.map((step) => {
                        const isStepDone = step.status === 'done';
                        const isStepBlocked = step.status === 'blocked';
                        const isStepInProgress = step.status === 'in_progress';
                        const isHumanStep = step.owner === 'human';

                        return (
                          <div
                            key={step.id}
                            className={`goal-step-item ${isStepBlocked ? 'is-blocked' : ''} ${isHumanStep && !isStepDone ? 'is-human-step' : ''}`}
                          >
                            <button
                              type="button"
                              onClick={() => handleToggleStepStatus(goal, step)}
                              disabled={Boolean(updatingStepId)}
                              aria-label={
                                isStepDone
                                  ? `将步骤 ${step.title} 设为待办`
                                  : `将步骤 ${step.title} 标记完成`
                              }
                              className={`goal-step-checkbox ${isStepDone ? 'is-done' : isStepBlocked ? 'is-blocked' : ''}`}
                              title="点击标记完成/待办"
                            >
                              {isStepDone ? (
                                <CheckCircle2 size={16} className="goal-icon-done" />
                              ) : isStepBlocked ? (
                                <AlertTriangle size={16} className="goal-icon-blocked" />
                              ) : isStepInProgress ? (
                                <Loader2 size={16} className="spin-icon goal-icon-active" />
                              ) : (
                                <Circle size={16} />
                              )}
                            </button>

                            <div className="goal-step-content">
                              <div className="goal-step-title-row">
                                <div className={`goal-step-title ${isStepDone ? 'is-done' : ''}`}>
                                  {step.idx || 1}. {step.title}
                                </div>
                                <span
                                  className={`goal-step-owner-tag ${isHumanStep ? 'is-human' : 'is-agent'}`}
                                >
                                  {isHumanStep ? '需你处理' : 'AI 执行'}
                                </span>
                                {step.assigneeBotId && (
                                  <span className="goal-step-bot-tag">
                                    @{step.assigneeBotId}
                                  </span>
                                )}
                              </div>
                              {step.description && step.description !== step.title && (
                                <div className="goal-step-desc">{step.description}</div>
                              )}
                              {step.note && (
                                <div className="goal-step-note">{step.note}</div>
                              )}
                              {isHumanStep && !isStepDone && !isStepBlocked && (
                                <div className="goal-step-human-actions">
                                  <button
                                    type="button"
                                    className="btn-secondary goal-btn-xs"
                                    onClick={() =>
                                      setGuidanceModal({
                                        isOpen: true,
                                        goalId: goal.id,
                                        stepId: step.id,
                                        stepTitle: step.title,
                                        guidance: ''
                                      })
                                    }
                                  >
                                    补充输入并推进
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-primary goal-btn-xs"
                                    onClick={() => handleToggleStepStatus(goal, step)}
                                  >
                                    我已完成此步
                                  </button>
                                </div>
                              )}
                              {isStepBlocked && step.blockedReason && (
                                <div className="goal-step-blocked-box">
                                  <span>阻碍卡点: {step.blockedReason}</span>
                                  <div className="goal-step-blocked-actions">
                                    <button
                                      type="button"
                                      className="btn-secondary goal-btn-xs"
                                      onClick={() =>
                                        setGuidanceModal({
                                          isOpen: true,
                                          goalId: goal.id,
                                          stepId: step.id,
                                          stepTitle: step.title,
                                          guidance: ''
                                        })
                                      }
                                    >
                                      补充指导重试
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary goal-btn-xs"
                                      onClick={() =>
                                        setRollbackModal({
                                          isOpen: true,
                                          goalId: goal.id,
                                          targetStepId: step.id,
                                          steps: goal.steps || []
                                        })
                                      }
                                    >
                                      退回此步骤返工
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* 行内追加新步骤（支持指定 AI / 人工 与数字员工） */}
                      <div className="goal-step-add">
                        <select
                          aria-label="步骤责任方"
                          value={inlineStepOwners[goal.id] || 'agent'}
                          onChange={(e) =>
                            setInlineStepOwners((prev) => ({
                              ...prev,
                              [goal.id]: e.target.value as StepOwner
                            }))
                          }
                          className="goal-form-select goal-step-owner-select"
                        >
                          <option value="agent">AI 执行</option>
                          <option value="human">需我处理</option>
                        </select>
                        {(inlineStepOwners[goal.id] || 'agent') === 'agent' && bots.length > 1 && (
                          <select
                            aria-label="指派数字员工"
                            value={inlineStepBots[goal.id] || ''}
                            onChange={(e) =>
                              setInlineStepBots((prev) => ({
                                ...prev,
                                [goal.id]: e.target.value
                              }))
                            }
                            className="goal-form-select goal-step-bot-select"
                          >
                            <option value="">默认员工</option>
                            {bots.map((b) => (
                              <option key={b.id} value={b.id}>
                                @{b.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          type="text"
                          placeholder="输入后续步骤，回车快速添加..."
                          value={inlineStepInputs[goal.id] || ''}
                          onChange={(e) =>
                            setInlineStepInputs((prev) => ({
                              ...prev,
                              [goal.id]: e.target.value
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleAddInlineStep(goal.id);
                            }
                          }}
                          className="goal-step-add-input"
                        />
                        <button
                          type="button"
                          className="btn-secondary goal-step-add-btn"
                          onClick={() => handleAddInlineStep(goal.id)}
                          disabled={
                            addingStepGoalId === goal.id ||
                            !(inlineStepInputs[goal.id] || '').trim()
                          }
                          aria-label="添加执行步骤"
                        >
                          <Plus size={14} /> {addingStepGoalId === goal.id ? '添加中…' : '添加'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 进展备忘 */}
                {goal.notes && (
                  <div className="goal-notes-section">
                    <div className="goal-notes-title">进展备忘与推进记录：</div>
                    <pre className="goal-notes-pre">{goal.notes}</pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 新建目标模态框 */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="新建目标工作区"
      >
        <div className="goal-modal-body">
          {/* 1. 目标形态 3 选 1 */}
          <div className="goal-form-field">
            <label className="goal-form-label">目标形态</label>
            <div className="goal-mode-picker">
              {GOAL_MODES.map((m) => {
                const isSelected = newMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSelectModeInModal(m.id)}
                    className={`goal-mode-card ${isSelected ? 'is-active' : ''}`}
                  >
                    <div className="goal-mode-card-head">
                      {m.icon({ size: 15 })}
                      <span>{m.label}</span>
                    </div>
                    <div className="goal-mode-card-tag">{m.tagline}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="goal-form-field">
            <div className="goal-form-header-inline">
              <label className="goal-form-label">
                目标名称 <span className="goal-form-required">*</span>
              </label>
              <button
                type="button"
                onClick={handleApplyStarterPreset}
                className="goal-btn-preset-link"
              >
                填入{modeOf(newMode).label}示例
              </button>
            </div>
            <input
              type="text"
              placeholder="一句话描述你要达成的终局结果..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleDirectCreate();
                }
              }}
              aria-label="目标名称"
              maxLength={80}
              className="goal-form-input"
            />
          </div>

          <div className="goal-form-field">
            <label className="goal-form-label">终局验收标准（怎么算真正做完？）</label>
            <input
              type="text"
              placeholder={modeOf(newMode).criteriaPlaceholder}
              value={newCriteria}
              onChange={(e) => setNewCriteria(e.target.value)}
              className="goal-form-input"
            />
          </div>

          <div className="goal-form-field">
            <label className="goal-form-label">所属领域</label>
            <div className="goal-cat-picker">
              {CATEGORIES.map((c) => {
                const isSelected = newCategory === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setNewCategory(c.id)}
                    className={`goal-cat-btn ${isSelected ? 'is-active' : ''}`}
                  >
                    {c.icon({ size: 12 })}
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="goal-form-row-2col">
            <div className="goal-form-field">
              <label className="goal-form-label">期望截止日期（选填）</label>
              <input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                className="goal-form-input"
              />
            </div>
            <div className="goal-form-field">
              <label className="goal-form-label">量化指标（选填，如延迟/数量）</label>
              <div className="goal-metric-inputs">
                <input
                  type="text"
                  placeholder="指标名(如 P99)"
                  value={newMetricLabel}
                  onChange={(e) => setNewMetricLabel(e.target.value)}
                  className="goal-form-input"
                />
                <input
                  type="text"
                  placeholder="当前"
                  value={newMetricCurrent}
                  onChange={(e) => setNewMetricCurrent(e.target.value)}
                  className="goal-form-input goal-metric-num"
                />
                <input
                  type="text"
                  placeholder="目标"
                  value={newMetricTarget}
                  onChange={(e) => setNewMetricTarget(e.target.value)}
                  className="goal-form-input goal-metric-num"
                />
                <input
                  type="text"
                  placeholder="单位"
                  value={newMetricUnit}
                  onChange={(e) => setNewMetricUnit(e.target.value)}
                  className="goal-form-input goal-metric-unit"
                />
              </div>
            </div>
          </div>

          <div className="goal-form-field">
            <label className="goal-form-label">背景上下文与约束（选填）</label>
            <textarea
              rows={2}
              placeholder="补充仓库范围、上下游依赖、注意事项或不想被遗忘的决策前提..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="goal-form-textarea"
            />
          </div>

          {newMode !== 'portfolio' && (
            <div className="goal-form-field">
              <label className="goal-form-label">
                拆解步骤（选填，每行一步；行尾加 [人工] 可标为需你确认）
              </label>
              <textarea
                rows={3}
                placeholder="例如：&#10;梳理依赖清单并确认范围&#10;完成核心模块改造与单测&#10;确认上线窗口 [人工]"
                value={newStepsText}
                onChange={(e) => setNewStepsText(e.target.value)}
                className="goal-form-textarea"
              />
            </div>
          )}

          {/* 默认不设定时，按需展开 */}
          <div className="goal-cadence-toggle-block">
            <label className="goal-cadence-checkbox">
              <input
                type="checkbox"
                checked={newShowCadence}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setNewShowCadence(checked);
                  if (!checked) setNewCadence('');
                  else if (!newCadence) setNewCadence('weekly mon 10:00');
                }}
              />
              <span>开启内置周期推演（默认关闭，推荐按需推进或挂载 Routine 巡检）</span>
            </label>
            {newShowCadence && (
              <select
                value={newCadence}
                onChange={(e) => setNewCadence(e.target.value)}
                className="goal-form-select"
              >
                <option value="daily 09:00">每天 09:00</option>
                <option value="weekdays 09:30">每个工作日 09:30</option>
                <option value="weekly mon 10:00">每周一 10:00</option>
                <option value="monthly 1 09:00">每月 1 日 09:00</option>
              </select>
            )}
          </div>

          {createError && (
            <div className="goal-form-error" role="alert">
              {createError}
            </div>
          )}

          <div className="goal-modal-actions">
            <button
              type="button"
              className="btn-secondary goal-plan-agent-btn"
              onClick={handleAskAgentPlan}
              disabled={!newTitle.trim()}
            >
              <Sparkles size={14} /> 让 {botName} 在对话中细化
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleDirectCreate}
              disabled={creating || !newTitle.trim()}
            >
              {creating ? '创建中…' : '创建目标'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 编辑目标模态框 */}
      <Modal
        isOpen={editingGoal !== null}
        onClose={closeEditModal}
        title="编辑目标详情"
      >
        <div className="goal-modal-body">
          <div className="goal-form-field">
            <label className="goal-form-label">目标形态</label>
            <div className="goal-mode-picker">
              {GOAL_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setEditMode(m.id)}
                  className={`goal-mode-card ${editMode === m.id ? 'is-active' : ''}`}
                >
                  <div className="goal-mode-card-head">
                    {m.icon({ size: 15 })}
                    <span>{m.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="goal-form-field">
            <label className="goal-form-label">目标名称</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveEdit();
                }
              }}
              aria-label="目标名称"
              maxLength={80}
              className="goal-form-input"
            />
          </div>

          <div className="goal-form-field">
            <label className="goal-form-label">终局验收标准</label>
            <input
              type="text"
              value={editCriteria}
              onChange={(e) => setEditCriteria(e.target.value)}
              placeholder="明确达到什么条件算彻底完成"
              className="goal-form-input"
            />
          </div>

          <div className="goal-form-field">
            <label className="goal-form-label">领域分类</label>
            <div className="goal-cat-picker">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setEditCategory(c.id)}
                  className={`goal-cat-btn ${editCategory === c.id ? 'is-active' : ''}`}
                >
                  {c.icon({ size: 12 })}
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="goal-form-row-2col">
            <div className="goal-form-field">
              <label className="goal-form-label">期望截止日期</label>
              <input
                type="date"
                value={editDue}
                onChange={(e) => setEditDue(e.target.value)}
                className="goal-form-input"
              />
            </div>
            <div className="goal-form-field">
              <label className="goal-form-label">内置周期提醒</label>
              <select
                value={editCadence}
                onChange={(e) => setEditCadence(e.target.value)}
                className="goal-form-select"
              >
                <option value="">不设周期提醒（按需推进）</option>
                <option value="daily 09:00">每天 09:00</option>
                <option value="weekdays 09:30">每个工作日 09:30</option>
                <option value="weekly mon 10:00">每周一 10:00</option>
                <option value="monthly 1 09:00">每月 1 日 09:00</option>
              </select>
            </div>
          </div>

          <div className="goal-form-field">
            <label className="goal-form-label">量化指标（选填）</label>
            <div className="goal-metric-inputs">
              <input
                type="text"
                placeholder="指标名"
                value={editMetricLabel}
                onChange={(e) => setEditMetricLabel(e.target.value)}
                className="goal-form-input"
              />
              <input
                type="text"
                placeholder="当前值"
                value={editMetricCurrent}
                onChange={(e) => setEditMetricCurrent(e.target.value)}
                className="goal-form-input goal-metric-num"
              />
              <input
                type="text"
                placeholder="目标值"
                value={editMetricTarget}
                onChange={(e) => setEditMetricTarget(e.target.value)}
                className="goal-form-input goal-metric-num"
              />
              <input
                type="text"
                placeholder="单位"
                value={editMetricUnit}
                onChange={(e) => setEditMetricUnit(e.target.value)}
                className="goal-form-input goal-metric-unit"
              />
            </div>
          </div>

          <div className="goal-form-field">
            <label className="goal-form-label">背景描述</label>
            <textarea
              rows={3}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="goal-form-textarea"
            />
          </div>

          {editError && (
            <div className="goal-form-error" role="alert">
              {editError}
            </div>
          )}

          <div className="goal-modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={closeEditModal}
              disabled={savingEdit}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSaveEdit}
              disabled={savingEdit || !editTitle.trim()}
            >
              {savingEdit ? '保存中…' : '保存更改'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 补充指引重试弹窗 */}
      <Modal
        isOpen={guidanceModal.isOpen}
        onClose={() => setGuidanceModal((prev) => ({ ...prev, isOpen: false }))}
        title="补充输入并继续推进"
      >
        <div className="goal-modal-body">
          <div className="goal-guidance-step-header">
            当前步骤: <strong>{guidanceModal.stepTitle}</strong>
          </div>
          <div className="goal-form-field">
            <label className="goal-form-label">
              向数字员工提供确认决策、排查指令或补充数据:
            </label>
            <textarea
              rows={4}
              placeholder="例如：已确认下游团队周四切流，请继续生成灰度检查清单并推进下一步..."
              value={guidanceModal.guidance}
              onChange={(e) =>
                setGuidanceModal((prev) => ({ ...prev, guidance: e.target.value }))
              }
              className="goal-form-textarea"
            />
          </div>
          <div className="goal-modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setGuidanceModal((prev) => ({ ...prev, isOpen: false }))}
            >
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleRetryWithGuidance}>
              提交并继续推进
            </button>
          </div>
        </div>
      </Modal>

      {/* 退回历史步骤弹窗 */}
      <Modal
        isOpen={rollbackModal.isOpen}
        onClose={() => setRollbackModal((prev) => ({ ...prev, isOpen: false }))}
        title="退回到指定步骤返工"
      >
        <div className="goal-modal-body">
          <div className="goal-rollback-notice">
            选择要退回的目标步骤，该步骤及其后续的所有步骤都将重置为待办 (Pending) 状态：
          </div>
          <div className="goal-form-field">
            <select
              value={rollbackModal.targetStepId}
              onChange={(e) =>
                setRollbackModal((prev) => ({ ...prev, targetStepId: e.target.value }))
              }
              className="goal-form-select"
            >
              {rollbackModal.steps.map((st) => (
                <option key={st.id} value={st.id}>
                  步骤 {st.idx || 1}: {st.title} [{st.status}]
                </option>
              ))}
            </select>
          </div>
          <div className="goal-modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRollbackModal((prev) => ({ ...prev, isOpen: false }))}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleRollback}
              disabled={rollbackBusy}
            >
              {rollbackBusy ? '处理中…' : '确认退回并重新推进'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
};
