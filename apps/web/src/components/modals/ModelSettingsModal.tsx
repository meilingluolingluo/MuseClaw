import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { ProviderIcon } from '../../utils/icons';
import { Cpu, Laptop, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';
import type { ModelProvider } from '../../types';

export const ModelSettingsModal: React.FC = () => {
  const {
    isModelModalOpen,
    setIsModelModalOpen,
    setIsAddMachineModalOpen,
    modelsConfig,
    loadModelsConfig,
    showToast,
  } = useApp();

  const [selectedProviderId, setSelectedProviderId] = useState<string>('deepseek');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latency?: number; message?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (modelsConfig) {
      const activeId = modelsConfig.activeProviderId || 'deepseek';
      setSelectedProviderId(activeId);
      const activeP = modelsConfig.providers.find((p) => p.id === activeId);
      if (activeP) {
        setModelId(activeP.model || activeP.modelId || activeP.candidateModels?.[0] || '');
        setApiKey(activeP.apiKey || '');
        setEndpoint(activeP.baseUrl || activeP.endpoint || '');
      }
    }
  }, [modelsConfig]);

  const handleSelectProvider = (p: ModelProvider) => {
    setSelectedProviderId(p.id);
    setModelId(p.model || p.modelId || (p.candidateModels?.[0] || p.supportedModels?.[0] || ''));
    setApiKey(p.apiKey || '');
    setEndpoint(p.baseUrl || p.endpoint || '');
    setTestResult(null);
  };

  const currentProvider: ModelProvider = modelsConfig?.providers.find(
    (p) => p.id === selectedProviderId
  ) || {
    id: selectedProviderId,
    name: selectedProviderId,
    description: 'AI 交互推理引擎',
    candidateModels: ['default'],
  };

  const isLocalAgent = Boolean(
    currentProvider.isLocalAgent || ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(currentProvider.id)
  );

  const candidateModels = (currentProvider.candidateModels && currentProvider.candidateModels.length > 0)
    ? currentProvider.candidateModels
    : (currentProvider.supportedModels && currentProvider.supportedModels.length > 0)
    ? currentProvider.supportedModels
    : ['gpt-4o', 'gpt-4o-mini', 'deepseek-chat', 'deepseek-flash', 'qwen-plus'];

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testModel(currentProvider.id, modelId);
      const isOk = Boolean(res.success || res.ok);
      const latency = res.latency ?? res.latencyMs ?? 0;
      const message = res.message || res.error || (isOk ? '连通性验证通过' : '连接超时或未响应');
      const normalizedResult = { ...res, success: isOk, latency, message };
      setTestResult(normalizedResult);
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
      await api.saveModelsConfig({
        activeProviderId: selectedProviderId,
        provider: {
          id: selectedProviderId,
          model: modelId,
          baseUrl: endpoint || undefined,
          apiKey: apiKey || undefined,
        },
      });

      await loadModelsConfig();
      showToast(`已成功将 ${currentProvider.name} 设为全局激活大模型`, 'success');
      setIsModelModalOpen(false);
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const isCurrentActive = selectedProviderId === modelsConfig?.activeProviderId;
  const isCurrentReady = isLocalAgent
    ? Boolean(currentProvider.installed || currentProvider.isAvailable)
    : Boolean(currentProvider.hasKey || currentProvider.apiKey || currentProvider.isAvailable);

  return (
    <Modal
      isOpen={isModelModalOpen}
      onClose={() => setIsModelModalOpen(false)}
      title="AI 大模型服务配置中心 (AI Engines)"
      icon={<Cpu size={18} />}
      maxWidth="780px"
      zIndex={1000}
    >
      {/* 顶部接入计算节点快捷横幅 */}
      <div className="model-compute-banner">
        <div className="model-compute-banner-info">
          <Laptop size={18} className="model-compute-banner-icon" />
          <div>
            <div className="model-compute-banner-title">
              连接个人电脑计算节点 (Mac / Linux)
            </div>
            <div className="model-compute-banner-desc">
              一键在个人电脑终端运行伴侣，即可就绪本机 ducc、ducx 等私有 Agent
            </div>
          </div>
        </div>
        <button
          type="button"
          className="btn-primary model-compute-banner-btn"
          onClick={() => {
            setIsModelModalOpen(false);
            setIsAddMachineModalOpen(true);
          }}
        >
          💻 添加计算节点
        </button>
      </div>

      {/* 模型服务商网格 */}
      <div className="model-providers-grid">
        {modelsConfig?.providers.map((p) => {
          const isSelected = p.id === selectedProviderId;
          const isActive = p.id === modelsConfig.activeProviderId;
          const isLocal = Boolean(p.isLocalAgent || ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(p.id));
          const isReady = isLocal ? Boolean(p.installed || p.isAvailable) : Boolean(p.hasKey || p.apiKey || p.isAvailable);

          let badgeText = '待配置';
          let isBadgeGreen = false;
          if (isActive) {
            badgeText = '● 正在使用';
            isBadgeGreen = true;
          } else if (isLocal) {
            if (isReady) {
              badgeText = '💻 本地已就绪';
              isBadgeGreen = true;
            } else {
              badgeText = '未检测到';
              isBadgeGreen = false;
            }
          } else {
            if (isReady) {
              badgeText = '已就绪';
              isBadgeGreen = true;
            } else {
              badgeText = '待配置';
              isBadgeGreen = false;
            }
          }

          return (
            <div
              key={p.id}
              className={`model-provider-card ${isSelected ? 'active' : ''}`}
              onClick={() => handleSelectProvider(p)}
            >
              <div className="model-provider-card-icon">
                <ProviderIcon providerId={p.id} size={28} />
              </div>
              <div className="model-provider-card-name" title={p.name}>
                {p.name}
              </div>
              <div className={`model-provider-card-badge ${isBadgeGreen ? 'configured' : 'unconfigured'}`}>
                {badgeText}
              </div>
            </div>
          );
        })}
      </div>

      {/* 选中提供商配置表单 */}
      <div className="model-config-section">
        <div className="model-config-header">
          <div className="model-config-title-group">
            <ProviderIcon providerId={currentProvider.id} size={22} />
            <span className="model-config-title">{currentProvider.name}</span>
          </div>
          <span
            className={`pill-badge ${isCurrentReady ? 'pill-green' : 'pill-neutral'} model-config-badge`}
          >
            {isCurrentReady ? (isLocalAgent ? '✅ 本地环境就绪' : '✅ 环境就绪') : '待配置'}
          </span>
        </div>

        <p className="model-config-desc">
          {currentProvider.description || '企业级智能体推理服务，支持标准与本地模式交互'}
        </p>

        {isLocalAgent ? (
          <div className="model-form-stack">
            <div className="model-field">
              <label className="model-field-label">
                程序检测状态 (CLI Path / Mesh Node):
              </label>
              <div
                className={`model-probe-box ${isCurrentReady ? 'is-ready' : 'is-missing'}`}
              >
                {currentProvider.executablePath || currentProvider.cliPath || (isCurrentReady ? '通过远程在线计算节点连接就绪' : '未在服务器或已连接节点中检测到')}
              </div>
            </div>

            <div className="model-field">
              <label className="model-field-label">
                探针响应版本 (Probe Version):
              </label>
              <div
                className={`model-probe-version ${isCurrentReady ? 'is-ready' : 'is-missing'}`}
              >
                {currentProvider.version || currentProvider.detectedVersion || (isCurrentReady ? '在线就绪' : '探针未响应')}
              </div>
            </div>

            <div className="model-field">
              <label className="model-field-label">
                指定模型 (Model ID):
              </label>
              <select
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
              <div className="model-candidate-tags">
                {candidateModels.map((m) => (
                  <span
                    key={m}
                    className={`model-candidate-tag ${m === modelId ? 'is-selected' : ''}`}
                    onClick={() => setModelId(m)}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>

            {testResult ? (
              testResult.success ? (
                <div className="model-test-banner is-success">
                  <span className="model-test-dot is-success" />
                  <div>
                    <div className="model-test-heading is-success">
                      🟢 本地 Agent 响应就绪 ({testResult.latency || 15}ms)
                    </div>
                    <div className="model-test-detail">
                      检测到版本: {currentProvider.version || '在线就绪'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="model-test-banner is-error">
                  <AlertCircle size={16} className="model-test-icon is-error" />
                  <div>
                    <div className="model-test-heading is-error">
                      连通性测试未通过
                    </div>
                    <div className="model-test-detail">
                      {testResult.message || '远程节点响应超时'}
                    </div>
                  </div>
                </div>
              )
            ) : isCurrentReady ? (
              <div className="model-test-banner is-ready">
                <span className="model-test-dot is-success" />
                <div>
                  <div className="model-test-heading is-ready">
                    Agent 运行环境已就绪
                  </div>
                  <div className="model-test-detail">
                    已关联可用计算节点，可点击下方“测试连通性”进行在线验证
                  </div>
                </div>
              </div>
            ) : (
              <div className="model-test-banner is-warning">
                <AlertCircle size={16} className="model-test-icon is-warning" />
                <div className="model-test-heading is-warning">
                  未检测到本地 {currentProvider.name} 程序。请在终端安装或连接个人电脑伴侣。
                </div>
                <button
                  type="button"
                  className="btn-secondary model-test-banner-btn"
                  onClick={() => {
                    setIsModelModalOpen(false);
                    setIsAddMachineModalOpen(true);
                  }}
                >
                  💻 接入个人电脑
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="model-form-stack">
            <div className="model-field">
              <label className="model-field-label">
                指定模型 (Model ID):
              </label>
              <input
                type="text"
                className="form-control model-input"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="例如 deepseek-flash 或 gpt-4o"
              />
              <div className="model-candidate-tags">
                {candidateModels.map((m) => (
                  <span
                    key={m}
                    className={`model-candidate-tag ${m === modelId ? 'is-selected' : ''}`}
                    onClick={() => setModelId(m)}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>

            <div className="model-field">
              <label className="model-field-label">
                API Key:
              </label>
              <input
                type="password"
                className="form-control model-input"
                placeholder={currentProvider.hasKey ? (currentProvider.maskedKey || '已配置密钥 (留空保持不变)') : 'sk-...'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            <div className="model-field">
              <label className="model-field-label">
                Base URL / Endpoint (选填):
              </label>
              <input
                type="text"
                className="form-control model-input"
                placeholder={currentProvider.baseUrl || 'https://api.openai.com/v1'}
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="model-actions-bar">
        <button
          type="button"
          className="btn-secondary"
          onClick={handleTest}
          disabled={isTesting}
        >
          {isTesting ? '正在测试连通性...' : '测试连通性'}
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
            {saving ? '保存中...' : (isCurrentActive ? '保存配置' : '设为激活模型并保存')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
