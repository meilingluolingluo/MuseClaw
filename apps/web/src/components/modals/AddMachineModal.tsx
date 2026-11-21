import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { copyToClipboard } from '../../utils/clipboard';
import { useApp } from '../../context/AppContext';
import { Copy, Laptop, CheckCircle2 } from 'lucide-react';

export const AddMachineModal: React.FC = () => {
  const { isAddMachineModalOpen, setIsAddMachineModalOpen, setIsModelModalOpen, user, showToast } = useApp();
  const [onlineNode, setOnlineNode] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8799';
  const token = user?.username || 'user_default';

  const installCmd = `# 1. 配置内网直连代理 (避免被全局代理拦截)
export NO_PROXY="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,localhost,127.0.0.1,*.baidu-int.com"
export no_proxy="$NO_PROXY"

# 2. 一键启动 MuseClaw 本地计算节点伴侣 (自动识别本机 ducc、ducx)
curl -fsSL "${origin}/runner/install.sh?token=${encodeURIComponent(token)}" | bash`;

  useEffect(() => {
    if (!isAddMachineModalOpen) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/runner/machines?userId=${encodeURIComponent(token)}`, {
          credentials: 'include'
        });
        if (res.ok) {
          const data = await res.json();
          const online = data.machines?.filter((m: any) => m.status === 'online') || [];
          if (online.length > 0) {
            setOnlineNode(online[0].hostname || online[0].id);
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [isAddMachineModalOpen, token]);

  const handleCopy = async () => {
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
      <div className="add-machine-desc">
        在要连接的个人电脑（Mac 或 Linux）终端中，复制并运行以下整组命令。伴侣进程启动后，系统将自动识别并就绪你电脑上的 <code>ducc</code>、<code>ducx</code> 等本地 Agent。
      </div>

      <div className="add-machine-cmd-section">
        <div className="add-machine-cmd-header">
          <div className="add-machine-cmd-title">
            💻 个人电脑终端接入命令 <span className="add-machine-cmd-sub">(免安装依赖 · Node.js 即时运行)</span>
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

      <div className={`add-machine-status-box ${onlineNode ? 'is-online' : 'is-waiting'}`}>
        {onlineNode ? (
          <>
            <CheckCircle2 size={16} className="add-machine-status-icon is-online" />
            <div className="add-machine-status-text is-online">
              🎉 个人电脑计算节点已上线: {onlineNode}，本地 Agent 已成功连接就绪！
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
    </Modal>
  );
};
