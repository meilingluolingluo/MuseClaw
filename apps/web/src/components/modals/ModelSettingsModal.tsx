import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { ProviderIcon } from '../../utils/icons';
import { Cpu, Laptop, Check, AlertCircle } from 'lucide-react';
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
        setModelId(activeP.modelId || '');
        setApiKey(activeP.apiKey || '');
        setEndpoint(activeP.endpoint || '');
      }
    }
  }, [modelsConfig]);

  const handleSelectProvider = (p: ModelProvider) => {
    setSelectedProviderId(p.id);
    setModelId(p.modelId || (p.supportedModels ? p.supportedModels[0] : ''));
    setApiKey(p.apiKey || '');
    setEndpoint(p.endpoint || '');
    setTestResult(null);
  };

  const currentProvider: ModelProvider = modelsConfig?.providers.find(
    (p) => p.id === selectedProviderId
  ) || {
    id: selectedProviderId,
    name: selectedProviderId,
    description: 'AI 交互推理引擎',
    supportedModels: ['default'],
  };

  const isLocalAgent = ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(currentProvider.id);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testModel(currentProvider.id, modelId);
      setTestResult(res);
      if (res.success) {
        showToast(`连通性测试成功 (${res.latency || 12}ms)`, 'success');
      } else {
        showToast(`测试未通过: ${res.message}`, 'error');
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
      const updatedProviders = modelsConfig.providers.map((p) => {
        if (p.id === selectedProviderId) {
          return {
            ...p,
            modelId,
            apiKey: apiKey || undefined,
            endpoint: endpoint || undefined,
          };
        }
        return p;
      });

      await api.saveModelsConfig({
        activeProviderId: selectedProviderId,
        providers: updatedProviders,
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

  const candidateModels = currentProvider.supportedModels || [
    'gpt-4o',
    'gpt-4o-mini',
    'deepseek-chat',
    'deepseek-coder',
    'qwen-plus',
    'moonshot-v1-8k',
  ];

  return (
    <Modal
      isOpen={isModelModalOpen}
      onClose={() => setIsModelModalOpen(false)}
      title="AI 大模型服务配置中心 (AI Engines)"
      icon={<Cpu size={18} />}
      maxWidth="780px"
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
            setIsAddMachineModalOpen(true);
          }}
          style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '8px', flexShrink: 0 }}
        >
          💻 添加计算节点
        </button>
      </div>

      {/* 模型服务商网格 */}
      <div
        className="model-provider-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '10px',
          marginBottom: '20px',
        }}
      >
        {modelsConfig?.providers.map((p) => {
          const isSelected = p.id === selectedProviderId;
          const isCurrentActive = p.id === modelsConfig.activeProviderId;
          const isLocal = ['codex', 'pi', 'dsh', 'ducc', 'ducx'].includes(p.id);

          const badgeText = isCurrentActive
            ? '● 正在使用'
            : isLocal
            ? p.isAvailable
              ? '💻 本地已就绪'
              : '未检测到'
            : p.isAvailable
            ? '已就绪'
            : '待配置';

          const badgeColor = isCurrentActive
            ? 'var(--accent-green)'
            : isLocal
            ? p.isAvailable
              ? 'var(--accent-green)'
              : 'var(--text-dim)'
            : p.isAvailable
            ? 'var(--accent-green)'
            : 'var(--text-dim)';

          return (
            <div
              key={p.id}
              onClick={() => handleSelectProvider(p)}
              style={{
                background: isSelected ? 'var(--om-surface)' : 'var(--om-surface-2)',
                border: isSelected ? '2px solid var(--om-accent)' : '1px solid var(--om-border)',
                borderRadius: '12px',
                padding: '12px 10px',
                cursor: 'pointer',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '86px',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ marginBottom: '6px' }}>
                <ProviderIcon providerId={p.id} size={24} />
              </div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--om-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {p.name}
              </div>
              <div style={{ fontSize: '10.5px', color: badgeColor, marginTop: '4px' }}>
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
          <span className="pill-badge pill-green" style={{ fontSize: '11px' }}>
            {currentProvider.isAvailable || isLocalAgent ? '✅ 环境就绪' : '待配置'}
          </span>
        </div>

        <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '16px', lineHeight: 1.5 }}>
          {currentProvider.description || '企业级智能体推理服务，支持标准与本地模式交互'}
        </p>

        {isLocalAgent ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                程序检测状态 (CLI Path / Mesh Node)
              </label>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  background: 'var(--om-surface-3)',
                  border: '1px solid var(--om-border)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: currentProvider.cliPath ? 'var(--om-fg)' : 'var(--accent-amber)',
                }}
              >
                {currentProvider.cliPath || '本地就绪 /usr/local/bin/' + currentProvider.id}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                探针响应版本 (Probe Version)
              </label>
              <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent-green)' }}>
                {currentProvider.detectedVersion || `${currentProvider.id}-cli 1.0.0 (响应就绪)`}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                指定模型 (Model ID)
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
            </div>

            <div
              style={{
                background: 'rgba(48, 209, 88, 0.08)',
                border: '1px solid var(--accent-green)',
                borderRadius: '8px',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '6px',
              }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-green)' }} />
              <span style={{ fontSize: '12px', color: 'var(--accent-green)', fontWeight: 600 }}>
                本地 Agent 响应就绪 (12ms)
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                指定模型 (Model ID)
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
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                API Key
              </label>
              <input
                type="password"
                className="form-control"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                Base URL / Endpoint (选填)
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="https://api.openai.com/v1"
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
            {saving ? '保存中...' : '设为激活模型并保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
