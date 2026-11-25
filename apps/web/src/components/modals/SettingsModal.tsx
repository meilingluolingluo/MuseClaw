import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { formatTime } from '../../utils/format';
import { ConnectorsPanel } from './ConnectorsPanel';
import type { AuditLog, Grant } from '../../types';
import {
  Settings,
  Globe,
  LayoutGrid,
  CreditCard,
  Shield,
  MessageCircle,
  Smartphone,
  Lock,
  HelpCircle,
  ShieldCheck,
  LogOut,
  X,
  ExternalLink,
  Gift,
  Sun,
  Moon,
  Laptop,
  Check,
  ChevronRight,
  ChevronDown,
  Trash2,
  KeyRound,
  RefreshCw,
  AlertCircle,
  Download,
} from 'lucide-react';

type SettingsTab =
  | 'general'
  | 'browser'
  | 'connectors'
  | 'wallet'
  | 'storage'
  | 'security'
  | 'channels'
  | 'devices'
  | 'data'
  | 'help'
  | 'legal';

interface AccentColorOption {
  id: string;
  name: string;
  hex: string;
}

const ACCENT_COLORS: AccentColorOption[] = [
  { id: 'blue', name: '经典蓝', hex: '#0064d4' },
  { id: 'cyan', name: '晴空蓝', hex: '#0284c7' },
  { id: 'purple', name: '幻境紫', hex: '#7c3aed' },
  { id: 'pink', name: '玫瑰粉', hex: '#e11d48' },
  { id: 'orange', name: '活力橙', hex: '#ea580c' },
  { id: 'amber', name: '暖阳金', hex: '#d97706' },
  { id: 'emerald', name: '翡翠绿', hex: '#059669' },
  { id: 'slate', name: '极夜灰', hex: '#334155' },
];

