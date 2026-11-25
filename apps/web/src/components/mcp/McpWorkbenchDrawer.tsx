import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Terminal,
  Trash2,
  X
} from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { copyToClipboard } from '../../utils/clipboard';
import { formatTime } from '../../utils/format';
import type {
  Bot,
  McpLogEntry,
  McpProbeResult,
  McpRiskLevel,
  McpServer,
  McpToolCallResult,
  McpToolView,
  McpTransportType
} from '../../types';

export type McpDrawerTab = 'tools' | 'config' | 'logs';

interface McpWorkbenchDrawerProps {
  server: McpServer | null;
  initialTab: McpDrawerTab;
  bots: Bot[];
  onClose: () => void;
  onServerUpdated: (server: McpServer) => void;
  onServerDeleted: (name: string) => void;
}

interface SecretRow {
  key: string;
  value: string;
}

function buildInitialArgsFromSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema?.properties && typeof schema.properties === 'object'
    ? schema.properties
    : {}) as Record<string, any>;
  const initial: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop?.default !== undefined) {
      initial[key] = prop.default;
    } else if (prop?.type === 'boolean') {
      initial[key] = false;
    }
  }
  return initial;
}

export const McpWorkbenchDrawer: React.FC<McpWorkbenchDrawerProps> = ({
  server,
  initialTab,
  bots,
  onClose,
  onServerUpdated,
  onServerDeleted
}) => {
  const { showToast } = useApp();
  const [activeTab, setActiveTab] = useState<McpDrawerTab>(initialTab);

  // 工具与试运行状态
  const [toolSearch, setToolSearch] = useState('');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [argMode, setArgMode] = useState<'form' | 'json'>('form');
  const [formArgs, setFormArgs] = useState<Record<string, unknown>>({});
  const [jsonArgsText, setJsonArgsText] = useState('{}');
  const [callingTool, setCallingTool] = useState(false);
  const [callResult, setCallResult] = useState<McpToolCallResult | null>(null);

  // 配置编辑状态
  const [transport, setTransport] = useState<McpTransportType>('stdio');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [cwd, setCwd] = useState('');
  const [url, setUrl] = useState('');
  const [secretRows, setSecretRows] = useState<SecretRow[]>([]);
  const [timeoutMs, setTimeoutMs] = useState(60000);
  const [connectTimeoutMs, setConnectTimeoutMs] = useState(20000);
  const [maxResultBytes, setMaxResultBytes] = useState(65536);
  const [risk, setRisk] = useState<McpRiskLevel>('moderate');
  const [everyBot, setEveryBot] = useState(true);
  const [assignedBots, setAssignedBots] = useState<string[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [probingConfig, setProbingConfig] = useState(false);
  const [probeFeedback, setProbeFeedback] = useState<McpProbeResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 日志状态
  const [logs, setLogs] = useState<McpLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logLevel, setLogLevel] = useState<'all' | McpLogEntry['level']>('all');
  const [logQuery, setLogQuery] = useState('');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, server?.name]);

  useEffect(() => {
    if (!server) return;
    setToolSearch('');
    setExpandedTool(null);
    setCallResult(null);
    setProbeFeedback(null);
    setConfirmDelete(false);

    setTransport(server.transport);
    setDescription(server.description || '');
    setCommand(server.command || '');
    setArgsText((server.args || []).join('\n'));
    setCwd(server.cwd || '');
    setUrl(server.url || '');

    const sourceSecrets = server.transport === 'stdio' ? server.envMasked : server.headersMasked;
    setSecretRows(
      Object.entries(sourceSecrets || {}).map(([key, value]) => ({ key, value }))
    );

    setTimeoutMs(server.timeoutMs || 60000);
    setConnectTimeoutMs(server.connectTimeoutMs || 20000);
    setMaxResultBytes(server.maxResultBytes || 65536);
    setRisk(server.risk || 'moderate');
    setEveryBot(server.everyBot !== false);
    setAssignedBots(server.assignedBots || []);
  }, [server]);

  const loadLogs = async (name: string) => {
    setLogsLoading(true);
    try {
      const res = await api.getMcpServerLogs(name);
      setLogs(res.logs || []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (server && activeTab === 'logs') {
      void loadLogs(server.name);
    }
  }, [server?.name, activeTab]);

  const filteredTools = useMemo(() => {
    if (!server) return [];
    const q = toolSearch.trim().toLowerCase();
    if (!q) return server.tools;
    return server.tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.fullName.toLowerCase().includes(q)
    );
  }, [server, toolSearch]);

  const filteredLogs = useMemo(() => {
    const q = logQuery.trim().toLowerCase();
    return logs.filter((entry) => {
      if (logLevel !== 'all' && entry.level !== logLevel) return false;
      if (q && !entry.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, logLevel, logQuery]);

  if (!server) return null;

  const openPlayground = (tool: McpToolView) => {
    if (expandedTool === tool.name) {
      setExpandedTool(null);
      return;
    }
    const initArgs = buildInitialArgsFromSchema(tool.inputSchema);
    setExpandedTool(tool.name);
    setFormArgs(initArgs);
    setJsonArgsText(JSON.stringify(initArgs, null, 2));
    setCallResult(null);
  };

  const handleRunTool = async (tool: McpToolView) => {
    let argsPayload: Record<string, unknown> = {};
    if (argMode === 'json') {
      try {
        const parsed = JSON.parse(jsonArgsText || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          showToast('JSON 参数必须是一个对象 ({ ... })', 'error');
          return;
        }
        argsPayload = parsed;
      } catch {
        showToast('参数 JSON 语法错误，请检查格式', 'error');
        return;
      }
    } else {
      argsPayload = { ...formArgs };
    }

    setCallingTool(true);
    setCallResult(null);
    try {
      const res = await api.callMcpTool(server.name, tool.name, argsPayload);
      setCallResult(res);
    } catch (err: any) {
      showToast(err?.message || '调用工具失败', 'error');
    } finally {
      setCallingTool(false);
    }
  };

  const handleToggleTool = async (tool: McpToolView) => {
    try {
      const res = await api.toggleMcpTool(server.name, tool.name, !tool.enabled);
      onServerUpdated(res.server);
    } catch (err: any) {
      showToast(err?.message || '切换工具状态失败', 'error');
    }
  };

  const handleToggleAllTools = async (enabledAll: boolean) => {
    try {
      const res = await api.toggleAllMcpTools(server.name, enabledAll);
      onServerUpdated(res.server);
      showToast(enabledAll ? '已全部启用该服务工具' : '已全部禁用该服务工具', 'info');
    } catch (err: any) {
      showToast(err?.message || '批量操作失败', 'error');
    }
  };

  const handleToolRiskChange = async (tool: McpToolView, nextRisk: McpRiskLevel) => {
    try {
      const res = await api.updateMcpToolPolicy(server.name, tool.name, { risk: nextRisk });
      onServerUpdated(res.server);
      showToast(`工具 ${tool.name} 风险级别已设为 ${nextRisk}`, 'success');
    } catch (err: any) {
      showToast(err?.message || '更新风险级别失败', 'error');
    }
  };

  const buildConfigPayload = () => {
    const secretMap: Record<string, string> = {};
    for (const row of secretRows) {
      if (row.key.trim()) {
        secretMap[row.key.trim()] = row.value;
      }
    }
    const parsedArgs = argsText
      .split(/\r?\n/)
      .flatMap((line) => line.trim().split(/\s+/))
      .filter(Boolean);

    return {
      transport,
      description: description.trim(),
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? parsedArgs : undefined,
      cwd: transport === 'stdio' && cwd.trim() ? cwd.trim() : undefined,
      env: transport === 'stdio' ? secretMap : undefined,
      url: transport !== 'stdio' ? url.trim() : undefined,
      headers: transport !== 'stdio' ? secretMap : undefined,
      timeoutMs,
      connectTimeoutMs,
      maxResultBytes,
      risk,
      everyBot,
      assignedBots
    };
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await api.updateMcpServer(server.name, {
        ...buildConfigPayload(),
        reconnect: true
      });
      onServerUpdated(res.server);
      showToast('配置已保存并热重载', 'success');
    } catch (err: any) {
      showToast(err?.message || '保存配置失败', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleProbeConfig = async () => {
    setProbingConfig(true);
    setProbeFeedback(null);
    try {
      const res = await api.testMcpServer(server.name);
      setProbeFeedback(res);
      if (res.server) onServerUpdated(res.server);
    } catch (err: any) {
      showToast(err?.message || '测试失败', 'error');
    } finally {
      setProbingConfig(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteMcpServer(server.name);
      showToast(`已移除 MCP 服务「${server.name}」`, 'info');
      onServerDeleted(server.name);
    } catch (err: any) {
      showToast(err?.message || '删除失败', 'error');
    }
  };

  const handleReconnect = async () => {
    try {
      const res = await api.reconnectMcpServer(server.name);
      onServerUpdated(res.server);
      showToast(
        res.server.status === 'connected'
          ? `「${server.name}」重连成功`
          : `重连未就绪：${res.server.error || res.server.status}`,
        res.server.status === 'connected' ? 'success' : 'warning'
      );
    } catch (err: any) {
      showToast(err?.message || '重连失败', 'error');
    }
  };

  return (
    <div className="mcp-drawer-backdrop" onClick={onClose}>
      <aside
        className="mcp-drawer"
        aria-label={`${server.name} 工作台`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mcp-drawer-header">
          <div className="mcp-drawer-title-group">
            <div className="mcp-drawer-title-row">
              <h2 className="mcp-drawer-title">{server.name}</h2>
              <span className="mcp-transport-tag">{server.transport.toUpperCase()}</span>
              <span className={`mcp-status-pill is-${server.status}`}>
                {server.status === 'connected'
                  ? '已连接'
                  : server.status === 'auth_required'
                    ? '需凭据'
                    : server.status === 'disabled'
                      ? '已停用'
                      : server.status === 'error'
                        ? '异常'
                        : '未连接'}
              </span>
            </div>
            <p className="mcp-drawer-sub">
              {server.serverInfo?.name
                ? `${server.serverInfo.name}${server.serverInfo.version ? ` v${server.serverInfo.version}` : ''}`
                : server.description || 'MCP 工具服务'}
              {server.protocolVersion ? ` · MCP ${server.protocolVersion}` : ''}
            </p>
          </div>

          <div className="mcp-drawer-header-actions">
            <button
              type="button"
              className="om-btn-subtle mcp-btn-xs"
              onClick={handleReconnect}
              title="重新握手连接"
            >
              <RefreshCw size={13} />
              <span>重连</span>
            </button>
            <button
              type="button"
              className="mcp-icon-btn"
              aria-label="关闭抽屉"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="mcp-drawer-tabs" role="tablist" aria-label="服务管理面板">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tools'}
            className="mcp-tab-btn"
            onClick={() => setActiveTab('tools')}
          >
            <span>工具与试运行 ({server.enabledToolCount}/{server.toolCount})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'config'}
            className="mcp-tab-btn"
            onClick={() => setActiveTab('config')}
          >
            <span>配置与密钥</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'logs'}
            className="mcp-tab-btn"
            onClick={() => setActiveTab('logs')}
          >
            <span>诊断日志</span>
          </button>
        </div>

        <div className="mcp-drawer-body">
          {activeTab === 'tools' && (
            <div className="mcp-tools-panel">
              <div className="mcp-tools-toolbar">
                <div className="mcp-search-box">
                  <Search size={14} />
                  <input
                    type="search"
                    placeholder="过滤工具名称或描述..."
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                  />
                </div>
                <div className="mcp-tools-batch">
                  <button
                    type="button"
                    className="om-btn-subtle mcp-btn-xs"
                    onClick={() => handleToggleAllTools(true)}
                    disabled={server.tools.length === 0}
                  >
                    全部启用
                  </button>
                  <button
                    type="button"
                    className="om-btn-subtle mcp-btn-xs"
                    onClick={() => handleToggleAllTools(false)}
                    disabled={server.tools.length === 0}
                  >
                    全部禁用
                  </button>
                </div>
              </div>

              {filteredTools.length === 0 ? (
                <div className="mcp-empty-box">
                  <Terminal size={24} />
                  <p>
                    {server.tools.length === 0
                      ? '当前服务尚未发现可用工具，请先确认连接状态或点击右上角重连。'
                      : '没有匹配筛选条件的工具。'}
                  </p>
                </div>
              ) : (
                <div className="mcp-tool-list">
                  {filteredTools.map((tool) => {
                    const isOpen = expandedTool === tool.name;
                    const props = (tool.inputSchema?.properties &&
                    typeof tool.inputSchema.properties === 'object'
                      ? tool.inputSchema.properties
                      : {}) as Record<string, any>;
                    const requiredList = Array.isArray(tool.inputSchema?.required)
                      ? (tool.inputSchema.required as string[])
                      : [];
                    const propEntries = Object.entries(props);

                    return (
                      <div key={tool.name} className={`mcp-tool-item ${!tool.enabled ? 'is-muted' : ''}`}>
                        <div className="mcp-tool-row">
                          <div className="mcp-tool-main">
                            <div className="mcp-tool-name-line">
                              <code className="mcp-tool-name">{tool.name}</code>
                              <span className="mcp-token-chip">~{tool.estimatedTokens} tok</span>
                            </div>
                            <p className="mcp-tool-desc">{tool.description}</p>
                          </div>

                          <div className="mcp-tool-controls">
                            <select
                              aria-label={`${tool.name} 风险级别`}
                              className={`mcp-risk-select is-${tool.risk}`}
                              value={tool.risk}
                              onChange={(e) =>
                                handleToolRiskChange(tool, e.target.value as McpRiskLevel)
                              }
                            >
                              <option value="safe">安全</option>
                              <option value="moderate">标准</option>
                              <option value="sensitive">敏感需审批</option>
                            </select>

                            <button
                              type="button"
                              className="om-btn-subtle mcp-btn-xs"
                              onClick={() => openPlayground(tool)}
                            >
                              <Play size={12} />
                              <span>试运行</span>
                              {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>

                            <button
                              type="button"
                              role="switch"
                              aria-checked={tool.enabled}
                              aria-label={tool.enabled ? `禁用 ${tool.name}` : `启用 ${tool.name}`}
                              className={`mcp-switch ${tool.enabled ? 'is-checked' : ''}`}
                              onClick={() => handleToggleTool(tool)}
                            >
                              <span className="mcp-switch-thumb" />
                            </button>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="mcp-playground">
                            <div className="mcp-playground-top">
                              <span className="mcp-playground-label">
                                工具调用名: <code>{tool.fullName}</code>
                              </span>
                              <div className="mcp-mode-switch">
                                <button
                                  type="button"
                                  className={`mcp-mode-btn ${argMode === 'form' ? 'is-active' : ''}`}
                                  onClick={() => setArgMode('form')}
                                >
                                  结构化表单
                                </button>
                                <button
                                  type="button"
                                  className={`mcp-mode-btn ${argMode === 'json' ? 'is-active' : ''}`}
                                  onClick={() => {
                                    setJsonArgsText(JSON.stringify(formArgs, null, 2));
                                    setArgMode('json');
                                  }}
                                >
                                  JSON 参数
                                </button>
                              </div>
                            </div>

                            {argMode === 'form' ? (
                              propEntries.length === 0 ? (
                                <p className="mcp-field-help">该工具无需入参，可直接点击执行。</p>
                              ) : (
                                <div className="mcp-playground-fields">
                                  {propEntries.map(([paramKey, spec]) => {
                                    const isRequired = requiredList.includes(paramKey);
                                    const paramType = spec?.type || 'string';
                                    const enumVals = Array.isArray(spec?.enum) ? spec.enum : null;
                                    const val = formArgs[paramKey];

                                    return (
                                      <label key={paramKey} className="mcp-field">
                                        <span className="mcp-field-label">
                                          {paramKey}
                                          {isRequired ? ' *' : ''}
                                          <span className="mcp-param-type">({paramType})</span>
                                        </span>
                                        {enumVals ? (
                                          <select
                                            className="mcp-select"
                                            value={String(val ?? '')}
                                            onChange={(e) =>
                                              setFormArgs((prev) => ({
                                                ...prev,
                                                [paramKey]: e.target.value
                                              }))
                                            }
                                          >
                                            <option value="">-- 请选择 --</option>
                                            {enumVals.map((opt: any) => (
                                              <option key={String(opt)} value={String(opt)}>
                                                {String(opt)}
                                              </option>
                                            ))}
                                          </select>
                                        ) : paramType === 'boolean' ? (
                                          <label className="mcp-checkbox-inline">
                                            <input
                                              type="checkbox"
                                              checked={Boolean(val)}
                                              onChange={(e) =>
                                                setFormArgs((prev) => ({
                                                  ...prev,
                                                  [paramKey]: e.target.checked
                                                }))
                                              }
                                            />
                                            <span>{spec?.description || '启用'}</span>
                                          </label>
                                        ) : paramType === 'number' || paramType === 'integer' ? (
                                          <input
                                            type="number"
                                            className="mcp-input mcp-mono"
                                            placeholder={spec?.description || ''}
                                            value={val === undefined ? '' : String(val)}
                                            onChange={(e) =>
                                              setFormArgs((prev) => ({
                                                ...prev,
                                                [paramKey]:
                                                  e.target.value === ''
                                                    ? undefined
                                                    : Number(e.target.value)
                                              }))
                                            }
                                          />
                                        ) : paramType === 'object' || paramType === 'array' ? (
                                          <textarea
                                            className="mcp-textarea mcp-mono"
                                            rows={3}
                                            placeholder={spec?.description || (paramType === 'array' ? '[]' : '{}')}
                                            value={
                                              typeof val === 'string'
                                                ? val
                                                : val !== undefined
                                                  ? JSON.stringify(val, null, 2)
                                                  : ''
                                            }
                                            onChange={(e) => {
                                              const raw = e.target.value;
                                              try {
                                                const parsed = JSON.parse(raw);
                                                setFormArgs((prev) => ({ ...prev, [paramKey]: parsed }));
                                              } catch {
                                                setFormArgs((prev) => ({ ...prev, [paramKey]: raw }));
                                              }
                                            }}
                                          />
                                        ) : (
                                          <input
                                            type="text"
                                            className="mcp-input"
                                            placeholder={spec?.description || ''}
                                            value={String(val ?? '')}
                                            onChange={(e) =>
                                              setFormArgs((prev) => ({
                                                ...prev,
                                                [paramKey]: e.target.value
                                              }))
                                            }
                                          />
                                        )}
                                        {spec?.description && paramType !== 'boolean' && (
                                          <span className="mcp-field-help">{spec.description}</span>
                                        )}
                                      </label>
                                    );
                                  })}
                                </div>
                              )
                            ) : (
                              <textarea
                                className="mcp-textarea mcp-mono"
                                rows={5}
                                spellCheck={false}
                                value={jsonArgsText}
                                onChange={(e) => setJsonArgsText(e.target.value)}
                              />
                            )}

                            <div className="mcp-playground-actions">
                              <button
                                type="button"
                                className="om-btn-primary mcp-btn-xs"
                                disabled={callingTool}
                                onClick={() => handleRunTool(tool)}
                              >
                                {callingTool ? (
                                  <Loader2 size={13} className="spin" />
                                ) : (
                                  <Play size={13} />
                                )}
                                <span>{callingTool ? '调用执行中...' : '立即试运行'}</span>
                              </button>
                            </div>

                            {callResult && (
                              <div className={`mcp-call-result ${callResult.ok ? 'is-ok' : 'is-error'}`}>
                                <div className="mcp-call-result-head">
                                  <span>
                                    {callResult.ok ? '执行成功' : '执行报错'} · {callResult.durationMs}ms ·{' '}
                                    {callResult.originalBytes}B
                                    {callResult.truncated ? ' (已按预算截断)' : ''}
                                  </span>
                                  <button
                                    type="button"
                                    className="mcp-link-btn"
                                    onClick={async () => {
                                      const ok = await copyToClipboard(callResult.outputText);
                                      showToast(ok ? '已复制输出结果' : '复制失败', ok ? 'info' : 'error');
                                    }}
                                  >
                                    <Copy size={12} /> 复制
                                  </button>
                                </div>
                                <pre className="mcp-call-output">{callResult.outputText}</pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'config' && (
            <div className="mcp-form-stack">
              <div className="mcp-form-grid-2">
                <label className="mcp-field">
                  <span className="mcp-field-label">传输协议</span>
                  <select
                    className="mcp-select"
                    value={transport}
                    onChange={(e) => setTransport(e.target.value as McpTransportType)}
                  >
                    <option value="stdio">Stdio 本地子进程</option>
                    <option value="http">Streamable HTTP</option>
                    <option value="sse">Legacy SSE</option>
                  </select>
                </label>

                <label className="mcp-field">
                  <span className="mcp-field-label">默认安全风险级别</span>
                  <select
                    className="mcp-select"
                    value={risk}
                    onChange={(e) => setRisk(e.target.value as McpRiskLevel)}
                  >
                    <option value="safe">Safe（只读安全）</option>
                    <option value="moderate">Moderate（标准）</option>
                    <option value="sensitive">Sensitive（敏感需人工审批）</option>
                  </select>
                </label>
              </div>

              <label className="mcp-field">
                <span className="mcp-field-label">描述说明</span>
                <input
                  type="text"
                  className="mcp-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>

              {transport === 'stdio' ? (
                <>
                  <div className="mcp-form-grid-2">
                    <label className="mcp-field">
                      <span className="mcp-field-label">启动命令 (Command)</span>
                      <input
                        type="text"
                        className="mcp-input mcp-mono"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                      />
                    </label>
                    <label className="mcp-field">
                      <span className="mcp-field-label">工作目录 (CWD)</span>
                      <input
                        type="text"
                        className="mcp-input mcp-mono"
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="mcp-field">
                    <span className="mcp-field-label">启动参数 (Args)</span>
                    <textarea
                      className="mcp-textarea mcp-mono"
                      rows={3}
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <label className="mcp-field">
                  <span className="mcp-field-label">服务端点 URL</span>
                  <input
                    type="url"
                    className="mcp-input mcp-mono"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </label>
              )}

              <div className="mcp-kv-section">
                <div className="mcp-kv-header">
                  <span className="mcp-field-label">
                    {transport === 'stdio'
                      ? '环境变量密钥 (保留 •••••••• 即维持原加密值)'
                      : '认证请求头 (保留 •••••••• 即维持原值)'}
                  </span>
                  <button
                    type="button"
                    className="om-btn-subtle mcp-btn-xs"
                    onClick={() => setSecretRows((prev) => [...prev, { key: '', value: '' }])}
                  >
                    <Plus size={12} />
                    <span>添加</span>
                  </button>
                </div>
                {secretRows.map((row, idx) => (
                  <div key={idx} className="mcp-kv-row">
                    <input
                      type="text"
                      className="mcp-input mcp-mono"
                      placeholder="Key"
                      value={row.key}
                      onChange={(e) =>
                        setSecretRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      type="password"
                      className="mcp-input mcp-mono"
                      placeholder="输入新值或保留占位符"
                      value={row.value}
                      onChange={(e) =>
                        setSecretRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r))
                        )
                      }
                    />
                    <button
                      type="button"
                      className="mcp-icon-btn"
                      aria-label="移除该项"
                      onClick={() => setSecretRows((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mcp-form-grid-3">
                <label className="mcp-field">
                  <span className="mcp-field-label">握手超时 (ms)</span>
                  <input
                    type="number"
                    className="mcp-input"
                    value={connectTimeoutMs}
                    onChange={(e) => setConnectTimeoutMs(Number(e.target.value) || 20000)}
                  />
                </label>
                <label className="mcp-field">
                  <span className="mcp-field-label">调用超时 (ms)</span>
                  <input
                    type="number"
                    className="mcp-input"
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(Number(e.target.value) || 60000)}
                  />
                </label>
                <label className="mcp-field">
                  <span className="mcp-field-label">结果预算 (Bytes)</span>
                  <input
                    type="number"
                    className="mcp-input"
                    value={maxResultBytes}
                    onChange={(e) => setMaxResultBytes(Number(e.target.value) || 65536)}
                  />
                </label>
              </div>

              <div className="mcp-scope-box">
                <div className="mcp-scope-head">
                  <span className="mcp-field-label">数字员工授权范围</span>
                  <label className="mcp-checkbox-inline">
                    <input
                      type="checkbox"
                      checked={everyBot}
                      onChange={(e) => setEveryBot(e.target.checked)}
                    />
                    <span>全部数字员工可用</span>
                  </label>
                </div>
                {!everyBot && bots.length > 0 && (
                  <div className="mcp-bot-checks">
                    {bots.map((bot) => {
                      const checked = assignedBots.includes(bot.id);
                      return (
                        <label key={bot.id} className="mcp-checkbox-inline">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setAssignedBots((prev) =>
                                e.target.checked
                                  ? [...prev, bot.id]
                                  : prev.filter((id) => id !== bot.id)
                              )
                            }
                          />
                          <span>{bot.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {probeFeedback && (
                <div className={`mcp-alert-box ${probeFeedback.ok ? 'is-ok' : 'is-error'}`}>
                  {probeFeedback.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  <span>
                    {probeFeedback.ok
                      ? `探测通过 (${probeFeedback.latencyMs}ms)，共发现 ${probeFeedback.toolCount} 个工具`
                      : probeFeedback.error || '探测失败'}
                  </span>
                </div>
              )}

              <div className="mcp-config-actions">
                <button
                  type="button"
                  className="om-btn-subtle"
                  disabled={probingConfig}
                  onClick={handleProbeConfig}
                >
                  {probingConfig ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}
                  <span>测试连通性</span>
                </button>
                <button
                  type="button"
                  className="om-btn-primary"
                  disabled={savingConfig}
                  onClick={handleSaveConfig}
                >
                  {savingConfig ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                  <span>保存并重连</span>
                </button>
              </div>

              <div className="mcp-danger-zone">
                <div>
                  <strong>删除该 MCP 服务</strong>
                  <p className="mcp-field-help">将停止运行中的连接并移除持久化配置</p>
                </div>
                <button
                  type="button"
                  className={`mcp-btn-danger ${confirmDelete ? 'is-armed' : ''}`}
                  onClick={handleDelete}
                >
                  <Trash2 size={14} />
                  <span>{confirmDelete ? '再次点击确认删除' : '删除服务'}</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="mcp-logs-panel">
              <div className="mcp-logs-toolbar">
                <div className="mcp-search-box">
                  <Search size={14} />
                  <input
                    type="search"
                    placeholder="过滤日志内容..."
                    value={logQuery}
                    onChange={(e) => setLogQuery(e.target.value)}
                  />
                </div>
                <select
                  aria-label="日志级别"
                  className="mcp-select mcp-select-sm"
                  value={logLevel}
                  onChange={(e) => setLogLevel(e.target.value as any)}
                >
                  <option value="all">全部级别</option>
                  <option value="stderr">stderr</option>
                  <option value="error">error</option>
                  <option value="warn">warn</option>
                  <option value="info">info</option>
                </select>
                <button
                  type="button"
                  className="om-btn-subtle mcp-btn-xs"
                  onClick={() => void loadLogs(server.name)}
                >
                  <RefreshCw size={12} className={logsLoading ? 'spin' : ''} />
                  <span>刷新</span>
                </button>
                <button
                  type="button"
                  className="om-btn-subtle mcp-btn-xs"
                  onClick={async () => {
                    await api.clearMcpServerLogs(server.name);
                    setLogs([]);
                  }}
                >
                  清空
                </button>
              </div>

              <div className="mcp-log-tail">
                {filteredLogs.length === 0 ? (
                  <div className="mcp-log-empty">暂无运行诊断日志</div>
                ) : (
                  filteredLogs.map((entry, idx) => (
                    <div key={idx} className={`mcp-log-line is-${entry.level}`}>
                      <span className="mcp-log-ts">{formatTime(entry.ts)}</span>
                      <span className="mcp-log-lvl">[{entry.level}]</span>
                      <span className="mcp-log-msg">{entry.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
