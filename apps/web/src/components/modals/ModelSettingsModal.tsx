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
      <div
        style={{
          background: 'var(--om-surface-2)',
          border: '1px solid var(--om-border)',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Laptop size={18} style={{ color: 'var(--om-accent)' }} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 650 }}>
              连接个人电脑计算节点 (Mac / Linux)
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
              一键在个人电脑终端运行伴侣，即可就绪本机 ducc、ducx 等私有 Agent
            </div>
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setIsModelModalOpen(false);
            setIsAddMachineModalOpen(true);
          }}
          style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '8px', flexShrink: 0 }}
        >
          💻 添加计算节点
        </button>
      </div>

      {/* 模型服务商网格 */}
      <div
        className="model-providers-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '10px',
          marginBottom: '20px',
        }}
      >
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
      <div
        style={{
          background: 'var(--om-surface-2)',
          border: '1px solid var(--om-border)',
          borderRadius: '12px',
          padding: '18px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ProviderIcon providerId={currentProvider.id} size={22} />
            <span style={{ fontSize: '15px', fontWeight: 650 }}>{currentProvider.name}</span>
          </div>
          <span
            className={`pill-badge ${isCurrentReady ? 'pill-green' : 'pill-neutral'}`}
            style={{ fontSize: '11px' }}
          >
            {isCurrentReady ? (isLocalAgent ? '✅ 本地环境就绪' : '✅ 环境就绪') : '待配置'}
          </span>
        </div>

        <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '16px', lineHeight: 1.5 }}>
          {currentProvider.description || '企业级智能体推理服务，支持标准与本地模式交互'}
        </p>

        {isLocalAgent ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                程序检测状态 (CLI Path / Mesh Node):
              </label>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  background: 'var(--om-surface-3)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: isCurrentReady ? 'var(--om-fg)' : 'var(--accent-amber)',
                }}
              >
                {currentProvider.executablePath || currentProvider.cliPath || (isCurrentReady ? '通过远程在线计算节点连接就绪' : '未在服务器或已连接节点中检测到')}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                探针响应版本 (Probe Version):
              </label>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  color: isCurrentReady ? 'var(--accent-green)' : 'var(--text-dim)',
                  paddingLeft: '2px',
                }}
              >
                {currentProvider.version || currentProvider.detectedVersion || (isCurrentReady ? '在线就绪' : '探针未响应')}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                指定模型 (Model ID):
              </label>
              <select
                className="form-control"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                style={{ width: '100%' }}
              >
                {candidateModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <div className="model-candidate-tags" style={{ marginTop: '8px' }}>
                {candidateModels.map((m) => (
                  <span
                    key={m}
                    className="model-candidate-tag"
                    onClick={() => setModelId(m)}
                    style={
                      m === modelId
                        ? { borderColor: 'var(--om-accent)', color: 'var(--om-accent)', fontWeight: 600 }
                        : undefined
                    }
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>

            {testResult ? (
              testResult.success ? (
                <div
                  style={{
                    background: 'rgba(48, 209, 88, 0.08)',
                    border: '1px solid var(--accent-green)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '6px',
                  }}
                >
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-green)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--accent-green)', fontWeight: 600 }}>
                      🟢 本地 Agent 响应就绪 ({testResult.latency || 15}ms)
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--om-muted)', marginTop: '2px' }}>
                      检测到版本: {currentProvider.version || '在线就绪'}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: 'rgba(255, 69, 58, 0.08)',
                    border: '1px solid var(--accent-red)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '6px',
                  }}
                >
                  <AlertCircle size={16} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--accent-red)', fontWeight: 600 }}>
                      连通性测试未通过
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--om-muted)', marginTop: '2px' }}>
                      {testResult.message || '远程节点响应超时'}
                    </div>
                  </div>
                </div>
              )
            ) : isCurrentReady ? (
              <div
                style={{
                  background: 'rgba(48, 209, 88, 0.06)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '6px',
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-green)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--om-fg)', fontWeight: 600 }}>
                    Agent 运行环境已就绪
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--om-muted)', marginTop: '2px' }}>
                    已关联可用计算节点，可点击下方“测试连通性”进行在线验证
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: 'rgba(255, 149, 0, 0.08)',
                  border: '1px solid var(--accent-amber)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '6px',
                }}
              >
                <AlertCircle size={16} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
                <div style={{ fontSize: '12px', color: 'var(--accent-amber)', fontWeight: 600 }}>
                  未检测到本地 {currentProvider.name} 程序。请在终端安装或连接个人电脑伴侣。
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setIsModelModalOpen(false);
                    setIsAddMachineModalOpen(true);
                  }}
                  style={{ marginLeft: 'auto', fontSize: '11px', padding: '2px 8px', flexShrink: 0 }}
                >
                  💻 接入个人电脑
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                指定模型 (Model ID):
              </label>
              <input
                type="text"
                className="form-control"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                style={{ width: '100%', marginBottom: '6px' }}
                placeholder="例如 deepseek-flash 或 gpt-4o"
              />
              <div className="model-candidate-tags">
                {candidateModels.map((m) => (
                  <span
                    key={m}
                    className="model-candidate-tag"
                    onClick={() => setModelId(m)}
                    style={
                      m === modelId
                        ? { borderColor: 'var(--om-accent)', color: 'var(--om-accent)', fontWeight: 600 }
                        : undefined
                    }
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                API Key:
              </label>
              <input
                type="password"
                className="form-control"
                placeholder={currentProvider.hasKey ? (currentProvider.maskedKey || '已配置密钥 (留空保持不变)') : 'sk-...'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Base URL / Endpoint (选填):
              </label>
              <input
                type="text"
                className="form-control"
                placeholder={currentProvider.baseUrl || 'https://api.openai.com/v1'}
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleTest}
          disabled={isTesting}
        >
          {isTesting ? '正在测试连通性...' : '测试连通性'}
        </button>

        <div style={{ display: 'flex', gap: '8px' }}>
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
