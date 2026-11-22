import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { Palette, CheckCircle, AlertCircle, RefreshCw, Key, Globe, Shield } from 'lucide-react';
import { api } from '../../services/api';

export interface ImageProviderItem {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  candidateModels: string[];
  apiKey?: string;
  hasKey?: boolean;
  maskedKey?: string;
  description: string;
  enabled?: boolean;
}

export const ImageModelSettingsModal: React.FC = () => {
  const {
    isImageModelModalOpen,
    setIsImageModelModalOpen,
    setIsModelModalOpen,
    showToast,
  } = useApp();

  const [activeProviderId, setActiveProviderId] = useState<string>('siliconflow');
  const [providers, setProviders] = useState<ImageProviderItem[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('siliconflow');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string; models?: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.getImageModelsConfig();
      if (data && Array.isArray(data.providers)) {
        setProviders(data.providers);
        const activeId = data.activeProviderId || 'siliconflow';
        setActiveProviderId(activeId);
        setSelectedProviderId(activeId);
        const activeP = data.providers.find((p) => p.id === activeId);
        if (activeP) {
          setModelId(activeP.model || activeP.candidateModels?.[0] || '');
          setApiKey(activeP.apiKey || '');
          setEndpoint(activeP.baseUrl || '');
        }
      }
    } catch (err: any) {
      showToast(`加载生图配置失败: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isImageModelModalOpen) {
      loadConfig();
      setTestResult(null);
    }
  }, [isImageModelModalOpen]);

  const handleSelectProvider = (p: ImageProviderItem) => {
    setSelectedProviderId(p.id);
    setModelId(p.model || p.candidateModels?.[0] || '');
    setApiKey(p.apiKey || '');
    setEndpoint(p.baseUrl || '');
    setTestResult(null);
  };

  const currentProvider = providers.find((p) => p.id === selectedProviderId) || {
    id: selectedProviderId,
    name: selectedProviderId,
    baseUrl: '',
    model: '',
    candidateModels: [],
    description: '',
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testImageModel({
        id: currentProvider.id,
        model: modelId,
        apiKey: apiKey || undefined,
        baseUrl: endpoint || undefined,
      });
      setTestResult(res);
      if (res.ok) {
        showToast(`连通性验证成功 (${res.latencyMs}ms)`, 'success');
      } else {
        showToast(`连通性测试未通过: ${res.error || '连接超时'}`, 'error');
      }
    } catch (err: any) {
      setTestResult({ ok: false, latencyMs: 0, error: err.message });
      showToast(`测试失败: ${err.message}`, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveImageModelsConfig({
        activeProviderId: selectedProviderId,
        provider: {
          id: selectedProviderId,
          model: modelId,
          baseUrl: endpoint || undefined,
          apiKey: apiKey || undefined,
        },
      });
      showToast('生图模型配置已保存，已更新为默认生图引擎', 'success');
      await loadConfig();
      setIsImageModelModalOpen(false);
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const isCurrentActive = selectedProviderId === activeProviderId;

  return (
    <Modal
      isOpen={isImageModelModalOpen}
      onClose={() => setIsImageModelModalOpen(false)}
      title="独立生图模型配置中心 (Image Generation Engines)"
      icon={<Palette size={18} />}
      maxWidth="780px"
      zIndex={1000}
    >
      {/* 顶部模块类型清晰分流 Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '16px',
          borderBottom: '1px solid var(--om-border, #e5e7eb)',
          paddingBottom: '10px',
        }}
      >
        <button
          type="button"
          onClick={() => {
            setIsImageModelModalOpen(false);
            setIsModelModalOpen(true);
          }}
          style={{
            padding: '7px 16px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            background: 'var(--om-bg-subtle, #f3f4f6)',
            color: 'var(--om-text-secondary, #4b5563)',
            border: '1px solid var(--om-border, #e5e7eb)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          💬 对话与推理模型 (LLM)
        </button>
        <button
          type="button"
          style={{
            padding: '7px 16px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            background: '#8b5cf6',
            color: '#fff',
            border: 'none',
            cursor: 'default',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Palette size={14} /> 🎨 图像生成模型 (独立配置)
        </button>
      </div>

      {/* 说明横幅 */}
      <div className="image-model-header-banner">
        <div>
          <span className="image-model-header-title">专属于虚拟形象与绘图工坊的生图模型管理</span>
          <div className="image-model-header-desc">
            与对话推理模型完全物理隔离，独立设定绘图 API Key、模型与服务商。
          </div>
        </div>
        <span className="image-model-active-badge">
          当前生效: {providers.find((p) => p.id === activeProviderId)?.name || activeProviderId}
        </span>
      </div>

      {/* 生图服务商网格 */}
      <div className="model-providers-grid">
        {providers.map((p) => {
          const isSelected = p.id === selectedProviderId;
          const isActive = p.id === activeProviderId;
          const isReady = Boolean(p.hasKey || p.apiKey || p.id === 'builtin');

          let badgeText = '待配置 Key';
          let isBadgeGreen = false;
          if (isActive) {
            badgeText = '● 正在使用';
            isBadgeGreen = true;
          } else if (p.id === 'builtin') {
            badgeText = '离线就绪';
            isBadgeGreen = true;
          } else if (isReady) {
            badgeText = '凭证已就绪';
            isBadgeGreen = true;
          }

          return (
            <div
              key={p.id}
              className={`model-provider-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handleSelectProvider(p)}
              style={{
                cursor: 'pointer',
                border: isSelected ? '2px solid #8b5cf6' : undefined,
              }}
            >
              <div className="model-provider-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isSelected ? 'rgba(139, 92, 246, 0.15)' : 'var(--om-bg-subtle, #f3f4f6)',
                      color: isSelected ? '#8b5cf6' : 'var(--om-text, #374151)',
                    }}
                  >
                    <Palette size={16} />
                  </div>
                  <div>
                    <div className="model-provider-name" style={{ fontWeight: 600 }}>
                      {p.name}
                    </div>
                  </div>
                </div>
                <span className={`model-provider-badge ${isBadgeGreen ? 'active' : 'inactive'}`}>
                  {badgeText}
                </span>
              </div>
              <div className="model-provider-desc" style={{ fontSize: '12px', marginTop: '6px' }}>
                {p.description}
              </div>
            </div>
          );
        })}
      </div>

      {/* 参数表单配置区 */}
      <div
        className="model-config-form"
        style={{
          marginTop: '16px',
          padding: '16px',
          background: 'var(--om-card-bg, #fff)',
          borderRadius: '8px',
          border: '1px solid var(--om-border, #e5e7eb)',
        }}
      >
        <div className="flex-between-center mb-14">
          <div>
            <span className="font-semibold text-sm">
              {currentProvider.name} 参数设定
            </span>
            <span className="text-muted text-xs ml-2">
              ({currentProvider.id})
            </span>
          </div>
          {isCurrentActive ? (
            <span className="image-model-status-ready">
              <CheckCircle size={14} /> 当前生图引擎
            </span>
          ) : (
            <span className="image-model-status-unready">
              未激活（点击保存可激活此引擎）
            </span>
          )}
        </div>

        {currentProvider.id === 'builtin' ? (
          <div className="callout-card text-sm">
            内置离线自适应矢量引擎无需配置 API Key 或网络地址，可在离线环境下秒级生成风格化角色形象。
          </div>
        ) : (
          <div className="image-model-form-group">
            {/* 模型选择 */}
            <div>
              <label className="image-model-form-label">
                图像生成模型 (Model ID):
              </label>
              {currentProvider.candidateModels && currentProvider.candidateModels.length > 0 ? (
                <div className="flex-gap-8">
                  <select
                    className="input-text flex-1"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                  >
                    {currentProvider.candidateModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="input-text flex-1"
                    placeholder="或直接输入自定义模型标识"
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                  />
                </div>
              ) : (
                <input
                  type="text"
                  className="input-text w-full"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                />
              )}
            </div>

            {/* Base URL */}
            <div>
              <label className="image-model-form-label">
                服务接口端点 (Base URL):
              </label>
              <div className="image-model-input-wrap">
                <input
                  type="text"
                  className="input-text image-model-input-field"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://..."
                />
                <Globe size={15} className="image-model-input-icon" />
              </div>
            </div>

            {/* API Key */}
            <div>
              <div className="flex-between-center mb-6">
                <label className="image-model-form-label">
                  API 访问密钥 (API Key):
                </label>
                {currentProvider.hasKey && (
                  <span className="image-model-status-ready text-xs">
                    <Shield size={12} /> 环境中已配置秘钥 ({currentProvider.maskedKey})
                  </span>
                )}
              </div>
              <div className="image-model-input-wrap">
                <input
                  type="password"
                  className="input-text image-model-input-field"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={currentProvider.hasKey ? '已读取环境变量/本地凭据 (留空保持原秘钥)' : '请输入 API 密钥 (如 sk-...)'}
                />
                <Key size={15} className="image-model-input-icon" />
              </div>
            </div>

            {/* 连通性测试结果面板 */}
            {testResult && (
              <div className={`image-model-test-panel ${testResult.ok ? 'is-success' : 'is-fail'}`}>
                <div className="flex-center-gap-8">
                  {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                  <span>
                    {testResult.ok
                      ? `服务鉴权通过！响应延迟: ${testResult.latencyMs}ms`
                      : `连接失败: ${testResult.error || '未响应'}`}
                  </span>
                </div>
                {testResult.models && (
                  <span className="text-xs color-green-700">
                    探测到 {testResult.models.length} 个可用生图模型
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* 底部按钮栏 */}
        <div className="flex-end-gap-10 mt-18">
          {currentProvider.id !== 'builtin' && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleTest}
              disabled={isTesting}
            >
              <RefreshCw size={14} className={isTesting ? 'spin' : ''} />
              {isTesting ? '正在测试连通性...' : '测试连通性'}
            </button>
          )}

          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '正在保存...' : '设为默认生图引擎'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
