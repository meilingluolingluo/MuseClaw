import React from 'react';
import { useApp } from '../../context/AppContext';
import { ClawLogo } from '../../utils/icons';
import {
  MessageSquare,
  Rss,
  Target,
  Clock,
  Brain,
  Boxes,
  Package,
  Cpu,
  Settings,
} from 'lucide-react';
import type { TabType } from '../../types';

export const NavRail: React.FC = () => {
  const { tab, setTab, setIsModelModalOpen, setIsSettingsModalOpen, modelsConfig } = useApp();

  const navItems: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    { id: 'chat', label: '对话', icon: <MessageSquare size={20} /> },
    { id: 'feed', label: '动态', icon: <Rss size={20} /> },
    { id: 'goals', label: '目标', icon: <Target size={20} /> },
    { id: 'routines', label: '定时', icon: <Clock size={20} /> },
    { id: 'memory', label: '记忆', icon: <Brain size={20} /> },
    { id: 'skills', label: '技能', icon: <Boxes size={20} /> },
    { id: 'artifacts', label: '工件', icon: <Package size={20} /> },
  ];

  const hasConfiguredModel = Boolean(modelsConfig?.activeProviderId);

  return (
    <nav className="nav-rail" aria-label="主工作台导航">
      <button
        className="brand-icon"
        title="MuseClaw 数字员工工作台"
        onClick={() => setTab('chat')}
        type="button"
        aria-label="返回对话工作台"
      >
        <ClawLogo size={22} color="var(--om-accent)" />
      </button>

      <div className="nav-items-group" role="tablist" aria-orientation="vertical">
        {navItems.map((item) => {
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
              title={item.label}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {isActive && <span className="nav-active-indicator" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className="nav-rail-spacer" />

      {/* 模型配置入口 */}
      <button
        className="nav-item nav-model-btn"
        type="button"
        title={hasConfiguredModel ? 'AI 模型服务已就绪 (点击配置)' : 'AI 模型服务配置'}
        onClick={() => setIsModelModalOpen(true)}
        aria-label="AI 模型配置"
      >
        <span className="nav-icon nav-model-icon-wrap">
          <Cpu size={20} />
          {hasConfiguredModel && <span className="nav-status-dot online" title="模型服务运行中" />}
        </span>
        <span className="nav-label">模型</span>
      </button>

      {/* 工作台系统设置 */}
      <button
        className="nav-item nav-settings-btn"
        type="button"
        title="设置"
        aria-label="工作台系统设置"
        onClick={() => setIsSettingsModalOpen(true)}
      >
        <span className="nav-icon">
          <Settings size={20} />
        </span>
        <span className="nav-label">设置</span>
      </button>
    </nav>
  );
};
