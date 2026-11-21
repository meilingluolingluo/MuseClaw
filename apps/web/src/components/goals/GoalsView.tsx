import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Target,
  Plus,
  Play,
  Pause,
  CheckCircle2,
  Circle,
  CircleSlash,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  Trash2,
  Sparkles,
  MessageCircle,
  Loader2,
  CalendarDays,
  Bell,
  Search,
  RotateCcw,
  Square,
  SquareCheck,
  Edit3,
  FileText,
  ListTodo,
  ArrowRight,
  Send
} from 'lucide-react';
import type { Goal, GoalStep, StepStatus } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import {
  CATEGORIES,
  CADENCES,
  WEEKDAYS,
  categoryOf,
  splitCadence,
  joinCadence,
  describeCadence,
  dueLabel,
  weekdayName,
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
    if (!confirm(`确定删除目标 “${goal.title}” 吗？此操作不可撤销。`)) return;
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
    const dirty =
      editTitle !== editingGoal.title ||
      editDesc !== (editingGoal.description || '') ||
      editCategory !== (editingGoal.category || 'other') ||
      editDue !== (editingGoal.due || '') ||
      editCadence !== (editingGoal.cadence || '');
    if (dirty && !confirm('有未保存的修改，确定放弃吗？')) return;
    setEditError('');
    setEditingGoal(null);
  };

  return (
    <section className="view-stage">
      {/* 顶部主标题栏 */}
      <div className="view-header" style={{ marginBottom: '16px' }}>
        <div>
          <div className="view-heading" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Target size={22} style={{ color: 'var(--om-accent, #3b82f6)' }} />
            长周期目标 (Goals)
          </div>
          <div className="view-sub">
            跨会话持久化目标管理体系：支持多领域生活与工作规划、多阶段里程碑拆解、定时 Check-in 自主推演与计划自适应修订。
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => handleOpenCreateModal()}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          {pendingProposals.map((goal) => {
            const p = goal.proposal!;
            const pSteps = p.proposedSteps || [];
            return (
              <div
                key={goal.id}
                style={{
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  borderRadius: '14px',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--om-accent, #3b82f6)' }}>
                    <Sparkles size={16} />
                    <span>{botName} 建议调整目标【{goal.title}】的推进计划</span>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                    等待人类确认决策
                  </span>
                </div>
                <div style={{ fontSize: '13.5px', color: 'var(--text-main)', lineHeight: 1.6 }}>
                  <strong>调整原因：</strong>{p.reason}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  <strong>修订后的后续步骤：</strong>
                  <ol style={{ margin: '6px 0 0 20px', padding: 0 }}>
                    {pSteps.map((st, i) => (
                      <li key={i} style={{ marginBottom: '3px' }}>
                        {typeof st === 'string' ? st : st.title}
                      </li>
                    ))}
                  </ol>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => handleResolveProposal(goal.id, true)}
                    disabled={Boolean(resolvingProposalId)}
                    style={{ fontSize: '13px', padding: '6px 16px' }}
                  >
                    采纳修订方案并更新步骤
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleResolveProposal(goal.id, false)}
                    disabled={Boolean(resolvingProposalId)}
                    style={{ fontSize: '13px', padding: '6px 16px' }}
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
      <div
        className="goal-filter-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          background: 'var(--om-surface)',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid var(--om-border)',
          marginBottom: '16px'
        }}
      >
        {/* 状态分段选择器 */}
        <div className="goal-status-tabs" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
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
              className={selectedStatus === tab.id ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: '13px', padding: '5px 14px', borderRadius: '8px' }}
            >
              {tab.label}
              <span style={{ marginLeft: '6px', opacity: 0.75, fontSize: '12px' }}>
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
        <div className="goal-search" style={{ position: 'relative', flex: 1, minWidth: 'min(220px, 100%)', maxWidth: '320px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            aria-label="搜索目标或步骤"
            placeholder="搜索目标或步骤..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px 6px 30px',
              fontSize: '13px',
              borderRadius: '8px',
              border: '1px solid var(--om-border)',
              background: 'var(--om-bg)',
              color: 'var(--text-main)',
              outline: 'none'
            }}
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
      <div
        className="goal-cat-row"
        style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          paddingBottom: '8px',
          marginBottom: '16px'
        }}
      >
        <button
          type="button"
          onClick={() => setSelectedCategory('')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '12.5px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            border: selectedCategory === '' ? '1px solid var(--om-accent)' : '1px solid var(--om-border)',
            background: selectedCategory === '' ? 'rgba(59, 130, 246, 0.12)' : 'var(--om-surface)',
            color: selectedCategory === '' ? 'var(--om-accent)' : 'var(--text-muted)'
          }}
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
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '20px',
                fontSize: '12.5px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                border: isActive ? '1px solid var(--om-accent)' : '1px solid var(--om-border)',
                background: isActive ? 'rgba(59, 130, 246, 0.12)' : 'var(--om-surface)',
                color: isActive ? 'var(--om-accent)' : 'var(--text-muted)'
              }}
            >
              {c.icon({ size: 14 })}
              <span>{c.label}</span>
              {count > 0 && (
                <span
                  style={{
                    fontSize: '11px',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    background: 'var(--om-bg)',
                    opacity: 0.8
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 目标卡片列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!loaded && goals.length === 0 ? (
          <div className="goals-loading" aria-label="加载中">
            {[0, 1, 2].map((i) => <div key={i} className="goal-skeleton" />)}
          </div>
        ) : filteredGoals.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '60px 20px',
              background: 'var(--om-surface)',
              borderRadius: '14px',
              border: '1px solid var(--om-border)'
            }}
          >
            <div style={{ fontSize: '42px', marginBottom: '12px' }}>🎯</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>
              {searchQuery || selectedCategory || selectedStatus !== 'all'
                ? '未找到符合条件的目标'
                : '暂无跨周期规划目标'}
            </div>
            <div style={{ fontSize: '13.5px', marginTop: '6px', color: 'var(--text-muted)', maxWidth: '520px', margin: '8px auto 0' }}>
              {hasActiveFilter
                ? '换个筛选条件，或清空后查看所有目标。'
                : `点击下方快捷领域模板或上方“规划新目标”，让 ${botName} 协助你将长期目标分解为清晰的阶段。`}
            </div>

            {hasActiveFilter && (
              <button
                type="button"
                className="om-btn-subtle"
                style={{ marginTop: '14px' }}
                onClick={resetFilters}
              >
                清空筛选条件
              </button>
            )}

            {/* 快速起步推荐网格 */}
            {!hasActiveFilter && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '12px',
                marginTop: '24px',
                textAlign: 'left'
              }}
            >
              {CATEGORIES.slice(0, 6).map((c) => (
                <div
                  key={c.id}
                  onClick={() => handleOpenCreateModal(c.id)}
                  style={{
                    padding: '14px',
                    background: 'var(--om-bg)',
                    borderRadius: '10px',
                    border: '1px solid var(--om-border)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  className="hover-card"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                    {c.icon({ size: 16 })}
                    {c.label}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.4 }}>
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
                className="goal-card"
                style={{
                  background: 'var(--om-surface)',
                  borderRadius: '14px',
                  border: isDone ? '1px solid var(--om-border)' : '1px solid var(--om-border)',
                  padding: '18px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  opacity: isDone ? 0.85 : 1
                }}
              >
                {/* 卡片头部：快速勾选完成、分类标签、截止日期、提醒周期、快捷操作 */}
                <div className="goal-card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div className="goal-card-badges" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    {/* 一键勾选达成状态 */}
                    <button
                      type="button"
                      onClick={() => handleToggleGoalDone(goal)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        color: isDone ? '#10b981' : 'var(--text-dim)',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title={isDone ? '标记为未完成' : '标记为已达成'}
                      aria-label={isDone ? '重新开启目标' : '标记目标已达成'}
                      disabled={Boolean(statusGoalId)}
                    >
                      {isDone ? <SquareCheck size={20} color="#10b981" /> : <Square size={20} />}
                    </button>

                    {/* 领域分类徽章 */}
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '3px 10px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 500,
                        border: '1px solid var(--om-border)',
                        background: 'var(--om-bg)'
                      }}
                    >
                      {catDef.icon({ size: 12 })}
                      {catDef.label}
                    </span>

                    {/* 截止日期徽章 */}
                    {goal.due && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: dueInfo.isOverdue ? 600 : 400,
                          background: dueInfo.isOverdue ? 'rgba(239, 68, 68, 0.12)' : 'var(--om-bg)',
                          color: dueInfo.isOverdue ? '#ef4444' : 'var(--text-dim)',
                          border: dueInfo.isOverdue ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--om-border)'
                        }}
                      >
                        <CalendarDays size={12} />
                        {dueInfo.label}
                      </span>
                    )}

                    {/* 巡检周期徽章 */}
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '3px 10px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        background: 'var(--om-bg)',
                        color: 'var(--text-dim)',
                        border: '1px solid var(--om-border)'
                      }}
                    >
                      <Bell size={12} />
                      {goal.cadence ? describeCadence(goal.cadence) : '单次手动'}
                    </span>

                    {/* 状态徽章 */}
                    <span
                      className={`goal-status-chip ${isDone ? 'is-done' : isPaused ? 'is-paused' : 'is-active'}`}
                    >
                      {isDone ? '已达成' : isPaused ? '已暂停' : '推进中'}
                    </span>
                  </div>

                  {/* 右侧操作按钮组 */}
                  <div className="goal-card-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* 立即推演 Check-in */}
                    {!isDone && (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={isAdvancing}
                        onClick={() => handleAdvance(goal.id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12.5px', padding: '5px 12px' }}
                      >
                        {isAdvancing ? <Loader2 size={13} className="spin-icon" /> : <Play size={13} />}
                        {isAdvancing ? '推演中...' : '立即推进'}
                      </button>
                    )}

                    {/* 暂停 / 恢复 */}
                    {!isDone && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleTogglePause(goal)}
                        disabled={Boolean(statusGoalId)}
                        aria-label={isPaused ? '恢复目标' : '暂停目标'}
                        style={{ padding: '5px 8px' }}
                        title={isPaused ? '恢复巡检' : '暂停巡检'}
                      >
                        {isPaused ? <Play size={14} /> : <Pause size={14} />}
                      </button>
                    )}

                    {/* 在对话中商讨 */}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleDiscussInChat(goal)}
                      aria-label="在对话中商讨此目标"
                      style={{ padding: '5px 8px' }}
                      title="在对话中与数字员工商讨此目标"
                    >
                      <MessageCircle size={14} />
                    </button>

                    {/* 编辑 */}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleOpenEditModal(goal)}
                      aria-label="编辑目标信息"
                      style={{ padding: '5px 8px' }}
                      title="编辑目标信息"
                    >
                      <Edit3 size={14} />
                    </button>

                    {/* 删除 */}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleDeleteGoal(goal)}
                      aria-label="删除目标"
                      style={{ padding: '5px 8px', color: '#ef4444' }}
                      title="删除目标"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* 目标标题与背景说明 */}
                <div>
                  <div
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      color: isDone ? 'var(--text-muted)' : 'var(--text-main)',
                      textDecoration: isDone ? 'line-through' : 'none'
                    }}
                  >
                    {goal.title}
                  </div>
                  {goal.description && (
                    <div style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '4px', lineHeight: 1.5 }}>
                      {goal.description}
                    </div>
                  )}
                  {activeStep && !isDone && (
                    <div style={{ fontSize: '13px', color: 'var(--om-accent)', marginTop: '6px', fontWeight: 500 }}>
                      👉 当前阶段: [{activeStep.idx || 1}] {activeStep.title}
                    </div>
                  )}
                </div>

                {/* 进度条 */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '5px' }}>
                    <span>
                      里程碑进度: {steps.filter((s) => s.status === 'done' || s.status === 'skipped').length} / {steps.length} 步骤
                    </span>
                    <span style={{ fontWeight: 600, color: progress === 100 ? '#10b981' : 'var(--text-main)' }}>
                      {progress}%
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: 'var(--om-bg)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${progress}%`,
                        height: '100%',
                        background: progress === 100 ? '#10b981' : 'var(--om-accent)',
                        borderRadius: '3px',
                        transition: 'width 0.3s ease'
                      }}
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
                <div style={{ borderTop: '1px solid var(--om-border)', paddingTop: '10px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'var(--text-muted)'
                    }}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ListTodo size={15} />
                      <span>执行步骤清单 ({steps.length})</span>
                    </div>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>

                  {/* 展开的步骤列表 */}
                  {isExpanded && (
                    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {steps.map((step) => {
                        const isStepDone = step.status === 'done';
                        const isStepBlocked = step.status === 'blocked';
                        const isStepInProgress = step.status === 'in_progress';

                        return (
                          <div
                            key={step.id}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '10px',
                              padding: '8px 12px',
                              background: 'var(--om-bg)',
                              borderRadius: '8px',
                              border: isStepBlocked ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--om-border)'
                            }}
                          >
                            {/* 步骤完成勾选按钮 */}
                            <button
                              type="button"
                              onClick={() => handleToggleStepStatus(goal, step)}
                              disabled={Boolean(updatingStepId)}
                              aria-label={isStepDone ? `将步骤 ${step.title} 设为待办` : `将步骤 ${step.title} 标记完成`}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                marginTop: '2px',
                                color: isStepDone ? '#10b981' : isStepBlocked ? '#f59e0b' : 'var(--text-dim)'
                              }}
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
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: '13.5px',
                                  fontWeight: 500,
                                  color: isStepDone ? 'var(--text-dim)' : 'var(--text-main)',
                                  textDecoration: isStepDone ? 'line-through' : 'none'
                                }}
                              >
                                {step.idx || 1}. {step.title}
                              </div>
                              {step.description && step.description !== step.title && (
                                <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '2px' }}>
                                  {step.description}
                                </div>
                              )}
                              {step.note && (
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', background: 'var(--om-surface)', padding: '4px 8px', borderRadius: '4px' }}>
                                  📝 {step.note}
                                </div>
                              )}
                              {isStepBlocked && step.blockedReason && (
                                <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '4px', fontWeight: 500 }}>
                                  ⚠️ 阻碍卡点: {step.blockedReason}
                                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      onClick={() =>
                                        setGuidanceModal({
                                          isOpen: true,
                                          goalId: goal.id,
                                          stepId: step.id,
                                          stepTitle: step.title,
                                          guidance: ''
                                        })
                                      }
                                      style={{ fontSize: '11px', padding: '3px 8px' }}
                                    >
                                      补充指导重试
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      onClick={() =>
                                        setRollbackModal({
                                          isOpen: true,
                                          goalId: goal.id,
                                          targetStepId: step.id,
                                          steps: goal.steps || []
                                        })
                                      }
                                      style={{ fontSize: '11px', padding: '3px 8px' }}
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
                      <div className="goal-step-add" style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
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
                          style={{
                            flex: 1,
                            padding: '6px 12px',
                            fontSize: '13px',
                            borderRadius: '8px',
                            border: '1px solid var(--om-border)',
                            background: 'var(--om-bg)',
                            color: 'var(--text-main)',
                            outline: 'none'
                          }}
                        />
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => handleAddInlineStep(goal.id)}
                          disabled={addingStepGoalId === goal.id || !(inlineStepInputs[goal.id] || '').trim()}
                          aria-label="添加执行步骤"
                          style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
                        >
                          <Plus size={14} /> {addingStepGoalId === goal.id ? '添加中…' : '添加'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 进展备忘与历史巡检笔记 (Notes) */}
                {goal.notes && (
                  <div style={{ borderTop: '1px solid var(--om-border)', paddingTop: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '4px' }}>
                      📋 {botName} 进展备忘与巡检记录：
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: '12px',
                        fontFamily: 'inherit',
                        color: 'var(--text-muted)',
                        background: 'var(--om-bg)',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.5,
                        maxHeight: '120px',
                        overflowY: 'auto'
                      }}
                    >
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              你想要达成什么目标？ <span style={{ color: '#ef4444' }}>*</span>
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
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                borderRadius: '8px',
                border: '1px solid var(--om-border)',
                background: 'var(--om-bg)',
                color: 'var(--text-main)',
                outline: 'none'
              }}
            />
          </div>

          {/* 领域分类选择 */}
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              所属领域分类
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
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
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 12px',
                      borderRadius: '16px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      border: isSelected ? '1px solid var(--om-accent)' : '1px solid var(--om-border)',
                      background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--om-bg)',
                      color: isSelected ? 'var(--om-accent)' : 'var(--text-muted)'
                    }}
                  >
                    {c.icon({ size: 12 })}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 期望截止日期与巡检提醒周期 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                期望截止日期 (选填)
              </label>
              <input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '13px',
                  borderRadius: '8px',
                  border: '1px solid var(--om-border)',
                  background: 'var(--om-bg)',
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                提醒与巡检周期
              </label>
              <select
                value={newCadence}
                onChange={(e) => setNewCadence(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '13px',
                  borderRadius: '8px',
                  border: '1px solid var(--om-border)',
                  background: 'var(--om-bg)',
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
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
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              背景要求与重要性说明 (选填)
            </label>
            <textarea
              rows={2}
              placeholder="说明为什么这个目标重要、客观资源约束或核心成功标准..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '8px',
                border: '1px solid var(--om-border)',
                background: 'var(--om-bg)',
                color: 'var(--text-main)',
                outline: 'none',
                resize: 'none'
              }}
            />
          </div>

          {/* 执行步骤拆解 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600 }}>
                执行步骤 (每行一个步骤，留空将由数字员工协助拆解)
              </label>
              {CATEGORY_PRESETS[newCategory] && (
                <button
                  type="button"
                  onClick={() => {
                    const p = CATEGORY_PRESETS[newCategory];
                    setNewStepsText(p.steps.join('\n'));
                  }}
                  style={{ fontSize: '12px', color: 'var(--om-accent)', background: 'none', border: 'none', cursor: 'pointer' }}
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
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '8px',
                border: '1px solid var(--om-border)',
                background: 'var(--om-bg)',
                color: 'var(--text-main)',
                outline: 'none',
                resize: 'none'
              }}
            />
          </div>

          {createError && <div className="goal-form-error" role="alert">{createError}</div>}

          {/* 底部按钮组 */}
          <div className="goal-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleAskAgentPlan}
              disabled={!newTitle.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
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
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                borderRadius: '8px',
                border: '1px solid var(--om-border)',
                background: 'var(--om-bg)',
                color: 'var(--text-main)',
                outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              领域分类
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setEditCategory(c.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '5px 12px',
                    borderRadius: '16px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    border: editCategory === c.id ? '1px solid var(--om-accent)' : '1px solid var(--om-border)',
                    background: editCategory === c.id ? 'rgba(59, 130, 246, 0.15)' : 'var(--om-bg)',
                    color: editCategory === c.id ? 'var(--om-accent)' : 'var(--text-muted)'
                  }}
                >
                  {c.icon({ size: 12 })}
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                期望截止日期
              </label>
              <input
                type="date"
                value={editDue}
                onChange={(e) => setEditDue(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '13px',
                  borderRadius: '8px',
                  border: '1px solid var(--om-border)',
                  background: 'var(--om-bg)',
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                提醒与巡检周期
              </label>
              <select
                value={editCadence}
                onChange={(e) => setEditCadence(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '13px',
                  borderRadius: '8px',
                  border: '1px solid var(--om-border)',
                  background: 'var(--om-bg)',
                  color: 'var(--text-main)',
                  outline: 'none'
                }}
              >
                <option value="daily 09:00">每天 09:00</option>
                <option value="weekdays 09:30">每个工作日 09:30</option>
                <option value="weekly mon 10:00">每周一 10:00</option>
                <option value="monthly 1 09:00">每月 1 日 09:00</option>
                <option value="">不设周期提醒</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              背景描述
            </label>
            <textarea
              rows={3}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '8px',
                border: '1px solid var(--om-border)',
                background: 'var(--om-bg)',
                color: 'var(--text-main)',
                outline: 'none',
                resize: 'none'
              }}
            />
          </div>

          {editError && <div className="goal-form-error" role="alert">{editError}</div>}

          <div className="goal-modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '13.5px', color: 'var(--text-main)' }}>
            当前卡点步骤: <strong>{guidanceModal.stepTitle}</strong>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              向数字员工补充排障指令或业务输入:
            </label>
            <textarea
              rows={4}
              placeholder="例如：请尝试使用 mock 数据绕过外部网络依赖，或者补充指定配置路径..."
              value={guidanceModal.guidance}
              onChange={(e) => setGuidanceModal((prev) => ({ ...prev, guidance: e.target.value }))}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                borderRadius: '8px',
                border: '1px solid var(--om-border)',
                background: 'var(--om-bg)',
                color: 'var(--text-main)',
                outline: 'none',
                resize: 'none'
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            选择要退回的目标步骤，该步骤及其后续的所有步骤都将重置为待办 (Pending) 状态：
          </div>
          <select
            value={rollbackModal.targetStepId}
            onChange={(e) => setRollbackModal((prev) => ({ ...prev, targetStepId: e.target.value }))}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '13px',
              borderRadius: '8px',
              border: '1px solid var(--om-border)',
              background: 'var(--om-bg)',
              color: 'var(--text-main)',
              outline: 'none'
            }}
          >
            {rollbackModal.steps.map((st) => (
              <option key={st.id} value={st.id}>
                步骤 {st.idx || 1}: {st.title} [{st.status}]
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
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
