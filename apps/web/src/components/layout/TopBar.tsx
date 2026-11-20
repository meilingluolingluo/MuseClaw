import React from 'react';
import { useApp } from '../../context/AppContext';
import { ProviderIcon } from '../../utils/icons';
import {
  PanelLeftClose,
  PanelLeftOpen,
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
  } = useApp();

  const activeProvider = modelsConfig?.providers?.find(
    (p) => p.id === modelsConfig.activeProviderId
  ) || { id: 'deepseek', name: 'DeepSeek' };

  const tabTitles: Record<string, { title: string; icon: React.ReactNode }> = {
    chat: { title: '对话工作台', icon: null },
    feed: { title: '智能体动态 (Feed)', icon: <Rss size={16} style={{ color: 'var(--om-accent)' }} /> },
    goals: { title: '长周期目标 (Goals)', icon: <Target size={16} style={{ color: 'var(--om-accent)' }} /> },
    routines: { title: '定时任务 (Routines)', icon: <Clock size={16} style={{ color: 'var(--om-accent)' }} /> },
    memory: { title: '受控长期记忆 (Memory)', icon: <Brain size={16} style={{ color: 'var(--om-accent)' }} /> },
    skills: { title: '微沙箱与 MCP (Skills)', icon: <Boxes size={16} style={{ color: 'var(--om-accent)' }} /> },
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
            onClick={() => setIsDrawerCollapsed((prev) => !prev)}
            title={isDrawerCollapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {isDrawerCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
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
      </div>
    </header>
  );
};
