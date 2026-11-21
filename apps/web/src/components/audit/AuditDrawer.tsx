import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  Trash2,
  X,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Lock,
  FileCode,
  ListFilter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Radio,
} from 'lucide-react';
import type { Grant, AuditLog } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatTime, formatRelativeTime } from '../../utils/format';

interface AuditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeSessionId?: string | null;
}

export const AuditDrawer: React.FC<AuditDrawerProps> = ({
  isOpen,
  onClose,
  activeSessionId,
}) => {
  const { showToast, isTainted, taintReasons } = useApp();
  const [activeTab, setActiveTab] = useState<'trail' | 'grants' | 'policy'>('trail');
  const [policy, setPolicy] = useState<any>({});
  const [grants, setGrants] = useState<Grant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSessionOnly, setFilterSessionOnly] = useState(false);
  const [expandedLogKeys, setExpandedLogKeys] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
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
    } catch (err: any) {
      console.error('Failed to load audit drawer data:', err);
      showToast('拉取安全审计信息异常', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  const handleRevokeGrant = async (id: string) => {
    try {
      await api.revokeGrant(id);
      setGrants((prev) => prev.filter((g) => g.id !== id));
      showToast('已撤销该免审批授权条目', 'success');
    } catch (err: any) {
      showToast(`撤销授权失败: ${err.message}`, 'error');
    }
  };

  const toggleExpand = (key: string) => {
    setExpandedLogKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  if (!isOpen) return null;

  const displayedLogs = filterSessionOnly && activeSessionId
    ? auditLogs.filter((l) => l.sessionId === activeSessionId)
    : auditLogs;

  const getEventBadge = (log: AuditLog) => {
    const ev = (log.event || log.eventType || 'EVENT').toUpperCase();
    if (ev === 'APPROVAL_DECISION') {
      const isApproved = String(log.decision).toLowerCase().includes('approved');
      return (
        <span className={`pill-badge ${isApproved ? 'pill-green' : 'pill-red'}`} style={{ fontSize: '10.5px' }}>
          {isApproved ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
          {isApproved ? '审批批准' : '审批驳回'}
        </span>
      );
    }
    if (ev === 'SENTINEL_INTERCEPT') {
      return (
        <span className="pill-badge pill-amber" style={{ fontSize: '10.5px' }}>
          <ShieldAlert size={11} /> 门禁拦截
        </span>
      );
    }
    if (ev === 'TAINT_EVENT') {
      return (
        <span className="pill-badge pill-red" style={{ fontSize: '10.5px' }}>
          <AlertTriangle size={11} /> 污染阻断
        </span>
      );
    }
    return (
      <span className="pill-badge pill-blue" style={{ fontSize: '10.5px' }}>
        {ev}
      </span>
    );
  };

  return (
    <aside className="audit-drawer" role="complementary" aria-label="安全与审计检查抽屉">
      {/* 1. Header */}
      <div className="audit-drawer-header">
        <div className="audit-drawer-title">
          <ShieldCheck size={17} style={{ color: 'var(--om-accent)' }} />
          <span>安全合规与审计 (Audit)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn-icon"
            onClick={loadData}
            disabled={loading}
            title="刷新安全审计数据"
            style={{ padding: '5px' }}
          >
            <RefreshCw size={13} className={loading ? 'tool-spin' : ''} />
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            title="收起审计抽屉 (Esc)"
            style={{ padding: '5px' }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 2. Tabs */}
      <div className="audit-drawer-tabs">
        <button
          type="button"
          className={`audit-drawer-tab ${activeTab === 'trail' ? 'active' : ''}`}
          onClick={() => setActiveTab('trail')}
        >
          📋 审计流水 ({displayedLogs.length})
        </button>
        <button
          type="button"
          className={`audit-drawer-tab ${activeTab === 'grants' ? 'active' : ''}`}
          onClick={() => setActiveTab('grants')}
        >
          📜 活跃授权 ({grants.length})
        </button>
        <button
          type="button"
          className={`audit-drawer-tab ${activeTab === 'policy' ? 'active' : ''}`}
          onClick={() => setActiveTab('policy')}
        >
          🛡️ 策略配置
        </button>
      </div>

      {/* 3. Taint Alert Banner if present */}
      {isTainted && (
        <div
          style={{
            padding: '8px 14px',
            background: 'color-mix(in srgb, var(--accent-red) 10%, var(--om-surface))',
            borderBottom: '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11.5px',
            color: 'var(--accent-red)',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>当前处于敏感污染态：</strong>
            {taintReasons.join('; ') || '已触及受控数据源'}
          </div>
        </div>
      )}

      {/* 4. Body Content */}
      <div className="audit-drawer-body">
        {/* TAB 1: 审计流水 */}
        {activeTab === 'trail' && (
          <>
            {activeSessionId && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px 4px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-dim)' }}>
                  {filterSessionOnly ? '仅展示当前会话记录' : '展示全部会话流水'}
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setFilterSessionOnly((v) => !v)}
                  style={{ fontSize: '11px', padding: '2px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <ListFilter size={11} /> {filterSessionOnly ? '查看全局流水' : '只看当前会话'}
                </button>
              </div>
            )}

            {displayedLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-dim)' }}>
                <ShieldCheck size={32} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
                <div style={{ fontSize: '13px', fontWeight: 600 }}>暂无审计流水记录</div>
                <div style={{ fontSize: '11.5px', marginTop: '4px' }}>
                  {filterSessionOnly ? '本会话暂未触发安全判定或工具调用' : '系统尚无敏感动作产生'}
                </div>
              </div>
            ) : (
              displayedLogs.map((log, idx) => {
                const logKey = log.id || `${log.event}_${idx}_${log.ts || log.timestamp}`;
                const isExpanded = Boolean(expandedLogKeys[logKey]);
                const timeRaw = log.ts || log.timestamp;
                const timeText = formatRelativeTime(timeRaw);
                const exactTime = formatTime(timeRaw);

                const summary =
                  typeof log.details === 'string'
                    ? log.details
                    : log.details?.reason ||
                      log.details?.actionSummary ||
                      (typeof log.decision === 'string' ? log.decision : '');

                return (
                  <div key={logKey} className="audit-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {getEventBadge(log)}
                        {log.tool && (
                          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-main)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {log.tool}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }} title={exactTime}>
                        {timeText}
                      </span>
                    </div>

                    {log.target && (
                      <div
                        style={{
                          fontSize: '11.5px',
                          fontFamily: 'var(--font-mono, monospace)',
                          background: 'var(--om-surface)',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          border: '1px solid var(--om-border)',
                          marginBottom: '6px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: 'var(--text-main)',
                        }}
                        title={log.target}
                      >
                        {log.target}
                      </div>
                    )}

                    {summary && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-muted)',
                          lineHeight: 1.45,
                          marginBottom: '6px',
                        }}
                      >
                        {summary}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-dim)' }}>
                        {log.sessionId ? `会话: ${log.sessionId.slice(-6)}` : '全局系统'}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleExpand(logKey)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--om-accent)',
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px',
                          padding: '2px 4px',
                        }}
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {isExpanded ? '收起详情' : '展开 Payload'}
                      </button>
                    </div>

                    {isExpanded && (
                      <pre
                        style={{
                          marginTop: '8px',
                          padding: '8px',
                          borderRadius: '6px',
                          background: 'var(--om-bg)',
                          border: '1px solid var(--om-border)',
                          fontSize: '10.5px',
                          lineHeight: 1.4,
                          color: 'var(--text-dim)',
                          overflowX: 'auto',
                          maxHeight: '200px',
                        }}
                      >
                        {JSON.stringify(log, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* TAB 2: 活跃复用授权 (Grants) */}
        {activeTab === 'grants' && (
          <>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '6px' }}>
              当前记住的免审批授权规则。撤销后，对应操作将恢复 Sentinel 门禁人工逐次审批。
            </div>

            {grants.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-dim)' }}>
                <Lock size={30} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
                <div style={{ fontSize: '13px', fontWeight: 600 }}>暂无活跃免密授权</div>
                <div style={{ fontSize: '11.5px', marginTop: '4px' }}>所有敏感操作将按当前门禁策略进行审核</div>
              </div>
            ) : (
              grants.map((grant: any, idx: number) => {
                const permText = typeof grant.permission === 'object' ? JSON.stringify(grant.permission) : String(grant.permission || '');
                return (
                  <div key={grant.id || idx} className="audit-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span className="pill-badge pill-blue" style={{ fontSize: '11px' }}>
                        {grant.scope || 'general'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRevokeGrant(grant.id)}
                        className="btn-reject"
                        style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
                        title="撤销此免审批授权"
                      >
                        <Trash2 size={11} /> 撤销授权
                      </button>
                    </div>

                    <div
                      style={{
                        fontSize: '11.5px',
                        fontFamily: 'var(--font-mono, monospace)',
                        background: 'var(--om-surface)',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--om-border)',
                        color: 'var(--text-main)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {permText}
                    </div>

                    {grant.grantedAt && (
                      <div style={{ fontSize: '10.5px', color: 'var(--text-dim)', marginTop: '6px' }}>
                        授权时间: {formatTime(grant.grantedAt)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* TAB 3: 声明式安全策略 (Policy) */}
        {activeTab === 'policy' && (
          <>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '6px' }}>
              由安全管理内核挂载的声明式防护策略（sentinel-policy.json），定义了黑名单工具与严格阻断规则。
            </div>

            <div className="audit-card">
              <div style={{ fontWeight: 600, fontSize: '12.5px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileCode size={14} style={{ color: 'var(--om-accent)' }} /> 策略规则概览
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>默认审批动作:</span>
                  <span style={{ fontWeight: 600 }}>{policy.default_action || policy.defaultAction || 'ASK'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>全局禁用工具数:</span>
                  <span style={{ fontWeight: 600 }}>{policy.deny_tools?.length || policy.denyTools?.length || 0} 个</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>强制确认命令数:</span>
                  <span style={{ fontWeight: 600 }}>{policy.ask_commands?.length || policy.askCommands?.length || 0} 项</span>
                </div>
              </div>
            </div>

            <div className="audit-card">
              <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '6px' }}>
                原始策略配置 (JSON)
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: '11px',
                  lineHeight: 1.45,
                  color: 'var(--text-dim)',
                  maxHeight: '280px',
                  overflow: 'auto',
                  background: 'var(--om-surface)',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--om-border)',
                }}
              >
                {JSON.stringify(policy, null, 2)}
              </pre>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
