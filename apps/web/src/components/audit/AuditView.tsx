import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
  const revokeTimerRef = useRef<any>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [p, g, a] = await Promise.all([
        api.getPolicy(),
        api.getGrants(),
        api.getAuditLogs(),
      ]);
      setPolicy(p || {});
      setGrants(Array.isArray(g) ? g : []);
      setAuditLogs(Array.isArray(a) ? a : []);
    } catch (err: any) {
      console.error('Failed to load audit data:', err);
      setLoadError(err.message || '安全审计数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRevokeGrant = async (id: string) => {
    if (revokingGrantId !== id) {
      setRevokingGrantId(id);
      if (revokeTimerRef.current) clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = setTimeout(() => setRevokingGrantId(null), 3500);
      return;
    }
    if (revokeTimerRef.current) clearTimeout(revokeTimerRef.current);
    setRevokingGrantId(null);

    try {
      await api.revokeGrant(id);
      setGrants((prev) => prev.filter((g) => g.id !== id));
      showToast('已撤销该授权条目', 'success');
    } catch (err: any) {
      showToast(`撤销失败: ${err.message}`, 'error');
    }
  };

  return (
    <section className="view-stage audit-stage" aria-label="安全策略与合规审计">
      <div className="view-header audit-header-wrap">
        <div>
          <div className="view-heading audit-heading">
            <ShieldCheck size={20} className="audit-heading-icon" />
            <span>安全策略与合规审计</span>
          </div>
          <div className="view-sub audit-sub">
            声明式策略配置、已授予的复用权限 (Grants) 以及全生命周期追加式审计追踪流 (AuditLog)。
          </div>
        </div>
        <div className="audit-header-actions">
          <button type="button" className="btn-secondary audit-refresh-btn" onClick={loadData} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>刷新审计流</span>
          </button>
        </div>
      </div>

      {loadError && (
        <div className="view-load-error is-spaced" role="alert">
          <AlertTriangle size={14} />
          <span>审计数据加载失败：{loadError}</span>
          <button type="button" onClick={loadData} disabled={loading}>重试</button>
        </div>
      )}

      <div className="audit-top-grid">
        {/* Declarative policy card */}
        <div className="audit-card">
          <div className="audit-card-title">
            🛡️ 声明式安全策略 (sentinel-policy.json)
          </div>
          <pre className="audit-policy-pre">
            {JSON.stringify(policy, null, 2)}
          </pre>
        </div>

        {/* Grants store */}
        <div className="audit-card">
          <div className="audit-card-title audit-grants-header">
            <span>📜 活跃复用授权 (Grants)</span>
            <span className="audit-grants-count">{grants.length} 个授权</span>
          </div>
          <div className="audit-grants-list">
            {grants.length === 0 ? (
              <div className="audit-grants-empty">暂无活跃授权</div>
            ) : (
              grants.map((grant: any, idx: number) => {
                const permText = typeof grant.permission === 'object' ? JSON.stringify(grant.permission) : String(grant.permission || '');
                return (
                  <div
                    key={grant.id || idx}
                    className="audit-grant-row"
                  >
                    <div className="audit-grant-desc">
                      <span className="audit-grant-scope">{grant.scope}</span>: {permText}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevokeGrant(grant.id)}
                      className={`audit-grant-revoke-btn ${revokingGrantId === grant.id ? 'is-confirming' : ''}`}
                      title={revokingGrantId === grant.id ? '再次点击确认撤销' : '撤销授权'}
                      aria-label="撤销授权"
                    >
                      <Trash2 size={13} />
                      {revokingGrantId === grant.id && <span className="audit-grant-confirm-tag">确认？</span>}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Audit trail table */}
      <div className="audit-card audit-table-card">
        <div className="audit-card-title">
          📋 结构化操作审计流水 (Audit Trail)
        </div>
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr className="audit-table-head-row">
                <th className="audit-th">时间戳</th>
                <th className="audit-th">事件类型</th>
                <th className="audit-th">涉及目标</th>
                <th className="audit-th">裁决 / 详情</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="audit-empty-td">
                    暂无审计记录
                  </td>
                </tr>
              ) : (
                auditLogs.map((log: any, idx: number) => {
                  const time = log.timestamp || log.ts || Date.now();
                  const eventType = log.eventType || log.event || 'EVENT';
                  const detailsText = typeof log.details === 'string'
                    ? log.details
                    : log.details?.reason || log.details?.actionSummary || (log.details ? JSON.stringify(log.details) : '');
                  const decisionRaw = log.decision || detailsText || '-';
                  const decisionDisplay = typeof decisionRaw === 'object' ? JSON.stringify(decisionRaw) : String(decisionRaw);

                  return (
                    <tr key={log.id || `${eventType}_${idx}`} className="audit-tr">
                      <td className="audit-td audit-time-cell">{formatTime(time)}</td>
                      <td className="audit-td audit-type-cell">
                        <span className="pill-badge pill-blue">{eventType}</span>
                      </td>
                      <td className="audit-td audit-target-cell">{log.target || log.tool || '-'}</td>
                      <td className="audit-td audit-decision-cell" title={decisionDisplay}>
                        {decisionDisplay}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
