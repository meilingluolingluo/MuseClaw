import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { copyToClipboard } from '../../utils/clipboard';
import { useApp } from '../../context/AppContext';
import { Copy, Laptop, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react';

export const AddMachineModal: React.FC = () => {
  const { isAddMachineModalOpen, setIsAddMachineModalOpen, setIsModelModalOpen, setIsAuthModalOpen, user, showToast } = useApp();
  const [onlineNode, setOnlineNode] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8799';
  const token = user?.username || '';

  const installCmd = `# 1. 配置内网直连代理 (避免被全局代理拦截)
export NO_PROXY="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,localhost,127.0.0.1,*.baidu-int.com"
export no_proxy="$NO_PROXY"

# 2. 一键启动 MuseClaw 本地计算节点伴侣 (自动识别本机 ducc、ducx)
curl -fsSL "${origin}/runner/install.sh?token=${encodeURIComponent(token)}" | bash`;

  useEffect(() => {
    if (!isAddMachineModalOpen || !token) return;
    setPollError(null);
    let failCount = 0;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/runner/machines?userId=${encodeURIComponent(token)}`, {
          credentials: 'include'
        });
        if (res.status === 401) {
          setPollError('登录状态已过期，请重新登录以完成计算节点接入');
          clearInterval(timer);
          return;
        }
        if (res.ok) {
          failCount = 0;
          setPollError(null);
          const data = await res.json();
          const online = data.machines?.filter((m: any) => m.status === 'online') || [];
          if (online.length > 0) {
            setOnlineNode(online[0].hostname || online[0].id);
          }
        } else {
          failCount++;
          if (failCount >= 5) {
            setPollError('检测节点连接服务异常，请检查网络或后端网关状态');
            clearInterval(timer);
          }
        }
      } catch (err: any) {
        failCount++;
        if (failCount >= 5) {
          setPollError('检测服务网络连接异常，请检查网络连通性后重试');
          clearInterval(timer);
        }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [isAddMachineModalOpen, token, retryKey]);

  const handleCopy = async () => {
    if (!user) {
      showToast('请先登录员工账号后再复制接入命令', 'warning');
      setIsAuthModalOpen(true);
      return;
    }
    const success = await copyToClipboard(installCmd);
    if (success) {
      showToast('已复制整组接入命令到剪贴板！', 'success');
    } else {
      showToast('复制失败，请手动全选文本框内容复制', 'warning');
    }
  };

  const handleClose = () => {
    setIsAddMachineModalOpen(false);
    setIsModelModalOpen(true);
  };

  return (
    <Modal
      isOpen={isAddMachineModalOpen}
      onClose={handleClose}
      title="添加计算节点 · 个人电脑本地 Agent 接入"
      icon={<Laptop size={18} />}
      maxWidth="640px"
      zIndex={1100}
      footer={
        <div className="modal-actions-bar modal-actions-right">
          <button
            type="button"
            className="btn-primary"
            onClick={handleClose}
          >
            完成并返回
          </button>
        </div>
      }
    >
      {!user ? (
        <div className="add-machine-login-prompt" style={{ padding: '24px', textAlign: 'center', background: 'var(--om-surface)', borderRadius: '8px', border: '1px solid var(--om-border)' }}>
          <AlertTriangle size={24} style={{ color: 'var(--accent-orange)', marginBottom: '8px' }} />
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>尚未登录员工身份</h3>
          <p style={{ color: 'var(--text-dim)', fontSize: '13px', marginBottom: '16px' }}>
            接入的个人电脑计算节点将严格绑定至你的个人隔离空间。请先登录员工账号后再获取接入命令。
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setIsAddMachineModalOpen(false);
              setIsAuthModalOpen(true);
            }}
          >
            立即登录 / 切换身份
          </button>
        </div>
      ) : (
        <>
          <div className="add-machine-desc">
            在要连接的个人电脑（Mac 或 Linux）终端中，复制并运行以下整组命令。伴侣进程启动后，系统将自动识别并就绪你电脑上的 <code>ducc</code>、<code>ducx</code> 等本地 Agent。
          </div>

          <div className="add-machine-cmd-section">
            <div className="add-machine-cmd-header">
              <div className="add-machine-cmd-title">
                💻 个人电脑终端接入命令 <span className="add-machine-cmd-sub">(绑定员工: {user.displayName || user.username})</span>
              </div>
              <button
                type="button"
                className="btn-secondary add-machine-copy-btn"
                onClick={handleCopy}
              >
                <Copy size={11} /> <span>一键复制整组命令</span>
              </button>
            </div>

            <pre className="add-machine-cmd-pre">
              {installCmd}
            </pre>
          </div>

          <div className={`add-machine-status-box ${onlineNode ? 'is-online' : pollError ? 'is-failed' : 'is-waiting'}`}>
            {onlineNode ? (
              <>
                <CheckCircle2 size={16} className="add-machine-status-icon is-online" />
                <div className="add-machine-status-text is-online">
                  🎉 个人电脑计算节点已上线: {onlineNode}，本地 Agent 已成功连接就绪！
                </div>
              </>
            ) : pollError ? (
              <>
                <AlertTriangle size={16} className="add-machine-status-icon is-failed" style={{ color: 'var(--accent-red)' }} />
                <div className="add-machine-status-text is-failed" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span>{pollError}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setRetryKey((k) => k + 1)}
                    style={{ padding: '2px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <RotateCcw size={11} /> 重试
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="add-machine-spinner" />
                <div className="add-machine-status-text is-waiting">
                  正在等待个人电脑计算节点连接... (请在终端运行上方命令)
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
};
