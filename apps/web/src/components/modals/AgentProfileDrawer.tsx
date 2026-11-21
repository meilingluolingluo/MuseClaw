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
  CheckCircle2,
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
  { id: 'moss-courier', name: '苔藓邮差 (Moss)', desc: '绿叶耳朵与布制信件包', emoji: '🍀' },
  { id: 'tide-tinker', name: '潮汐工匠 (Tide)', desc: '海沫色蝾螈工匠与工具囊', emoji: '🫧' },
  { id: 'dusk-moth', name: '暮光飞蛾 (Dusk)', desc: '圆眼镜与水彩双翼', emoji: '🌙' },
  { id: 'copper-acorn', name: '纯铜橡果 (Copper)', desc: '纯铜齿轮与保暖围巾', emoji: '🦊' },
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
  const { isBotModalOpen, setIsBotModalOpen, activeBot, bots, loadBots, showToast, setTab, isTainted } = useApp();
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
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [feedActivities, setFeedActivities] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    '今天': true,
    '昨天': true,
    '更早': false,
  });
  const [memoryStats, setMemoryStats] = useState<{ count: number }>({ count: 0 });
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
        if (isLookModalOpen) setIsLookModalOpen(false);
        else if (isSoulModalOpen) setIsSoulModalOpen(false);
        else if (isEditingInfo) setIsEditingInfo(false);
        else setIsBotModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBotModalOpen, isLookModalOpen, isSoulModalOpen, isEditingInfo]);

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
          if (!isSoulModalOpen && !isLookModalOpen) setIsBotModalOpen(false);
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
          <div style={{ position: 'relative', display: 'inline-flex', marginBottom: '8px' }}>
            <div
              className="agent-capsule-avatar-aura"
              style={{ cursor: 'pointer' }}
              onClick={() => setIsLookModalOpen(true)}
              title="点击更换形象"
            >
              <BotAvatar bot={{ ...activeBot, avatar } as any} size={86} motion="avatar-idle" />
            </div>

            {/* 笔形徽章 */}
            <button
              type="button"
              className="avatar-edit-badge"
              onClick={() => setIsLookModalOpen(true)}
              title="更换智能体外观形象"
              style={{ width: '28px', height: '28px', bottom: '0', right: '0' }}
            >
              <Pencil size={13} />
            </button>
          </div>

          {/* 名字与状态 */}
          <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--om-fg)', marginTop: '4px' }}>
            {name}
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12.5px',
              fontWeight: 500,
              color: '#10b981',
              marginTop: '4px',
            }}
          >
            <span className="bot-status-dot-pulse" />
            <span>已连接</span>
          </div>

          {/* 三个设定分区 */}
          <div className="bot-segmented-tabs" role="tablist" aria-label="智能体设定分区" style={{ marginTop: '14px' }}>
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
        <div className="bot-tab-body" style={{ flex: 1, padding: '18px 22px', overflowY: 'auto' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* 预定任务概况（真实例行任务） */}
              <div>
                <div style={{ fontSize: '13.5px', fontWeight: 650, color: 'var(--om-fg)', marginBottom: '10px' }}>
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
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--om-fg)' }}>
                          {task.name}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '2px' }}>
                          {task.scheduleHumanZh || task.cronExpr || '按周期定时执行'} · {task.enabled ? '运行中' : '已暂停'}
                        </div>
                      </div>
                    </div>
                  ))
                )}

                <button
                  type="button"
                  onClick={() => {
                    setIsBotModalOpen(false);
                    setTab('routines');
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    width: '100%',
                    padding: '8px',
                    fontSize: '12.5px',
                    color: 'var(--om-accent)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 500,
                    marginTop: '4px',
                  }}
                >
                  查看所有预定任务 <ChevronRight size={14} />
                </button>
              </div>

              {/* 动态轨迹流 (Timeline - 按天分组并支持展开收起) */}
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                              style={{
                                transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                                transition: 'transform 0.2s ease',
                                color: 'var(--text-dim)',
                              }}
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
                                      <AlertTriangle size={12} style={{ color: '#ef4444' }} />
                                    ) : (
                                      <Check size={12} strokeWidth={2.4} />
                                    )}
                                  </div>

                                  {/* 动作主标题与自然语言说明 */}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                      style={{
                                        fontSize: '13.5px',
                                        fontWeight: 600,
                                        color: 'var(--om-fg)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {item.title}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: '12px',
                                        color: 'var(--text-dim)',
                                        marginTop: '2px',
                                        lineHeight: 1.35,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {item.subtitle}
                                    </div>
                                  </div>

                                  {/* 时间与交互来源头像 */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                    <span className="agent-activity-time">
                                      {formatTimeLabel(item.timestamp)}
                                    </span>
                                    {item.showAvatar && (
                                      <div
                                        style={{
                                          width: '18px',
                                          height: '18px',
                                          borderRadius: '50%',
                                          overflow: 'hidden',
                                          flexShrink: 0,
                                          opacity: 0.85,
                                        }}
                                      >
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 650, display: 'block', marginBottom: '6px' }}>
                  门禁审批级别 (Sentinel Approval Mode)
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        border: approvalMode === opt.mode ? '2px solid var(--om-accent)' : '1px solid var(--om-border)',
                        background: approvalMode === opt.mode ? 'rgba(2, 132, 199, 0.06)' : 'var(--om-surface-2)',
                        cursor: savingMode ? 'wait' : 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: 600, color: approvalMode === opt.mode ? 'var(--om-accent)' : 'var(--om-fg)' }}>
                        {opt.label}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 微沙箱与防污状态 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    background: 'var(--om-surface-2)',
                    borderRadius: '12px',
                    border: '1px solid var(--om-border)',
                  }}
                >
                  <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Terminal size={15} style={{ color: 'var(--om-accent)' }} />
                    微沙箱隔离容器
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: 'rgba(2, 132, 199, 0.1)',
                      color: 'var(--om-accent)',
                    }}
                  >
                    {sandboxStatus
                      ? sandboxStatus.available
                        ? `${sandboxStatus.engine} 就绪`
                        : '标准子进程模式'
                      : '检测中…'}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    background: 'var(--om-surface-2)',
                    borderRadius: '12px',
                    border: '1px solid var(--om-border)',
                  }}
                >
                  <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldCheck size={15} style={{ color: '#10b981' }} />
                    动态污点跟踪
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: 'rgba(16, 185, 129, 0.1)',
                      color: '#10b981',
                    }}
                  >
                    {isTainted ? '已标记敏感数据' : '纯净态'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 灵魂设定与核心记忆 (Image 3 精髓) */}
          {currentTab === 'identity' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 名片基本信息卡 */}
              <div
                style={{
                  background: 'var(--om-surface-2)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '18px',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                {isEditingInfo ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label htmlFor="agent-name" style={{ fontSize: '11.5px', fontWeight: 600 }}>
                      名称 <span style={{ color: 'var(--accent-red)' }}>*</span>
                    </label>
                    <input
                      id="agent-name"
                      type="text"
                      className="form-control"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="智能体名称"
                      maxLength={40}
                      style={{ fontSize: '13px', padding: '6px 10px' }}
                    />
                    <label htmlFor="agent-role" style={{ fontSize: '11.5px', fontWeight: 600 }}>
                      角色描述
                    </label>
                    <input
                      id="agent-role"
                      type="text"
                      className="form-control"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      placeholder="例如：负责巡检与故障排查"
                      maxLength={120}
                      style={{ fontSize: '12.5px', padding: '6px 10px' }}
                    />
                    {infoError && <div className="agent-form-error" role="alert">{infoError}</div>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '4px' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={resetInfoForm}
                        disabled={savingInfo}
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleSaveInfo}
                        disabled={savingInfo || !name.trim()}
                        style={{ padding: '4px 12px', fontSize: '12px' }}
                      >
                        {savingInfo ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--om-fg)' }}>{name}</div>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setIsEditingInfo(true)}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '9999px',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Pencil size={11} /> 编辑
                      </button>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                      {role || '企业自动化总协调数字员工'}
                    </div>
                  </>
                )}
              </div>

              {/* 沉浸式双渐变卡片 (SOUL 与 记忆，精确对齐用户期望) */}
              <div className="agent-gradient-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
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
                <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-muted)' }}>
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
        zIndex={1060}
        title="编辑 SOUL 核心人设"
        icon={<Sparkles size={18} style={{ color: '#ef4444' }} />}
        maxWidth="680px"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
              字符数: {soulPromptBuffer.length}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '8px' }}>
              快速套用性格准则模板：
            </div>
            <div className="agent-preset-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {SOUL_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setSoulPromptBuffer(p.prompt)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--om-border)',
                    background: 'var(--om-surface-2)',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 650, color: 'var(--om-fg)' }}>{p.name}</div>
                  <div style={{ fontSize: '10.5px', color: 'var(--text-dim)', marginTop: '2px' }}>{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12.5px', fontWeight: 650, display: 'block', marginBottom: '6px' }}>
              SOUL 正文 <span style={{ color: 'var(--accent-red)' }}>*</span>
            </label>
            <textarea
              className="form-control"
              rows={12}
              autoFocus
              value={soulPromptBuffer}
              onChange={(e) => setSoulPromptBuffer(e.target.value)}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '12.5px', lineHeight: 1.6 }}
              placeholder="定义智能体的语气、工作准则、红线与边界..."
              maxLength={8000}
            />
            {soulError && <div className="agent-form-error" role="alert">{soulError}</div>}
            <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
              修改后立即生效；点击取消会还原到已保存的内容。
            </div>
          </div>
        </div>
      </Modal>

      {/* 模态框 2: 外观形象与头像定制 (Avatar Look Chooser) */}
      <Modal
        isOpen={isLookModalOpen}
        onClose={() => setIsLookModalOpen(false)}
        zIndex={1060}
        title="更换智能体外观形象"
        icon={<Pencil size={18} />}
        maxWidth="540px"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
            <button type="button" className="btn-secondary" onClick={() => { setAvatarError(''); setIsLookModalOpen(false); }} disabled={savingAvatar}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleSaveAvatar} disabled={savingAvatar}>
              {savingAvatar ? '保存中…' : '保存外观'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 选项卡 */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--om-border)', paddingBottom: '10px' }}>
            <button
              type="button"
              className={avatarChoice === 'preset' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setAvatarChoice('preset')}
              style={{ fontSize: '12px', padding: '4px 12px' }}
            >
              形象预设
            </button>
            <button
              type="button"
              className={avatarChoice === 'emoji' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setAvatarChoice('emoji')}
              style={{ fontSize: '12px', padding: '4px 12px' }}
            >
              Emoji 表情
            </button>
            <button
              type="button"
              className={avatarChoice === 'custom' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setAvatarChoice('custom')}
              style={{ fontSize: '12px', padding: '4px 12px' }}
            >
              自定义地址
            </button>
          </div>

          {avatarChoice === 'preset' && (
            <div className="agent-avatar-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {AVATAR_PRESETS.map((p) => {
                const isSelected = selectedPreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPreset(p.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px',
                      borderRadius: '12px',
                      border: isSelected ? '2px solid var(--om-accent)' : '1px solid var(--om-border)',
                      background: isSelected ? 'rgba(2, 132, 199, 0.08)' : 'var(--om-surface-2)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <BotAvatar bot={{ avatar: p.id } as any} size={40} motion="avatar-idle" />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 650, color: 'var(--om-fg)' }}>{p.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>{p.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {avatarChoice === 'emoji' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'block', marginBottom: '8px' }}>
                  选择表情:
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {EMOJI_CHOICES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setSelectedEmoji(e)}
                      style={{
                        width: '38px',
                        height: '38px',
                        fontSize: '20px',
                        borderRadius: '8px',
                        border: selectedEmoji === e ? '2px solid var(--om-accent)' : '1px solid var(--om-border)',
                        background: 'var(--om-surface-2)',
                        cursor: 'pointer',
                      }}
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
              <label style={{ fontSize: '12.5px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                输入图像绝对 URL 或 WebP 地址:
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="https://... 或 /avatars/..."
                value={customAvatarUrl}
                onChange={(e) => setCustomAvatarUrl(e.target.value)}
                style={{ width: '100%', fontSize: '13px' }}
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
