import React from 'react';
import {
  Activity,
  AlertCircle,
  Bot as BotIcon,
  CheckCircle2,
  Globe,
  KeyRound,
  Loader2,
  PowerOff,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  Terminal,
  Wrench
} from 'lucide-react';
import type { Bot, McpServer } from '../../types';

interface McpServerCardProps {
  server: McpServer;
  bots: Bot[];
  busyAction: string | null;
  onToggleEnabled: (server: McpServer) => void;
  onTest: (server: McpServer) => void;
  onReconnect: (server: McpServer) => void;
  onOpenDrawer: (server: McpServer, initialTab?: 'tools' | 'config' | 'logs') => void;
}

const STATUS_META: Record<
  McpServer['status'],
  { label: string; badgeClass: string }
> = {
  connected: { label: '已连接', badgeClass: 'is-connected' },
  connecting: { label: '连接中', badgeClass: 'is-connecting' },
  disconnected: { label: '未连接', badgeClass: 'is-disconnected' },
  error: { label: '连接异常', badgeClass: 'is-error' },
  auth_required: { label: '需要凭据', badgeClass: 'is-auth' },
  disabled: { label: '已停用', badgeClass: 'is-disabled' }
};

function formatEndpointSummary(server: McpServer): string {
  if (server.transport === 'stdio') {
    const cmd = server.command || '';
    const args = (server.args || []).join(' ');
    return `${cmd} ${args}`.trim() || 'stdio';
  }
  return server.url || 'remote endpoint';
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

export const McpServerCard: React.FC<McpServerCardProps> = ({
  server,
  bots,
  busyAction,
  onToggleEnabled,
  onTest,
  onReconnect,
  onOpenDrawer
}) => {
  const statusMeta = STATUS_META[server.status] || STATUS_META.disconnected;
  const isTesting = busyAction === `test:${server.name}`;
  const isReconnecting = busyAction === `reconnect:${server.name}`;
  const isToggling = busyAction === `toggle:${server.name}`;

  const botSummary = server.everyBot
    ? '全部数字员工'
    : server.assignedBots.length > 0
      ? server.assignedBots
          .map((id) => bots.find((b) => b.id === id)?.name || id)
          .slice(0, 2)
          .join('、') +
        (server.assignedBots.length > 2 ? ` +${server.assignedBots.length - 2}` : '')
      : '未分配员工';

  return (
    <article className={`mcp-card ${!server.enabled ? 'is-disabled' : ''}`}>
      <div className="mcp-card-top">
        <div className={`mcp-transport-icon is-${server.transport}`} aria-hidden="true">
          {server.transport === 'stdio' ? (
            <Terminal size={18} />
          ) : server.transport === 'sse' ? (
            <Radio size={18} />
          ) : (
            <Globe size={18} />
          )}
        </div>

        <div className="mcp-card-title-block">
          <div className="mcp-card-name-row">
            <h3 className="mcp-card-title">{server.name}</h3>
            <span className={`mcp-status-pill ${statusMeta.badgeClass}`}>
              {server.status === 'connected' && <CheckCircle2 size={11} />}
              {server.status === 'connecting' && <Loader2 size={11} className="spin" />}
              {server.status === 'error' && <AlertCircle size={11} />}
              {server.status === 'auth_required' && <KeyRound size={11} />}
              {server.status === 'disabled' && <PowerOff size={11} />}
              <span>{statusMeta.label}</span>
            </span>
          </div>
          <p className="mcp-card-desc">
            {server.description || formatEndpointSummary(server)}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={server.enabled}
          aria-label={server.enabled ? `停用 ${server.name}` : `启用 ${server.name}`}
          className={`mcp-switch ${server.enabled ? 'is-checked' : ''}`}
          disabled={isToggling}
          onClick={() => onToggleEnabled(server)}
          title={server.enabled ? '点击停用此 MCP 服务' : '点击启用并连接'}
        >
          <span className="mcp-switch-thumb" />
        </button>
      </div>

      <div className="mcp-card-endpoint" title={formatEndpointSummary(server)}>
        <span className="mcp-transport-tag">{server.transport.toUpperCase()}</span>
        <code className="mcp-endpoint-code">{formatEndpointSummary(server)}</code>
      </div>

      <div className="mcp-card-metrics">
        <span className="mcp-metric-pill" title="已启用工具 / 全部工具">
          <Wrench size={12} />
          <span>
            {server.enabledToolCount}/{server.toolCount} 工具
          </span>
        </span>
        {server.estimatedTokens > 0 && (
          <span
            className={`mcp-metric-pill ${server.estimatedTokens > 4000 ? 'is-warn' : ''}`}
            title="工具 Schema 预计占用的上下文 Token"
          >
            ~{formatTokens(server.estimatedTokens)} tokens
          </span>
        )}
        {typeof server.lastLatencyMs === 'number' && server.status === 'connected' && (
          <span className="mcp-metric-pill is-ok" title="最近握手延迟">
            {server.lastLatencyMs}ms
          </span>
        )}
        <span className="mcp-metric-pill" title="生效数字员工范围">
          <BotIcon size={12} />
          <span>{botSummary}</span>
        </span>
      </div>

      {server.error && (server.status === 'error' || server.status === 'auth_required') && (
        <div className={`mcp-card-alert ${server.status === 'auth_required' ? 'is-auth' : 'is-error'}`}>
          <AlertCircle size={13} />
          <span className="mcp-card-alert-text" title={server.error}>
            {server.error}
          </span>
          {server.status === 'auth_required' && (
            <button
              type="button"
              className="mcp-inline-fix-btn"
              onClick={() => onOpenDrawer(server, 'config')}
            >
              配置凭据
            </button>
          )}
        </div>
      )}

      <div className="mcp-card-actions">
        <button
          type="button"
          className="om-btn-subtle mcp-btn-xs"
          disabled={isTesting}
          onClick={() => onTest(server)}
        >
          {isTesting ? <Loader2 size={13} className="spin" /> : <Activity size={13} />}
          <span>测试</span>
        </button>

        <button
          type="button"
          className="om-btn-subtle mcp-btn-xs"
          disabled={isReconnecting}
          onClick={() => onReconnect(server)}
        >
          <RefreshCw size={13} className={isReconnecting ? 'spin' : ''} />
          <span>重连</span>
        </button>

        <button
          type="button"
          className="om-btn-primary mcp-btn-xs mcp-btn-grow"
          onClick={() => onOpenDrawer(server, 'tools')}
        >
          <SlidersHorizontal size={13} />
          <span>工具与调试</span>
        </button>
      </div>
    </article>
  );
};
