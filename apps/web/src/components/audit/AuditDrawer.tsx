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
  const { showToast, isTainted, taintReasons, focusApprovalId } = useApp();
  const [activeTab, setActiveTab] = useState<'trail' | 'grants' | 'policy'>('trail');
  const [policy, setPolicy] = useState<any>({});
  const [grants, setGrants] = useState<Grant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSessionOnly, setFilterSessionOnly] = useState(false);
  const [expandedLogKeys, setExpandedLogKeys] = useState<Record<string, boolean>>({});
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);
  const revokeTimerRef = React.useRef<any>(null);

  // 监听 Esc 键关闭抽屉
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  // 当外部传入聚焦的审批 ID 时，自动切换到审计流水页并定位展开高亮对应记录
  useEffect(() => {
    if (!isOpen || !focusApprovalId || auditLogs.length === 0) return;
    setActiveTab('trail');

    const matchedIdx = auditLogs.findIndex((l) => {
      if (l.id === focusApprovalId) return true;
      if ((l as any).approvalId === focusApprovalId) return true;
      if ((l as any).actionId === focusApprovalId) return true;
      if (typeof l.details === 'object' && l.details) {
        if ((l.details as any).approvalId === focusApprovalId) return true;
        if ((l.details as any).actionId === focusApprovalId) return true;
      }
      return JSON.stringify(l).includes(focusApprovalId);
    });

    if (matchedIdx !== -1) {
      const targetLog = auditLogs[matchedIdx];
      const targetKey = targetLog.id || `${targetLog.event}_${matchedIdx}_${targetLog.ts || targetLog.timestamp}`;
      setExpandedLogKeys((prev) => ({ ...prev, [targetKey]: true }));

      // 稍微延迟等待 DOM 展开渲染后平滑滚动
      setTimeout(() => {
        const el = document.getElementById(`audit-card-${targetKey}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [isOpen, focusApprovalId, auditLogs]);

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
        <span className={`pill-badge ${isApproved ? 'pill-green' : 'pill-red'}`}>
          {isApproved ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
          {isApproved ? '审批批准' : '审批驳回'}
        </span>
      );
    }
    if (ev === 'SENTINEL_INTERCEPT') {
      return (
        <span className="pill-badge pill-amber">
          <ShieldAlert size={11} /> 门禁拦截
        </span>
      );
    }
    if (ev === 'TAINT_EVENT') {
      return (
        <span className="pill-badge pill-red">
          <AlertTriangle size={11} /> 污染阻断
        </span>
      );
    }
    return (
      <span className="pill-badge pill-blue">
        {ev}
      </span>
    );
  };

  return (
    <aside className="audit-drawer" role="complementary" aria-label="安全与审计检查抽屉">
      {/* 1. Header */}
      <div className="audit-drawer-header">
        <div className="audit-drawer-title">
          <ShieldCheck size={17} className="audit-drawer-policy-icon" />
          <span>安全合规与审计 (Audit)</span>
        </div>
        <div className="flex-center-gap-8">
          <button
            type="button"
            className="btn-icon"
            onClick={loadData}
            disabled={loading}
            title="刷新安全审计数据"
          >
            <RefreshCw size={13} className={loading ? 'tool-spin' : ''} />
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            title="收起审计抽屉 (Esc)"
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
        <div className="audit-taint-banner">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <div className="audit-taint-text">
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
              <div className="audit-filter-bar">
                <span className="audit-filter-label">
                  {filterSessionOnly ? '仅展示当前会话记录' : '展示全部会话流水'}
                </span>
                <button
                  type="button"
                  className="btn-secondary audit-filter-btn"
                  onClick={() => setFilterSessionOnly((v) => !v)}
                >
                  <ListFilter size={11} /> {filterSessionOnly ? '查看全局流水' : '只看当前会话'}
                </button>
              </div>
            )}

            {displayedLogs.length === 0 ? (
              <div className="audit-drawer-empty">
                <ShieldCheck size={32} className="audit-drawer-empty-icon" />
                <div className="audit-drawer-empty-title">暂无审计流水记录</div>
                <div className="audit-drawer-empty-sub">
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

                const isMatchedFocus = Boolean(
                  focusApprovalId && (
                    log.id === focusApprovalId ||
                    (log as any).approvalId === focusApprovalId ||
                    (log as any).actionId === focusApprovalId ||
                    (typeof log.details === 'object' && ((log.details as any)?.approvalId === focusApprovalId || (log.details as any)?.actionId === focusApprovalId)) ||
                    JSON.stringify(log).includes(focusApprovalId)
                  )
                );

                return (
                  <div
                    key={logKey}
                    id={`audit-card-${logKey}`}
                    className={`audit-card ${isMatchedFocus ? 'audit-card-highlighted' : ''}`}
                  >
                    <div className="audit-drawer-row">
                      <div className="flex-center-gap-6">
                        {getEventBadge(log)}
                        {log.tool && (
                          <span className="audit-drawer-tool-tag">
                            {log.tool}
                          </span>
                        )}
                      </div>
                      <span className="audit-drawer-time" title={exactTime}>
                        {timeText}
                      </span>
                    </div>

                    {log.target && (
                      <div className="audit-drawer-target" title={log.target}>
                        {log.target}
                      </div>
                    )}

                    {summary && (
                      <div className="audit-drawer-summary">
                        {summary}
                      </div>
                    )}

                    <div className="audit-drawer-meta-bar">
                      <span className="audit-drawer-meta-session">
                        {log.sessionId ? `会话: ${log.sessionId.slice(-6)}` : '全局系统'}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleExpand(logKey)}
                        className="audit-drawer-expand-btn"
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {isExpanded ? '收起详情' : '展开 Payload'}
                      </button>
                    </div>

                    {isExpanded && (
                      <pre className="audit-drawer-payload-pre">
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
            <div className="audit-drawer-tab-desc">
              当前记住的免审批授权规则。撤销后，对应操作将恢复 Sentinel 门禁人工逐次审批。
            </div>

            {grants.length === 0 ? (
              <div className="audit-drawer-empty">
                <Lock size={30} className="audit-drawer-empty-icon" />
                <div className="audit-drawer-empty-title">暂无活跃免密授权</div>
                <div className="audit-drawer-empty-sub">所有敏感操作将按当前门禁策略进行审核</div>
              </div>
            ) : (
              grants.map((grant: any, idx: number) => {
                const permText = typeof grant.permission === 'object' ? JSON.stringify(grant.permission) : String(grant.permission || '');
                return (
                  <div key={grant.id || idx} className="audit-card">
                    <div className="audit-drawer-row">
                      <span className="pill-badge pill-blue">
                        {grant.scope || 'general'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRevokeGrant(grant.id)}
                        className={`btn-reject audit-grant-revoke-btn ${revokingGrantId === grant.id ? 'is-confirming' : ''}`}
                        title={revokingGrantId === grant.id ? '再次点击确认撤销' : '撤销此免审批授权'}
                      >
                        <Trash2 size={11} /> {revokingGrantId === grant.id ? '确认撤销？' : '撤销授权'}
                      </button>
                    </div>

                    <div className="audit-drawer-perm-box">
                      {permText}
                    </div>

                    {grant.grantedAt && (
                      <div className="audit-drawer-perm-time">
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
            <div className="audit-drawer-tab-desc">
              由安全管理内核挂载的声明式防护策略（sentinel-policy.json），定义了黑名单工具与严格阻断规则。
            </div>

            <div className="audit-card">
              <div className="audit-drawer-policy-title">
                <FileCode size={14} className="audit-drawer-policy-icon" /> 策略规则概览
              </div>
              <div className="audit-drawer-stat-list">
                <div className="audit-drawer-stat-row">
                  <span className="text-muted">默认审批动作:</span>
                  <span className="font-semibold">{policy.default_action || policy.defaultAction || 'ASK'}</span>
                </div>
                <div className="audit-drawer-stat-row">
                  <span className="text-muted">全局禁用工具数:</span>
                  <span className="font-semibold">{policy.deny_tools?.length || policy.denyTools?.length || 0} 个</span>
                </div>
                <div className="audit-drawer-stat-row">
                  <span className="text-muted">强制确认命令数:</span>
                  <span className="font-semibold">{policy.ask_commands?.length || policy.askCommands?.length || 0} 项</span>
                </div>
              </div>
            </div>

            <div className="audit-card">
              <div className="audit-drawer-json-title">
                原始策略配置 (JSON)
              </div>
              <pre className="audit-drawer-json-pre">
                {JSON.stringify(policy, null, 2)}
              </pre>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