export const SettingsModal: React.FC = () => {
  const {
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    settingsInitialTab,
    setSettingsInitialTab,
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    showToast,
    setIsAuthModalOpen,
    user,
    setUser,
  } = useApp();

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [inviteCode, setInviteCode] = useState('');
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [browserHeadless, setBrowserHeadless] = useState(false);
  const [notifyFeed, setNotifyFeed] = useState(true);

  // 安全中心状态管理
  const [securityPolicy, setSecurityPolicy] = useState<Record<string, unknown>>({});
  const [securityGrants, setSecurityGrants] = useState<Grant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [showAllAuditLogs, setShowAllAuditLogs] = useState(false);
  const [expandedAuditKeys, setExpandedAuditKeys] = useState<Record<string, boolean>>({});
  const [showPolicyJson, setShowPolicyJson] = useState(false);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
  const revokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isSettingsModalOpen && settingsInitialTab) {
      const validTabs: SettingsTab[] = [
        'general',
        'browser',
        'connectors',
        'wallet',
        'storage',
        'security',
        'channels',
        'devices',
        'data',
        'help',
        'legal',
      ];
      if (validTabs.includes(settingsInitialTab as SettingsTab)) {
        setActiveTab(settingsInitialTab as SettingsTab);
      }
      setSettingsInitialTab(null);
    }
  }, [isSettingsModalOpen, settingsInitialTab, setSettingsInitialTab]);

  const loadSecurityData = useCallback(async () => {
    setSecurityLoading(true);
    setSecurityError(null);
    try {
      const [p, g, a] = await Promise.all([
        api.getPolicy(),
        api.getGrants(),
        api.getAuditLogs(undefined, 100),
      ]);
      setSecurityPolicy(p && typeof p === 'object' ? p : {});
      setSecurityGrants(Array.isArray(g) ? g : []);
      setAuditLogs(Array.isArray(a) ? a : []);
    } catch (err: any) {
      setSecurityError(err?.message || '安全审计数据加载失败');
    } finally {
      setSecurityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSettingsModalOpen && activeTab === 'security') {
      loadSecurityData();
    }
  }, [isSettingsModalOpen, activeTab, loadSecurityData]);

  useEffect(() => {
    return () => {
      if (revokeTimerRef.current) clearTimeout(revokeTimerRef.current);
    };
  }, []);

  const handleExportAuditLogs = () => {
    if (auditLogs.length === 0) {
      showToast('暂无可导出的审计日志', 'warning');
      return;
    }
    const blob = new Blob([JSON.stringify(auditLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'museclaw-audit-logs.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`已导出 ${auditLogs.length} 条审计日志`, 'success');
  };

  const handleRevokeGrant = async (id: string) => {
    if (revokingGrantId !== id) {
      setRevokingGrantId(id);
      if (revokeTimerRef.current) clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = setTimeout(() => setRevokingGrantId(null), 3500);
      return;
    }
    if (revokeTimerRef.current) clearTimeout(revokeTimerRef.current);
    setRevokingGrantId(null);

    try {
      await api.revokeGrant(id);
      setSecurityGrants((prev) => prev.filter((g) => g.id !== id));
      showToast('已撤销该复用授权条目', 'success');
    } catch (err: any) {
      showToast(`撤销失败: ${err?.message || '请重试'}`, 'error');
    }
  };

  if (!isSettingsModalOpen) return null;

  const handleClose = () => {
    setIsSettingsModalOpen(false);
  };

  const handleApplyInvite = () => {
    if (!inviteCode.trim()) {
      showToast('请输入有效的邀请码', 'warning');
      return;
    }
    showToast(`邀请码「${inviteCode.trim()}」兑现成功！已激活专属企业特权`, 'success');
    setInviteCode('');
    setShowInviteInput(false);
  };

  const handleLogout = () => {
    setUser(null);
    showToast('已安全退出登录', 'info');
    setIsSettingsModalOpen(false);
  };

  return (
    <div className="settings-modal-backdrop" onClick={handleClose}>
      <div
        className="settings-modal-window"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="工作台设置"
      >
        {/* 左侧导航栏 */}
        <aside className="settings-sidebar">
          <div className="settings-sidebar-header">
            <h2 className="settings-sidebar-title">设置</h2>
          </div>

          <nav className="settings-nav-list" aria-label="设置菜单">
            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'general' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              <Settings size={18} className="settings-nav-icon" />
              <span>通用</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'browser' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('browser')}
            >
              <Globe size={18} className="settings-nav-icon" />
              <span>浏览器</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'connectors' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('connectors')}
            >
              <LayoutGrid size={18} className="settings-nav-icon" />
              <span>连接器</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'wallet' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('wallet')}
            >
              <CreditCard size={18} className="settings-nav-icon" />
              <span>钱包</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'storage' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('storage')}
            >
              <Shield size={18} className="settings-nav-icon" />
              <span>安全存储</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'security' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('security')}
            >
              <ShieldCheck size={18} className="settings-nav-icon" />
              <span>安全中心</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'channels' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('channels')}
            >
              <MessageCircle size={18} className="settings-nav-icon" />
              <span>消息渠道</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'devices' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('devices')}
            >
              <Smartphone size={18} className="settings-nav-icon" />
              <span>设备</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'data' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('data')}
            >
              <Lock size={18} className="settings-nav-icon" />
              <span>数据控制</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'help' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('help')}
            >
              <HelpCircle size={18} className="settings-nav-icon" />
              <span>帮助与支持</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'legal' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('legal')}
            >
              <ShieldCheck size={18} className="settings-nav-icon" />
              <span>法律信息</span>
            </button>
          </nav>

          <div className="settings-sidebar-footer">
            <button
              type="button"
              className="settings-logout-btn"
              onClick={handleLogout}
            >
              <LogOut size={16} />
              <span>退出</span>
            </button>
          </div>
        </aside>

        {/* 右侧核心内容区域 */}
        <main className="settings-main-content">
          <div className="settings-top-bar">
            <h3 className="settings-content-title">
              {activeTab === 'general' && '通用'}
              {activeTab === 'browser' && '浏览器'}
              {activeTab === 'connectors' && '连接器'}
              {activeTab === 'wallet' && '钱包'}
              {activeTab === 'storage' && '安全存储'}
              {activeTab === 'security' && '安全中心'}
              {activeTab === 'channels' && '消息渠道'}
              {activeTab === 'devices' && '设备'}
              {activeTab === 'data' && '数据控制'}
              {activeTab === 'help' && '帮助与支持'}
              {activeTab === 'legal' && '法律信息'}
            </h3>

            <button
              type="button"
              className="settings-close-btn"
              onClick={handleClose}
              title="关闭设置"
              aria-label="关闭设置"
            >
              <X size={16} />
            </button>
          </div>

          <div className="settings-body-scroll">
            {/* 1. 通用 (General) */}
            {activeTab === 'general' && (
              <div className="settings-pane-wrap">
                {/* 账户卡片 */}
                <div
                  className="settings-card settings-card-link"
                  onClick={() => setIsAuthModalOpen(true)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="settings-account-left">
                    <div className="settings-meta-logo-icon">
                      <span className="settings-meta-infinity">∞</span>
                    </div>
                    <div className="settings-account-text">
                      <div className="settings-account-name">
                        {user?.displayName || user?.username ? `${user.displayName || user.username} 账户` : '工作台账户'}
                      </div>
                      <div className="settings-account-desc">密码、安全、个人详情</div>
                    </div>
                  </div>
                  <ExternalLink size={16} className="settings-link-arrow" />
                </div>

                {/* 使用情况 */}
                <div className="settings-section-block">
                  <div className="settings-section-caption">使用情况</div>
                  <div className="settings-card">
                    <div className="settings-usage-header">
                      <span className="settings-usage-tier">免费版</span>
                      <span className="settings-usage-percent">已使用 0%</span>
                    </div>
                    <div className="settings-usage-reset">周限额重置时间: 11月26日</div>
                    <div className="settings-progress-track">
                      <div className="settings-progress-fill" />
                    </div>
                    <div className="settings-usage-footer">
                      <button
                        type="button"
                        className="settings-upgrade-link"
                        onClick={() => showToast('即将跳转至企业套餐充能页', 'info')}
                      >
                        升级
                      </button>
                    </div>
                  </div>
                </div>

                {/* 兑现邀请码 */}
                <div className="settings-card settings-interactive-card">
                  <div
                    className="settings-card-clickable-row"
                    onClick={() => setShowInviteInput(!showInviteInput)}
                  >
                    <div className="settings-card-icon-title">
                      <Gift size={18} className="settings-gift-icon" />
                      <span>兑现邀请码</span>
                    </div>
                    <ChevronRight
                      size={16}
                      className={`settings-chevron ${showInviteInput ? 'is-expanded' : ''}`}
                    />
                  </div>

                  {showInviteInput && (
                    <div className="settings-invite-expand-wrap">
                      <div className="settings-invite-input-row">
                        <input
                          type="text"
                          placeholder="输入 8 位邀请激活码"
                          value={inviteCode}
                          onChange={(e) => setInviteCode(e.target.value)}
                          className="form-control"
                        />
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleApplyInvite}
                        >
                          立即兑现
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 语言 */}
                <div
                  className="settings-card settings-interactive-card settings-clickable-single"
                  onClick={() => showToast('当前系统已设为简体中文', 'info')}
                >
                  <div className="settings-card-icon-title">
                    <Globe size={18} className="settings-globe-icon" />
                    <span>语言</span>
                  </div>
                  <div className="settings-val-with-chevron">
                    <span className="settings-subtle-val">简体中文</span>
                    <ChevronRight size={16} className="settings-chevron" />
                  </div>
                </div>

                {/* 外观 */}
                <div className="settings-section-block">
                  <div className="settings-section-caption">外观</div>
                  <div className="settings-card settings-appearance-card">
                    {/* 模式切换 */}
                    <div className="settings-appearance-row">
                      <span className="settings-item-label">模式</span>
                      <div className="settings-theme-pill-toggle">
                        <button
                          type="button"
                          className={`settings-theme-pill-btn ${theme === 'light' ? 'is-active' : ''}`}
                          onClick={() => setTheme('light')}
                          title="浅色模式"
                        >
                          <Sun size={15} />
                        </button>
                        <button
                          type="button"
                          className={`settings-theme-pill-btn ${theme === 'dark' ? 'is-active' : ''}`}
                          onClick={() => setTheme('dark')}
                          title="深色模式"
                        >
                          <Moon size={15} />
                        </button>
                        <button
                          type="button"
                          className={`settings-theme-pill-btn ${theme === 'system' ? 'is-active' : ''}`}
                          onClick={() => setTheme('system')}
                          title="跟随系统"
                        >
                          <Laptop size={15} />
                        </button>
                      </div>
                    </div>

                    {/* 主题色选择器 */}
                    <div className="settings-appearance-row settings-color-row">
                      <span className="settings-item-label">主题色</span>
                      <div className="settings-color-dots-list">
                        {ACCENT_COLORS.map((col) => {
                          const isSelected = accentColor.toLowerCase() === col.hex.toLowerCase();
                          return (
                            <button
                              key={col.id}
                              type="button"
                              onClick={() => setAccentColor(col.hex)}
                              className={`settings-color-dot ${isSelected ? 'is-selected' : ''}`}
                              title={col.name}
                              data-color={col.hex}
                            >
                              <span
                                className="settings-color-swatch"
                                data-color={col.hex}
                              />
                              {isSelected && <Check size={12} className="settings-color-check" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. 浏览器 (Browser) */}
            {activeTab === 'browser' && (
              <div className="settings-pane-wrap">
                <div className="settings-card">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-toggle-title">无头静默浏览器模式 (Headless)</div>
                      <div className="settings-toggle-desc">
                        数字员工在受控容器内运行网页浏览、抓取与自动化测试时静默执行
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={browserHeadless}
                      onChange={(e) => setBrowserHeadless(e.target.checked)}
                      className="settings-toggle-switch"
                    />
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-toggle-title">跨域访问沙箱隔离保护</div>
                      <div className="settings-toggle-desc">
                        防止数字员工跨非受信域访问，保护内网敏感端口与本地工作区数据安全
                      </div>
                    </div>
                    <span className="settings-badge-green">已开启 · 严格受控</span>
                  </div>
                </div>
              </div>
            )}

            {/* 3. 连接器 (Connectors) */}
            {activeTab === 'connectors' && <ConnectorsPanel />}

            {/* 4. 钱包 (Wallet) */}
            {activeTab === 'wallet' && (
              <div className="settings-pane-wrap">
                <div className="settings-card">
                  <div className="settings-wallet-row">
                    <div>
                      <div className="settings-usage-tier">Token 钱包与账本</div>
                      <div className="settings-toggle-desc">管理企业级模型 Token 预充值与自主消费限额</div>
                    </div>
                    <span className="settings-wallet-balance">¥ 2,840.00</span>
                  </div>
                  <div className="settings-progress-track">
                    <div className="settings-progress-fill" />
                  </div>
                </div>
              </div>
            )}

            {/* 5. 安全存储 (Storage) */}
            {activeTab === 'storage' && (
              <div className="settings-pane-wrap">
                <div className="settings-card">
                  <div className="settings-card-icon-title">
                    <KeyRound size={18} className="settings-icon-blue" />
                    <div>
                      <div className="settings-toggle-title">AES-256 本地密钥加密库</div>
                      <div className="settings-toggle-desc">沙箱环境环境变量、第三方 API Key 均采用硬件级派生密钥存储</div>
                    </div>
                  </div>
                  <span className="settings-badge-green">硬件密钥保护</span>
                </div>
              </div>
            )}

            {/* 6. 安全中心 (Security) */}
            {activeTab === 'security' && (
              <div className="settings-pane-wrap">
                {securityError && (
                  <div className="connector-error-alert" role="alert">
                    <AlertCircle size={14} />
                    <span>{securityError}</span>
                  </div>
                )}

                {/* 卡片 1：审计中心 */}
                <div className="settings-card">
                  <div className="settings-audit-header">
                    <div>
                      <div className="settings-toggle-title">审计中心</div>
                      <div className="settings-toggle-desc">拦截/放行记录与日志导出。</div>
                    </div>
                    <div className="settings-audit-actions">
                      <button
                        type="button"
                        className="connector-action-btn"
                        onClick={handleExportAuditLogs}
                        disabled={auditLogs.length === 0}
                      >
                        <Download size={13} />
                        <span>导出日志</span>
                      </button>
                      <button
                        type="button"
                        className="connector-action-btn"
                        onClick={loadSecurityData}
                        disabled={securityLoading}
                      >
                        <RefreshCw size={13} className={securityLoading ? 'spin' : ''} />
                        <span>刷新</span>
                      </button>
                    </div>
                  </div>

                  {auditLogs.length === 0 ? (
                    <div className="settings-audit-empty">
                      {securityLoading ? '正在加载审计记录...' : '暂无拦截或放行记录'}
                    </div>
                  ) : (
                    <>
                      <div className="settings-audit-list">
                        {(showAllAuditLogs ? auditLogs : auditLogs.slice(0, 5)).map((log, idx) => {
                          const eventLabel = log.eventType || log.event || 'EVENT';
                          const rowKey = log.id || `${eventLabel}_${idx}_${log.ts || log.timestamp || idx}`;
                          const isExpanded = Boolean(expandedAuditKeys[rowKey]);
                          const rawDetail =
                            typeof log.details === 'string'
                              ? log.details
                              : log.details?.reason ||
                                log.details?.actionSummary ||
                                log.details?.command ||
                                log.target ||
                                (typeof log.decision === 'string' ? log.decision : '') ||
                                '';
                          const toolPrefix = log.tool ? `${log.tool}: ` : '';
                          const summaryText = `[${eventLabel}] ${toolPrefix}${rawDetail || '安全检查记录'}`;
                          const timeValue = log.timestamp || log.ts;

                          return (
                            <div key={rowKey} className="settings-audit-row">
                              <button
                                type="button"
                                className="settings-audit-row-main"
                                onClick={() =>
                                  setExpandedAuditKeys((prev) => ({
                                    ...prev,
                                    [rowKey]: !prev[rowKey],
                                  }))
                                }
                                aria-expanded={isExpanded}
                              >
                                <span className="settings-audit-summary" title={summaryText}>
                                  {summaryText}
                                </span>
                                <span className="settings-audit-time">
                                  {timeValue ? formatTime(timeValue) : '-'}
                                </span>
                              </button>
                              {isExpanded && (
                                <pre className="settings-audit-detail">
                                  {JSON.stringify(log, null, 2)}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {auditLogs.length > 5 && (
                        <button
                          type="button"
                          className="settings-audit-more"
                          onClick={() => setShowAllAuditLogs((prev) => !prev)}
                        >
                          <span>{showAllAuditLogs ? '收起' : `查看全部 (${auditLogs.length}) >`}</span>
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* 卡片 2：活跃复用授权 */}
                <div className="settings-card">
                  <div className="settings-audit-header">
                    <div>
                      <div className="settings-toggle-title">活跃复用授权</div>
                      <div className="settings-toggle-desc">
                        当前已记住 {securityGrants.length} 条免确认规则，撤销后将恢复门禁询问。
                      </div>
                    </div>
                  </div>

                  {securityGrants.length === 0 ? (
                    <div className="settings-audit-empty">暂无活跃复用授权</div>
                  ) : (
                    <div className="settings-audit-list">
                      {securityGrants.map((grant, idx) => {
                        const permText =
                          typeof grant.permission === 'object'
                            ? JSON.stringify(grant.permission)
                            : String(grant.permission || '');
                        return (
                          <div key={grant.id || idx} className="settings-grant-row">
                            <div className="settings-grant-info">
                              <span className="settings-grant-scope">{grant.scope || 'general'}</span>
                              <span className="settings-grant-perm" title={permText}>
                                {permText}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRevokeGrant(grant.id)}
                              className={`connector-action-btn ${
                                revokingGrantId === grant.id ? 'btn-danger' : ''
                              }`}
                              title={revokingGrantId === grant.id ? '再次点击确认撤销' : '撤销该授权'}
                            >
                              <Trash2 size={12} />
                              <span>{revokingGrantId === grant.id ? '确认撤销' : '撤销'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 卡片 3：默认安全策略 */}
                <div className="settings-card">
                  <button
                    type="button"
                    className="settings-card-clickable-row settings-policy-toggle"
                    onClick={() => setShowPolicyJson((prev) => !prev)}
                    aria-expanded={showPolicyJson}
                  >
                    <div className="settings-card-icon-title">
                      <Shield size={16} className="settings-icon-blue" />
                      <span>查看生效策略配置</span>
                    </div>
                    {showPolicyJson ? (
                      <ChevronDown size={16} className="settings-chevron" />
                    ) : (
                      <ChevronRight size={16} className="settings-chevron" />
                    )}
                  </button>
                  {showPolicyJson && (
                    <pre className="settings-policy-pre">
                      {JSON.stringify(securityPolicy, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {/* 7. 消息渠道 (Channels) */}
            {activeTab === 'channels' && (
              <div className="settings-pane-wrap">
                <div className="settings-card">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-toggle-title">团队动态流 (Feed) 推送通知</div>
                      <div className="settings-toggle-desc">
                        例行任务巡检结论与数字员工主动交付成果时向团队动态流发送通报
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifyFeed}
                      onChange={(e) => setNotifyFeed(e.target.checked)}
                      className="settings-toggle-switch"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 8. 设备 (Devices) */}
            {activeTab === 'devices' && (
              <div className="settings-pane-wrap">
                <div className="settings-card">
                  <div className="settings-card-icon-title">
                    <Laptop size={18} className="settings-icon-blue" />
                    <div>
                      <div className="settings-toggle-title">当前工作站实例</div>
                      <div className="settings-toggle-desc">
                        Windows 11 / WSL2 Ubuntu 24.04 LTS · Chrome 134 桌面宿主
                      </div>
                    </div>
                  </div>
                  <span className="settings-badge-green">在线 (Connected)</span>
                </div>
              </div>
            )}

            {/* 9. 数据控制 (Data) */}
            {activeTab === 'data' && (
              <div className="settings-pane-wrap">
                <div className="settings-card">
                  <div className="settings-toggle-row">
                    <div>
                      <div className="settings-toggle-title">清理本地会话缓存</div>
                      <div className="settings-toggle-desc">清除浏览器本地 IndexedDB 临时图表与离线日志缓存</div>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => showToast('本地会话缓存已清理', 'success')}
                    >
                      <Trash2 size={14} /> 清理缓存
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 10. 帮助与支持 (Help) */}
            {activeTab === 'help' && (
              <div className="settings-pane-wrap">
                <div className="settings-card">
                  <div className="settings-toggle-title">MuseClaw Enterprise Digital Employee Workstation</div>
                  <div className="settings-toggle-desc">版本: v0.1.0-alpha · 智能数字员工协作平台</div>
                </div>
              </div>
            )}

            {/* 11. 法律信息 (Legal) */}
            {activeTab === 'legal' && (
              <div className="settings-pane-wrap">
                <div className="settings-card">
                  <div className="settings-toggle-title">隐私与合规条款</div>
                  <div className="settings-toggle-desc">
                    MuseClaw 严格遵循受控沙箱运行原则，所有本地文件操作均限制于指定工作区内。
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
