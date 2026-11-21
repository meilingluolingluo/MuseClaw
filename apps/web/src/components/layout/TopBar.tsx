import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ProviderIcon } from '../../utils/icons';
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
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const activeProvider = modelsConfig?.providers?.find(
    (p) => p.id === modelsConfig.activeProviderId
  ) || { id: 'deepseek', name: 'DeepSeek' };

  const tabTitles: Record<string, { title: string; icon: React.ReactNode }> = {
    chat: { title: '对话工作台', icon: null },
    feed: { title: '智能体动态 (Feed)', icon: <Rss size={16} style={{ color: 'var(--om-accent)' }} /> },
    goals: { title: '长周期目标 (Goals)', icon: <Target size={16} style={{ color: 'var(--om-accent)' }} /> },
    routines: { title: '定时任务 (Routines)', icon: <Clock size={16} style={{ color: 'var(--om-accent)' }} /> },
    memory: { title: '受控长期记忆 (Memory)', icon: <Brain size={16} style={{ color: 'var(--om-accent)' }} /> },
    skills: { title: '技能规程库 (Skills)', icon: <Boxes size={16} style={{ color: 'var(--om-accent)' }} /> },
    audit: { title: '安全策略与合规审计', icon: <ShieldCheck size={16} style={{ color: 'var(--om-accent)' }} /> },
    artifacts: { title: '交付工件 (Artifacts)', icon: <Package size={16} style={{ color: 'var(--om-accent)' }} /> },
  };

  const isBotScopedTab = tab === 'chat' || tab === 'memory';

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        {isBotScopedTab && (
          <button
            className="btn-toggle-drawer"
            type="button"
            onClick={() => {
              if (isMobile) setIsMobileDrawerOpen((prev) => !prev);
              else setIsDrawerCollapsed((prev) => !prev);
            }}
            title={isMobile ? '打开数字员工与会话' : isDrawerCollapsed ? '展开侧边栏' : '收起侧边栏'}
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
              title="点击查看/配置该数字员工与形象"
              style={{ cursor: 'pointer' }}
            >
              <span style={{ fontSize: '18px' }}>{activeBot?.avatar || '🤖'}</span>
              <span style={{ fontWeight: 600 }}>{activeBot?.name || '数字员工'}</span>
              <span className="pill-badge pill-blue" style={{ fontSize: '11px' }}>
                {activeBot?.role || 'Coordinator'}
              </span>
            </div>

            {/* 敏感污染态状态 */}
            <div id="taint-badge-container">
              {isTainted ? (
                <span
                  className="pill-badge pill-red"
                  title={`敏感数据受限模式: ${taintReasons.join('; ')}`}
                >
                  <ShieldAlert size={12} /> 污染态 (Tainted)
                </span>
              ) : (
                <span className="pill-badge pill-green" title="出网策略正常，未触及私密数据">
                  <Shield size={12} /> 纯净态 (Untainted)
                </span>
              )}
            </div>

            {/* 沙箱隔离 */}
            <span className="pill-badge pill-blue" title="Linux Bubblewrap 内核级安全沙箱隔离">
              <Box size={12} /> bwrap 隔离
            </span>

            {tab === 'memory' && (
              <span className="pill-badge pill-blue" style={{ marginLeft: '6px' }}>
                受控长期记忆 (Memory)
              </span>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '4px' }}>
            <span style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {tabTitles[tab]?.icon}
              {tabTitles[tab]?.title || tab}
            </span>
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
        >
          <span className="model-status-icon">
            <ProviderIcon providerId={activeProvider.id} size={16} />
          </span>
          <span className="model-status-name">{activeProvider.name}</span>
          <span className="model-status-dot" />
        </button>

        {/* 员工身份胶囊 */}
        <button
          className="user-profile-capsule"
          type="button"
          onClick={() => setIsAuthModalOpen(true)}
          title="员工身份与账号配置"
        >
          <span className="user-avatar" style={{ fontSize: '15px' }}>👤</span>
          <span className="user-name">{user ? user.displayName || user.username : '未登录'}</span>
        </button>

        {/* 门禁审批模式切换器 */}
        <div
          className="approval-selector"
          onClick={cycleApprovalMode}
          title="点击切换门禁审批模式 (ASK / AUTO_EDITS / FULL)"
          style={{ cursor: 'pointer' }}
        >
          <Lock size={13} />
          <span>{(activeBot?.approvalMode || 'ASK').toUpperCase()} 门禁</span>
          <ChevronDown size={13} />
        </div>

        {/* 审计模式切换胶囊 */}
        <button
          className={`audit-toggle-capsule ${isAuditDrawerOpen ? 'active' : ''}`}
          type="button"
          onClick={() => {
            if (tab !== 'chat') setTab('chat');
            setIsAuditDrawerOpen((prev) => !prev);
          }}
          title={isAuditDrawerOpen ? '收起安全策略与审计抽屉' : '展开安全策略与审计抽屉'}
        >
          <ShieldCheck size={14} className="audit-capsule-icon" />
          <span className="audit-capsule-text">审计模式</span>
          {isTainted && <span className="audit-alert-dot" title="当前会话存在敏感数据或操作标记" />}
        </button>
      </div>
    </header>
  );
};
