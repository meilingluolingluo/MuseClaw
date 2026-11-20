import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { copyToClipboard } from '../../utils/clipboard';
import { useApp } from '../../context/AppContext';
import { Copy, Laptop, CheckCircle2 } from 'lucide-react';

export const AddMachineModal: React.FC = () => {
  const { isAddMachineModalOpen, setIsAddMachineModalOpen, user, showToast } = useApp();
  const [onlineNode, setOnlineNode] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8799';
  const token = user?.username || 'user_default';

  const installCmd = `# 1. 配置内网直连代理 (防止内网 IP 被全局代理拦截)
export no_proxy=".bcebos.com,.duckdns.org,.ai-chat.host,.baidu-int.com,10.0.0.0/8,localhost,127.0.0.1\${no_proxy:+,\$no_proxy}"
export NO_PROXY="$no_proxy"

# 2. 一键启动 MuseClaw 本地计算节点伴侣 (自动识别本机 ducc、ducx)
curl -fsSL "${origin}/runner/install.sh?token=${encodeURIComponent(token)}" | bash`;

  useEffect(() => {
    if (!isAddMachineModalOpen) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/runner/machines?userId=${encodeURIComponent(token)}`);
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

  return (
    <Modal
      isOpen={isAddMachineModalOpen}
      onClose={() => setIsAddMachineModalOpen(false)}
      title="添加计算节点 · 个人电脑本地 Agent 接入"
      icon={<Laptop size={18} />}
      maxWidth="640px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setIsAddMachineModalOpen(false)}
          >
            完成并返回
          </button>
        </div>
      }
    >
      <div style={{ fontSize: '13px', color: 'var(--om-muted)', marginBottom: '14px', lineHeight: 1.5 }}>
        在要连接的个人电脑（Mac 或 Linux）终端中，复制并运行以下整组命令。伴侣进程启动后，系统将自动识别并就绪你电脑上的 <code>ducc</code>、<code>ducx</code> 等本地 Agent。
      </div>

      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--om-fg)' }}>
            💻 个人电脑终端接入命令 <span style={{ fontSize: '11px', color: 'var(--om-muted)', fontWeight: 400 }}>(免安装依赖 · Node.js 即时运行)</span>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleCopy}
            style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Copy size={11} /> 📋 一键复制整组命令
          </button>
        </div>

        <pre
          style={{
            background: 'var(--om-surface-3)',
            border: '1px solid var(--om-border)',
            borderRadius: '8px',
            padding: '12px',
            fontFamily: 'monospace',
            fontSize: '12px',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: 'var(--om-fg)',
            userSelect: 'all',
          }}
        >
          {installCmd}
        </pre>
      </div>

      <div
        style={{
          background: onlineNode ? 'rgba(48, 209, 88, 0.08)' : 'var(--om-surface-2)',
          border: `1px solid ${onlineNode ? 'var(--accent-green)' : 'var(--om-border)'}`,
          borderRadius: '10px',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        {onlineNode ? (
          <>
            <CheckCircle2 size={16} style={{ color: 'var(--accent-green)' }} />
            <div style={{ fontSize: '12px', color: 'var(--accent-green)', fontWeight: 600 }}>
              🎉 个人电脑计算节点已上线: {onlineNode}，本地 Agent 已成功连接就绪！
            </div>
          </>
        ) : (
          <>
            <span
              style={{
                display: 'inline-block',
                width: '14px',
                height: '14px',
                border: '2px solid var(--om-border)',
                borderTopColor: 'var(--accent-blue)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <div style={{ fontSize: '12px', color: 'var(--om-muted)' }}>
              正在等待个人电脑计算节点连接... (请在终端运行上方命令)
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
