import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Target,
  Plus,
  Play,
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
  ListTodo
} from 'lucide-react';
import type { Goal, GoalStep, StepStatus } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import {
  CATEGORIES,
  categoryOf,
  describeCadence,
  dueLabel,
  CATEGORY_PRESETS
} from '../../utils/goals';

export const GoalsView: React.FC = () => {
  const { showToast, setTab, activeBot } = useApp();
  const botName = activeBot?.name || '小哀';

  const [goals, setGoals] = useState<Goal[]>([]);
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
  const expandedInitRef = useRef(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'active' | 'done' | 'paused'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGoalIds, setExpandedGoalIds] = useState<Set<string>>(new Set());
  const [advancingGoalId, setAdvancingGoalId] = useState<string | null>(null);

  // 新建目标弹窗状态
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<string>('career');
  const [newDue, setNewDue] = useState('');
  const [newCadence, setNewCadence] = useState('weekdays 09:30');
  const [newStepsText, setNewStepsText] = useState('');

  // 编辑目标弹窗状态
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editCadence, setEditCadence] = useState('');
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);
  const deleteGoalTimerRef = useRef<any>(null);

  // 行内添加新步骤输入
  const [inlineStepInputs, setInlineStepInputs] = useState<Record<string, string>>({});

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
      const data = await api.getGoals();
      const list = Array.isArray(data) ? data : [];
      setGoals(list);
      setLoadError(null);
      // 仅在首次载入时默认展开；后续刷新保留用户手动折叠的状态
      if (!expandedInitRef.current) {
        setExpandedGoalIds(new Set(list.map((g) => g.id)));
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

  // 过滤后的目标列表
  const filteredGoals = useMemo(() => {
    return goals.filter((g) => {
      // 状态过滤
      if (selectedStatus === 'active' && g.status !== 'active') return false;
      if (selectedStatus === 'done' && g.status !== 'done') return false;
      if (selectedStatus === 'paused' && g.status !== 'paused') return false;

      // 分类过滤
      if (selectedCategory && g.category?.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }

      // 关键词搜索
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchTitle = g.title.toLowerCase().includes(q);
        const matchDesc = g.description?.toLowerCase().includes(q);
        const matchStep = (g.steps || []).some((s) => s.title.toLowerCase().includes(q));
        if (!matchTitle && !matchDesc && !matchStep) return false;
      }

      return true;
    });
  }, [goals, selectedStatus, selectedCategory, searchQuery]);

  const hasActiveFilter =
    selectedStatus !== 'all' || Boolean(selectedCategory) || Boolean(searchQuery.trim());
  const resetFilters = () => {
    setSelectedStatus('all');
    setSelectedCategory('');
    setSearchQuery('');
  };

  // 待审批修订提案列表
  const pendingProposals = useMemo(() => {
    return goals.filter((g) => g.proposal && g.proposal.status === 'pending');
  }, [goals]);

  // 各分类下的目标计数
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of goals) {
      const cat = (g.category || 'other').toLowerCase();
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [goals]);

  // 切换目标达成/激活状态
  const handleToggleGoalDone = async (goal: Goal) => {
    if (statusGoalId) return;
    const nextStatus = goal.status === 'done' ? 'active' : 'done';
    setStatusGoalId(goal.id);
    try {
      await api.updateGoal(goal.id, { status: nextStatus });
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, status: nextStatus } : g)));
      showToast(nextStatus === 'done' ? '目标已达成' : '目标已重新置为推进中', 'success');
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`, 'error');
    } finally {
      setStatusGoalId(null);
    }
  };

  // 切换目标暂停/恢复状态
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

  // 切换单一步骤完成状态
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
      showToast(`步骤「${step.title}」已${nextStatus === 'done' ? '完成' : '设为待办'}`, 'success');
    } catch (err: any) {
      showToast(`更新步骤失败: ${err.message}`, 'error');
    } finally {
      setUpdatingStepId(null);
    }
  };

  // 立即推进 / Check-in
  const handleAdvance = async (goalId: string) => {
    if (advancingGoalId) return;
    setAdvancingGoalId(goalId);
    try {
      const res = await api.advanceGoal(goalId);
      if (res.status === 'blocked') {
        showToast(`推进受阻: ${res.blockedReason || '需处理阻碍或修订'}`, 'warning');
      } else if (res.goalCompleted) {
        showToast('🎉 恭喜！长周期目标已全部推进完成达成！', 'success');
      } else {
        showToast(`推进成功: 步骤 [${res.stepTitle || '当前阶段'}] 已达成`, 'success');
      }
      await loadGoals();
    } catch (err: any) {
      showToast(`推进失败: ${err.message}`, 'error');
    } finally {
      setAdvancingGoalId(null);
    }
  };

  // 行内添加新步骤
  const handleAddInlineStep = async (goalId: string) => {
    const text = (inlineStepInputs[goalId] || '').trim();
    if (!text || addingStepGoalId) return;
    setAddingStepGoalId(goalId);
    try {
      await api.addGoalStep(goalId, { title: text, description: text });
      setInlineStepInputs((prev) => ({ ...prev, [goalId]: '' }));
      showToast(`已添加步骤「${text}」`, 'success');
      await loadGoals();
    } catch (err: any) {
      showToast(`添加步骤失败: ${err.message}`, 'error');
    } finally {
      setAddingStepGoalId(null);
    }
  };

  // 审批修订提案
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

  // 现场补充指引重试
  const handleRetryWithGuidance = async () => {
    const { goalId, stepId, guidance } = guidanceModal;
    if (!guidance.trim()) {
      showToast('请输入指导说明', 'warning');
      return;
    }
    try {
      setGuidanceModal((prev) => ({ ...prev, isOpen: false }));
      setAdvancingGoalId(goalId);
      const res = await api.retryGoal(goalId, { stepId, guidance: guidance.trim() });
      if (res.status === 'blocked') {
        showToast(`重试推进仍受阻: ${res.blockedReason || '请继续调整'}`, 'warning');
      } else {
        showToast('带着新指引已顺利推进！', 'success');
      }
      await loadGoals();
    } catch (err: any) {
      showToast(`重试失败: ${err.message}`, 'error');
    } finally {
      setAdvancingGoalId(null);
    }
  };

  // 退回历史步骤返工
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

  // 删除目标
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

  // 在对话中商讨该目标
  const handleDiscussInChat = (goal: Goal) => {
    const prompt = `关于我的长周期目标【${goal.title}】(ID: ${goal.id})：请帮我盘点目前的推进进度，评估后续步骤可行性，并告诉我下一步具体该怎么做？`;
    sessionStorage.setItem('museclaw_chat_draft', prompt);
    window.dispatchEvent(new CustomEvent('museclaw:chat_draft', { detail: prompt }));
    setTab('chat');
    showToast('已跳转到对话，可直接发送或补充要求', 'info');
  };

  // 打开新建弹窗并可预填分类
  const handleOpenCreateModal = (catId?: string) => {
    const targetCat = catId || 'career';
    setCreateError('');
    setNewCategory(targetCat);
    setNewTitle('');
    setNewDesc('');
    setNewDue('');
    setNewCadence('weekdays 09:30');

    const preset = CATEGORY_PRESETS[targetCat];
    if (preset) {
      setNewTitle(preset.title);
      setNewDesc(preset.description);
      setNewStepsText(preset.steps.join('\n'));
    } else {
      setNewStepsText('');
    }
    setIsCreateModalOpen(true);
  };

  // 让 Agent 协助规划目标 (跳转对话)
  const handleAskAgentPlan = () => {
    if (!newTitle.trim()) {
      showToast('请先输入想达成的目标名称', 'warning');
      return;
    }
    const catDef = categoryOf(newCategory);
    const extras: string[] = [];
    if (newCategory) extras.push(`所属领域: ${catDef.label}`);
    if (newDue) extras.push(`期望截止日期: ${newDue}`);
    if (newCadence) extras.push(`提醒周期: ${describeCadence(newCadence)}`);
    if (newDesc.trim()) extras.push(`背景说明: ${newDesc.trim()}`);

    const prompt = `帮我系统性规划一个目标：“${newTitle.trim()}”${extras.length > 0 ? ` (${extras.join('，')})` : ''}。请运用 goals 工具将它拆解为具体可量化落地的执行步骤，并在对话中向我汇报规划方案。`;

    sessionStorage.setItem('museclaw_chat_draft', prompt);
    window.dispatchEvent(new CustomEvent('museclaw:chat_draft', { detail: prompt }));
    setIsCreateModalOpen(false);
    setTab('chat');
    showToast(`已将目标规划意向转交给 ${botName}`, 'info');
  };

  // 直接创建目标
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

    const steps = newStepsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const formattedSteps: GoalStep[] = steps.map((s, idx) => ({
      id: `s_${idx + 1}`,
      idx: idx + 1,
      title: s,
      description: s,
      status: 'pending',
      updatedAt: Date.now()
    }));

    try {
      const created = await api.createGoal({
        title,
        description: newDesc.trim() || newTitle.trim(),
        category: newCategory,
        due: newDue || undefined,
        cadence: newCadence,
        steps: formattedSteps.length > 0 ? formattedSteps : undefined,
        status: 'active'
      });
      setGoals((prev) => [created, ...prev]);
      setExpandedGoalIds((prev) => new Set([...prev, created.id]));
      // 新建后回到全部筛选，确保能看到刚创建的目标
      setSelectedStatus('all');
      setSelectedCategory('');
      setSearchQuery('');
      setIsCreateModalOpen(false);
      showToast('目标已创建，开始追踪', 'success');
    } catch (err: any) {
      setCreateError(err.message || '创建失败，请重试');
      showToast(`创建失败: ${err.message}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  // 打开编辑弹窗
  const handleOpenEditModal = (goal: Goal) => {
    setEditError('');
    setEditingGoal(goal);
    setEditTitle(goal.title);
    setEditDesc(goal.description || '');
    setEditCategory(goal.category || 'other');
    setEditDue(goal.due || '');
    setEditCadence(goal.cadence || '');
  };

  // 提交编辑更新
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
    try {
      const updated = await api.updateGoal(editingGoal.id, {
        title,
        description: editDesc.trim(),
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

  // 关闭编辑弹窗时还原草稿，避免未保存内容残留
  const closeEditModal = () => {
    if (!editingGoal) return;
    setEditError('');
    setEditingGoal(null);
  };

  return (
    <section className="view-stage goals-stage" aria-label="长周期目标推进">
      {/* 顶部主标题栏 */}
      <div className="view-header goal-header-wrap">
        <div>
          <div className="view-heading goal-heading">
            <Target size={22} className="goal-heading-icon" />
            <span>长周期目标</span>
          </div>
          <div className="view-sub">
            跨会话持久化目标管理体系：支持多领域规划、阶段里程碑拆解、定时 Check-in 自主推演与自适应修订。
          </div>
        </div>
        <div className="view-header-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => handleOpenCreateModal()}
          >
            <Plus size={16} /> 规划新目标
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

      {/* 待审批修订提案横幅 (AI Proposals) */}
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
                    等待人类确认决策
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

      {/* 搜索与状态过滤器栏 */}
      <div className="goal-filter-toolbar">
        {/* 状态分段选择器 */}
        <div className="goal-status-tabs">
          {[
            { id: 'all', label: '全部' },
            { id: 'active', label: '推进中' },
            { id: 'done', label: '已达成' },
            { id: 'paused', label: '已暂停' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedStatus(tab.id as any)}
              aria-pressed={selectedStatus === tab.id}
              className={`goal-status-tab-btn ${selectedStatus === tab.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {tab.label}
              <span className="goal-status-tab-count">
                {tab.id === 'all'
                  ? goals.length
                  : goals.filter((g) => g.status === tab.id).length}
              </span>
            </button>
          ))}
        </div>

        {/* 结果计数 */}
        {hasActiveFilter && (
          <span className="goal-count" aria-live="polite">
            匹配 {filteredGoals.length} / {goals.length} 个
          </span>
        )}

        {/* 搜索框 */}
        <div className="goal-search-wrapper">
          <Search size={14} className="goal-search-icon" aria-hidden="true" />
          <input
            type="text"
            aria-label="搜索目标或步骤"
            placeholder="搜索目标或步骤..."
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

      {/* 领域分类胶囊滚动栏 (Category Chips) */}
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
            <div className="goal-empty-icon">🎯</div>
            <div className="goal-empty-title">
              {searchQuery || selectedCategory || selectedStatus !== 'all'
                ? '未找到符合条件的目标'
                : '暂无跨周期规划目标'}
            </div>
            <div className="goal-empty-desc">
              {hasActiveFilter
                ? '换个筛选条件，或清空后查看所有目标。'
                : `点击下方快捷领域模板或上方“规划新目标”，让 ${botName} 协助你将长期目标分解为清晰的阶段。`}
            </div>

            {hasActiveFilter && (
              <button
                type="button"
                className="om-btn-subtle goal-clear-filter-btn"
                onClick={resetFilters}
              >
                清空筛选条件
              </button>
            )}

            {/* 快速起步推荐网格 */}
            {!hasActiveFilter && (
              <div className="goal-presets-grid">
                {CATEGORIES.slice(0, 6).map((c) => (
                  <div
                    key={c.id}
                    onClick={() => handleOpenCreateModal(c.id)}
                    className="goal-preset-card hover-card"
                  >
                    <div className="goal-preset-title">
                      {c.icon({ size: 16 })}
                      <span>{c.label}</span>
                    </div>
                    <div className="goal-preset-desc">
                      {c.description}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          filteredGoals.map((goal) => {
            const isAdvancing = advancingGoalId === goal.id;
            const isExpanded = expandedGoalIds.has(goal.id);
            const steps = goal.steps || [];
            const isDone = goal.status === 'done';
            const isPaused = goal.status === 'paused';
            const catDef = categoryOf(goal.category || 'other');
            const dueInfo = dueLabel(goal.due);
            const activeStep = steps.find((s) => s.status === 'in_progress' || s.status === 'blocked') || steps.find((s) => s.status === 'pending');
            const progress = goal.progress || 0;

            return (
              <div
                key={goal.id}
                className={`goal-card ${isDone ? 'is-done' : ''}`}
              >
                {/* 卡片头部：快速勾选完成、分类标签、截止日期、提醒周期、快捷操作 */}
                <div className="goal-card-head">
                  <div className="goal-card-badges">
                    {/* 一键勾选达成状态 */}
                    <button
                      type="button"
                      onClick={() => handleToggleGoalDone(goal)}
                      className={`goal-check-btn ${isDone ? 'is-checked' : ''}`}
                      title={isDone ? '标记为未完成' : '标记为已达成'}
                      aria-label={isDone ? '重新开启目标' : '标记目标已达成'}
                      disabled={Boolean(statusGoalId)}
                    >
                      {isDone ? <SquareCheck size={20} color="#10b981" /> : <Square size={20} />}
                    </button>

                    {/* 领域分类徽章 */}
                    <span className="goal-badge-item">
                      {catDef.icon({ size: 12 })}
                      <span>{catDef.label}</span>
                    </span>

                    {/* 截止日期徽章 */}
                    {goal.due && (
                      <span className={`goal-badge-item goal-due-badge ${dueInfo.isOverdue ? 'is-overdue' : ''}`}>
                        <CalendarDays size={12} />
                        <span>{dueInfo.label}</span>
                      </span>
                    )}

                    {/* 巡检周期徽章 */}
                    <span className="goal-badge-item">
                      <Bell size={12} />
                      <span>{goal.cadence ? describeCadence(goal.cadence) : '单次手动'}</span>
                    </span>

                    {/* 状态徽章 */}
                    <span
                      className={`goal-status-chip ${isDone ? 'is-done' : isPaused ? 'is-paused' : 'is-active'}`}
                    >
                      {isDone ? '已达成' : isPaused ? '已暂停' : '推进中'}
                    </span>
                  </div>

                  {/* 右侧操作按钮组 */}
                  <div className="goal-card-actions">
                    {/* 立即推演 Check-in */}
                    {!isDone && (
                      <button
                        type="button"
                        className="btn-primary goal-advance-btn"
                        disabled={isAdvancing}
                        onClick={() => handleAdvance(goal.id)}
                      >
                        {isAdvancing ? <Loader2 size={13} className="spin-icon" /> : <Play size={13} />}
                        <span>{isAdvancing ? '推演中...' : '立即推进'}</span>
                      </button>
                    )}

                    {/* 暂停 / 恢复 */}
                    {!isDone && (
                      <button
                        type="button"
                        className="btn-secondary goal-action-icon-btn"
                        onClick={() => handleTogglePause(goal)}
                        disabled={Boolean(statusGoalId)}
                        aria-label={isPaused ? '恢复目标' : '暂停目标'}
                        title={isPaused ? '恢复巡检' : '暂停巡检'}
                      >
                        {isPaused ? <Play size={14} /> : <Pause size={14} />}
                      </button>
                    )}

                    {/* 在对话中商讨 */}
                    <button
                      type="button"
                      className="btn-secondary goal-action-icon-btn"
                      onClick={() => handleDiscussInChat(goal)}
                      aria-label="在对话中商讨此目标"
                      title="在对话中与数字员工商讨此目标"
                    >
                      <MessageCircle size={14} />
                    </button>

                    {/* 编辑 */}
                    <button
                      type="button"
                      className="btn-secondary goal-action-icon-btn"
                      onClick={() => handleOpenEditModal(goal)}
                      aria-label="编辑目标信息"
                      title="编辑目标信息"
                    >
                      <Edit3 size={14} />
                    </button>

                    {/* 删除 */}
                    <button
                      type="button"
                      className={`btn-secondary goal-action-icon-btn is-danger ${deletingGoalId === goal.id ? 'is-confirming' : ''}`}
                      onClick={() => handleDeleteGoal(goal)}
                      aria-label="删除目标"
                      title={deletingGoalId === goal.id ? '再次点击确认删除' : '删除目标'}
                    >
                      <Trash2 size={14} />
                      {deletingGoalId === goal.id && <span className="inline-confirm-text">确认？</span>}
                    </button>
                  </div>
                </div>

                {/* 目标标题与背景说明 */}
                <div className="goal-info-section">
                  <div className={`goal-card-title ${isDone ? 'is-done' : ''}`}>
                    {goal.title}
                  </div>
                  {goal.description && (
                    <div className="goal-card-desc">
                      {goal.description}
                    </div>
                  )}
                  {activeStep && !isDone && (
                    <div className="goal-active-step">
                      👉 当前阶段: [{activeStep.idx || 1}] {activeStep.title}
                    </div>
                  )}
                </div>

                {/* 进度条 */}
                <div className="goal-progress-section">
                  <div className="goal-progress-meta">
                    <span>
                      里程碑进度: {steps.filter((s) => s.status === 'done' || s.status === 'skipped').length} / {steps.length} 步骤
                    </span>
                    <span className={`goal-progress-percent ${progress === 100 ? 'is-complete' : ''}`}>
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

                {steps.length > 0 && steps.every((st) => st.status === 'done' || st.status === 'skipped') && !isDone && (
                  <div className="goal-complete-hint">
                    <CheckCircle2 size={14} />
                    <span>所有步骤已完成，可以标记目标达成</span>
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

                {/* 步骤清单折叠切换 */}
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
                      <span>执行步骤清单 ({steps.length})</span>
                    </div>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>

                  {/* 展开的步骤列表 */}
                  {isExpanded && (
                    <div className="goal-steps-list">
                      {steps.map((step) => {
                        const isStepDone = step.status === 'done';
                        const isStepBlocked = step.status === 'blocked';
                        const isStepInProgress = step.status === 'in_progress';

                        return (
                          <div
                            key={step.id}
                            className={`goal-step-item ${isStepBlocked ? 'is-blocked' : ''}`}
                          >
                            {/* 步骤完成勾选按钮 */}
                            <button
                              type="button"
                              onClick={() => handleToggleStepStatus(goal, step)}
                              disabled={Boolean(updatingStepId)}
                              aria-label={isStepDone ? `将步骤 ${step.title} 设为待办` : `将步骤 ${step.title} 标记完成`}
                              className={`goal-step-checkbox ${isStepDone ? 'is-done' : isStepBlocked ? 'is-blocked' : ''}`}
                              title="点击标记完成/待办"
                            >
                              {isStepDone ? (
                                <CheckCircle2 size={16} color="#10b981" />
                              ) : isStepBlocked ? (
                                <AlertTriangle size={16} color="#f59e0b" />
                              ) : isStepInProgress ? (
                                <Loader2 size={16} className="spin-icon" color="var(--om-accent)" />
                              ) : (
                                <Circle size={16} />
                              )}
                            </button>

                            {/* 步骤文本 */}
                            <div className="goal-step-content">
                              <div className={`goal-step-title ${isStepDone ? 'is-done' : ''}`}>
                                {step.idx || 1}. {step.title}
                              </div>
                              {step.description && step.description !== step.title && (
                                <div className="goal-step-desc">
                                  {step.description}
                                </div>
                              )}
                              {step.note && (
                                <div className="goal-step-note">
                                  📝 {step.note}
                                </div>
                              )}
                              {isStepBlocked && step.blockedReason && (
                                <div className="goal-step-blocked-box">
                                  <span>⚠️ 阻碍卡点: {step.blockedReason}</span>
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

                      {/* 行内追加新步骤 */}
                      <div className="goal-step-add">
                        <input
                          type="text"
                          placeholder="输入后续步骤，回车快速添加..."
                          value={inlineStepInputs[goal.id] || ''}
                          onChange={(e) =>
                            setInlineStepInputs((prev) => ({ ...prev, [goal.id]: e.target.value }))
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
                          disabled={addingStepGoalId === goal.id || !(inlineStepInputs[goal.id] || '').trim()}
                          aria-label="添加执行步骤"
                        >
                          <Plus size={14} /> {addingStepGoalId === goal.id ? '添加中…' : '添加'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 进展备忘与历史巡检笔记 (Notes) */}
                {goal.notes && (
                  <div className="goal-notes-section">
                    <div className="goal-notes-title">
                      📋 {botName} 进展备忘与巡检记录：
                    </div>
                    <pre className="goal-notes-pre">
                      {goal.notes}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 新建目标模态框 (New Goal Sheet) */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="规划新长周期目标"
      >
        <div className="goal-modal-body">
          <div className="goal-form-field">
            <label className="goal-form-label">
              你想要达成什么目标？ <span className="goal-form-required">*</span>
            </label>
            <input
              type="text"
              placeholder="例如：深入掌握 Agent 核心推理原理、完成 Q4 核心系统上线..."
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

          {/* 领域分类选择 */}
          <div className="goal-form-field">
            <label className="goal-form-label">
              所属领域分类
            </label>
            <div className="goal-cat-picker">
              {CATEGORIES.map((c) => {
                const isSelected = newCategory === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setNewCategory(c.id);
                      const p = CATEGORY_PRESETS[c.id];
                      if (p && !newTitle.trim()) {
                        setNewTitle(p.title);
                        setNewDesc(p.description);
                        setNewStepsText(p.steps.join('\n'));
                      }
                    }}
                    className={`goal-cat-btn ${isSelected ? 'is-active' : ''}`}
                  >
                    {c.icon({ size: 12 })}
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 期望截止日期与巡检提醒周期 */}
          <div className="goal-form-row-2col">
            <div className="goal-form-field">
              <label className="goal-form-label">
                期望截止日期 (选填)
              </label>
              <input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                className="goal-form-input"
              />
            </div>
            <div className="goal-form-field">
              <label className="goal-form-label">
                提醒与巡检周期
              </label>
              <select
                value={newCadence}
                onChange={(e) => setNewCadence(e.target.value)}
                className="goal-form-select"
              >
                <option value="daily 09:00">每天 09:00</option>
                <option value="weekdays 09:30">每个工作日 09:30</option>
                <option value="weekly mon 10:00">每周一 10:00</option>
                <option value="monthly 1 09:00">每月 1 日 09:00</option>
                <option value="">不设周期提醒 (单次手动推进)</option>
              </select>
            </div>
          </div>

          {/* 目标背景说明与约束 */}
          <div className="goal-form-field">
            <label className="goal-form-label">
              背景要求与重要性说明 (选填)
            </label>
            <textarea
              rows={2}
              placeholder="说明为什么这个目标重要、客观资源约束或核心成功标准..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="goal-form-textarea"
            />
          </div>

          {/* 执行步骤拆解 */}
          <div className="goal-form-field">
            <div className="goal-form-header-inline">
              <label className="goal-form-label">
                执行步骤 (每行一个步骤，留空将由数字员工协助拆解)
              </label>
              {CATEGORY_PRESETS[newCategory] && (
                <button
                  type="button"
                  onClick={() => {
                    const p = CATEGORY_PRESETS[newCategory];
                    setNewStepsText(p.steps.join('\n'));
                  }}
                  className="goal-btn-preset-link"
                >
                  ⚡ 填入{categoryOf(newCategory).label}推荐步骤
                </button>
              )}
            </div>
            <textarea
              rows={4}
              placeholder="步骤 1: 需求梳理与环境准备&#10;步骤 2: 方案落地与代码实现&#10;步骤 3: 自动化测试回归&#10;步骤 4: 交付复盘与沉淀"
              value={newStepsText}
              onChange={(e) => setNewStepsText(e.target.value)}
              className="goal-form-textarea"
            />
          </div>

          {createError && <div className="goal-form-error" role="alert">{createError}</div>}

          {/* 底部按钮组 */}
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
              {creating ? '创建中…' : '立项并开始追踪'}
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
            <label className="goal-form-label">
              目标名称
            </label>
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
            <label className="goal-form-label">
              领域分类
            </label>
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
              <label className="goal-form-label">
                期望截止日期
              </label>
              <input
                type="date"
                value={editDue}
                onChange={(e) => setEditDue(e.target.value)}
                className="goal-form-input"
              />
            </div>
            <div className="goal-form-field">
              <label className="goal-form-label">
                提醒与巡检周期
              </label>
              <select
                value={editCadence}
                onChange={(e) => setEditCadence(e.target.value)}
                className="goal-form-select"
              >
                <option value="daily 09:00">每天 09:00</option>
                <option value="weekdays 09:30">每个工作日 09:30</option>
                <option value="weekly mon 10:00">每周一 10:00</option>
                <option value="monthly 1 09:00">每月 1 日 09:00</option>
                <option value="">不设周期提醒</option>
              </select>
            </div>
          </div>

          <div className="goal-form-field">
            <label className="goal-form-label">
              背景描述
            </label>
            <textarea
              rows={3}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="goal-form-textarea"
            />
          </div>

          {editError && <div className="goal-form-error" role="alert">{editError}</div>}

          <div className="goal-modal-actions">
            <button type="button" className="btn-secondary" onClick={closeEditModal} disabled={savingEdit}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleSaveEdit} disabled={savingEdit || !editTitle.trim()}>
              {savingEdit ? '保存中…' : '保存更改'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 补充指引重试弹窗 */}
      <Modal
        isOpen={guidanceModal.isOpen}
        onClose={() => setGuidanceModal((prev) => ({ ...prev, isOpen: false }))}
        title="补充指引重试推进"
      >
        <div className="goal-modal-body">
          <div className="goal-guidance-step-header">
            当前卡点步骤: <strong>{guidanceModal.stepTitle}</strong>
          </div>
          <div className="goal-form-field">
            <label className="goal-form-label">
              向数字员工补充排障指令或业务输入:
            </label>
            <textarea
              rows={4}
              placeholder="例如：请尝试使用 mock 数据绕过外部网络依赖，或者补充指定配置路径..."
              value={guidanceModal.guidance}
              onChange={(e) => setGuidanceModal((prev) => ({ ...prev, guidance: e.target.value }))}
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
              立即带着新指引重试
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
              onChange={(e) => setRollbackModal((prev) => ({ ...prev, targetStepId: e.target.value }))}
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
            <button type="button" className="btn-primary" onClick={handleRollback} disabled={rollbackBusy}>
              {rollbackBusy ? '处理中…' : '确认退回并重新推进'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
};
