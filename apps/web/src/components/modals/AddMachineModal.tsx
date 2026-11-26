import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { copyToClipboard } from '../../utils/clipboard';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import type { RunnerMachine } from '../../types';
import { Copy, Laptop, CheckCircle2, AlertTriangle, RotateCcw, Terminal, Monitor } from 'lucide-react';

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
  const [machines, setMachines] = useState<RunnerMachine[]>([]);
  const [pollError, setPollError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8799';
  const token = user?.username || '';

  const unixCmd = includeNoProxy
    ? `# 1. 如在企业内网环境，可按需放行局域网直连\nexport NO_PROXY="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,localhost,127.0.0.1"\nexport no_proxy="$NO_PROXY"\n\n# 2. 启动 MuseClaw 本地计算节点伴侣（自动识别 Claude Code、Codex、Pi 等）\ncurl -fsSL "${origin}/runner/install.sh?token=${encodeURIComponent(token)}" | bash`
    : `# 在终端执行以下命令，自动接入本机 Claude Code / Codex / Pi 等本地 Agent\ncurl -fsSL "${origin}/runner/install.sh?token=${encodeURIComponent(token)}" | bash`;

  const winCmd = `# 在 Windows PowerShell 中执行以下命令启动计算节点伴侣\n$env:MUSECLAW_SERVER_URL="${origin}"\n$env:MUSECLAW_TOKEN="${token}"\nirm "${origin}/runner/install.ps1?token=${encodeURIComponent(token)}" | iex`;

  const installCmd = platformTab === 'unix' ? unixCmd : winCmd;

  useEffect(() => {
    if (!isAddMachineModalOpen || !token) return;
    setPollError(null);
    let failCount = 0;

    const pollMachines = async () => {
      try {
        const data = await api.getRunnerMachines(token);
        failCount = 0;
        setPollError(null);
        setMachines(data.machines || []);
      } catch (err: any) {
        if (String(err?.message || '').includes('401')) {
          setPollError('登录状态已过期，请重新登录以完成计算节点接入');
          return;
        }
        failCount++;
        if (failCount >= 5) {
          setPollError('检测计算节点服务异常，请检查网络或网关状态');
        }
      }
    };

    void pollMachines();
    const timer = setInterval(() => {
      void pollMachines();
    }, 2500);
    return () => clearInterval(timer);
  }, [isAddMachineModalOpen, token, retryKey]);

  const onlineMachines = machines.filter((m) => m.status === 'online');

  const handleCopy = async () => {
    if (!user) {
      showToast('请先登录账号后再复制接入命令', 'warning');
      setIsAuthModalOpen(true);
      return;
    }
    const success = await copyToClipboard(installCmd);
    if (success) {
      showToast('已复制接入命令到剪贴板！', 'success');
    } else {
      const preEl = document.querySelector('.add-machine-cmd-pre');
      if (preEl) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(preEl);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      showToast('已全选接入命令，可直接按 Cmd+C / Ctrl+C 复制', 'info');
    }
  };

  const handleClose = () => {
    setIsAddMachineModalOpen(false);
    void loadModelsConfig(true);
    setIsModelModalOpen(true);
  };

  return (
    <Modal
      isOpen={isAddMachineModalOpen}
      onClose={handleClose}
      title="接入个人电脑计算节点 · 本地 Agent 桥接"
      icon={<Laptop size={18} />}
      maxWidth="680px"
      zIndex={1100}
      footer={
        <div className="modal-actions-bar modal-actions-right">
          <button type="button" className="btn-primary" onClick={handleClose}>
            完成并返回配置中心
          </button>
        </div>
      }
    >
      {!user ? (
        <div className="add-machine-login-prompt">
          <AlertTriangle size={24} className="add-machine-login-icon" />
          <h3 className="add-machine-login-title">尚未登录账号</h3>
          <p className="add-machine-login-desc">
            接入的计算节点将绑定至你的个人隔离空间。请先登录账号后再获取接入命令。
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setIsAddMachineModalOpen(false);
              setIsAuthModalOpen(true);
            }}
          >
            立即登录 / 注册
          </button>
        </div>
      ) : (
        <>
          <div className="add-machine-desc">
            如果 Web 网关部署在远端服务器，只需在你的个人电脑终端运行一次伴侣脚本，即可将本机的{' '}
            <code>Claude Code</code>、<code>Codex</code>、<code>Pi</code> 等本地 Agent 安全桥接到当前 Web 工作台。
          </div>

          <div className="add-machine-platform-bar">
            <div className="add-machine-platform-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={platformTab === 'unix'}
                className={`add-machine-platform-tab ${platformTab === 'unix' ? 'is-active' : ''}`}
                onClick={() => setPlatformTab('unix')}
              >
                <Terminal size={13} />
                <span>macOS / Linux / WSL</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={platformTab === 'windows'}
                className={`add-machine-platform-tab ${platformTab === 'windows' ? 'is-active' : ''}`}
                onClick={() => setPlatformTab('windows')}
              >
                <Monitor size={13} />
                <span>Windows (PowerShell)</span>
              </button>
            </div>

            {platformTab === 'unix' && (
              <label className="add-machine-proxy-toggle">
                <input
                  type="checkbox"
                  checked={includeNoProxy}
                  onChange={(e) => setIncludeNoProxy(e.target.checked)}
                />
                <span>附加内网 NO_PROXY</span>
              </label>
            )}
          </div>

          <div className="add-machine-cmd-section">
            <div className="add-machine-cmd-header">
              <div className="add-machine-cmd-title">
                终端接入命令{' '}
                <span className="add-machine-cmd-sub">
                  (绑定用户: {user.displayName || user.username})
                </span>
              </div>
              <button
                type="button"
                className="btn-secondary add-machine-copy-btn"
                onClick={handleCopy}
              >
                <Copy size={11} /> <span>一键复制命令</span>
              </button>
            </div>

            <pre
              className="add-machine-cmd-pre"
              title="点击可全选命令文本"
              onClick={(e) => {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(e.currentTarget);
                selection?.removeAllRanges();
                selection?.addRange(range);
              }}
            >
              {installCmd}
            </pre>
          </div>

          {onlineMachines.length > 0 ? (
            <div className="add-machine-nodes-list">
              <div className="add-machine-nodes-header">
                <CheckCircle2 size={15} className="add-machine-status-icon is-online" />
                <span>已在线计算节点 ({onlineMachines.length})</span>
              </div>
              {onlineMachines.map((m) => (
                <div key={m.id} className="add-machine-node-card">
                  <div className="add-machine-node-top">
                    <div className="add-machine-node-name">
                      <span className="add-machine-node-dot" />
                      <span>{m.hostname}</span>
                    </div>
                    <span className="add-machine-node-platform">
                      {m.platform} / {m.arch}
                    </span>
                  </div>
                  <div className="add-machine-node-runtimes">
                    {m.runtimes && m.runtimes.length > 0 ? (
                      m.runtimes.map((rt) => (
                        <span
                          key={rt.id}
                          className={`add-machine-runtime-pill ${rt.status === 'unauthenticated' ? 'is-warning' : 'is-ready'}`}
                        >
                          <span>{rt.id}</span>
                          {rt.version ? <span className="add-machine-runtime-ver">{rt.version.split(' ')[0]}</span> : null}
                          {rt.status === 'unauthenticated' ? <span>· 需认证</span> : null}
                        </span>
                      ))
                    ) : (
                      <span className="add-machine-node-empty">暂未检测到本地 Agent</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={`add-machine-status-box ${pollError ? 'is-failed' : 'is-waiting'}`}>
              {pollError ? (
                <>
                  <AlertTriangle size={16} className="add-machine-status-icon is-failed" />
                  <div className="add-machine-status-text is-failed">
                    <span>{pollError}</span>
                    <button
                      type="button"
                      className="btn-secondary add-machine-retry-btn"
                      onClick={() => setRetryKey((k) => k + 1)}
                    >
                      <RotateCcw size={11} /> 重试
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="add-machine-spinner" />
                  <div className="add-machine-status-text is-waiting">
                    正在等待个人电脑计算节点上线...（请在终端运行上方命令）
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
};
