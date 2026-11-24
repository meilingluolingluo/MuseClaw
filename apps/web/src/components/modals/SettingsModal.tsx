import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { formatTime } from '../../utils/format';
import type { ConnectorItem, ConnectorCategory, AuditLog, Grant } from '../../types';
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
  Info,
  Terminal,
  Cpu,
  Trash2,
  Bell,
  HardDrive,
  KeyRound,
  Search,
  Plus,
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Database,
  Palette,
  DollarSign,
  Folder,
  Brain,
  Sparkles,
  Target,
  Mail,
  Link2,
  Code2,
  Loader2,
  Activity,
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

const CONNECTOR_CATEGORIES: Array<{ id: ConnectorCategory | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'builtin', label: '核心内置' },
  { id: 'work', label: '办公协同' },
  { id: 'dev', label: '代码研发' },
  { id: 'data', label: '数据存储' },
  { id: 'search', label: '网页检索' },
  { id: 'talk', label: '通讯协同' },
  { id: 'design', label: '创意设计' },
  { id: 'money', label: '财务结算' },
  { id: 'custom', label: '自定义 MCP' },
];

const renderConnectorIcon = (item: ConnectorItem, size: number = 18) => {
  if (item.category === 'builtin') {
    if (item.id === 'terminal') return <Terminal size={size} />;
    if (item.id === 'filesystem') return <Folder size={size} />;
    if (item.id === 'browser') return <Globe size={size} />;
    if (item.id === 'memory') return <Brain size={size} />;
    if (item.id === 'skills') return <Sparkles size={size} />;
    if (item.id === 'goals') return <Target size={size} />;
    if (item.id === 'feishu') return <MessageCircle size={size} />;
    if (item.id === 'email') return <Mail size={size} />;
  }
  if (item.category === 'dev') return <Code2 size={size} />;
  if (item.category === 'data') return <Database size={size} />;
  if (item.category === 'search') return <Search size={size} />;
  if (item.category === 'talk') return <MessageCircle size={size} />;
  if (item.category === 'design') return <Palette size={size} />;
  if (item.category === 'money') return <DollarSign size={size} />;
  if (item.category === 'custom') return <Cpu size={size} />;
  return <LayoutGrid size={size} />;
};

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

  // 连接器状态管理
  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [loadingConnectors, setLoadingConnectors] = useState<boolean>(false);
  const [connectorSearch, setConnectorSearch] = useState<string>('');
  const [connectorCategory, setConnectorCategory] = useState<ConnectorCategory | 'all'>('all');
  const [activeConnectorDetail, setActiveConnectorDetail] = useState<ConnectorItem | null>(null);

  // 测试状态
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; latencyMs: number; message: string }>>({});

  // 连接配置弹窗
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [connectTarget, setConnectTarget] = useState<ConnectorItem | null>(null);
  const [connectKeyInput, setConnectKeyInput] = useState<string>('');
  const [connectUrlInput, setConnectUrlInput] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string>('');

  // 新建自定义连接器弹窗
  const [isCustomModalOpen, setIsCustomModalOpen] = useState<boolean>(false);
  const [customForm, setCustomForm] = useState<{
    id: string;
    name: string;
    category: ConnectorCategory;
    transport: 'stdio' | 'sse' | 'http';
    command: string;
    args: string;
    url: string;
    env: string;
  }>({
    id: '',
    name: '',
    category: 'custom',
    transport: 'stdio',
    command: '',
    args: '',
    url: '',
    env: '',
  });
  const [isSubmittingCustom, setIsSubmittingCustom] = useState<boolean>(false);
  const [customError, setCustomError] = useState<string>('');

  // 断开确认
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null);

  const loadConnectors = useCallback(async () => {
    try {
      setLoadingConnectors(true);
      const res = await api.getConnectors();
      if (res && res.connectors) {
        setConnectors(res.connectors);
        if (activeConnectorDetail) {
          const updated = res.connectors.find((c) => c.id === activeConnectorDetail.id);
          if (updated) setActiveConnectorDetail(updated);
        }
      }
    } catch (err: any) {
      console.warn('加载连接器列表失败:', err);
    } finally {
      setLoadingConnectors(false);
    }
  }, [activeConnectorDetail]);

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

  useEffect(() => {
    if (isSettingsModalOpen && activeTab === 'connectors') {
      loadConnectors();
    }
  }, [isSettingsModalOpen, activeTab, loadConnectors]);

  const handleToggleTool = async (connectorId: string, toolName: string, currentEnabled: boolean) => {
    setConnectors((prev) =>
      prev.map((c) => {
        if (c.id !== connectorId) return c;
        return {
          ...c,
          tools: c.tools.map((t) => (t.name === toolName ? { ...t, enabled: !currentEnabled } : t))
        };
      })
    );
    if (activeConnectorDetail && activeConnectorDetail.id === connectorId) {
      setActiveConnectorDetail((prev) =>
        prev
          ? {
              ...prev,
              tools: prev.tools.map((t) => (t.name === toolName ? { ...t, enabled: !currentEnabled } : t))
            }
          : null
      );
    }
    try {
      await api.toggleConnectorTool(connectorId, toolName, !currentEnabled);
      showToast(`已${!currentEnabled ? '启用' : '禁用'}工具「${toolName}」`, 'info');
    } catch (err: any) {
      showToast(`工具状态切换失败: ${err.message}`, 'error');
      loadConnectors();
    }
  };

  const handleTestConnector = async (connectorId: string) => {
    setTestingId(connectorId);
    try {
      const res = await api.testConnector(connectorId);
      setTestResult((prev) => ({ ...prev, [connectorId]: res }));
      if (res.success) {
        showToast(`连通性测试通过 (${res.latencyMs}ms)`, 'success');
      } else {
        showToast(`连通性异常: ${res.message}`, 'warning');
      }
    } catch (err: any) {
      setTestResult((prev) => ({
        ...prev,
        [connectorId]: { success: false, latencyMs: 0, message: err.message }
      }));
      showToast(`测试请求失败: ${err.message}`, 'error');
    } finally {
      setTestingId(null);
    }
  };

  const handleOpenConnectModal = (target: ConnectorItem) => {
    setConnectTarget(target);
    setConnectKeyInput('');
    setConnectUrlInput(target.url || '');
    setConnectError('');
    setIsConnectModalOpen(true);
  };

  const handleSaveConnect = async () => {
    if (!connectTarget) return;
    setIsConnecting(true);
    setConnectError('');
    try {
      const res = await api.connectConnector({
        id: connectTarget.id,
        key: connectKeyInput.trim() || undefined,
        url: connectUrlInput.trim() || undefined
      });
      if (res.connector?.status === 'error') {
        const errMsg = res.connector.error || '验证未通过';
        setConnectError(errMsg);
        showToast(`连接校验未通过: ${errMsg}`, 'warning');
        await loadConnectors();
        return;
      }
      showToast(`连接器「${connectTarget.name}」配置接入成功！`, 'success');
      setIsConnectModalOpen(false);
      await loadConnectors();
    } catch (err: any) {
      setConnectError(err.message || '连接失败');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectConnector = async (connectorId: string) => {
    if (confirmDisconnectId !== connectorId) {
      setConfirmDisconnectId(connectorId);
      setTimeout(() => {
        setConfirmDisconnectId((prev) => (prev === connectorId ? null : prev));
      }, 5000);
      return;
    }
    setConfirmDisconnectId(null);
    try {
      await api.disconnectConnector(connectorId);
      showToast('已断开连接器', 'info');
      await loadConnectors();
      if (activeConnectorDetail && activeConnectorDetail.id === connectorId) {
        setActiveConnectorDetail((prev) => (prev ? { ...prev, status: 'disconnected' } : null));
      }
    } catch (err: any) {
      showToast(`断开连接失败: ${err.message}`, 'error');
    }
  };

  const handleCreateCustomConnector = async () => {
    if (!customForm.name.trim()) {
      setCustomError('请输入连接器名称');
      return;
    }
    if (customForm.transport === 'stdio' && !customForm.command.trim()) {
      setCustomError('命令行 stdio 模式必须填写启动命令');
      return;
    }
    if ((customForm.transport === 'http' || customForm.transport === 'sse') && !customForm.url.trim()) {
      setCustomError('HTTP / SSE 模式必须填写服务端点 URL');
      return;
    }

    setIsSubmittingCustom(true);
    setCustomError('');

    const genId = customForm.id.trim() || `mcp_${Date.now()}`;
    let envObj: Record<string, string> | undefined;
    if (customForm.env.trim()) {
      try {
        envObj = JSON.parse(customForm.env.trim());
      } catch {
        envObj = {};
        for (const line of customForm.env.split('\n')) {
          const [k, ...v] = line.split('=');
          if (k && v.length) envObj[k.trim()] = v.join('=').trim();
        }
      }
    }

    try {
      await api.connectConnector({
        id: genId,
        label: customForm.name.trim(),
        category: customForm.category,
        command: customForm.transport === 'stdio' ? customForm.command.trim() : undefined,
        args: customForm.args ? customForm.args.split(/\s+/).filter(Boolean) : undefined,
        url: customForm.transport !== 'stdio' ? customForm.url.trim() : undefined,
        env: envObj
      });
      showToast(`自定义连接器「${customForm.name}」已添加！`, 'success');
      setIsCustomModalOpen(false);
      setCustomForm({
        id: '',
        name: '',
        category: 'custom',
        transport: 'stdio',
        command: '',
        args: '',
        url: '',
        env: ''
      });
      await loadConnectors();
    } catch (err: any) {
      setCustomError(err.message || '添加自定义连接器失败');
    } finally {
      setIsSubmittingCustom(false);
    }
  };

  const handleDeleteCustomConnector = async (connectorId: string) => {
    try {
      await api.deleteConnector(connectorId);
      showToast('已删除自定义连接器', 'info');
      if (activeConnectorDetail && activeConnectorDetail.id === connectorId) {
        setActiveConnectorDetail(null);
      }
      await loadConnectors();
    } catch (err: any) {
      showToast(`删除连接器失败: ${err.message}`, 'error');
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
            {activeTab === 'connectors' && (
              <div className="settings-pane-wrap">
                {activeConnectorDetail ? (
                  /* 详情与细粒度工具管控视图 */
                  <div className="connector-detail-wrap">
                    <button
                      type="button"
                      className="connector-back-btn"
                      onClick={() => setActiveConnectorDetail(null)}
                    >
                      <ArrowLeft size={16} /> 返回连接器列表
                    </button>

                    <div className="connector-hero-card">
                      <div className="connector-hero-top">
                        <div className="connector-hero-avatar">
                          {renderConnectorIcon(activeConnectorDetail, 28)}
                        </div>
                        <div className="connector-hero-info">
                          <div className="connector-hero-title-row">
                            <h3 className="connector-hero-title">{activeConnectorDetail.name}</h3>
                            <span className="connector-category-tag">
                              {CONNECTOR_CATEGORIES.find((cat) => cat.id === activeConnectorDetail.category)?.label ||
                                activeConnectorDetail.category}
                            </span>
                            <span
                              className={`connector-status-badge ${
                                activeConnectorDetail.status === 'connected'
                                  ? 'status-connected'
                                  : activeConnectorDetail.status === 'error'
                                  ? 'status-error'
                                  : 'status-disconnected'
                              }`}
                            >
                              {activeConnectorDetail.status === 'connected' ? (
                                <>
                                  <CheckCircle2 size={12} /> 已连接就绪
                                </>
                              ) : activeConnectorDetail.status === 'error' ? (
                                <>
                                  <AlertCircle size={12} /> 连接异常
                                </>
                              ) : (
                                '未连接'
                              )}
                            </span>
                          </div>
                          <p className="connector-hero-desc">{activeConnectorDetail.description}</p>
                          <div className="connector-hero-endpoints">
                            {activeConnectorDetail.url && (
                              <span className="connector-endpoint-code">端点: {activeConnectorDetail.url}</span>
                            )}
                            {activeConnectorDetail.command && (
                              <span className="connector-endpoint-code">命令: {activeConnectorDetail.command}</span>
                            )}
                            {activeConnectorDetail.docs && (
                              <a
                                href={activeConnectorDetail.docs}
                                target="_blank"
                                rel="noreferrer"
                                className="connector-back-btn"
                              >
                                查阅官方文档 <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="connector-hero-actions">
                        <button
                          type="button"
                          className="connector-action-btn"
                          disabled={testingId === activeConnectorDetail.id}
                          onClick={() => handleTestConnector(activeConnectorDetail.id)}
                        >
                          {testingId === activeConnectorDetail.id ? (
                            <>
                              <Loader2 size={13} className="spin" /> 测试中...
                            </>
                          ) : (
                            <>
                              <Activity size={13} /> 测试连通性
                            </>
                          )}
                        </button>

                        {activeConnectorDetail.status === 'connected' && activeConnectorDetail.category !== 'builtin' && (
                          <>
                            <button
                              type="button"
                              className="connector-action-btn"
                              onClick={() => handleOpenConnectModal(activeConnectorDetail)}
                            >
                              <Settings size={13} /> 重新配置认证
                            </button>
                            <button
                              type="button"
                              className={`connector-action-btn ${
                                confirmDisconnectId === activeConnectorDetail.id ? 'btn-danger' : ''
                              }`}
                              onClick={() => handleDisconnectConnector(activeConnectorDetail.id)}
                            >
                              {confirmDisconnectId === activeConnectorDetail.id ? '确认断开连接？' : '断开连接'}
                            </button>
                          </>
                        )}

                        {activeConnectorDetail.status !== 'connected' && (
                          <button
                            type="button"
                            className="connector-btn-sm btn-primary"
                            onClick={() => handleOpenConnectModal(activeConnectorDetail)}
                          >
                            立即连接接入
                          </button>
                        )}

                        {activeConnectorDetail.category === 'custom' && (
                          <button
                            type="button"
                            className="connector-action-btn btn-danger"
                            onClick={() => handleDeleteCustomConnector(activeConnectorDetail.id)}
                          >
                            <Trash2 size={13} /> 删除自定义连接器
                          </button>
                        )}

                        {testResult[activeConnectorDetail.id] && (
                          <span
                            className={`connector-count-pill ${
                              testResult[activeConnectorDetail.id].success ? 'status-connected' : 'status-error'
                            }`}
                          >
                            {testResult[activeConnectorDetail.id].message}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 挂载工具能力细粒度管控 */}
                    <div className="connector-tools-container">
                      <div className="connector-tools-header">
                        <div className="connector-section-title">
                          挂载工具能力 (
                          {activeConnectorDetail.tools.filter((t) => t.enabled).length} /{' '}
                          {activeConnectorDetail.tools.length} 已启用)
                        </div>
                        <span className="connector-form-hint">
                          关闭的工具在 Agent 执行上下文不可见，避免高危或非必要操作
                        </span>
                      </div>

                      <div className="connector-tools-card">
                        {activeConnectorDetail.tools.length > 0 ? (
                          activeConnectorDetail.tools.map((tool) => (
                            <div key={tool.name} className="connector-tool-row">
                              <div className="connector-tool-left">
                                <div className="connector-tool-name">{tool.name}</div>
                                <div className="connector-tool-desc">{tool.description}</div>
                              </div>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={tool.enabled}
                                className={`connector-switch ${tool.enabled ? 'is-checked' : ''}`}
                                onClick={() =>
                                  handleToggleTool(activeConnectorDetail.id, tool.name, tool.enabled)
                                }
                                title={tool.enabled ? '点击禁用该工具' : '点击启用该工具'}
                              >
                                <span className="connector-switch-thumb" />
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="connector-tool-row">
                            <span className="connector-form-hint">当前连接器尚未向运行时暴露任何工具</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 安全策略卡片 */}
                    <div className="settings-card">
                      <div className="settings-toggle-row">
                        <div className="settings-card-icon-title">
                          <ShieldCheck size={18} className="settings-icon-blue" />
                          <div>
                            <div className="settings-toggle-title">安全隔离与受控防护</div>
                            <div className="settings-toggle-desc">
                              连接器凭据均经硬件安全库隔离加密存储；工具执行严格受 Sentinel 审计拦截保障。
                            </div>
                          </div>
                        </div>
                        <span className="settings-badge-green">企业安全策略生效中</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* 连接器目录主页视图 */
                  <div className="connector-container">
                    {/* 顶部搜索与操作栏 */}
                    <div className="connector-toolbar">
                      <div className="connector-search-wrap">
                        <Search size={15} className="connector-search-icon" />
                        <input
                          type="search"
                          placeholder="搜索连接器名称、分类、描述或挂载工具..."
                          className="connector-search-input"
                          value={connectorSearch}
                          onChange={(e) => setConnectorSearch(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="connector-add-btn"
                        onClick={() => setIsCustomModalOpen(true)}
                      >
                        <Plus size={15} /> 新增自定义 MCP
                      </button>
                    </div>

                    {/* 分类过滤器 */}
                    <div className="connector-chips-wrap">
                      {CONNECTOR_CATEGORIES.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          className={`connector-filter-chip ${connectorCategory === cat.id ? 'is-active' : ''}`}
                          onClick={() => setConnectorCategory(cat.id)}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>

                    {/* 运行时指标状态条 */}
                    <div className="connector-metrics-card">
                      <div className="connector-metrics-stats">
                        <div className="connector-metrics-item">
                          <span>已接入连接器:</span>
                          <span className="connector-metrics-num">
                            {connectors.filter((c) => c.status === 'connected').length}
                          </span>
                        </div>
                        <div className="connector-metrics-item">
                          <span>挂载活跃工具:</span>
                          <span className="connector-metrics-num">
                            {connectors.reduce(
                              (sum, c) => sum + c.tools.filter((t) => t.enabled).length,
                              0
                            )}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="connector-back-btn"
                        onClick={() => loadConnectors()}
                        title="刷新连接器状态"
                      >
                        <RefreshCw size={13} className={loadingConnectors ? 'spin' : ''} /> 刷新
                      </button>
                    </div>

                    {/* 已连接与常驻能力列表 */}
                    {(() => {
                      const q = connectorSearch.trim().toLowerCase();
                      const filtered = connectors.filter((c) => {
                        const matchesQuery =
                          !q ||
                          c.name.toLowerCase().includes(q) ||
                          c.description.toLowerCase().includes(q) ||
                          c.id.toLowerCase().includes(q) ||
                          c.tools.some(
                            (t) =>
                              t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
                          );
                        const matchesCat = connectorCategory === 'all' || c.category === connectorCategory;
                        return matchesQuery && matchesCat;
                      });

                      const connectedList = filtered.filter((c) => c.status === 'connected');
                      const availableList = filtered.filter((c) => c.status !== 'connected');

                      return (
                        <>
                          {connectedList.length > 0 && (
                            <div className="connector-section">
                              <div className="connector-section-header">
                                <div className="connector-section-title">
                                  <span>已接入与活跃连接器</span>
                                  <span className="connector-count-pill">{connectedList.length}</span>
                                </div>
                              </div>
                              <div className="connector-grid">
                                {connectedList.map((item) => (
                                  <div key={item.id} className="connector-card">
                                    <div className="connector-card-top">
                                      <div className="connector-avatar-icon">
                                        {renderConnectorIcon(item, 20)}
                                      </div>
                                      <div className="connector-info">
                                        <div className="connector-title-row">
                                          <span className="connector-name">{item.name}</span>
                                          <span className="connector-category-tag">
                                            {CONNECTOR_CATEGORIES.find((cat) => cat.id === item.category)?.label ||
                                              item.category}
                                          </span>
                                        </div>
                                        <p className="connector-description">{item.description}</p>
                                      </div>
                                    </div>
                                    <div className="connector-card-bottom">
                                      <div className="connector-meta-tags">
                                        <span className="connector-status-badge status-connected">
                                          <CheckCircle2 size={11} /> 运行中
                                        </span>
                                        <span className="connector-tool-count-pill">
                                          {item.tools.filter((t) => t.enabled).length} 个工具
                                        </span>
                                      </div>
                                      <div className="connector-card-actions">
                                        <button
                                          type="button"
                                          className="connector-btn-sm"
                                          onClick={() => setActiveConnectorDetail(item)}
                                        >
                                          管理配置
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 可接入生态目录列表 */}
                          {availableList.length > 0 && (
                            <div className="connector-section">
                              <div className="connector-section-header">
                                <div className="connector-section-title">
                                  <span>可接入生态服务连接器</span>
                                  <span className="connector-count-pill">{availableList.length}</span>
                                </div>
                              </div>
                              <div className="connector-grid">
                                {availableList.map((item) => (
                                  <div key={item.id} className="connector-card">
                                    <div className="connector-card-top">
                                      <div className="connector-avatar-icon">
                                        {renderConnectorIcon(item, 20)}
                                      </div>
                                      <div className="connector-info">
                                        <div className="connector-title-row">
                                          <span className="connector-name">{item.name}</span>
                                          <span className="connector-category-tag">
                                            {CONNECTOR_CATEGORIES.find((cat) => cat.id === item.category)?.label ||
                                              item.category}
                                          </span>
                                        </div>
                                        <p className="connector-description">{item.description}</p>
                                      </div>
                                    </div>
                                    <div className="connector-card-bottom">
                                      <div className="connector-meta-tags">
                                        <span className="connector-status-badge status-disconnected">
                                          {item.authType === 'oauth'
                                            ? 'OAuth 2.0'
                                            : item.authType === 'key'
                                            ? 'API 密钥'
                                            : '免密钥开放'}
                                        </span>
                                        <span className="connector-tool-count-pill">
                                          {item.tools.length} 个工具
                                        </span>
                                      </div>
                                      <div className="connector-card-actions">
                                        <button
                                          type="button"
                                          className="connector-btn-sm"
                                          onClick={() => setActiveConnectorDetail(item)}
                                        >
                                          详情
                                        </button>
                                        <button
                                          type="button"
                                          className="connector-btn-sm btn-primary"
                                          onClick={() => handleOpenConnectModal(item)}
                                        >
                                          连接
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {filtered.length === 0 && (
                            <div className="settings-card">
                              <div className="connector-hero-desc">
                                未匹配到符合条件的连接器。您可以尝试更换筛选条件或点击右上角新增自定义 MCP 连接器。
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

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

      {/* 连接认证配置弹窗 */}
      {isConnectModalOpen && connectTarget && (
        <div className="connector-dialog-overlay" onClick={() => setIsConnectModalOpen(false)}>
          <div className="connector-dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="connector-dialog-header">
              <h4 className="connector-dialog-title">连接接入 · {connectTarget.name}</h4>
              <button
                type="button"
                className="connector-dialog-close"
                onClick={() => setIsConnectModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="connector-dialog-body">
              <div className="connector-hero-desc">{connectTarget.description}</div>

              {(connectTarget.authType === 'key' || connectTarget.authType === 'oauth') && (
                <div className="connector-form-field">
                  <label className="connector-form-label">
                    {connectTarget.authType === 'key' ? 'API 密钥 / Webhook URL / 访问凭据' : 'OAuth 访问令牌 / Token (支持直接填入)'}
                  </label>
                  <input
                    type="password"
                    placeholder={
                      connectTarget.id === 'discord'
                        ? '输入 Discord Bot Token 或频道 Webhook URL...'
                        : '输入访问密钥、Access Token 或 Webhook URL...'
                    }
                    className="connector-form-input"
                    value={connectKeyInput}
                    onChange={(e) => setConnectKeyInput(e.target.value)}
                  />
                  {connectTarget.keyHint ? (
                    <p className="connector-form-hint">获取指引: {connectTarget.keyHint}</p>
                  ) : connectTarget.authType === 'oauth' ? (
                    <p className="connector-form-hint">支持填入该平台 Personal Access Token、Bot Token 或 Webhook 直连</p>
                  ) : null}
                </div>
              )}

              {connectTarget.authType === 'none' && (
                <div className="settings-card">
                  <div className="connector-form-hint">
                    该服务为开放式 MCP 协议端点，无需凭据鉴权即可直接挂载使用。
                  </div>
                </div>
              )}

              {connectTarget.url && (
                <div className="connector-form-field">
                  <label className="connector-form-label">服务通信端点 URL</label>
                  <input
                    type="text"
                    className="connector-form-input"
                    value={connectUrlInput}
                    onChange={(e) => setConnectUrlInput(e.target.value)}
                  />
                </div>
              )}

              {connectError && (
                <div className="connector-error-alert">
                  <AlertCircle size={14} />
                  <span>{connectError}</span>
                </div>
              )}
            </div>
            <div className="connector-dialog-footer">
              <button
                type="button"
                className="connector-action-btn"
                onClick={() => setIsConnectModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="connector-btn-sm btn-primary"
                disabled={isConnecting}
                onClick={handleSaveConnect}
              >
                {isConnecting ? (
                  <>
                    <Loader2 size={13} className="spin" /> 正在连接...
                  </>
                ) : (
                  '确认并连接'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增自定义 MCP 连接器弹窗 */}
      {isCustomModalOpen && (
        <div className="connector-dialog-overlay" onClick={() => setIsCustomModalOpen(false)}>
          <div className="connector-dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="connector-dialog-header">
              <h4 className="connector-dialog-title">新增自定义 MCP 连接器</h4>
              <button
                type="button"
                className="connector-dialog-close"
                onClick={() => setIsCustomModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="connector-dialog-body">
              <div className="connector-form-field">
                <label className="connector-form-label">连接器名称</label>
                <input
                  type="text"
                  placeholder="例如: 本地 Postgres MCP 服务"
                  className="connector-form-input"
                  value={customForm.name}
                  onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                />
              </div>

              <div className="connector-form-field">
                <label className="connector-form-label">业务分类</label>
                <select
                  className="connector-form-select"
                  value={customForm.category}
                  onChange={(e) =>
                    setCustomForm({ ...customForm, category: e.target.value as ConnectorCategory })
                  }
                >
                  <option value="dev">代码研发 (dev)</option>
                  <option value="data">数据存储 (data)</option>
                  <option value="work">办公协同 (work)</option>
                  <option value="search">网页检索 (search)</option>
                  <option value="talk">通讯协同 (talk)</option>
                  <option value="custom">通用自定义 (custom)</option>
                </select>
              </div>

              <div className="connector-form-field">
                <label className="connector-form-label">传输协议 (Transport)</label>
                <select
                  className="connector-form-select"
                  value={customForm.transport}
                  onChange={(e) =>
                    setCustomForm({
                      ...customForm,
                      transport: e.target.value as 'stdio' | 'sse' | 'http'
                    })
                  }
                >
                  <option value="stdio">Stdio 命令行子进程 (推荐)</option>
                  <option value="http">Streamable HTTP 端点</option>
                  <option value="sse">Server-Sent Events (SSE) 协议</option>
                </select>
              </div>

              {customForm.transport === 'stdio' ? (
                <>
                  <div className="connector-form-field">
                    <label className="connector-form-label">启动命令 (Command)</label>
                    <input
                      type="text"
                      placeholder="例如: npx, uvx, node 或 python3"
                      className="connector-form-input"
                      value={customForm.command}
                      onChange={(e) => setCustomForm({ ...customForm, command: e.target.value })}
                    />
                  </div>
                  <div className="connector-form-field">
                    <label className="connector-form-label">命令参数 (Arguments)</label>
                    <input
                      type="text"
                      placeholder="以空格分隔的参数，例如: -y @modelcontextprotocol/server-filesystem /tmp"
                      className="connector-form-input"
                      value={customForm.args}
                      onChange={(e) => setCustomForm({ ...customForm, args: e.target.value })}
                    />
                  </div>
                </>
              ) : (
                <div className="connector-form-field">
                  <label className="connector-form-label">服务端点 URL</label>
                  <input
                    type="url"
                    placeholder="例如: https://mcp.internal.net/mcp"
                    className="connector-form-input"
                    value={customForm.url}
                    onChange={(e) => setCustomForm({ ...customForm, url: e.target.value })}
                  />
                </div>
              )}

              <div className="connector-form-field">
                <label className="connector-form-label">自定义环境变量 (可选)</label>
                <textarea
                  placeholder="KEY=VALUE 或 JSON 格式"
                  className="connector-form-textarea"
                  value={customForm.env}
                  onChange={(e) => setCustomForm({ ...customForm, env: e.target.value })}
                />
              </div>

              {customError && (
                <div className="connector-error-alert">
                  <AlertCircle size={14} />
                  <span>{customError}</span>
                </div>
              )}
            </div>
            <div className="connector-dialog-footer">
              <button
                type="button"
                className="connector-action-btn"
                onClick={() => setIsCustomModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="connector-btn-sm btn-primary"
                disabled={isSubmittingCustom}
                onClick={handleCreateCustomConnector}
              >
                {isSubmittingCustom ? (
                  <>
                    <Loader2 size={13} className="spin" /> 正在验证...
                  </>
                ) : (
                  '验证并添加'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
