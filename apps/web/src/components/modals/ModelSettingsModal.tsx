import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { ProviderIcon } from '../../utils/icons';
import { copyToClipboard } from '../../utils/clipboard';
import {
  Cpu,
  Laptop,
  AlertCircle,
  Palette,
  RefreshCw,
  CheckCircle2,
  KeyRound,
  Terminal,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Copy,
  Cloud,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../../services/api';
import type { ModelProvider } from '../../types';

type ProviderScopeTab = 'local' | 'cloud';

function isLocalProvider(p: ModelProvider): boolean {
  return Boolean(
    p.isLocalAgent ||
      p.category === 'local_agent' ||
      p.category === 'intranet_agent' ||
      ['claude', 'codex', 'pi', 'dsh', 'ollama', 'ducc', 'ducx'].includes(p.id)
  );
}

function isIntranetProvider(p: ModelProvider): boolean {
  return p.category === 'intranet_agent' || p.id === 'ducc' || p.id === 'ducx';
}

function getProviderBadgeInfo(
  p: ModelProvider,
  isActive: boolean
): { text: string; tone: 'active' | 'ready' | 'warning' | 'muted' } {
  if (isActive) {
    return { text: '使用中', tone: 'active' };
  }
  if (isLocalProvider(p)) {
    if (p.status === 'ready' || (p.installed && p.isAvailable !== false && p.status !== 'unauthenticated')) {
      return { text: p.source === 'remote' ? '远程就绪' : '已就绪', tone: 'ready' };
    }
    if (p.status === 'unauthenticated') {
      return { text: '需认证', tone: 'warning' };
    }
    if (p.installed && p.isAvailable === false) {
      return { text: '未运行', tone: 'warning' };
    }
    return { text: '未检测到', tone: 'muted' };
  }
  if (p.hasKey || p.apiKey || p.isAvailable) {
    return { text: '已就绪', tone: 'ready' };
  }
  return { text: '待配置', tone: 'muted' };
}

function getStatusPillText(p: ModelProvider, isLocal: boolean): { text: string; tone: 'ready' | 'warning' | 'muted' } {
  if (!isLocal) {
    return p.hasKey || p.apiKey || p.isAvailable
      ? { text: '凭证已就绪', tone: 'ready' }
      : { text: '待配置 Key', tone: 'muted' };
  }
  if (p.status === 'ready' || (p.installed && p.isAvailable !== false && p.status !== 'unauthenticated')) {
    return {
      text: p.source === 'remote' ? `远程节点就绪 (${p.machineName || 'Node'})` : '本地环境就绪',
      tone: 'ready',
    };
  }
  if (p.status === 'unauthenticated') {
    return { text: '已安装 · 待认证', tone: 'warning' };
  }
  if (p.installed && p.isAvailable === false) {
    return { text: '已安装 · 服务未启动', tone: 'warning' };
  }
  return { text: '未检测到', tone: 'muted' };
}

export const ModelSettingsModal: React.FC = () => {
  const {
    isModelModalOpen,
    setIsModelModalOpen,
    setIsImageModelModalOpen,
    setIsAddMachineModalOpen,
    modelsConfig,
    loadModelsConfig,
    showToast,
  } = useApp();

  const [scopeTab, setScopeTab] = useState<ProviderScopeTab>('local');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('claude');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [binaryPath, setBinaryPath] = useState('');
  const [configDir, setConfigDir] = useState('');
  const [cwd, setCwd] = useState('');
  const [extraArgs, setExtraArgs] = useState('');
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [newCustomModel, setNewCustomModel] = useState('');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showIntranet, setShowIntranet] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latency?: number;
    version?: string;
    authLabel?: string;
    replyPreview?: string;
    message?: string;
  } | null>(null);

  const syncFormFromProvider = (p: ModelProvider) => {
    setSelectedProviderId(p.id);
    setModelId(p.model || p.modelId || p.candidateModels?.[0] || p.supportedModels?.[0] || '');
    setApiKey('');
    setClearApiKey(false);
    const rawEndpoint = p.baseUrl || p.endpoint || '';
    setEndpoint(rawEndpoint.startsWith('local://') ? '' : rawEndpoint);
    setBinaryPath(p.binaryPath || '');
    setConfigDir(p.configDir || '');
    setCwd(p.cwd || '');
    setExtraArgs(p.extraArgs || '');
    setCustomModels(p.customModels || []);
    setNewCustomModel('');
    setTestResult(null);
  };

  useEffect(() => {
    if (!modelsConfig) return;
    const currentStillExists = modelsConfig.providers.find((p) => p.id === selectedProviderId);
    const activeId = modelsConfig.activeProviderId || 'claude';
    const target =
      (isModelModalOpen && currentStillExists ? currentStillExists : undefined) ||
      modelsConfig.providers.find((p) => p.id === activeId) ||
      modelsConfig.providers[0];
    if (target) {
      syncFormFromProvider(target);
      setScopeTab(isLocalProvider(target) ? 'local' : 'cloud');
      const hasAnyIntranetReady = modelsConfig.providers.some(
        (p) => isIntranetProvider(p) && (p.installed || p.id === activeId)
      );
      setShowIntranet(hasAnyIntranetReady);
    }
  }, [modelsConfig, isModelModalOpen]);

  const providers = modelsConfig?.providers || [];
  const localProviders = useMemo(
    () => providers.filter((p) => isLocalProvider(p) && !isIntranetProvider(p)),
    [providers]
  );
  const intranetProviders = useMemo(
    () => providers.filter((p) => isIntranetProvider(p)),
    [providers]
  );
  const cloudProviders = useMemo(
    () => providers.filter((p) => !isLocalProvider(p)),
    [providers]
  );

  const readyLocalCount = useMemo(
    () =>
      providers.filter(
        (p) =>
          isLocalProvider(p) &&
          (p.status === 'ready' || (p.installed && p.isAvailable !== false && p.status !== 'unauthenticated'))
      ).length,
    [providers]
  );

  const currentProvider: ModelProvider = useMemo(
    () =>
      providers.find((p) => p.id === selectedProviderId) || {
        id: selectedProviderId,
        name: selectedProviderId,
        description: 'AI 交互推理引擎',
        candidateModels: ['default'],
      },
    [providers, selectedProviderId]
  );

  const isLocalAgent = isLocalProvider(currentProvider);
  const isClaude = currentProvider.id === 'claude';
  const isOllama = currentProvider.id === 'ollama';

  const candidateModels = useMemo(() => {
    const base =
      currentProvider.candidateModels && currentProvider.candidateModels.length > 0
        ? currentProvider.candidateModels
        : currentProvider.supportedModels && currentProvider.supportedModels.length > 0
          ? currentProvider.supportedModels
          : [];
    return Array.from(new Set([...base, ...customModels, ...(modelId ? [modelId] : [])])).filter(Boolean);
  }, [currentProvider, customModels, modelId]);

  const handleSelectScope = (nextScope: ProviderScopeTab) => {
    setScopeTab(nextScope);
    const targetList = nextScope === 'local' ? [...localProviders, ...intranetProviders] : cloudProviders;
    if (targetList.length > 0 && !targetList.some((p) => p.id === selectedProviderId)) {
      const activeInScope = targetList.find((p) => p.id === modelsConfig?.activeProviderId);
      const readyInScope = targetList.find((p) => p.status === 'ready' || p.hasKey);
      syncFormFromProvider(activeInScope || readyInScope || targetList[0]);
    }
  };

  const handleRefreshProbe = async () => {
    setIsRefreshing(true);
    try {
      await loadModelsConfig(true);
      showToast('已刷新本机与远程节点运行时状态', 'success');
    } catch (err: any) {
      showToast(`刷新失败: ${err.message}`, 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddCustomModel = () => {
    const slug = newCustomModel.trim();
    if (!slug) return;
    if (!customModels.includes(slug)) {
      setCustomModels((prev) => [...prev, slug]);
    }
    setModelId(slug);
    setNewCustomModel('');
  };

  const handleRemoveCustomModel = (slug: string) => {
    setCustomModels((prev) => prev.filter((m) => m !== slug));
    if (modelId === slug) {
      const remaining = candidateModels.filter((m) => m !== slug);
      setModelId(remaining[0] || '');
    }
  };

  const handleCopyCommand = async (cmd: string, label: string) => {
    const ok = await copyToClipboard(cmd);
    if (ok) {
      showToast(`已复制 ${label}`, 'success');
    } else {
      showToast('复制失败，请手动选中命令文本复制', 'info');
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testModel(currentProvider.id, modelId, {
        baseUrl: isClaude || isOllama || !isLocalAgent ? endpoint.trim() : currentProvider.baseUrl,
        apiKey: clearApiKey ? '' : apiKey.trim() || undefined,
        binaryPath: binaryPath.trim() || undefined,
        configDir: configDir.trim() || undefined,
        cwd: cwd.trim() || undefined,
        extraArgs: extraArgs.trim() || undefined,
      });
      const isOk = Boolean(res.success || res.ok);
      const latency = res.latency ?? res.latencyMs ?? 0;
      const message = res.message || res.error || (isOk ? '连通性验证通过' : '连接超时或未响应');
      setTestResult({
        success: isOk,
        latency,
        version: res.version,
        authLabel: res.auth?.label,
        replyPreview: res.replyPreview,
        message,
      });
      if (isOk) {
        showToast(`连通性测试成功 (${latency}ms)`, 'success');
      } else {
        showToast(`测试未通过: ${message}`, 'error');
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
      showToast(`测试失败: ${err.message}`, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!modelsConfig) return;
    setSaving(true);
    try {
      const resolvedBaseUrl = isClaude || isOllama || !isLocalAgent ? endpoint.trim() : currentProvider.baseUrl;
      await api.saveModelsConfig({
        activeProviderId: selectedProviderId,
        provider: {
          id: selectedProviderId,
          model: modelId.trim(),
          baseUrl: resolvedBaseUrl,
          apiKey: apiKey.trim() || undefined,
          clearApiKey: clearApiKey || undefined,
          binaryPath: binaryPath.trim() || undefined,
          configDir: configDir.trim() || undefined,
          cwd: cwd.trim() || undefined,
          extraArgs: extraArgs.trim() || undefined,
          customModels,
        },
      });

      await loadModelsConfig(true);
      showToast(`已成功将 ${currentProvider.name} 设为全局激活引擎`, 'success');
      setIsModelModalOpen(false);
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const isCurrentActive = selectedProviderId === modelsConfig?.activeProviderId;
  const statusPill = getStatusPillText(currentProvider, isLocalAgent);
  const hasSavedKey = Boolean(
    !clearApiKey && (isClaude ? currentProvider.maskedKey?.includes('••••') : currentProvider.hasKey)
  );

  return (
    <Modal
      isOpen={isModelModalOpen}
      onClose={() => setIsModelModalOpen(false)}
      title="AI 引擎与本地 Agent 配置中心"
      icon={<Cpu size={18} />}
      maxWidth="920px"
      zIndex={1000}
    >
      {/* 顶部模式切换与操作栏 */}
      <div className="model-center-topbar">
        <div className="model-center-tabs" role="tablist" aria-label="引擎类别">
          <button
            type="button"
            role="tab"
            aria-selected={scopeTab === 'local'}
            className={`model-center-tab ${scopeTab === 'local' ? 'is-active' : ''}`}
            onClick={() => handleSelectScope('local')}
          >
            <Terminal size={14} />
            <span>本地 Agent</span>
            <span className="model-center-tab-count">{readyLocalCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scopeTab === 'cloud'}
            className={`model-center-tab ${scopeTab === 'cloud' ? 'is-active' : ''}`}
            onClick={() => handleSelectScope('cloud')}
          >
            <Cloud size={14} />
            <span>云端 API</span>
          </button>
          <button
            type="button"
            className="model-center-tab"
            onClick={() => {
              setIsModelModalOpen(false);
              setIsImageModelModalOpen(true);
            }}
          >
            <Palette size={14} />
            <span>图像模型</span>
          </button>
        </div>

        <div className="model-center-top-actions">
          <button
            type="button"
            className="btn-secondary model-top-action-btn"
            onClick={handleRefreshProbe}
            disabled={isRefreshing}
            title="重新探测本机 CLI 与远程计算节点"
          >
            <RefreshCw size={13} className={isRefreshing ? 'model-spin-icon' : ''} />
            <span>{isRefreshing ? '探测中...' : '刷新探测'}</span>
          </button>
          <button
            type="button"
            className="btn-secondary model-top-action-btn"
            onClick={() => {
              setIsModelModalOpen(false);
              setIsAddMachineModalOpen(true);
            }}
          >
            <Laptop size={13} />
            <span>接入个人电脑</span>
          </button>
        </div>
      </div>

      {/* 主从两栏配置工作区 */}
      <div className="model-center-layout">
        {/* 左侧供应商轨道 */}
        <aside className="model-provider-rail" aria-label="可选模型引擎列表">
          {scopeTab === 'local' ? (
            <>
              <div className="model-rail-section-title">通用本地编码 Agent</div>
              <div className="model-rail-list">
                {localProviders.map((p) => {
                  const isSelected = p.id === selectedProviderId;
                  const isActive = p.id === modelsConfig?.activeProviderId;
                  const badge = getProviderBadgeInfo(p, isActive);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`model-rail-item ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => syncFormFromProvider(p)}
                    >
                      <span className="model-rail-item-icon">
                        <ProviderIcon providerId={p.id} size={20} />
                      </span>
                      <span className="model-rail-item-meta">
                        <span className="model-rail-item-name">{p.name}</span>
                        <span className="model-rail-item-sub">
                          {p.version ? p.version.split(' ')[0] : p.protocol || 'local'}
                        </span>
                      </span>
                      <span className={`model-rail-badge tone-${badge.tone}`}>{badge.text}</span>
                    </button>
                  );
                })}
              </div>

              {intranetProviders.length > 0 && (
                <div className="model-rail-intranet-group">
                  <button
                    type="button"
                    className="model-rail-collapse-btn"
                    onClick={() => setShowIntranet((v) => !v)}
                  >
                    {showIntranet ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span>企业内网 Agent ({intranetProviders.length})</span>
                  </button>
                  {showIntranet && (
                    <div className="model-rail-list">
                      {intranetProviders.map((p) => {
                        const isSelected = p.id === selectedProviderId;
                        const isActive = p.id === modelsConfig?.activeProviderId;
                        const badge = getProviderBadgeInfo(p, isActive);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            className={`model-rail-item ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => syncFormFromProvider(p)}
                          >
                            <span className="model-rail-item-icon">
                              <ProviderIcon providerId={p.id} size={20} />
                            </span>
                            <span className="model-rail-item-meta">
                              <span className="model-rail-item-name">{p.name}</span>
                              <span className="model-rail-item-sub">{p.version || 'intranet'}</span>
                            </span>
                            <span className={`model-rail-badge tone-${badge.tone}`}>{badge.text}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="model-rail-section-title">云端与自建网关</div>
              <div className="model-rail-list">
                {cloudProviders.map((p) => {
                  const isSelected = p.id === selectedProviderId;
                  const isActive = p.id === modelsConfig?.activeProviderId;
                  const badge = getProviderBadgeInfo(p, isActive);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`model-rail-item ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => syncFormFromProvider(p)}
                    >
                      <span className="model-rail-item-icon">
                        <ProviderIcon providerId={p.id} size={20} />
                      </span>
                      <span className="model-rail-item-meta">
                        <span className="model-rail-item-name">{p.name}</span>
                        <span className="model-rail-item-sub">{p.model || 'OpenAI Compatible'}</span>
                      </span>
                      <span className={`model-rail-badge tone-${badge.tone}`}>{badge.text}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        {/* 右侧详细配置区 */}
        <div className="model-detail-pane">
          {/* 头部状态卡片 */}
          <div className="model-detail-header-card">
            <div className="model-detail-header-top">
              <div className="model-config-title-group">
                <ProviderIcon providerId={currentProvider.id} size={24} />
                <div>
                  <div className="model-config-title">{currentProvider.name}</div>
                  <div className="model-detail-subtitle">
                    {currentProvider.description || 'AI 交互推理服务'}
                  </div>
                </div>
              </div>
              <span className={`model-status-pill tone-${statusPill.tone}`}>
                {statusPill.text}
              </span>
            </div>

            {isLocalAgent && (
              <div className="model-meta-grid">
                <div className="model-meta-cell">
                  <span className="model-meta-label">版本</span>
                  <span className="model-meta-value">
                    {currentProvider.version || currentProvider.detectedVersion || '未探测到'}
                  </span>
                </div>
                <div className="model-meta-cell">
                  <span className="model-meta-label">认证状态</span>
                  <span className="model-meta-value">
                    {currentProvider.auth?.label ||
                      (currentProvider.isAvailable ? '就绪可用' : '未就绪')}
                    {currentProvider.auth?.email ? ` (${currentProvider.auth.email})` : ''}
                  </span>
                </div>
                <div className="model-meta-cell model-meta-cell-wide">
                  <span className="model-meta-label">可执行路径 / 来源</span>
                  <span className="model-meta-value model-meta-mono">
                    {currentProvider.executablePath ||
                      currentProvider.cliPath ||
                      (currentProvider.source === 'remote'
                        ? `远程计算节点 (${currentProvider.machineName || 'Node'})`
                        : '未在系统 PATH 中发现')}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 引导横幅：未安装或待认证 */}
          {isLocalAgent && currentProvider.status === 'unauthenticated' && (
            <div className="model-guidance-box is-warning">
              <ShieldAlert size={16} className="model-guidance-icon" />
              <div className="model-guidance-body">
                <div className="model-guidance-title">检测到 {currentProvider.name}，但尚未完成认证</div>
                <div className="model-guidance-desc">
                  你可以直接在个人终端运行登录命令，或在下方填写自定义 Anthropic 兼容 Base URL 与 API Key 立即启用：
                </div>
                {isClaude && (
                  <div className="model-guidance-cmd-row">
                    <code>claude auth login</code>
                    <button
                      type="button"
                      className="btn-secondary model-mini-copy-btn"
                      onClick={() => handleCopyCommand('claude auth login', '登录命令')}
                    >
                      <Copy size={11} />
                      <span>复制</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {isLocalAgent && !currentProvider.installed && (
            <div className="model-guidance-box is-muted">
              <AlertCircle size={16} className="model-guidance-icon" />
              <div className="model-guidance-body">
                <div className="model-guidance-title">未在本机或在线节点中检测到 {currentProvider.name}</div>
                <div className="model-guidance-desc">
                  如果该 Agent 安装在你的个人电脑上，请点击右上角「接入个人电脑」连接伴侣；或在本机安装后点击「刷新探测」：
                </div>
                {currentProvider.installCommand && (
                  <div className="model-guidance-cmd-row">
                    <code>{currentProvider.installCommand}</code>
                    <button
                      type="button"
                      className="btn-secondary model-mini-copy-btn"
                      onClick={() => handleCopyCommand(currentProvider.installCommand!, '安装命令')}
                    >
                      <Copy size={11} />
                      <span>复制</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 模型选择与自定义模型 */}
          <div className="model-form-card">
            <div className="model-field">
              <label htmlFor="provider-model-select" className="model-field-label">
                当前默认模型 (Model ID)
              </label>
              {isLocalAgent && candidateModels.length > 0 ? (
                <select
                  id="provider-model-select"
                  className="form-control model-select"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  {candidateModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="provider-model-select"
                  type="text"
                  className="form-control model-input"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  placeholder="输入模型 ID，例如 claude-sonnet-4-6 或 gpt-4o"
                />
              )}

              {candidateModels.length > 0 && (
                <div className="model-candidate-tags">
                  {candidateModels.map((m) => {
                    const isCustomTag = customModels.includes(m);
                    return (
                      <span
                        key={m}
                        className={`model-candidate-chip ${m === modelId ? 'is-selected' : ''}`}
                      >
                        <button
                          type="button"
                          className="model-candidate-chip-btn"
                          onClick={() => setModelId(m)}
                        >
                          {m}
                        </button>
                        {isCustomTag && (
                          <button
                            type="button"
                            className="model-candidate-chip-remove"
                            onClick={() => handleRemoveCustomModel(m)}
                            title="移除自定义模型"
                            aria-label={`移除 ${m}`}
                          >
                            <X size={10} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="model-custom-add-row">
                <input
                  type="text"
                  className="form-control model-custom-add-input"
                  value={newCustomModel}
                  onChange={(e) => setNewCustomModel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomModel();
                    }
                  }}
                  placeholder="添加自定义模型 slug（回车或点击添加）"
                />
                <button
                  type="button"
                  className="btn-secondary model-custom-add-btn"
                  onClick={handleAddCustomModel}
                  disabled={!newCustomModel.trim()}
                >
                  <Plus size={13} />
                  <span>添加模型</span>
                </button>
              </div>
            </div>

            {/* Claude 专属认证与自定义网关 / Ollama Endpoint / 云端 API Key */}
            {isClaude && (
              <div className="model-subsection">
                <div className="model-subsection-title">
                  <KeyRound size={13} />
                  <span>认证与自定义 API 网关（选填，留空则使用本机 claude auth login 登录态）</span>
                </div>
                <div className="model-two-col">
                  <div className="model-field">
                    <label htmlFor="claude-base-url" className="model-field-label">
                      ANTHROPIC_BASE_URL
                    </label>
                    <input
                      id="claude-base-url"
                      type="text"
                      className="form-control model-input"
                      placeholder="https://api.anthropic.com 或中转网关地址"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                    />
                  </div>
                  <div className="model-field">
                    <label htmlFor="claude-api-key" className="model-field-label">
                      API Key / Auth Token
                    </label>
                    <div className="model-key-input-wrap">
                      <input
                        id="claude-api-key"
                        type="password"
                        className="form-control model-input"
                        placeholder={
                          hasSavedKey
                            ? currentProvider.maskedKey || '已配置密钥 (留空保持不变)'
                            : 'sk-ant-... (选填)'
                        }
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          if (e.target.value) setClearApiKey(false);
                        }}
                      />
                      {hasSavedKey && (
                        <button
                          type="button"
                          className="btn-secondary model-clear-key-btn"
                          onClick={() => {
                            setClearApiKey(true);
                            setApiKey('');
                          }}
                        >
                          清除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isOllama && (
              <div className="model-field">
                <label htmlFor="local-endpoint-input" className="model-field-label">
                  Ollama 服务接入点 (Base URL)
                </label>
                <input
                  id="local-endpoint-input"
                  type="text"
                  className="form-control model-input"
                  placeholder="http://127.0.0.1:11434"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </div>
            )}

            {!isLocalAgent && (
              <div className="model-two-col">
                <div className="model-field">
                  <label htmlFor="remote-api-key" className="model-field-label">
                    API Key
                  </label>
                  <div className="model-key-input-wrap">
                    <input
                      id="remote-api-key"
                      type="password"
                      className="form-control model-input"
                      placeholder={
                        currentProvider.hasKey && !clearApiKey
                          ? currentProvider.maskedKey || '已配置密钥 (留空保持不变)'
                          : 'sk-...'
                      }
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        if (e.target.value) setClearApiKey(false);
                      }}
                    />
                    {currentProvider.hasKey && !clearApiKey && (
                      <button
                        type="button"
                        className="btn-secondary model-clear-key-btn"
                        onClick={() => {
                          setClearApiKey(true);
                          setApiKey('');
                        }}
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
                <div className="model-field">
                  <label htmlFor="remote-endpoint-input" className="model-field-label">
                    Base URL / Endpoint
                  </label>
                  <input
                    id="remote-endpoint-input"
                    type="text"
                    className="form-control model-input"
                    placeholder={currentProvider.baseUrl || 'https://api.openai.com/v1'}
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* 高级运行时配置（本地 Agent 专属可折叠面板） */}
            {isLocalAgent && !isOllama && (
              <div className="model-advanced-block">
                <button
                  type="button"
                  className="model-advanced-toggle"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>高级运行时配置（自定义路径、工作目录、CLI 参数）</span>
                </button>
                {showAdvanced && (
                  <div className="model-advanced-grid">
                    <div className="model-field">
                      <label htmlFor="adv-binary-path" className="model-field-label">
                        可执行文件路径覆盖 (Binary Path)
                      </label>
                      <input
                        id="adv-binary-path"
                        type="text"
                        className="form-control model-input"
                        placeholder={currentProvider.executablePath || `自动探测 ${currentProvider.id}`}
                        value={binaryPath}
                        onChange={(e) => setBinaryPath(e.target.value)}
                      />
                    </div>
                    <div className="model-field">
                      <label htmlFor="adv-config-dir" className="model-field-label">
                        独立配置目录 (Config Dir)
                      </label>
                      <input
                        id="adv-config-dir"
                        type="text"
                        className="form-control model-input"
                        placeholder={isClaude ? '~/.claude (留空用默认)' : '默认配置目录'}
                        value={configDir}
                        onChange={(e) => setConfigDir(e.target.value)}
                      />
                    </div>
                    <div className="model-field">
                      <label htmlFor="adv-cwd" className="model-field-label">
                        默认工作目录 (Working Directory)
                      </label>
                      <input
                        id="adv-cwd"
                        type="text"
                        className="form-control model-input"
                        placeholder="留空使用当前工作区目录"
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                      />
                    </div>
                    <div className="model-field">
                      <label htmlFor="adv-extra-args" className="model-field-label">
                        附加启动参数 (Extra CLI Args)
                      </label>
                      <input
                        id="adv-extra-args"
                        type="text"
                        className="form-control model-input"
                        placeholder="例如 --max-turns 5"
                        value={extraArgs}
                        onChange={(e) => setExtraArgs(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 连通性测试反馈横幅 */}
          {testResult && (
            <div className={`model-test-banner ${testResult.success ? 'is-success' : 'is-error'}`}>
              {testResult.success ? (
                <CheckCircle2 size={16} className="model-test-icon is-success" />
              ) : (
                <AlertCircle size={16} className="model-test-icon is-error" />
              )}
              <div className="model-test-content">
                <div className={`model-test-heading ${testResult.success ? 'is-success' : 'is-error'}`}>
                  {testResult.success
                    ? `连通性验证通过 (${testResult.latency || 0}ms)`
                    : '连通性测试未通过'}
                </div>
                <div className="model-test-detail">
                  {testResult.success
                    ? [
                        testResult.version ? `版本: ${testResult.version}` : '',
                        testResult.authLabel ? `认证: ${testResult.authLabel}` : '',
                        testResult.replyPreview ? `响应预览: "${testResult.replyPreview}"` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || testResult.message
                    : testResult.message}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="model-actions-bar">
        <button
          type="button"
          className="btn-secondary"
          onClick={handleTest}
          disabled={isTesting}
        >
          {isTesting ? '正在验证运行与连通性...' : '测试连通性'}
        </button>

        <div className="model-actions-right">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsModelModalOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中...' : isCurrentActive ? '保存配置' : '设为激活引擎并保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
