import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ProviderIcon } from '../../utils/icons';
import { BotAvatar } from '../common/BotAvatar';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Shield,
  ShieldAlert,
  Box,
  Lock,
  ChevronDown,
  Rss,
  Target,
  Clock,
  Boxes,
  ShieldCheck,
  Package,
  Brain,
  User as UserIcon,
} from 'lucide-react';

export const TopBar: React.FC = () => {
  const {
    isDrawerCollapsed,
    setIsDrawerCollapsed,
    setIsMobileDrawerOpen,
    activeBot,
    isTainted,
    taintReasons,
    modelsConfig,
    user,
    setIsModelModalOpen,
    setIsAuthModalOpen,
    setIsBotModalOpen,
    cycleApprovalMode,
    tab,
    setTab,
    isAuditDrawerOpen,
    setIsAuditDrawerOpen,
  } = useApp();

  const [isMobile, setIsMobile] = useState(false);
  const [confirmingFull, setConfirmingFull] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setIsMobile(mq.matches);
    update();
    if (mq.addEventListener) {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    } else if ((mq as any).addListener) {
      (mq as any).addListener(update);
      return () => (mq as any).removeListener(update);
    }
  }, []);

  const hasConfiguredModel = Boolean(modelsConfig?.activeProviderId);
  const activeProvider = modelsConfig?.providers?.find(
    (p) => p.id === modelsConfig.activeProviderId
  ) || { id: 'none', name: '未配置模型' };

  const handleApprovalSelectorClick = () => {
    const current = (activeBot?.approvalMode || 'ASK').toUpperCase();
    if (current === 'AUTO_EDITS') {
      if (!confirmingFull) {
        setConfirmingFull(true);
        setTimeout(() => setConfirmingFull(false), 4000);
        return;
      }
    }
    setConfirmingFull(false);
    cycleApprovalMode();
  };

  const tabTitles: Record<string, { title: string; icon: React.ReactNode }> = {
    chat: { title: '对话工作台', icon: null },
    feed: { title: '态势流与审批', icon: <Rss size={16} className="top-bar-tab-icon" /> },
    goals: { title: '长周期目标推进', icon: <Target size={16} className="top-bar-tab-icon" /> },
    routines: { title: '例行自动化调度', icon: <Clock size={16} className="top-bar-tab-icon" /> },
    memory: { title: '员工受控记忆中枢', icon: <Brain size={16} className="top-bar-tab-icon" /> },
    skills: { title: '技能与工具规程库', icon: <Boxes size={16} className="top-bar-tab-icon" /> },
    audit: { title: '安全策略与合规审计', icon: <ShieldCheck size={16} className="top-bar-tab-icon" /> },
    artifacts: { title: '交付物与成果抽屉', icon: <Package size={16} className="top-bar-tab-icon" /> },
  };

  const isBotScopedTab = tab === 'chat' || tab === 'memory';

  return (
    <header className="top-bar" role="banner">
      <div className="top-bar-left">
        {isBotScopedTab && (
          <button
            className="btn-toggle-drawer"
            type="button"
            onClick={() => {
              if (isMobile) setIsMobileDrawerOpen((prev) => !prev);
              else setIsDrawerCollapsed((prev) => !prev);
            }}
            title={isMobile ? '打开数字员工与会话列表' : isDrawerCollapsed ? '展开抽屉' : '收起抽屉'}
            aria-label={isDrawerCollapsed ? '展开抽屉' : '收起抽屉'}
          >
            {isMobile ? <Menu size={16} /> : isDrawerCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}

        {isBotScopedTab ? (
          <>
            {/* 当前数字员工身份卡 */}
            <div
              className="bot-title-badge"
              onClick={() => setIsBotModalOpen(true)}
              title="点击查看/配置该数字员工与形象 Prompt"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setIsBotModalOpen(true);
              }}
            >
              <div className="top-bar-bot-avatar">
                <BotAvatar bot={activeBot} size={28} still />
              </div>
              <span className="top-bar-bot-name">{activeBot?.name || '数字员工'}</span>
              <span className="pill-badge pill-blue top-bar-role-pill">
                {activeBot?.role || '智能协同'}
              </span>
            </div>

            {/* 敏感污染态状态 */}
            <div id="taint-badge-container">
              {isTainted ? (
                <span
                  className="pill-badge pill-red taint-alert-badge"
                  title={`敏感数据受限模式: ${taintReasons.join('; ')}`}
                >
                  <ShieldAlert size={12} /> 污染态受限
                </span>
              ) : (
                <span className="pill-badge pill-green" title="安全策略正常，未触及敏感数据">
                  <Shield size={12} /> 安全纯净态
                </span>
              )}
            </div>

            {/* 内核沙箱隔离 */}
            <span className="pill-badge pill-neutral top-bar-sandbox-pill" title="Linux Bubblewrap 内核级安全沙箱隔离">
              <Box size={12} /> bwrap 隔离
            </span>

            {tab === 'memory' && (
              <span className="pill-badge pill-blue">
                长期记忆上下文
              </span>
            )}
          </>
        ) : (
          <div className="top-bar-view-heading">
            {tabTitles[tab]?.icon}
            <h1 className="top-bar-view-title">{tabTitles[tab]?.title || tab}</h1>
          </div>
        )}
      </div>

      <div className="top-bar-right">
        {/* 当前模型服务指示胶囊 */}
        <button
          className="model-status-capsule"
          type="button"
          onClick={() => setIsModelModalOpen(true)}
          title="点击配置 AI 大模型服务 (DeepSeek / OpenAI / Ollama 等)"
          aria-label="AI 大模型服务配置"
        >
          <span className="model-status-icon">
            <ProviderIcon providerId={activeProvider.id} size={15} />
          </span>
          <span className="model-status-name">{hasConfiguredModel ? activeProvider.name : '未配置模型'}</span>
          <span className={`model-status-dot ${hasConfiguredModel ? 'online' : 'offline'}`} aria-hidden="true" />
        </button>

        {/* 员工身份胶囊 (未登录态显示醒目提示) */}
        <button
          className={`user-profile-capsule ${!user ? 'is-unauthenticated' : ''}`}
          type="button"
          onClick={() => setIsAuthModalOpen(true)}
          title={user ? `当前登录员工：${user.displayName || user.username}` : '点击登录以建立员工独立会话与数据隔离'}
          aria-label="员工身份与鉴权配置"
        >
          <span className="user-avatar-icon">
            <UserIcon size={14} />
          </span>
          <span className="user-name">{user ? user.displayName || user.username : '登录 / 员工身份'}</span>
        </button>

        {/* 门禁审批模式切换器 (切入 FULL 模式前提供防误触二次确认) */}
        <button
          className={`approval-selector ${confirmingFull ? 'is-confirming-full' : ''}`}
          type="button"
          onClick={handleApprovalSelectorClick}
          title={confirmingFull ? '再次点击确认开启完全自主模式' : '点击切换门禁审批模式 (ASK 逐项确认 / AUTO_EDITS 自动编辑 / FULL 完全自主)'}
          aria-label="切换门禁审批模式"
        >
          <Lock size={12} className="approval-lock-icon" />
          <span className="approval-mode-text">
            {confirmingFull ? '确认开启 FULL?' : `${(activeBot?.approvalMode || 'ASK').toUpperCase()} 门禁`}
          </span>
          <ChevronDown size={12} className="approval-chevron-icon" />
        </button>

        {/* 审计模式切换胶囊 */}
        <button
          className={`audit-toggle-capsule ${isAuditDrawerOpen ? 'active' : ''}`}
          type="button"
          onClick={() => {
            if (tab !== 'chat') setTab('chat');
            setIsAuditDrawerOpen((prev) => !prev);
          }}
          title={isAuditDrawerOpen ? '收起安全策略与审计抽屉' : '展开安全策略与审计抽屉'}
          aria-expanded={isAuditDrawerOpen}
          aria-label="切换安全合规审计面板"
        >
          <ShieldCheck size={14} className="audit-capsule-icon" />
          <span className="audit-capsule-text">审计模式</span>
          {isTainted && <span className="audit-alert-dot" title="当前会话存在敏感数据或操作标记" />}
        </button>
      </div>
    </header>
  );
};
