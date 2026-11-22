import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { BotAvatar } from '../common/BotAvatar';
import { Modal } from '../common/Modal';
import {
  List,
  Shield,
  Fingerprint,
  Pencil,
  X,
  Heart,
  Clock,
  Check,
  AlertTriangle,
  Sparkles,
  Terminal,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { api } from '../../services/api';
import type { Routine, AuditLog } from '../../types';
import {
  deriveBotActivities,
  groupActivities,
  formatTimeLabel,
} from '../../utils/activityHelper';

const AVATAR_PRESETS = [
  { id: 'haibara', name: '小哀 (Haibara)', desc: '沉静目光与浅蓝针织', emoji: '🌸' },
  { id: 'dragon', name: '巨龙灵兽 (Dragon)', desc: '守护灵与深蓝鳞片', emoji: '🐉' },
];

const EMOJI_CHOICES = ['✨', '🌸', '🐉', '🌙', '🍀', '🦊', '🐼', '⚡', '🎧', '🫧', '🤖', '🐱'];

const SOUL_PRESETS = [
  {
    name: '🎯 严谨专业',
    desc: '逻辑严密、优先工具调用、精简回答且绝无废话',
    prompt: '你是一个严谨、高效的企业级自动化数字员工。遵循以下核心原则：\n1. 优先调用可用工具获取真实数据，绝不凭借猜测捏造信息。\n2. 遇到多步任务先简短说明策略，再分步执行。\n3. 回复结构精炼清晰，结论先行，代码规范强类型。'
  },
  {
    name: '⚡ 敏捷高效',
    desc: '极简执行风格、直奔要点、自动化操作流',
    prompt: '你是一个敏捷、自驱动的自动化代码与运维助手。直奔要点，执行命令与编辑文件前先做必要安全检查，以最少交互最快落地用户诉求。'
  },
  {
    name: '🛡️ 安全合规',
    desc: '深度遵循最小权限、沙箱隔离与高危操作二次确认',
    prompt: '你是一个高度关注系统安全的数字员工。任何破坏性配置修改、生产环境变更或权限放宽操作前，必须向用户阐明风险并提供回滚预案。'
  },
  {
    name: '🌸 温暖同理',
    desc: '善解人意、循序渐进辅导、富有亲和力',
    prompt: '你是一个富有同理心与耐心的智能伙伴。善于倾听用户的业务场景，以温和友善的语气给予技术建议，逐步拆解复杂任务。'
  }
];

export const AgentProfileDrawer: React.FC = () => {
  const {
    isBotModalOpen,
    setIsBotModalOpen,
    activeBot,
    bots,
    loadBots,
    showToast,
    setTab,
    isTainted,
    isAvatarStudioOpen,
    setIsAvatarStudioOpen,
  } = useApp();
  const [currentTab, setCurrentTab] = useState<'tasks' | 'security' | 'identity'>('tasks');

  // 基础信息编辑状态
  const [name, setName] = useState(activeBot?.name || '小哀');
  const [role, setRole] = useState(activeBot?.role || activeBot?.description || '');
  const [avatar, setAvatar] = useState(activeBot?.avatar || 'haibara');
  const [approvalMode, setApprovalMode] = useState(activeBot?.approvalMode || 'ASK');
  const [isEditingInfo, setIsEditingInfo] = useState(false);

  // 模态框状态
  const [isLookModalOpen, setIsLookModalOpen] = useState(false);
  const [isSoulModalOpen, setIsSoulModalOpen] = useState(false);
  const [soulPromptBuffer, setSoulPromptBuffer] = useState('');

  // 形象定制表单
  const [avatarChoice, setAvatarChoice] = useState<'preset' | 'emoji' | 'custom'>('preset');
  const [selectedPreset, setSelectedPreset] = useState(activeBot?.avatar || 'haibara');
  const [selectedEmoji, setSelectedEmoji] = useState('✨');
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');

  // 预定任务、动态轨迹、会话与审计流水
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [_auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [feedActivities, setFeedActivities] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    '今天': true,
    '昨天': true,
    '更早': false,
  });
  const [_memoryStats, setMemoryStats] = useState<{ count: number }>({ count: 0 });
  const [sandboxStatus, setSandboxStatus] = useState<{ available: boolean; engine: string } | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // 表单保存/校验状态
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [savingSoul, setSavingSoul] = useState(false);
  const [soulError, setSoulError] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [savingMode, setSavingMode] = useState<string | null>(null);

  // 同步 activeBot
  useEffect(() => {
    if (activeBot) {
      setName(activeBot.name || '小哀');
      setRole(activeBot.role || activeBot.description || '');
      setAvatar(activeBot.avatar || 'haibara');
      setSelectedPreset(activeBot.avatar || 'haibara');
      setApprovalMode(activeBot.approvalMode || 'ASK');
      setSoulPromptBuffer(activeBot.systemPrompt || activeBot.system_prompt || '');
    }
  }, [activeBot]);

  // 拉取该员工的预定任务、动态流水、会话轨迹、记忆摘要与运行环境
  const loadExtraData = useCallback(async () => {
    if (!activeBot) return;
    setIsLoadingData(true);
    setLoadError(false);
    const [routineRes, auditRes, memoryRes, sandboxRes, feedRes, sessionRes] = await Promise.allSettled([
      api.getRoutines(),
      api.getAuditLogs(undefined, 30),
      api.getMemory(activeBot.id),
      api.getSandboxStatus(),
      api.getFeedActivity(),
      api.getSessions(activeBot.id),
    ]);

    setRoutines(
      routineRes.status === 'fulfilled' && Array.isArray(routineRes.value)
        ? routineRes.value
        : []
    );
    setAuditLogs(auditRes.status === 'fulfilled' && Array.isArray(auditRes.value) ? auditRes.value : []);
    setFeedActivities(feedRes.status === 'fulfilled' && Array.isArray(feedRes.value) ? feedRes.value : []);
    setSessions(sessionRes.status === 'fulfilled' && Array.isArray(sessionRes.value) ? sessionRes.value : []);

    const memoryCount =
      memoryRes.status === 'fulfilled' && Array.isArray(memoryRes.value?.items) ? memoryRes.value.items.length : 0;
    setMemoryStats({ count: memoryCount });
    if (sandboxRes.status === 'fulfilled') {
      setSandboxStatus({ available: Boolean(sandboxRes.value?.available), engine: sandboxRes.value?.engine || 'bwrap' });
    }
    if ([routineRes, auditRes, memoryRes, sandboxRes].some((r) => r.status === 'rejected')) {
      setLoadError(true);
    }
    setIsLoadingData(false);
  }, [activeBot?.id]);

  useEffect(() => {
    if (isBotModalOpen && activeBot) loadExtraData();
  }, [isBotModalOpen, activeBot?.id, loadExtraData]);

  // ESC 键关闭抽屉
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isBotModalOpen) {
        if (isAvatarStudioOpen) return;
        if (isLookModalOpen) setIsLookModalOpen(false);
        else if (isSoulModalOpen) setIsSoulModalOpen(false);
        else if (isEditingInfo) setIsEditingInfo(false);
        else setIsBotModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBotModalOpen, isLookModalOpen, isSoulModalOpen, isAvatarStudioOpen, isEditingInfo]);

  if (!isBotModalOpen || !activeBot) return null;

  // 保存基础信息
  const handleSaveInfo = async () => {
    const nextName = name.trim();
    const nextRole = role.trim();
    if (!nextName) {
      setInfoError('名称不能为空');
      return;
    }
    if (nextName.length > 40) {
      setInfoError('名称不超过 40 个字');
      return;
    }
    if (nextRole.length > 120) {
      setInfoError('角色描述不超过 120 个字');
      return;
    }
    setInfoError('');
    setSavingInfo(true);
    try {
      await api.updateBot(activeBot.id, { name: nextName, role: nextRole, description: nextRole });
      showToast('基本设定已保存', 'success');
      setIsEditingInfo(false);
      loadBots();
    } catch (err: any) {
      setInfoError(err.message || '保存失败，请重试');
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      setSavingInfo(false);
    }
  };

  // 取消编辑时还原，避免未保存的草稿留在抽屉里
  const resetInfoForm = () => {
    setName(activeBot.name || '小哀');
    setRole(activeBot.role || activeBot.description || '');
    setInfoError('');
    setIsEditingInfo(false);
  };

  // 保存形象
  const handleSaveAvatar = async () => {
    let finalAvatar = selectedPreset;
    if (avatarChoice === 'emoji') {
      finalAvatar = selectedEmoji;
    } else if (avatarChoice === 'custom') {
      const url = customAvatarUrl.trim();
      if (!url) {
        setAvatarError('请填写图片地址');
        return;
      }
      if (!/^https?:\/\//i.test(url) && !url.startsWith('/avatars/')) {
        setAvatarError('请输入 http(s) 地址或 /avatars/ 开头的路径');
        return;
      }
      finalAvatar = url;
    }
    setAvatarError('');
    setSavingAvatar(true);
    try {
      await api.updateBot(activeBot.id, { avatar: finalAvatar });
      setAvatar(finalAvatar);
      setIsLookModalOpen(false);
      showToast('形象已保存', 'success');
      loadBots();
    } catch (err: any) {
      setAvatarError(err.message || '保存失败，请重试');
      showToast(`更新形象失败: ${err.message}`, 'error');
    } finally {
      setSavingAvatar(false);
    }
  };

  // 保存 SOUL 人设提示词
  const handleSaveSoul = async () => {
    const content = soulPromptBuffer.trim();
    if (!content) {
      setSoulError('SOUL 内容不能为空');
      return;
    }
    if (content.length > 8000) {
      setSoulError('内容不超过 8000 字');
      return;
    }
    setSoulError('');
    setSavingSoul(true);
    try {
      await api.updateBot(activeBot.id, { systemPrompt: content });
      showToast('SOUL 设定已保存', 'success');
      setIsSoulModalOpen(false);
      loadBots();
    } catch (err: any) {
      setSoulError(err.message || '保存失败，请重试');
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      setSavingSoul(false);
    }
  };

  // 关闭 SOUL 编辑器时还原草稿
  const closeSoulModal = () => {
    setSoulPromptBuffer(activeBot.systemPrompt || activeBot.system_prompt || '');
    setSoulError('');
    setIsSoulModalOpen(false);
  };

  // 更新门禁模式
  const MODE_LABELS: Record<string, string> = {
    ASK: '严格模式',
    AUTO_EDITS: '自驱编辑',
    FULL: '全权托管',
  };
  const handleUpdateApproval = async (mode: 'ASK' | 'AUTO_EDITS' | 'FULL') => {
    if (savingMode || mode === approvalMode) return;
    const previous = approvalMode;
    setApprovalMode(mode);
    setSavingMode(mode);
    try {
      await api.updateBot(activeBot.id, { approvalMode: mode });
      showToast(`已切换为${MODE_LABELS[mode]}`, 'success');
      loadBots();
    } catch (err: any) {
      setApprovalMode(previous);
      showToast(`切换失败，已恢复：${err.message}`, 'error');
    } finally {
      setSavingMode(null);
    }
  };

  // 格式化时间戳 (对齐 MM.DD.YY 视觉规范)
  const formatDateStamp = (ts?: number) => {
    if (!ts) return '11.21.26';
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(2);
    return `${m}.${day}.${yy}`;
  };

  // 仅展示归属于当前员工的真实例行预定任务
  const isCoordinator = Boolean(
    (activeBot as any).is_coordinator ||
    (activeBot as any).isCoordinator ||
    activeBot.id === 'muse' ||
    bots[0]?.id === activeBot.id
  );
  const botRoutines = routines.filter((r) => {
    if (!r.agentId || r.agentId === '*' || r.agentId === activeBot.id) return true;
    const matched = bots.find((b) => b.id === r.agentId);
    if (matched) {
      return matched.id === activeBot.id;
    }
    // 若任务指定的 agentId 在当前系统注册中无匹配（如历史/预设 ID），则由主协调员工承接
    return isCoordinator;
  });

  // 格式化自然语言动态轨迹与日期分组（仅保留业务执行，严格排除审批审核事件）
  const activities = deriveBotActivities(feedActivities, sessions, activeBot.id);
  const activityGroups = groupActivities(activities);

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="agent-drawer-backdrop"
        onClick={() => {
          if (!isSoulModalOpen && !isLookModalOpen && !isAvatarStudioOpen) setIsBotModalOpen(false);
        }}
      />

      {/* 右侧滑出抽屉 */}
      <aside className="agent-drawer-pane" role="dialog" aria-modal="true" aria-label="智能体设定档案">
        {/* 顶部关闭按钮 */}
        <div className="agent-drawer-header">
          <button
            type="button"
            className="agent-drawer-close"
            onClick={() => setIsBotModalOpen(false)}
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>

          {/* 头像区域：活体动效 + 编辑笔徽章 */}
          <div className="agent-drawer-avatar-wrap">
            <div
              className="agent-capsule-avatar-aura"
              onClick={() => setIsLookModalOpen(true)}
              title="点击更换形象"
            >
              <BotAvatar bot={{ ...activeBot, avatar } as any} size={86} motion="avatar-idle" />
            </div>

            {/* 笔形徽章 */}
            <button
              type="button"
              className="avatar-edit-badge agent-drawer-avatar-badge"
              onClick={() => setIsLookModalOpen(true)}
              title="更换智能体外观形象"
            >
              <Pencil size={13} />
            </button>
          </div>

          {/* 名字与状态 */}
          <div className="agent-drawer-name">
            {name}
          </div>

          <div className="agent-drawer-status">
            <span className="bot-status-dot-pulse" />
            <span>已连接</span>
          </div>

          <div style={{ marginTop: '8px', marginBottom: '12px' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                padding: '4px 12px',
                borderRadius: '16px',
                background: 'rgba(59, 130, 246, 0.08)',
                color: 'var(--om-accent, #3b82f6)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
              }}
              onClick={() => setIsAvatarStudioOpen(true)}
              title="打开虚拟形象工坊，基于 AI 创作或定制全套姿态"
            >
              <Sparkles size={12} />
              形象工坊 (Avatar Studio)
            </button>
          </div>

          {/* 三个设定分区 */}
          <div className="bot-segmented-tabs agent-drawer-tabs" role="tablist" aria-label="智能体设定分区">
            {[
              { key: 'tasks' as const, label: '任务', icon: <List size={15} /> },
              { key: 'security' as const, label: '安全', icon: <Shield size={15} /> },
              { key: 'identity' as const, label: '设定', icon: <Fingerprint size={15} /> },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={currentTab === tab.key}
                className={`bot-segmented-tab ${currentTab === tab.key ? 'active' : ''}`}
                onClick={() => setCurrentTab(tab.key)}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 抽屉主体内容区 */}
        <div className="agent-drawer-body">
          {loadError && (
            <div className="agent-inline-alert" role="alert">
              <AlertTriangle size={14} />
              <span>部分信息加载失败</span>
              <button type="button" onClick={loadExtraData} disabled={isLoadingData}>
                重试
              </button>
            </div>
          )}
          {/* TAB 1: 预定任务与近期动态 */}
          {currentTab === 'tasks' && (
            <div className="agent-drawer-stack">
              {/* 预定任务概况（真实例行任务） */}
              <div>
                <div className="agent-drawer-section-heading">
                  {botRoutines.length > 0 ? `${botRoutines.length} 项预定任务` : '预定任务（0）'}
                </div>

                {botRoutines.length === 0 ? (
                  <div className="agent-empty-state">
                    {isLoadingData ? '正在加载…' : '这位员工还没有预定任务'}
                    <button
                      type="button"
                      onClick={() => {
                        setIsBotModalOpen(false);
                        setTab('routines');
                      }}
                    >
                      去创建 <ChevronRight size={12} />
                    </button>
                  </div>
                ) : (
                  botRoutines.map((task) => (
                    <div key={task.id} className="agent-scheduled-card">
                      <div className="agent-scheduled-icon-wrap agent-scheduled-icon-routine">
                        <Clock size={16} />
                      </div>
                      <div className="agent-scheduled-info">
                        <div className="agent-scheduled-title">
                          {task.name}
                        </div>
                        <div className="agent-scheduled-desc">
                          {task.scheduleHumanZh || task.cronExpr || '按周期定时执行'} · {task.enabled ? '运行中' : '已暂停'}
                        </div>
                      </div>
                    </div>
                  ))
                )}

                <button
                  type="button"
                  className="agent-view-all-routines-btn"
                  onClick={() => {
                    setIsBotModalOpen(false);
                    setTab('routines');
                  }}
                >
                  查看所有预定任务 <ChevronRight size={14} />
                </button>
              </div>

              {/* 动态轨迹流 (Timeline - 按天分组并支持展开收起) */}
              <div>
                <div className="agent-drawer-stack-sm">
                  {activityGroups.length > 0 ? (
                    activityGroups.map((group) => {
                      const isExpanded = expandedGroups[group.label] !== false;
                      return (
                        <div key={group.label} className="agent-activity-group">
                          {/* 分组折叠标题栏 */}
                          <button
                            type="button"
                            className="agent-activity-group-header"
                            onClick={() =>
                              setExpandedGroups((prev) => ({
                                ...prev,
                                [group.label]: !isExpanded,
                              }))
                            }
                          >
                            <span>{group.label}</span>
                            <ChevronDown
                              size={16}
                              className={`agent-group-chevron ${isExpanded ? 'is-open' : 'is-collapsed'}`}
                            />
                          </button>

                          {/* 动作清单 */}
                          {isExpanded && (
                            <div className="agent-activity-rows">
                              {group.items.map((item) => (
                                <div
                                  key={item.id}
                                  className="agent-activity-row"
                                  title={item.title}
                                >
                                  {/* 完成状态勾选徽章 */}
                                  <div className="agent-activity-check-wrap">
                                    {item.status === 'running' ? (
                                      <Loader2 size={12} className="spin" />
                                    ) : item.status === 'error' ? (
                                      <AlertTriangle size={12} className="agent-activity-error-icon" />
                                    ) : (
                                      <Check size={12} strokeWidth={2.4} />
                                    )}
                                  </div>

                                  {/* 动作主标题与自然语言说明 */}
                                  <div className="agent-activity-info">
                                    <div className="agent-activity-title">
                                      {item.title}
                                    </div>
                                    <div className="agent-activity-subtitle">
                                      {item.subtitle}
                                    </div>
                                  </div>

                                  {/* 时间与交互来源头像 */}
                                  <div className="agent-activity-meta">
                                    <span className="agent-activity-time">
                                      {formatTimeLabel(item.timestamp)}
                                    </span>
                                    {item.showAvatar && (
                                      <div className="agent-activity-avatar">
                                        <BotAvatar bot={{ ...activeBot, avatar } as any} size={18} />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="agent-empty-state">
                      {isLoadingData ? '正在加载…' : '暂无执行记录'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 门禁审批与安全权限 */}
          {currentTab === 'security' && (
            <div className="agent-drawer-stack">
              <div>
                <label className="agent-security-label">
                  门禁审批级别 (Sentinel Approval Mode)
                </label>
                <div className="agent-approval-options">
                  {[
                    { mode: 'ASK', label: 'ASK (严格模式)', desc: '高危文件写入、外网访问与破坏性操作全量拦截审批' },
                    { mode: 'AUTO_EDITS', label: 'AUTO_EDITS (自驱编辑)', desc: '代码编写与常规分析自主执行，高危命令仍需审批' },
                    { mode: 'FULL', label: 'FULL (全权托管)', desc: '完全自驱动执行，仅在触发安全核心红线时拦截' },
                  ].map((opt) => (
                    <button
                      key={opt.mode}
                      type="button"
                      role="radio"
                      aria-checked={approvalMode === opt.mode}
                      disabled={Boolean(savingMode)}
                      onClick={() => handleUpdateApproval(opt.mode as any)}
                      className={`agent-approval-option ${approvalMode === opt.mode ? 'is-active' : ''}`}
                    >
                      <div className={`agent-approval-title ${approvalMode === opt.mode ? 'is-active' : ''}`}>
                        {opt.label}
                      </div>
                      <div className="agent-approval-desc">
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 微沙箱与防污状态 */}
              <div className="agent-drawer-stack-sm">
                <div className="agent-security-card">
                  <span className="agent-security-card-title">
                    <Terminal size={15} className="agent-security-icon-blue" />
                    微沙箱隔离容器
                  </span>
                  <span className="agent-security-badge-blue">
                    {sandboxStatus
                      ? sandboxStatus.available
                        ? `${sandboxStatus.engine} 就绪`
                        : '标准子进程模式'
                      : '检测中…'}
                  </span>
                </div>

                <div className="agent-security-card">
                  <span className="agent-security-card-title">
                    <ShieldCheck size={15} className="agent-security-icon-green" />
                    动态污点跟踪
                  </span>
                  <span className="agent-security-badge-green">
                    {isTainted ? '已标记敏感数据' : '纯净态'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 灵魂设定与核心记忆 */}
          {currentTab === 'identity' && (
            <div className="agent-drawer-stack">
              {/* 名片基本信息卡 */}
              <div className="agent-identity-card">
                {isEditingInfo ? (
                  <div className="agent-identity-form">
                    <label htmlFor="agent-name" className="agent-identity-label">
                      名称 <span className="agent-required-mark">*</span>
                    </label>
                    <input
                      id="agent-name"
                      type="text"
                      className="form-control agent-identity-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="智能体名称"
                      maxLength={40}
                    />
                    <label htmlFor="agent-role" className="agent-identity-label">
                      角色描述
                    </label>
                    <input
                      id="agent-role"
                      type="text"
                      className="form-control agent-identity-input"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      placeholder="例如：负责巡检与故障排查"
                      maxLength={120}
                    />
                    {infoError && <div className="agent-form-error" role="alert">{infoError}</div>}
                    <div className="agent-identity-actions">
                      <button
                        type="button"
                        className="btn-secondary agent-btn-sm"
                        onClick={resetInfoForm}
                        disabled={savingInfo}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn-primary agent-btn-sm"
                        onClick={handleSaveInfo}
                        disabled={savingInfo || !name.trim()}
                      >
                        {savingInfo ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="agent-identity-header">
                      <div className="agent-identity-name">{name}</div>
                      <button
                        type="button"
                        className="btn-secondary agent-identity-edit-btn"
                        onClick={() => setIsEditingInfo(true)}
                      >
                        <Pencil size={11} /> <span>编辑</span>
                      </button>
                    </div>
                    <div className="agent-identity-role">
                      {role || '企业自动化总协调数字员工'}
                    </div>
                  </>
                )}
              </div>

              {/* 沉浸式双渐变卡片 (SOUL 与 记忆) */}
              <div className="agent-gradient-grid">
                {/* 🔴 SOUL 卡片 */}
                <div
                  className="agent-gradient-card agent-card-soul"
                  onClick={() => {
                    setSoulPromptBuffer(activeBot.systemPrompt || activeBot.system_prompt || '');
                    setIsSoulModalOpen(true);
                  }}
                  title="点击查看与编辑 SOUL 核心人设提示词"
                >
                  <div>
                    <div className="agent-gradient-title">SOUL</div>
                    <div className="agent-gradient-sub">请谨慎访问</div>
                  </div>
                  <div className="agent-gradient-footer">
                    <span>{formatDateStamp(activeBot.updated_at || activeBot.created_at)}</span>
                    <Heart size={14} fill="currentColor" />
                  </div>
                </div>

                {/* 🔵 记忆 (Memory) 卡片 */}
                <div
                  className="agent-gradient-card agent-card-memory"
                  onClick={() => {
                    setIsBotModalOpen(false);
                    setTab('memory');
                  }}
                  title="点击进入受控长期记忆库 (Memory.md)"
                >
                  <div>
                    <div className="agent-gradient-title">记忆</div>
                    <div className="agent-gradient-sub">请谨慎访问</div>
                  </div>
                  <div className="agent-gradient-footer">
                    <span>{formatDateStamp(Date.now())}</span>
                    <Heart size={14} fill="currentColor" />
                  </div>
                </div>
              </div>

              <div className="agent-soul-preview">
                <div className="agent-soul-preview-title">
                  当前 SOUL 设定
                </div>
                <p title={activeBot.systemPrompt || activeBot.system_prompt || ''}>
                  {(activeBot.systemPrompt || activeBot.system_prompt || '尚未设置 SOUL，点击上方卡片开始编写。').slice(0, 140)}
                  {(activeBot.systemPrompt || activeBot.system_prompt || '').length > 140 ? '…' : ''}
                </p>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* 模态框 1: SOUL 核心人设提示词编辑器 */}
      <Modal
        isOpen={isSoulModalOpen}
        onClose={closeSoulModal}
        zIndex={2000}
        title="编辑 SOUL 核心人设"
        icon={<Sparkles size={18} className="agent-modal-soul-icon" />}
        maxWidth="680px"
        footer={
          <div className="modal-actions-bar">
            <span className="agent-modal-char-count">
              字符数: {soulPromptBuffer.length}
            </span>
            <div className="agent-modal-actions-right">
              <button type="button" className="btn-secondary" onClick={closeSoulModal} disabled={savingSoul}>
                取消
              </button>
              <button type="button" className="btn-primary" onClick={handleSaveSoul} disabled={savingSoul || !soulPromptBuffer.trim()}>
                {savingSoul ? '保存中…' : '保存 SOUL'}
              </button>
            </div>
          </div>
        }
      >
        <div className="agent-drawer-stack">
          <div>
            <div className="agent-preset-label">
              快速套用性格准则模板：
            </div>
            <div className="agent-soul-presets-grid">
              {SOUL_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="agent-soul-preset-btn"
                  onClick={() => setSoulPromptBuffer(p.prompt)}
                >
                  <div className="agent-soul-preset-name">{p.name}</div>
                  <div className="agent-soul-preset-desc">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="agent-soul-body-label">
              SOUL 正文 <span className="agent-required-mark">*</span>
            </label>
            <textarea
              className="form-control agent-soul-textarea"
              rows={12}
              autoFocus
              value={soulPromptBuffer}
              onChange={(e) => setSoulPromptBuffer(e.target.value)}
              placeholder="定义智能体的语气、工作准则、红线与边界..."
              maxLength={8000}
            />
            {soulError && <div className="agent-form-error" role="alert">{soulError}</div>}
            <div className="agent-soul-tip">
              修改后立即生效；点击取消会还原到已保存的内容。
            </div>
          </div>
        </div>
      </Modal>

      {/* 模态框 2: 外观形象与头像定制 (Avatar Look Chooser) */}
      <Modal
        isOpen={isLookModalOpen}
        onClose={() => setIsLookModalOpen(false)}
        zIndex={2000}
        title="更换智能体外观形象"
        icon={<Pencil size={18} />}
        maxWidth="540px"
        footer={
          <div className="modal-actions-bar modal-actions-right">
            <button type="button" className="btn-secondary" onClick={() => { setAvatarError(''); setIsLookModalOpen(false); }} disabled={savingAvatar}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleSaveAvatar} disabled={savingAvatar}>
              {savingAvatar ? '保存中…' : '保存外观'}
            </button>
          </div>
        }
      >
        <div className="agent-drawer-stack">
          {/* 选项卡 */}
          <div className="agent-avatar-tabs">
            <button
              type="button"
              className={avatarChoice === 'preset' ? 'btn-primary agent-avatar-tab' : 'btn-secondary agent-avatar-tab'}
              onClick={() => setAvatarChoice('preset')}
            >
              形象预设
            </button>
            <button
              type="button"
              className={avatarChoice === 'emoji' ? 'btn-primary agent-avatar-tab' : 'btn-secondary agent-avatar-tab'}
              onClick={() => setAvatarChoice('emoji')}
            >
              Emoji 表情
            </button>
            <button
              type="button"
              className={avatarChoice === 'custom' ? 'btn-primary agent-avatar-tab' : 'btn-secondary agent-avatar-tab'}
              onClick={() => setAvatarChoice('custom')}
            >
              自定义地址
            </button>
            <button
              type="button"
              className="btn-secondary agent-avatar-tab"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--om-accent, #3b82f6)',
                fontWeight: 600,
              }}
              onClick={() => {
                setIsLookModalOpen(false);
                setIsAvatarStudioOpen(true);
              }}
            >
              <Sparkles size={12} />
              AI 形象工坊
            </button>
          </div>

          {avatarChoice === 'preset' && (
            <div className="agent-avatar-presets-grid">
              {AVATAR_PRESETS.map((p) => {
                const isSelected = selectedPreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPreset(p.id)}
                    className={`agent-avatar-preset-btn ${isSelected ? 'is-selected' : ''}`}
                  >
                    <BotAvatar bot={{ avatar: p.id } as any} size={40} motion="avatar-idle" />
                    <div>
                      <div className="agent-avatar-preset-name">{p.name}</div>
                      <div className="agent-avatar-preset-desc">{p.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {avatarChoice === 'emoji' && (
            <div className="agent-drawer-stack">
              <div>
                <label className="agent-emoji-label">
                  选择表情:
                </label>
                <div className="agent-emoji-grid">
                  {EMOJI_CHOICES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setSelectedEmoji(e)}
                      className={`agent-emoji-btn ${selectedEmoji === e ? 'is-selected' : ''}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {avatarChoice === 'custom' && (
            <div>
              <label className="agent-custom-avatar-label">
                输入图像绝对 URL 或 WebP 地址:
              </label>
              <input
                type="text"
                className="form-control agent-custom-avatar-input"
                placeholder="https://... 或 /avatars/..."
                value={customAvatarUrl}
                onChange={(e) => setCustomAvatarUrl(e.target.value)}
                aria-label="自定义头像地址"
              />
              {avatarError && <div className="agent-form-error" role="alert">{avatarError}</div>}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};
