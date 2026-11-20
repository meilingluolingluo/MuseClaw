import React, { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, Trash2 } from 'lucide-react';
import type { Grant, AuditLog } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatTime } from '../../utils/format';

export const AuditView: React.FC = () => {
  const { showToast } = useApp();
  const [policy, setPolicy] = useState<any>({});
  const [grants, setGrants] = useState<Grant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [p, g, a] = await Promise.all([
        api.getPolicy(),
        api.getGrants(),
        api.getAuditLogs(),
      ]);
      setPolicy(p || {});
      setGrants(Array.isArray(g) ? g : []);
      setAuditLogs(Array.isArray(a) ? a : []);
    } catch (err) {
      console.error('Failed to load audit data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRevokeGrant = async (id: string) => {
    try {
      await api.revokeGrant(id);
      setGrants((prev) => prev.filter((g) => g.id !== id));
      showToast('已撤销该授权条目', 'success');
    } catch (err: any) {
      showToast(`撤销失败: ${err.message}`, 'error');
    }
  };

  return (
    <section className="view-stage">
      <div className="view-header">
        <div>
          <div className="view-heading">
            <ShieldCheck size={18} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }} />
            安全策略与合规审计 (Security & Audit)
          </div>
          <div className="view-sub">声明式策略配置、已授予的复用权限 (Grants) 以及全生命周期追加式审计追踪流 (AuditLog)</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-secondary" onClick={loadData} disabled={loading}>
            <RefreshCw size={14} /> 刷新审计流
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
        {/* Declarative policy card */}
        <div style={{ background: 'var(--om-surface)', border: '1px solid var(--om-border)', borderRadius: '12px', padding: '18px' }}>
          <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '12px' }}>
            🛡️ 声明式安全策略 (sentinel-policy.json)
          </div>
          <pre style={{ margin: 0, fontSize: '12px', color: 'var(--text-dim)', maxHeight: '180px', overflowY: 'auto' }}>
            {JSON.stringify(policy, null, 2)}
          </pre>
        </div>

        {/* Grants store */}
        <div style={{ background: 'var(--om-surface)', border: '1px solid var(--om-border)', borderRadius: '12px', padding: '18px' }}>
          <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
            <span>📜 活跃复用授权 (Grants)</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{grants.length} 个授权</span>
          </div>
          <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {grants.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>暂无活跃授权</div>
            ) : (
              grants.map((grant) => (
                <div
                  key={grant.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'var(--om-surface-2)',
                    fontSize: '12px',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600 }}>{grant.scope}</span>: {grant.permission}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeGrant(grant.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)' }}
                    title="撤销"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Audit trail table */}
      <div style={{ background: 'var(--om-surface)', border: '1px solid var(--om-border)', borderRadius: '12px', padding: '18px' }}>
        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '12px' }}>
          📋 结构化操作审计流水 (Audit Trail)
        </div>
        <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--om-border)', color: 'var(--text-dim)' }}>
                <th style={{ padding: '8px' }}>时间戳</th>
                <th style={{ padding: '8px' }}>事件类型</th>
                <th style={{ padding: '8px' }}>涉及目标</th>
                <th style={{ padding: '8px' }}>裁决 / 详情</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)' }}>
                    暂无审计记录
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--om-border)' }}>
                    <td style={{ padding: '8px', color: 'var(--text-dim)' }}>{formatTime(log.timestamp)}</td>
                    <td style={{ padding: '8px' }}>
                      <span className="pill-badge pill-blue" style={{ fontSize: '10px' }}>{log.eventType}</span>
                    </td>
                    <td style={{ padding: '8px' }}>{log.target || '-'}</td>
                    <td style={{ padding: '8px' }}>{log.decision || log.details || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
