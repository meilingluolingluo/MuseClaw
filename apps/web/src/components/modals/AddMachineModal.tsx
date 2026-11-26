import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { copyToClipboard } from '../../utils/clipboard';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import type { EnvironmentInfo } from '../../types';
import { AlertTriangle, CheckCircle2, Copy, Laptop, Monitor, RotateCcw, Terminal } from 'lucide-react';

type PlatformTab = 'unix' | 'windows';

export const AddMachineModal: React.FC = () => {
  const {
    isAddMachineModalOpen,
    setIsAddMachineModalOpen,
    setIsModelModalOpen,
    setIsAuthModalOpen,
    user,
    loadModelsConfig,
    showToast,
  } = useApp();

  const [platformTab, setPlatformTab] = useState<PlatformTab>('unix');
  const [includeNoProxy, setIncludeNoProxy] = useState(false);
  const [environments, setEnvironments] = useState<EnvironmentInfo[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8799';
  const token = user?.username || '';

  const unixCmd = includeNoProxy
    ? `# 1. 局域网直连免代理\nexport NO_PROXY="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,localhost,127.0.0.1"\nexport no_proxy="$NO_PROXY"\n\n# 2. 启动 MuseClaw Environment Daemon (WebSocket 长连接)\ncurl -fsSL "${origin}/runner/install.sh?token=${encodeURIComponent(token)}" | bash`
    : `# 在本机终端执行，通过 WebSocket 长连接接入 Claude Code / Codex / Pi / Ollama\ncurl -fsSL "${origin}/runner/install.sh?token=${encodeURIComponent(token)}" | bash`;

  const winCmd = `# 在 Windows PowerShell 中执行，启动 MuseClaw Environment Daemon\n$env:MUSECLAW_SERVER_URL="${origin}"\n$env:MUSECLAW_TOKEN="${token}"\nirm "${origin}/runner/install.ps1?token=${encodeURIComponent(token)}" | iex`;

  const installCmd = platformTab === 'unix' ? unixCmd : winCmd;

  useEffect(() => {
    if (!isAddMachineModalOpen || !token) return;
    setPollError(null);
    let failCount = 0;

    const pollEnvironments = async () => {
      try {
        const data = await api.getEnvironments();
        failCount = 0;
        setPollError(null);
        setEnvironments(data.environments || []);
      } catch (err: any) {
        if (String(err?.message || '').includes('401')) {
          setPollError('登录状态已过期，请重新登录以完成计算环境接入');
          return;
        }
        failCount++;
        if (failCount >= 3) {
          setPollError('暂时无法获取环境列表，请检查网关服务状态');
        }
      }
    };

    void pollEnvironments();
    const timer = setInterval(pollEnvironments, 3000);
    return () => clearInterval(timer);
  }, [isAddMachineModalOpen, token, retryKey]);

  const remoteEnvs = environments.filter((env) => env.kind === 'remote');
  const onlineRemoteEnvs = remoteEnvs.filter((env) => env.status === 'online');

  const handleCopy = async () => {
    const ok = await copyToClipboard(installCmd);
    if (ok) {
      showToast('接入命令已复制到剪贴板', 'success');
    } else {
      showToast('复制失败，请手动选中命令复制', 'warning');
    }
  };

  const handleComplete = async () => {
    await loadModelsConfig(true);
    setIsAddMachineModalOpen(false);
    setIsModelModalOpen(true);
    showToast('已同步远程计算环境清单', 'success');
  };

  return (
    <Modal
      isOpen={isAddMachineModalOpen}
      onClose={() => setIsAddMachineModalOpen(false)}
      title="连接我的电脑 / 远程计算环境 (WebSocket 桥接)"
      maxWidth="640px"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsAddMachineModalOpen(false)}
          >
            关闭
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleComplete}
            disabled={onlineRemoteEnvs.length === 0}
          >
            完成并返回模型配置 ({onlineRemoteEnvs.length} 台在线)
          </button>
        </>
      }
    >
      <p className="add-machine-desc">
        在您自己的电脑上运行轻量级 Environment Daemon，通过加密双向 WebSocket 长连接实时汇报本地
        Claude Code、Codex、Pi 与 Ollama 运行状态，并在网页端安全触发对话、工具调用与审批控制。
      </p>

      {!token ? (
        <div className="add-machine-status-box is-waiting">
          <AlertTriangle size={16} className="model-test-icon is-warning" />
          <span className="add-machine-status-text is-waiting">
            请先登录员工身份，再生成绑定的 WebSocket 环境接入凭证。
          </span>
          <button
            type="button"
            className="btn-primary btn-xs"
            onClick={() => {
              setIsAddMachineModalOpen(false);
              setIsAuthModalOpen(true);
            }}
          >
            前往登录
          </button>
        </div>
      ) : (
        <>
          <div className="add-machine-platform-bar">
            <div className="add-machine-platform-tabs" role="tablist" aria-label="目标系统平台">
              <button
                type="button"
                role="tab"
                aria-selected={platformTab === 'unix'}
                className={`add-machine-platform-tab${platformTab === 'unix' ? ' is-active' : ''}`}
                onClick={() => setPlatformTab('unix')}
              >
                <Terminal size={13} />
                <span>macOS / Linux / WSL</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={platformTab === 'windows'}
                className={`add-machine-platform-tab${platformTab === 'windows' ? ' is-active' : ''}`}
                onClick={() => setPlatformTab('windows')}
              >
                <Monitor size={13} />
                <span>Windows PowerShell</span>
              </button>
            </div>

            {platformTab === 'unix' && (
              <label className="add-machine-proxy-toggle">
                <input
                  type="checkbox"
                  checked={includeNoProxy}
                  onChange={(e) => setIncludeNoProxy(e.target.checked)}
                />
                <span>内网免代理 (NO_PROXY)</span>
              </label>
            )}
          </div>

          <div className="add-machine-cmd-section">
            <div className="add-machine-cmd-header">
              <span className="add-machine-cmd-title">
                一键安装与上线命令
                <span className="add-machine-cmd-sub"> · 自动安装 ws 与官方 SDK 依赖</span>
              </span>
              <button
                type="button"
                className="btn-secondary add-machine-copy-btn"
                onClick={handleCopy}
              >
                <Copy size={12} />
                <span>复制命令</span>
              </button>
            </div>
            <pre className="add-machine-cmd-pre">{installCmd}</pre>
          </div>

          {pollError ? (
            <div className="add-machine-status-box is-waiting">
              <AlertTriangle size={15} className="model-test-icon is-warning" />
              <span className="add-machine-status-text is-waiting">{pollError}</span>
              <button
                type="button"
                className="btn-secondary btn-xs"
                onClick={() => setRetryKey((k) => k + 1)}
              >
                <RotateCcw size={12} />
                <span>重试</span>
              </button>
            </div>
          ) : onlineRemoteEnvs.length === 0 ? (
            <div className="add-machine-status-box is-waiting">
              <span className="add-machine-spinner" aria-hidden="true" />
              <span className="add-machine-status-text is-waiting">
                正在等待您的设备通过 WebSocket 上线连接（每 3 秒自动刷新）…
              </span>
            </div>
          ) : (
            <div className="add-machine-nodes-list">
              <div className="model-test-heading">
                <CheckCircle2 size={14} className="model-test-icon is-success" />
                <span>已连接的计算环境 ({onlineRemoteEnvs.length})</span>
              </div>
              {onlineRemoteEnvs.map((env) => (
                <div key={env.environmentId} className="add-machine-node-card">
                  <div className="add-machine-node-top">
                    <span className="add-machine-node-name">
                      <span className="add-machine-node-dot" />
                      <Laptop size={14} />
                      <span>{env.label || env.hostname}</span>
                    </span>
                    <span className="add-machine-node-platform">
                      {env.platform}/{env.arch} · {env.environmentId}
                    </span>
                  </div>
                  {env.snapshots && env.snapshots.length > 0 ? (
                    <div className="add-machine-node-runtimes">
                      {env.snapshots.map((snap) => (
                        <span
                          key={snap.instanceId}
                          className={`add-machine-runtime-pill ${
                            snap.status === 'ready'
                              ? 'is-ready'
                              : snap.installed
                              ? 'is-warning'
                              : ''
                          }`}
                        >
                          <span>{snap.displayName}</span>
                          {snap.version && (
                            <span className="add-machine-runtime-ver">{snap.version}</span>
                          )}
                          <span>· {snap.status}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="add-machine-node-empty">等待环境上报已安装的 CLI 运行时…</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
};
