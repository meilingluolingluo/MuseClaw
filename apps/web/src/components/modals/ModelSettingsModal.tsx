import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { ProviderIcon } from '../../utils/icons';
import { copyToClipboard } from '../../utils/clipboard';
import { api } from '../../services/api';
import type {
  EnvironmentInfo,
  PermissionMode,
  ProviderDriverKind,
  ProviderInstance,
  ProviderModelDescriptor,
  ProviderTestResult,
  ReasoningEffort,
} from '../../types';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  KeyRound,
  Laptop,
  Palette,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';

const NATIVE_DRIVERS: ProviderDriverKind[] = ['claude', 'codex', 'pi', 'ollama'];

function isNativeRuntime(driver: ProviderDriverKind): boolean {
  return NATIVE_DRIVERS.includes(driver);
}

function isAgentCliDriver(driver: ProviderDriverKind): boolean {
  return driver === 'claude' || driver === 'codex' || driver === 'pi';
}

function getRailBadgeInfo(
  inst: ProviderInstance,
  isActive: boolean
): { text: string; tone: 'active' | 'ready' | 'warning' | 'muted' } {
  if (isActive) {
    return { text: '使用中', tone: 'active' };
  }
  if (inst.enabled === false) {
    return { text: '已停用', tone: 'muted' };
  }
  const snap = inst.snapshot;
  if (isNativeRuntime(inst.driver)) {
    if (snap?.status === 'ready') {
      return { text: inst.environmentId !== 'local' ? '远程就绪' : '已就绪', tone: 'ready' };
    }
    if (snap?.status === 'unauthenticated' || snap?.status === 'warning') {
      return { text: '需登录', tone: 'warning' };
    }
    if (snap?.status === 'error') {
      return { text: '异常', tone: 'warning' };
    }
    return { text: '未检测到', tone: 'muted' };
  }
  if (inst.hasApiKey || inst.apiKey) {
    return { text: '已就绪', tone: 'ready' };
  }
  return { text: '待配置', tone: 'muted' };
}

