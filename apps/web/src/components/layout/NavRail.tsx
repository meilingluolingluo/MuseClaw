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
  const { tab, setTab, theme, setTheme, setIsModelModalOpen } = useApp();
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setIsThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    { id: 'chat', label: '对话', icon: <MessageSquare size={20} /> },
    { id: 'feed', label: '动态', icon: <Rss size={20} /> },
    { id: 'goals', label: '目标', icon: <Target size={20} /> },
    { id: 'routines', label: '定时', icon: <Clock size={20} /> },
    { id: 'memory', label: '记忆', icon: <Brain size={20} /> },
    { id: 'skills', label: '技能', icon: <Boxes size={20} /> },
    { id: 'artifacts', label: '工件', icon: <Package size={20} /> },
  ];

  return (
    <nav className="nav-rail">
      <div
        className="brand-icon"
        title="MuseClaw 数字员工工作台"
        onClick={() => setTab('chat')}
        style={{ cursor: 'pointer' }}
      >
        <ClawLogo size={22} color="var(--om-accent)" />
      </div>

      {navItems.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${tab === item.id ? 'active' : ''}`}
          onClick={() => setTab(item.id)}
          title={item.label}
          type="button"
        >
          <span className="nav-icon">{item.icon}</span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}

      <div className="nav-rail-spacer" />

      {/* 模型配置入口 */}
      <button
        className="nav-item"
        type="button"
        title="AI 模型服务配置"
        onClick={() => setIsModelModalOpen(true)}
      >
        <span className="nav-icon">
          <Cpu size={20} />
        </span>
        <span className="nav-label">模型</span>
      </button>

      {/* 外观设置 */}
      <div className="theme-picker-container" ref={themeMenuRef}>
        <button
          className="nav-item nav-theme-toggle"
          type="button"
          aria-haspopup="menu"
          aria-expanded={isThemeMenuOpen}
          title="外观模式切换"
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
          <div className="theme-menu" role="menu" style={{ display: 'flex' }}>
            <div className="theme-menu-header">外观模式</div>
            <button
              className={`theme-menu-item ${theme === 'light' ? 'active' : ''}`}
              type="button"
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
