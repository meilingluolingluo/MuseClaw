import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ProviderIcon } from '../../utils/icons';
import { BotAvatar } from '../common/BotAvatar';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Rss,
  Target,
  Clock,
  Boxes,
  Package,
  Brain,
  User as UserIcon,
  Home,
  MessageSquare,
} from 'lucide-react';

export const TopBar: React.FC = () => {
  const {
    isDrawerCollapsed,
    setIsDrawerCollapsed,
    setIsMobileDrawerOpen,
    activeBot,
    isMainChat,
    switchToMainChat,
    modelsConfig,
    user,
    setIsModelModalOpen,
    setIsAuthModalOpen,
    setIsBotModalOpen,
    tab,
  } = useApp();

  const [isMobile, setIsMobile] = useState(false);

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

  const hasConfiguredModel = Boolean(modelsConfig?.activeInstanceId);
  const activeProvider = modelsConfig?.instances?.find(
    (p) => p.instanceId === modelsConfig.activeInstanceId
  );

  const tabTitles: Record<string, { title: string; icon: React.ReactNode }> = {
    chat: { title: '对话工作台', icon: null },
    feed: { title: '态势流与审批', icon: <Rss size={16} className="top-bar-tab-icon" /> },
    goals: { title: '长周期目标推进', icon: <Target size={16} className="top-bar-tab-icon" /> },
    routines: { title: '例行自动化调度', icon: <Clock size={16} className="top-bar-tab-icon" /> },
    memory: { title: '员工受控记忆中枢', icon: <Brain size={16} className="top-bar-tab-icon" /> },
    skills: { title: '技能与工具规程库', icon: <Boxes size={16} className="top-bar-tab-icon" /> },
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

            {/* 会话类型指示胶囊 (主聊 vs 旁聊) */}
            {tab === 'chat' && (
              <button
                type="button"
                className={`pill-badge top-bar-thread-pill ${isMainChat ? 'pill-blue' : 'pill-purple'}`}
                onClick={!isMainChat ? switchToMainChat : undefined}
                title={isMainChat ? '当前为主聊（常驻核心工作流）' : '当前为独立旁聊，点击切回主聊'}
              >
                {isMainChat ? <Home size={11} /> : <MessageSquare size={11} />}
                <span>{isMainChat ? '主聊' : '旁聊'}</span>
              </button>
            )}

            {tab === 'memory' && (
              <span className="pill-badge pill-blue">
                长期记忆上下文
              </span>
            )}
          </>
        ) : (
          <div key={tab} className="top-bar-view-heading">
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
            <ProviderIcon providerId={activeProvider?.driver || activeProvider?.instanceId || 'claude'} size={15} />
          </span>
          <span className="model-status-name">
            {hasConfiguredModel && activeProvider ? activeProvider.displayName : '未配置模型'}
          </span>
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
      </div>
    </header>
  );
};