function getDetailStatusPill(inst: ProviderInstance): { text: string; tone: 'ready' | 'warning' | 'muted' } {
  if (inst.enabled === false) {
    return { text: '已停用', tone: 'muted' };
  }
  const snap = inst.snapshot;
  if (isNativeRuntime(inst.driver)) {
    if (snap?.status === 'ready') {
      return {
        text: snap.version ? `已就绪 · ${snap.version}` : '已就绪',
        tone: 'ready',
      };
    }
    if (snap?.status === 'unauthenticated') {
      return { text: '未登录或缺少凭证', tone: 'warning' };
    }
    if (snap?.status === 'warning' || snap?.status === 'error') {
      return { text: snap.message || '运行异常', tone: 'warning' };
    }
    return { text: '未检测到本地运行时', tone: 'muted' };
  }
  if (inst.hasApiKey || inst.apiKey) {
    return { text: 'API Key 已配置', tone: 'ready' };
  }
  return { text: '待填写 API Key', tone: 'muted' };
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

  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('claude');
  const [displayName, setDisplayName] = useState('');
  const [environmentId, setEnvironmentId] = useState('local');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [modelName, setModelName] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto_edits');
  const [effort, setEffort] = useState<ReasoningEffort>('medium');
  const [binaryPath, setBinaryPath] = useState('');
  const [cwd, setCwd] = useState('');
  const [extraArgs, setExtraArgs] = useState('');
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [newCustomModelInput, setNewCustomModelInput] = useState('');
  const [fetchedModels, setFetchedModels] = useState<ProviderModelDescriptor[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [showNewInstanceForm, setShowNewInstanceForm] = useState(false);
  const [newInstanceDriver, setNewInstanceDriver] = useState<ProviderDriverKind>('claude');
  const [newInstanceName, setNewInstanceName] = useState('');
  const [newInstanceEnv, setNewInstanceEnv] = useState('local');
  const [creatingInstance, setCreatingInstance] = useState(false);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  const instances = modelsConfig?.instances || [];
  const environments: EnvironmentInfo[] = modelsConfig?.environments || [];

  const selectedInstance = useMemo(() => {
    return (
      instances.find((inst) => inst.instanceId === selectedInstanceId) ||
      instances.find((inst) => inst.instanceId === modelsConfig?.activeInstanceId) ||
      instances[0]
    );
  }, [instances, selectedInstanceId, modelsConfig?.activeInstanceId]);

  const syncFormFromInstance = (inst: ProviderInstance) => {
    setDisplayName(inst.displayName || inst.instanceId);
    setEnvironmentId(inst.environmentId || 'local');
    setBaseUrl(inst.baseUrl || '');
    setApiKeyInput('');
    setModelName(
      inst.model ||
        inst.snapshot?.models?.[0]?.slug ||
        ''
    );
    setPermissionMode(inst.permissionMode || 'auto_edits');
    setEffort(inst.effort || 'medium');
    setBinaryPath(inst.binaryPath || '');
    setCwd(inst.cwd || '');
    setExtraArgs(inst.extraArgs || '');
    setCustomModels(inst.customModels || []);
    setFetchedModels(inst.snapshot?.models || []);
    setNewCustomModelInput('');
    setTestResult(null);
  };

  useEffect(() => {
    if (!isModelModalOpen) return;
    void loadModelsConfig(false);
  }, [isModelModalOpen, loadModelsConfig]);

  useEffect(() => {
    if (!isModelModalOpen || !modelsConfig?.instances?.length) return;
    const activeId = modelsConfig.activeInstanceId || modelsConfig.instances[0].instanceId;
    setSelectedInstanceId((prev) => {
      const stillExists = modelsConfig.instances.some((inst) => inst.instanceId === prev);
      return stillExists ? prev : activeId;
    });
  }, [isModelModalOpen, modelsConfig]);

  useEffect(() => {
    if (!selectedInstance) return;
    syncFormFromInstance(selectedInstance);
  }, [selectedInstance?.instanceId]);

  const nativeInstances = useMemo(
    () => instances.filter((inst) => isNativeRuntime(inst.driver)),
    [instances]
  );

  const cloudInstances = useMemo(
    () => instances.filter((inst) => !isNativeRuntime(inst.driver)),
    [instances]
  );

  const mergedModelDescriptors = useMemo(() => {
    const bySlug = new Map<string, ProviderModelDescriptor>();
    for (const m of fetchedModels) {
      bySlug.set(m.slug, m);
    }
    for (const cm of customModels) {
      if (!bySlug.has(cm)) {
        bySlug.set(cm, { slug: cm, name: cm, isCustom: true });
      }
    }
    if (modelName.trim() && !bySlug.has(modelName.trim())) {
      bySlug.set(modelName.trim(), { slug: modelName.trim(), name: modelName.trim(), isCustom: true });
    }
    return Array.from(bySlug.values());
  }, [fetchedModels, customModels, modelName]);

  const activeModelDescriptor = useMemo(
    () => mergedModelDescriptors.find((m) => m.slug === modelName.trim()),
    [mergedModelDescriptors, modelName]
  );

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await loadModelsConfig(true);
      showToast('已重新探测本机及远程环境运行状态', 'success');
    } catch (err: any) {
      showToast(`重新探测失败: ${err?.message || err}`, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const handleFetchModels = async () => {
    if (!selectedInstance) return;
    setFetchingModels(true);
    try {
      const res = await api.fetchProviderModels({
        instanceId: selectedInstance.instanceId,
        driver: selectedInstance.driver,
        environmentId,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKeyInput.trim() || undefined,
        binaryPath: binaryPath.trim() || undefined,
        extraArgs: extraArgs.trim() || undefined,
      });
      if (res.models?.length) {
        setFetchedModels(res.models);
        if (!modelName.trim()) {
          setModelName(res.models[0].slug);
        }
        showToast(`已发现 ${res.models.length} 个可用模型`, 'success');
      } else {
        showToast(res.snapshot?.message || res.error || '暂未拉取到模型列表', 'warning');
      }
    } catch (err: any) {
      showToast(`拉取模型失败: ${err?.message || err}`, 'error');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTest = async () => {
    if (!selectedInstance) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testModelProvider({
        instanceId: selectedInstance.instanceId,
        driver: selectedInstance.driver,
        environmentId,
        displayName,
        model: modelName.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKeyInput.trim() || undefined,
        binaryPath: binaryPath.trim() || undefined,
        extraArgs: extraArgs.trim() || undefined,
        cwd: cwd.trim() || undefined,
        permissionMode,
        effort,
      });
      setTestResult(res);
      if (res.ok) {
        showToast(`连通性测试通过 (${res.latencyMs}ms)`, 'success');
      } else {
        showToast(res.error || '连通性测试失败', 'warning');
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        diagnosticCode: 'execution_failed',
        error: err?.message || '测试请求失败',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAndActivate = async () => {
    if (!selectedInstance) return;
    setSaving(true);
    try {
      const payloadInstance: Partial<ProviderInstance> & { instanceId: string } = {
        instanceId: selectedInstance.instanceId,
        displayName: displayName.trim() || selectedInstance.displayName,
        driver: selectedInstance.driver,
        environmentId: environmentId || 'local',
        model: modelName.trim() || selectedInstance.model || 'default',
        customModels,
        enabled: true,
      };

      if (isAgentCliDriver(selectedInstance.driver)) {
        payloadInstance.permissionMode = permissionMode;
        payloadInstance.effort = effort;
        payloadInstance.binaryPath = binaryPath.trim() || undefined;
        payloadInstance.cwd = cwd.trim() || undefined;
        payloadInstance.extraArgs = extraArgs.trim() || undefined;
      } else {
        payloadInstance.baseUrl = baseUrl.trim();
        if (apiKeyInput.trim()) {
          payloadInstance.apiKey = apiKeyInput.trim();
        }
      }

      await api.saveModelsConfig({
        activeInstanceId: selectedInstance.instanceId,
        activeModelId: payloadInstance.model,
        activeEnvironmentId: payloadInstance.environmentId,
        instance: payloadInstance,
      });
      await loadModelsConfig(false);
      showToast(`已启用 ${payloadInstance.displayName} (${payloadInstance.model})`, 'success');
      setIsModelModalOpen(false);
    } catch (err: any) {
      showToast(`保存配置失败: ${err?.message || err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    if (!selectedInstance) return;
    try {
      await api.upsertProviderInstance({
        instanceId: selectedInstance.instanceId,
        driver: selectedInstance.driver,
        clearApiKey: true,
      });
      setApiKeyInput('');
      await loadModelsConfig(false);
      showToast('已清除保存的 API Key', 'success');
    } catch (err: any) {
      showToast(`清除失败: ${err?.message || err}`, 'error');
    }
  };

  const handleAddCustomModel = () => {
    const trimmed = newCustomModelInput.trim();
    if (!trimmed) return;
    if (!customModels.includes(trimmed)) {
      setCustomModels((prev) => [...prev, trimmed]);
    }
    setModelName(trimmed);
    setNewCustomModelInput('');
  };

  const handleRemoveCustomModel = (slug: string) => {
    setCustomModels((prev) => prev.filter((item) => item !== slug));
    if (modelName === slug) {
      setModelName(fetchedModels[0]?.slug || '');
    }
  };

  const handleCreateInstance = async () => {
    const trimmedName = newInstanceName.trim();
    if (!trimmedName) {
      showToast('请输入新实例名称', 'warning');
      return;
    }
    setCreatingInstance(true);
    try {
      const slugBase = trimmedName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || newInstanceDriver;
      const instanceId = `${newInstanceDriver}-${slugBase}-${Date.now().toString(36).slice(-4)}`;
      const res = await api.upsertProviderInstance({
        instanceId,
        driver: newInstanceDriver,
        displayName: trimmedName,
        environmentId: newInstanceEnv || 'local',
        enabled: true,
        model: newInstanceDriver === 'claude' ? 'sonnet' : newInstanceDriver === 'codex' ? 'gpt-5.3-codex' : '',
        permissionMode: isAgentCliDriver(newInstanceDriver) ? 'auto_edits' : undefined,
        effort: isAgentCliDriver(newInstanceDriver) ? 'medium' : undefined,
        baseUrl: newInstanceDriver === 'ollama' ? 'http://127.0.0.1:11434/v1' : undefined,
      });
      await loadModelsConfig(true);
      setSelectedInstanceId(res.instance.instanceId);
      setShowNewInstanceForm(false);
      setNewInstanceName('');
      showToast(`已创建实例 ${res.instance.displayName}`, 'success');
    } catch (err: any) {
      showToast(`创建实例失败: ${err?.message || err}`, 'error');
    } finally {
      setCreatingInstance(false);
    }
  };

  const handleDeleteInstance = async (inst: ProviderInstance) => {
    if (inst.isDefault) return;
    try {
      const res = await api.deleteProviderInstance(inst.instanceId);
      if (res.ok) {
        await loadModelsConfig(false);
        showToast(`已删除实例 ${inst.displayName}`, 'success');
      } else {
        showToast(res.reason || '无法删除该实例', 'warning');
      }
    } catch (err: any) {
      showToast(`删除失败: ${err?.message || err}`, 'error');
    }
  };

  const statusPill = selectedInstance ? getDetailStatusPill(selectedInstance) : { text: '', tone: 'muted' as const };
  const isCurrentActive = selectedInstance?.instanceId === modelsConfig?.activeInstanceId;

  return (
    <Modal
      isOpen={isModelModalOpen}
      onClose={() => setIsModelModalOpen(false)}
      title="模型与本地 Agent 运行时配置中心"
      icon={<Cpu size={18} />}
      maxWidth="920px"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setIsModelModalOpen(false);
              setIsImageModelModalOpen(true);
            }}
          >
            <Palette size={14} />
            <span>生图模型设置</span>
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsModelModalOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleTest}
            disabled={!selectedInstance || testing}
          >
            {testing ? <RefreshCw size={14} className="model-spin-icon" /> : <ShieldCheck size={14} />}
            <span>{testing ? '测试中…' : '连通性测试'}</span>
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSaveAndActivate}
            disabled={!selectedInstance || saving}
          >
            {saving ? '保存中…' : isCurrentActive ? '保存当前配置' : '保存并设为当前模型'}
          </button>
        </>
      }
    >
      {/* 顶部执行环境总览与远程接入栏 */}
      <div className="model-compute-banner">
        <div className="model-compute-banner-info">
          <Laptop size={18} className="model-compute-banner-icon" />
          <div>
            <div className="model-compute-banner-title">
              计算环境 ({environments.length} 个环境在线)
            </div>
            <div className="model-env-chips">
              {environments.map((env) => (
                <span
                  key={env.environmentId}
                  className={`model-env-chip${env.environmentId === environmentId ? ' is-selected' : ''}`}
                  title={`${env.hostname} (${env.platform}/${env.arch})`}
                >
                  <span className={`model-env-dot ${env.status === 'online' ? 'is-online' : 'is-offline'}`} />
                  <span>{env.label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="model-env-actions">
          <button
            type="button"
            className="btn-secondary model-top-action-btn"
            onClick={handleRefreshAll}
            disabled={refreshing}
          >
            <RefreshCw size={13} className={refreshing ? 'model-spin-icon' : ''} />
            <span>{refreshing ? '探测中…' : '重新探测'}</span>
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
            <span>连接新电脑</span>
          </button>
        </div>
      </div>

      <div className="model-center-layout">
        {/* 左侧提供方与实例列表 */}
        <aside className="model-provider-rail" aria-label="模型与本地运行时实例列表">
          <div className="model-rail-header-row">
            <span className="model-rail-section-title">本地 Agent 运行时</span>
            <button
              type="button"
              className="btn-secondary model-rail-add-btn"
              onClick={() => setShowNewInstanceForm((prev) => !prev)}
              title="新建自定义提供方实例"
            >
              <Plus size={12} />
              <span>新建</span>
            </button>
          </div>

          {showNewInstanceForm && (
            <div className="model-new-instance-card">
              <div className="model-field">
                <label className="model-field-label">驱动类型</label>
                <select
                  className="om-input"
                  value={newInstanceDriver}
                  onChange={(e) => setNewInstanceDriver(e.target.value as ProviderDriverKind)}
                >
                  <option value="claude">Claude Code SDK</option>
                  <option value="codex">Codex CLI</option>
                  <option value="pi">Pi Coding Agent</option>
                  <option value="ollama">Ollama 本地服务</option>
                  <option value="openai-compat">OpenAI 兼容网关</option>
                </select>
              </div>
              <div className="model-field">
                <label className="model-field-label">实例名称</label>
                <input
                  type="text"
                  className="om-input"
                  placeholder="例如：我的 Claude Worktree"
                  value={newInstanceName}
                  onChange={(e) => setNewInstanceName(e.target.value)}
                />
              </div>
              <div className="model-field">
                <label className="model-field-label">目标执行环境</label>
                <select
                  className="om-input"
                  value={newInstanceEnv}
                  onChange={(e) => setNewInstanceEnv(e.target.value)}
                >
                  {environments.map((env) => (
                    <option key={env.environmentId} value={env.environmentId}>
                      {env.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="model-new-instance-actions">
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  onClick={() => setShowNewInstanceForm(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-primary btn-xs"
                  onClick={handleCreateInstance}
                  disabled={creatingInstance}
                >
                  {creatingInstance ? '创建中…' : '确认创建'}
                </button>
              </div>
            </div>
          )}

          <div className="model-rail-list">
            {nativeInstances.map((inst) => {
              const active = inst.instanceId === modelsConfig?.activeInstanceId;
              const selected = inst.instanceId === selectedInstance?.instanceId;
              const badge = getRailBadgeInfo(inst, active);
              return (
                <button
                  key={inst.instanceId}
                  type="button"
                  className={`model-rail-item${selected ? ' is-selected' : ''}`}
                  onClick={() => setSelectedInstanceId(inst.instanceId)}
                >
                  <span className="model-rail-item-icon">
                    <ProviderIcon providerId={inst.driver} size={18} />
                  </span>
                  <span className="model-rail-item-meta">
                    <span className="model-rail-item-name">{inst.displayName}</span>
                    <span className="model-rail-item-sub">
                      {inst.snapshot?.version || inst.model || inst.driver}
                    </span>
                  </span>
                  <span className={`model-rail-badge tone-${badge.tone}`}>{badge.text}</span>
                </button>
              );
            })}
          </div>

          <div className="model-rail-intranet-group">
            <div className="model-rail-section-title">云端 / 兼容 API</div>
            <div className="model-rail-list">
              {cloudInstances.map((inst) => {
                const active = inst.instanceId === modelsConfig?.activeInstanceId;
                const selected = inst.instanceId === selectedInstance?.instanceId;
                const badge = getRailBadgeInfo(inst, active);
                return (
                  <button
                    key={inst.instanceId}
                    type="button"
                    className={`model-rail-item${selected ? ' is-selected' : ''}`}
                    onClick={() => setSelectedInstanceId(inst.instanceId)}
                  >
                    <span className="model-rail-item-icon">
                      <ProviderIcon providerId={inst.instanceId} size={18} />
                    </span>
                    <span className="model-rail-item-meta">
                      <span className="model-rail-item-name">{inst.displayName}</span>
                      <span className="model-rail-item-sub">{inst.model || '未选择模型'}</span>
                    </span>
                    <span className={`model-rail-badge tone-${badge.tone}`}>{badge.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* 右侧详细配置表单 */}
        {selectedInstance && (
          <section className="model-detail-pane" aria-label="实例配置详情">
            <div className="model-detail-header-card">
              <div className="model-detail-header-top">
                <div className="model-config-title-group">
                  <ProviderIcon
                    providerId={
                      isNativeRuntime(selectedInstance.driver)
                        ? selectedInstance.driver
                        : selectedInstance.instanceId
                    }
                    size={22}
                  />
                  <div>
                    <div className="model-config-title">{selectedInstance.displayName}</div>
                    <div className="model-detail-subtitle">
                      {selectedInstance.description ||
                        (isAgentCliDriver(selectedInstance.driver)
                          ? '原生 Agent 运行时驱动，支持工作区工具调用、会话断点恢复与权限控制'
                          : '标准 OpenAI 兼容模型服务端点')}
                    </div>
                  </div>
                </div>
                <div className="model-header-right-actions">
                  <span className={`model-status-pill tone-${statusPill.tone}`}>{statusPill.text}</span>
                  {!selectedInstance.isDefault && (
                    <button
                      type="button"
                      className="btn-secondary btn-xs model-delete-btn"
                      onClick={() => handleDeleteInstance(selectedInstance)}
                      title="删除此自定义实例"
                    >
                      <Trash2 size={12} />
                      <span>删除</span>
                    </button>
                  )}
                </div>
              </div>

              {selectedInstance.snapshot?.executablePath && (
                <div className="model-probe-meta-strip">
                  <div className="model-probe-version is-ready">
                    可执行程序: <code>{selectedInstance.snapshot.executablePath}</code>
                  </div>
                  {selectedInstance.snapshot.auth?.label && (
                    <div className="model-auth-chip">
                      <span>认证方式: {selectedInstance.snapshot.auth.label}</span>
                      {selectedInstance.snapshot.auth.endpoint && (
                        <code> · {selectedInstance.snapshot.auth.endpoint}</code>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedInstance.snapshot?.status === 'not_found' && selectedInstance.snapshot.installCommand && (
                <div className="model-guidance-box">
                  <div className="model-probe-box is-missing">
                    {selectedInstance.snapshot.message || '尚未在目标环境中检测到可执行程序'}
                  </div>
                  <div className="model-guidance-cmd-row">
                    <code>{selectedInstance.snapshot.installCommand}</code>
                    <button
                      type="button"
                      className="btn-secondary model-mini-copy-btn"
                      onClick={async () => {
                        if (selectedInstance.snapshot?.installCommand) {
                          const ok = await copyToClipboard(selectedInstance.snapshot.installCommand);
                          showToast(ok ? '已复制安装命令' : '复制失败', ok ? 'success' : 'warning');
                        }
                      }}
                    >
                      <Copy size={11} />
                      <span>复制</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="model-form-card">
              <div className="model-two-col">
                <div className="model-field">
                  <label className="model-field-label">实例显示名称</label>
                  <input
                    type="text"
                    className="om-input model-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>

                <div className="model-field">
                  <label className="model-field-label">执行环境 (Environment)</label>
                  <select
                    className="om-input model-select"
                    value={environmentId}
                    onChange={(e) => setEnvironmentId(e.target.value)}
                  >
                    {environments.map((env) => (
                      <option key={env.environmentId} value={env.environmentId}>
                        {env.label} ({env.status === 'online' ? '在线' : '离线'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!isAgentCliDriver(selectedInstance.driver) && (
                <div className="model-form-stack">
                  <div className="model-field">
                    <label className="model-field-label">接口 Base URL</label>
                    <input
                      type="text"
                      className="om-input model-input"
                      placeholder="https://api.openai.com/v1"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </div>
                  {selectedInstance.driver !== 'ollama' && (
                    <div className="model-field">
                      <label className="model-field-label">API Key</label>
                      <div className="model-key-input-wrap">
                        <input
                          type="password"
                          className="om-input model-input"
                          placeholder={
                            selectedInstance.hasApiKey
                              ? `已保存 (${selectedInstance.maskedApiKey || '****'})，留空保持不变`
                              : '输入 API Key (sk-...)'
                          }
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                        />
                        {selectedInstance.hasApiKey && (
                          <button
                            type="button"
                            className="btn-secondary model-clear-key-btn"
                            onClick={handleClearKey}
                          >
                            <KeyRound size={12} />
                            <span>清除</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 模型选择与实时探测能力展示 */}
              <div className="model-subsection">
                <div className="model-subsection-title">
                  <Terminal size={13} />
                  <span>默认模型与已发现能力</span>
                  <button
                    type="button"
                    className="btn-secondary btn-xs model-fetch-inline-btn"
                    onClick={handleFetchModels}
                    disabled={fetchingModels}
                  >
                    <RefreshCw size={11} className={fetchingModels ? 'model-spin-icon' : ''} />
                    <span>{fetchingModels ? '拉取中…' : '刷新模型列表'}</span>
                  </button>
                </div>

                <div className="model-field">
                  <input
                    type="text"
                    className="om-input model-input"
                    placeholder="输入或选择下方模型 ID"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                  />
                </div>

                {mergedModelDescriptors.length > 0 && (
                  <div className="model-candidates-wrap">
                    {mergedModelDescriptors.map((desc) => {
                      const isSelected = modelName.trim() === desc.slug;
                      const isRemovable = Boolean(desc.isCustom && customModels.includes(desc.slug));
                      return (
                        <span
                          key={desc.slug}
                          className={`model-candidate-chip${isSelected ? ' is-selected' : ''}`}
                        >
                          <button
                            type="button"
                            className="model-candidate-chip-btn"
                            onClick={() => setModelName(desc.slug)}
                            title={desc.name !== desc.slug ? `${desc.name} (${desc.slug})` : desc.slug}
                          >
                            {desc.name || desc.slug}
                          </button>
                          {desc.supportsEffort && <span className="model-cap-tag">思考强度</span>}
                          {isRemovable && (
                            <button
                              type="button"
                              className="model-candidate-chip-remove"
                              onClick={() => handleRemoveCustomModel(desc.slug)}
                              aria-label={`移除自定义模型 ${desc.slug}`}
                            >
                              <X size={11} />
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
                    className="om-input model-custom-add-input"
                    placeholder="添加自定义模型名称 (如 deepseek/deepseek-flash[1m])"
                    value={newCustomModelInput}
                    onChange={(e) => setNewCustomModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomModel();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary model-custom-add-btn"
                    onClick={handleAddCustomModel}
                  >
                    <Plus size={12} />
                    <span>添加</span>
                  </button>
                </div>
              </div>

              {/* 原生 Agent 权限模式与推理深度 */}
              {isAgentCliDriver(selectedInstance.driver) && (
                <div className="model-subsection">
                  <div className="model-two-col">
                    <div className="model-field">
                      <label className="model-field-label">工具审批与权限策略</label>
                      <select
                        className="om-input model-select"
                        value={permissionMode}
                        onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
                      >
                        <option value="ask">每次询问确认 (Ask)</option>
                        <option value="auto_edits">自动批准文件编辑 (Auto Edits)</option>
                        <option value="full">完全免确认执行 (Full Access)</option>
                      </select>
                    </div>

                    <div className="model-field">
                      <label className="model-field-label">
                        推理强度 (Effort)
                        {activeModelDescriptor?.supportsEffort ? ' · 当前模型支持' : ''}
                      </label>
                      <select
                        className="om-input model-select"
                        value={effort}
                        onChange={(e) => setEffort(e.target.value as ReasoningEffort)}
                      >
                        <option value="default">跟随默认</option>
                        <option value="low">Low (快速)</option>
                        <option value="medium">Medium (均衡)</option>
                        <option value="high">High (深度思考)</option>
                        <option value="xhigh">XHigh</option>
                        <option value="max">Max (极限推理)</option>
                      </select>
                    </div>
                  </div>

                  <div className="model-advanced-block">
                    <button
                      type="button"
                      className="model-advanced-toggle"
                      onClick={() => setShowAdvanced((prev) => !prev)}
                    >
                      {showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span>高级 CLI 路径与工作目录覆写</span>
                    </button>

                    {showAdvanced && (
                      <div className="model-advanced-grid">
                        <div className="model-field">
                          <label className="model-field-label">自定义可执行文件路径 (binaryPath)</label>
                          <input
                            type="text"
                            className="om-input model-input"
                            placeholder="留空自动探测"
                            value={binaryPath}
                            onChange={(e) => setBinaryPath(e.target.value)}
                          />
                        </div>
                        <div className="model-field">
                          <label className="model-field-label">默认工作目录 (cwd)</label>
                          <input
                            type="text"
                            className="om-input model-input"
                            placeholder="留空使用网关工作区根目录"
                            value={cwd}
                            onChange={(e) => setCwd(e.target.value)}
                          />
                        </div>
                        <div className="model-field">
                          <label className="model-field-label">附加 CLI 参数 (extraArgs)</label>
                          <input
                            type="text"
                            className="om-input model-input"
                            placeholder="例如：--verbose"
                            value={extraArgs}
                            onChange={(e) => setExtraArgs(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 连通性测试结果条 */}
              {testResult && (
                <div className={`model-test-banner ${testResult.ok ? 'is-success' : 'is-error'}`}>
                  {testResult.ok ? (
                    <CheckCircle2 size={16} className="model-test-icon is-success" />
                  ) : (
                    <AlertCircle size={16} className="model-test-icon is-error" />
                  )}
                  <div className="model-test-content">
                    <div className="model-test-heading">
                      {testResult.ok
                        ? `连通性测试通过 · ${testResult.latencyMs}ms${testResult.version ? ` · ${testResult.version}` : ''}`
                        : `测试失败 (${testResult.diagnosticCode}): ${testResult.error || '请检查环境配置'}`}
                    </div>
                    {testResult.replyPreview && (
                      <div className="model-detail-subtitle">
                        实测响应预览: {testResult.replyPreview}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
};
