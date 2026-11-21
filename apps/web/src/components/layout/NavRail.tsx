import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { ClawLogo } from '../../utils/icons';
import {
  MessageSquare,
  Rss,
  Target,
  Clock,
  Brain,
  Boxes,
  ShieldCheck,
  Package,
  Cpu,
  Sun,
  Moon,
  Laptop,
} from 'lucide-react';
import type { TabType } from '../../types';

export const NavRail: React.FC = () => {
  const { tab, setTab, theme, setTheme, setIsModelModalOpen, modelsConfig } = useApp();
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setIsThemeMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const navItems: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    { id: 'chat', label: '对话', icon: <MessageSquare size={20} /> },
    { id: 'feed', label: '动态', icon: <Rss size={20} /> },
    { id: 'goals', label: '目标', icon: <Target size={20} /> },
    { id: 'routines', label: '定时', icon: <Clock size={20} /> },
    { id: 'memory', label: '记忆', icon: <Brain size={20} /> },
    { id: 'skills', label: '技能', icon: <Boxes size={20} /> },
    { id: 'audit', label: '审计', icon: <ShieldCheck size={20} /> },
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

      {/* 外观模式设置 */}
      <div className="theme-picker-container" ref={themeMenuRef}>
        <button
          className="nav-item nav-theme-toggle"
          type="button"
          aria-haspopup="menu"
          aria-expanded={isThemeMenuOpen}
          title="外观模式切换"
          aria-label="外观模式切换"
          onClick={() => setIsThemeMenuOpen((prev) => !prev)}
        >
          <span className="nav-icon">
            {theme === 'light' ? <Sun size={20} /> : theme === 'dark' ? <Moon size={20} /> : <Laptop size={20} />}
          </span>
          <span className="nav-label">
            {theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '系统'}
          </span>
        </button>

        {isThemeMenuOpen && (
          <div className="theme-menu is-open" role="menu">
            <div className="theme-menu-header">外观模式</div>
            <button
              className={`theme-menu-item ${theme === 'light' ? 'active' : ''}`}
              type="button"
              role="menuitemradio"
              aria-checked={theme === 'light'}
              onClick={() => {
                setTheme('light');
                setIsThemeMenuOpen(false);
              }}
            >
              <span className="theme-menu-icon"><Sun size={16} /></span>
              <div className="theme-menu-text">
                <span className="theme-menu-label">浅色模式</span>
              </div>
              {theme === 'light' && <span className="theme-menu-check">✓</span>}
            </button>
            <button
              className={`theme-menu-item ${theme === 'dark' ? 'active' : ''}`}
              type="button"
              role="menuitemradio"
              aria-checked={theme === 'dark'}
              onClick={() => {
                setTheme('dark');
                setIsThemeMenuOpen(false);
              }}
            >
              <span className="theme-menu-icon"><Moon size={16} /></span>
              <div className="theme-menu-text">
                <span className="theme-menu-label">深色模式</span>
              </div>
              {theme === 'dark' && <span className="theme-menu-check">✓</span>}
            </button>
            <button
              className={`theme-menu-item ${theme === 'system' ? 'active' : ''}`}
              type="button"
              role="menuitemradio"
              aria-checked={theme === 'system'}
              onClick={() => {
                setTheme('system');
                setIsThemeMenuOpen(false);
              }}
            >
              <span className="theme-menu-icon"><Laptop size={16} /></span>
              <div className="theme-menu-text">
                <span className="theme-menu-label">跟随系统</span>
              </div>
              {theme === 'system' && <span className="theme-menu-check">✓</span>}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};
