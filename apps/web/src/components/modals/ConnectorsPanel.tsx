import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Brain,
  ChevronRight,
  Code2,
  Compass,
  Database,
  FileCode2,
  Folder,
  Globe,
  Layers,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Terminal,
  Trash2
} from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { formatTime } from '../../utils/format';
import type {
  Bot,
  ConnectorItem,
  McpCatalogEntry,
  McpLogEntry,
  McpRiskLevel,
  McpServer,
  McpToolCallResult,
  McpToolView
} from '../../types';
import {
  CustomConnectorDialog,
  PresetConnectDialog,
  type PresetConnectTarget
} from './ConnectorDialogs';

type ConsumerGroupId = 'productivity' | 'info' | 'devdata' | 'talk';

interface UnifiedTool {
  name: string;
  description: string;
  enabled: boolean;
  risk?: McpRiskLevel;
  inputSchema?: Record<string, unknown>;
}

interface UnifiedConnector {
  uid: string;
  backing: 'builtin' | 'rest' | 'mcp';
  id: string;
  name: string;
  description: string;
  group: ConsumerGroupId | 'builtin' | 'custom';
  status: 'connected' | 'disconnected' | 'error' | 'auth_required' | 'disabled';
  enabled: boolean;
  toneClass: string;
  docs?: string;
  error?: string;
  tools: UnifiedTool[];
  // 原生数据引用
  connectorItem?: ConnectorItem;
  catalogEntry?: McpCatalogEntry;
  mcpServer?: McpServer;
}

const GROUP_SECTIONS: Array<{ id: ConsumerGroupId; title: string }> = [
  { id: 'productivity', title: '效率提升' },
  { id: 'info', title: '信息与出行' },
  { id: 'devdata', title: '开发与数据' },
  { id: 'talk', title: '消息协同' }
];

const FEATURED_IDS = ['rest:github', 'rest:amap', 'mcp:deepwiki'];

// 由 REST 连接器直接接管的服务（避免在 MCP 目录中重复展示两份同名卡片）
const REST_PREFERRED_IDS = new Set(['github', 'tavily', 'amap', 'discord']);

function mapGroupForConnector(id: string, category: string): ConsumerGroupId | 'builtin' | 'custom' {
  if (category === 'builtin') return 'builtin';
  if (id === 'notion' || id === 'linear' || id === 'atlassian' || id === 'airtable' || id === 'filesystem' || id === 'memory' || id === 'sequential-thinking') {
    return 'productivity';
  }
  if (id === 'tavily' || id === 'exa' || id === 'amap' || id === 'amap-maps' || id === 'brave-search' || id === 'fetch' || id === 'playwright' || id === 'deepwiki') {
    return 'info';
  }
  if (id === 'github' || id === 'gitlab' || id === 'sentry' || id === 'vercel' || id === 'supabase' || id === 'neon' || id === 'context7' || id === 'boardui' || id === 'postgres' || id === 'sqlite' || id === 'figma' || id === 'stripe') {
    return 'devdata';
  }
  if (id === 'slack' || id === 'discord') {
    return 'talk';
  }
  return 'custom';
}

function pickToneClass(id: string, group: string): string {
  if (id === 'github' || id === 'notion') return 'tone-slate';
  if (id === 'amap' || id === 'amap-maps' || id === 'deepwiki' || id === 'boardui') return 'tone-blue';
  if (id === 'tavily' || id === 'supabase' || id === 'neon') return 'tone-emerald';
  if (id === 'linear' || id === 'discord' || id === 'stripe') return 'tone-indigo';
  if (id === 'sentry' || id === 'slack' || id === 'browser') return 'tone-purple';
  if (id === 'figma' || id === 'gitlab' || id === 'skills') return 'tone-amber';
  if (group === 'info') return 'tone-cyan';
  if (group === 'devdata') return 'tone-indigo';
  if (group === 'talk') return 'tone-purple';
  return 'tone-blue';
}

function renderServiceIcon(item: Pick<UnifiedConnector, 'id' | 'group'>, size = 18) {
  switch (item.id) {
    case 'terminal':
      return <Terminal size={size} />;
    case 'filesystem':
      return <Folder size={size} />;
    case 'browser':
    case 'playwright':
    case 'fetch':
      return <Globe size={size} />;
    case 'memory':
      return <Brain size={size} />;
    case 'skills':
    case 'sequential-thinking':
      return <Sparkles size={size} />;
    case 'goals':
      return <Target size={size} />;
    case 'feishu':
    case 'slack':
    case 'discord':
      return <MessageCircle size={size} />;
    case 'email':
      return <Mail size={size} />;
    case 'amap':
    case 'amap-maps':
      return <MapPin size={size} />;
    case 'tavily':
    case 'exa':
    case 'brave-search':
      return <Compass size={size} />;
    case 'context7':
    case 'deepwiki':
    case 'notion':
      return <BookOpen size={size} />;
    case 'github':
    case 'gitlab':
    case 'sentry':
    case 'vercel':
      return <Code2 size={size} />;
    case 'supabase':
    case 'neon':
    case 'postgres':
    case 'sqlite':
      return <Database size={size} />;
    case 'figma':
    case 'boardui':
      return <Palette size={size} />;
    default:
      if (item.group === 'devdata') return <FileCode2 size={size} />;
      if (item.group === 'info') return <Globe size={size} />;
      if (item.group === 'talk') return <MessageCircle size={size} />;
      return <Layers size={size} />;
  }
}

export const ConnectorsPanel: React.FC = () => {
  const { showToast } = useApp();

  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<McpCatalogEntry[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);

  const [subTab, setSubTab] = useState<'available' | 'connected'>('available');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGroupDrill, setActiveGroupDrill] = useState<ConsumerGroupId | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  // 弹窗状态
  const [connectTarget, setConnectTarget] = useState<PresetConnectTarget | null>(null);
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  // 详情页交互状态
  const [busyAction, setBusyAction] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testingResult, setTestingResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 详情页工具“试一下”
  const [tryingToolName, setTryingToolName] = useState<string | null>(null);
  const [tryArgs, setTryArgs] = useState<Record<string, unknown>>({});
  const [tryRunning, setTryRunning] = useState(false);
  const [tryOutput, setTryOutput] = useState<McpToolCallResult | null>(null);

  // 详情页高级选项状态
  const [advEndpoint, setAdvEndpoint] = useState('');
  const [advCommand, setAdvCommand] = useState('');
  const [advArgs, setAdvArgs] = useState('');
  const [advRisk, setAdvRisk] = useState<McpRiskLevel>('moderate');
  const [advEveryBot, setAdvEveryBot] = useState(true);
  const [advAssignedBots, setAdvAssignedBots] = useState<string[]>([]);
  const [advLogs, setAdvLogs] = useState<McpLogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [connRes, catRes, mcpRes, botsRes] = await Promise.all([
        api.getConnectors().catch(() => ({ connectors: [] as ConnectorItem[] })),
        api.getMcpCatalog().catch(() => ({ catalog: [] as McpCatalogEntry[] })),
        api.getMcpServers().catch(() => ({ servers: [] as McpServer[] })),
        api.getBots().catch(() => [])
      ]);
      setConnectors(connRes.connectors || []);
      setMcpCatalog(catRes.catalog || []);
      setMcpServers(mcpRes.servers || []);
      setBots(Array.isArray(botsRes) ? botsRes : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const unifiedList = useMemo<UnifiedConnector[]>(() => {
    const list: UnifiedConnector[] = [];
    const mcpByName = new Map(mcpServers.map((s) => [s.name, s]));
    const handledMcpNames = new Set<string>();

    // 1. 内置与 REST 连接器
    for (const c of connectors) {
      const isBuiltin = c.category === 'builtin';
      const mcp = mcpByName.get(c.id);
      if (mcp) handledMcpNames.add(c.id);

      const isCustomConnector = c.category === 'custom';
      const backing: UnifiedConnector['backing'] = isBuiltin
        ? 'builtin'
        : isCustomConnector || c.authType === 'stdio' || mcp
          ? 'mcp'
          : 'rest';

      const group = isBuiltin
        ? 'builtin'
        : isCustomConnector
          ? 'custom'
          : mapGroupForConnector(c.id, c.category);

      const status: UnifiedConnector['status'] = isBuiltin
        ? 'connected'
        : mcp
          ? (mcp.status === 'connected'
              ? 'connected'
              : mcp.status === 'auth_required'
                ? 'auth_required'
                : mcp.status === 'disabled'
                  ? 'disabled'
                  : mcp.status === 'error'
                    ? 'error'
                    : 'disconnected')
          : c.status === 'reauth'
            ? 'auth_required'
            : c.status === 'connecting'
              ? 'disconnected'
              : c.status;

      const tools: UnifiedTool[] =
        mcp && mcp.tools.length > 0
          ? mcp.tools.map((t) => ({
              name: t.name,
              description: t.description,
              enabled: t.enabled,
              risk: t.risk,
              inputSchema: t.inputSchema
            }))
          : (c.tools || []).map((t) => ({
              name: t.name,
              description: t.description,
              enabled: t.enabled
            }));

      list.push({
        uid: `${backing}:${c.id}`,
        backing,
        id: c.id,
        name: c.name,
        description: c.description,
        group,
        status,
        enabled: mcp ? mcp.enabled : status === 'connected',
        toneClass: pickToneClass(c.id, group),
        docs: c.docs,
        error: mcp?.error || c.error,
        tools,
        connectorItem: c,
        mcpServer: mcp
      });
    }

    // 2. 精选 MCP 目录条目（跳过内置和已由 REST 接管的服务）
    for (const entry of mcpCatalog) {
      if (REST_PREFERRED_IDS.has(entry.id)) continue;
      // 跳过已在 connectors 中呈现的 id（如 boardui）
      if (connectors.some((c) => c.id === entry.id)) continue;

      const mcp = mcpByName.get(entry.id);
      if (mcp) handledMcpNames.add(entry.id);

      const group = mapGroupForConnector(entry.id, entry.category);
      const status: UnifiedConnector['status'] = mcp
        ? mcp.status === 'connected'
          ? 'connected'
          : mcp.status === 'auth_required'
            ? 'auth_required'
            : mcp.status === 'disabled'
              ? 'disabled'
              : mcp.status === 'error'
                ? 'error'
                : 'disconnected'
        : 'disconnected';

      list.push({
        uid: `mcp:${entry.id}`,
        backing: 'mcp',
        id: entry.id,
        name: entry.name,
        description: entry.description,
        group,
        status,
        enabled: mcp ? mcp.enabled : false,
        toneClass: pickToneClass(entry.id, group),
        docs: entry.docs,
        error: mcp?.error,
        tools: mcp
          ? mcp.tools.map((t) => ({
              name: t.name,
              description: t.description,
              enabled: t.enabled,
              risk: t.risk,
              inputSchema: t.inputSchema
            }))
          : [],
        catalogEntry: entry,
        mcpServer: mcp
      });
    }

    // 3. 用户通过智能粘贴 / mcp.json 添加的自定义 MCP 服务
    for (const srv of mcpServers) {
      if (handledMcpNames.has(srv.name)) continue;
      list.push({
        uid: `mcp:${srv.name}`,
        backing: 'mcp',
        id: srv.name,
        name: srv.name,
        description: srv.description || srv.url || `${srv.command || ''} ${(srv.args || []).join(' ')}`.trim(),
        group: 'custom',
        status:
          srv.status === 'connected'
            ? 'connected'
            : srv.status === 'auth_required'
              ? 'auth_required'
              : srv.status === 'disabled'
                ? 'disabled'
                : srv.status === 'error'
                  ? 'error'
                  : 'disconnected',
        enabled: srv.enabled,
        toneClass: 'tone-slate',
        docs: srv.docs,
        error: srv.error,
        tools: srv.tools.map((t) => ({
          name: t.name,
          description: t.description,
          enabled: t.enabled,
          risk: t.risk,
          inputSchema: t.inputSchema
        })),
        mcpServer: srv
      });
    }

    return list;
  }, [connectors, mcpCatalog, mcpServers]);

  const selectedItem = useMemo(
    () => (selectedUid ? unifiedList.find((item) => item.uid === selectedUid) || null : null),
    [unifiedList, selectedUid]
  );

  useEffect(() => {
    if (!selectedItem) return;
    setConfirmDisconnect(false);
    setConfirmDelete(false);
    setTestingResult(null);
    setTryingToolName(null);
    setTryOutput(null);
    setShowLogs(false);
    setAdvLogs([]);

    if (selectedItem.mcpServer) {
      setAdvEndpoint(selectedItem.mcpServer.url || '');
      setAdvCommand(selectedItem.mcpServer.command || '');
      setAdvArgs((selectedItem.mcpServer.args || []).join(' '));
      setAdvRisk(selectedItem.mcpServer.risk || 'moderate');
      setAdvEveryBot(selectedItem.mcpServer.everyBot !== false);
      setAdvAssignedBots(selectedItem.mcpServer.assignedBots || []);
    }
  }, [selectedItem?.uid]);

  const handleQuickConnect = async (item: UnifiedConnector) => {
    if (item.backing === 'mcp' && item.catalogEntry) {
      const entry = item.catalogEntry;
      const needsInput =
        (entry.requiredArgs && entry.requiredArgs.length > 0) ||
        (entry.requiredEnv && entry.requiredEnv.length > 0) ||
        (entry.requiredHeaders && entry.requiredHeaders.length > 0);

      if (!needsInput) {
        setBusyAction(true);
        try {
          const res = await api.addMcpServer({
            name: entry.id,
            transport: entry.transport,
            command: entry.command,
            args: entry.args,
            url: entry.url,
            description: entry.description,
            category: entry.category,
            docs: entry.docs,
            risk: entry.risk || 'moderate',
            connectNow: true
          });
          showToast(
            res.server.status === 'connected'
              ? `已成功连接「${item.name}」`
              : `连接尚未就绪：${res.server.error || res.server.status}`,
            res.server.status === 'connected' ? 'success' : 'warning'
          );
          await loadAll();
        } catch (err: any) {
          showToast(err?.message || '连接失败', 'error');
        } finally {
          setBusyAction(false);
        }
        return;
      }

      setConnectTarget({
        backing: 'mcp',
        id: item.id,
        name: item.name,
        description: item.description,
        docs: item.docs,
        toneClass: item.toneClass,
        catalogEntry: entry
      });
      return;
    }

    if (item.connectorItem) {
      if (item.connectorItem.authType === 'none' && item.connectorItem.command) {
        setBusyAction(true);
        try {
          await api.connectConnector({ id: item.id });
          showToast(`已成功连接「${item.name}」`, 'success');
          await loadAll();
        } catch (err: any) {
          showToast(err?.message || '连接失败', 'error');
        } finally {
          setBusyAction(false);
        }
        return;
      }

      setConnectTarget({
        backing: 'rest',
        id: item.id,
        name: item.name,
        description: item.description,
        docs: item.docs,
        toneClass: item.toneClass,
        authType: item.connectorItem.authType,
        keyHint: item.connectorItem.keyHint,
        url: item.connectorItem.url
      });
    }
  };

  const handleDisconnect = async (item: UnifiedConnector) => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }
    setConfirmDisconnect(false);
    setBusyAction(true);
    try {
      if (item.backing === 'mcp' && item.mcpServer) {
        await api.patchMcpServer(item.id, { enabled: false });
      } else {
        await api.disconnectConnector(item.id);
      }
      showToast(`已断开「${item.name}」`, 'info');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || '断开失败', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleReconnect = async (item: UnifiedConnector) => {
    setBusyAction(true);
    try {
      if (item.backing === 'mcp' && item.mcpServer) {
        const res = await api.reconnectMcpServer(item.id);
        showToast(
          res.server.status === 'connected'
            ? `「${item.name}」已重新连接`
            : `重连提示：${res.server.error || res.server.status}`,
          res.server.status === 'connected' ? 'success' : 'warning'
        );
      } else {
        await handleQuickConnect(item);
      }
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || '重连失败', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleToggleTool = async (item: UnifiedConnector, tool: UnifiedTool) => {
    const nextEnabled = !tool.enabled;
    try {
      if (item.backing === 'mcp' && item.mcpServer) {
        await api.toggleMcpTool(item.id, tool.name, nextEnabled);
      } else {
        await api.toggleConnectorTool(item.id, tool.name, nextEnabled);
      }
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || '切换失败', 'error');
    }
  };

  const handleTestDetail = async (item: UnifiedConnector) => {
    setBusyAction(true);
    setTestingResult(null);
    try {
      if (item.backing === 'mcp' && item.mcpServer) {
        const res = await api.testMcpServer(item.id);
        setTestingResult({
          ok: res.ok,
          message: res.ok ? `连接正常 · ${res.toolCount} 项能力 (${res.latencyMs}ms)` : res.error || '连接失败'
        });
        await loadAll();
      } else {
        const res = await api.testConnector(item.id);
        setTestingResult({ ok: res.success, message: res.message });
      }
    } catch (err: any) {
      setTestingResult({ ok: false, message: err?.message || '测试失败' });
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveAdvanced = async (item: UnifiedConnector) => {
    if (!item.mcpServer) return;
    setBusyAction(true);
    try {
      await api.updateMcpServer(item.id, {
        ...(item.mcpServer.transport === 'stdio'
          ? { command: advCommand.trim(), args: advArgs.split(/\s+/).filter(Boolean) }
          : { url: advEndpoint.trim() }),
        risk: advRisk,
        everyBot: advEveryBot,
        assignedBots: advAssignedBots,
        reconnect: true
      });
      showToast('高级设置已保存', 'success');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteCustom = async (item: UnifiedConnector) => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusyAction(true);
    try {
      if (item.mcpServer) {
        await api.deleteMcpServer(item.id);
      }
      if (item.connectorItem) {
        await api.deleteConnector(item.id).catch(() => {});
      }
      showToast(`已移除「${item.name}」`, 'info');
      setSelectedUid(null);
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || '删除失败', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleRunPlaygroundTool = async (item: UnifiedConnector, tool: UnifiedTool) => {
    setTryRunning(true);
    setTryOutput(null);
    try {
      const res = await api.callMcpTool(item.id, tool.name, tryArgs);
      setTryOutput(res);
    } catch (err: any) {
      showToast(err?.message || '运行失败', 'error');
    } finally {
      setTryRunning(false);
    }
  };

  const renderRow = (item: UnifiedConnector) => {
    const isConnected = item.status === 'connected';
    const needsFix = item.status === 'error' || item.status === 'auth_required';

    return (
      <div
        key={item.uid}
        className="conn-list-row"
        onClick={() => setSelectedUid(item.uid)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedUid(item.uid);
          }
        }}
      >
        <div className={`conn-app-icon is-sm ${item.toneClass}`}>
          {renderServiceIcon(item, 17)}
        </div>
        <div className="conn-row-text">
          <div className="conn-row-title">{item.name}</div>
          {subTab === 'connected' && (
            <div className="conn-row-sub">
              {needsFix
                ? '连接异常，请检查凭据'
                : item.status === 'disabled'
                  ? '已暂停'
                  : `已开启 ${item.tools.filter((t) => t.enabled).length} 项能力`}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`conn-row-link ${needsFix ? 'is-warn' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isConnected || item.backing === 'builtin' || item.mcpServer) {
              setSelectedUid(item.uid);
            } else {
              void handleQuickConnect(item);
            }
          }}
        >
          {needsFix ? '修复' : isConnected || item.backing === 'builtin' ? '查看' : '连接'}
        </button>
      </div>
    );
  };

  // ==========================================
  // 详情下钻视图
  // ==========================================
  if (selectedItem) {
    const isConnected = selectedItem.status === 'connected';
    const needsFix = selectedItem.status === 'error' || selectedItem.status === 'auth_required';
    const isMcp = selectedItem.backing === 'mcp' && Boolean(selectedItem.mcpServer);

    return (
      <div className="conn-pane">
        <div className="conn-detail-nav">
          <button
            type="button"
            className="conn-back-link"
            onClick={() => setSelectedUid(null)}
          >
            <ArrowLeft size={16} />
            <span>返回</span>
          </button>
        </div>

        <div className="conn-detail-hero">
          <div className={`conn-app-icon is-lg ${selectedItem.toneClass}`}>
            {renderServiceIcon(selectedItem, 24)}
          </div>
          <div className="conn-detail-head-info">
            <div className="conn-detail-title-row">
              <h4 className="conn-detail-title">{selectedItem.name}</h4>
              <span
                className={`conn-status-tag ${
                  isConnected ? 'is-ok' : needsFix ? 'is-warn' : ''
                }`}
              >
                {isConnected
                  ? '已连接'
                  : selectedItem.status === 'auth_required'
                    ? '需要授权'
                    : selectedItem.status === 'error'
                      ? '连接异常'
                      : selectedItem.status === 'disabled'
                        ? '已暂停'
                        : '未连接'}
              </span>
            </div>
            <p className="conn-detail-desc">{selectedItem.description}</p>
          </div>
        </div>

        {selectedItem.error && needsFix && (
          <div className="conn-inline-error" role="alert">
            <AlertCircle size={14} />
            <span>{selectedItem.error}</span>
          </div>
        )}

        <div className="conn-detail-actions">
          {selectedItem.backing !== 'builtin' && !isConnected && (
            <button
              type="button"
              className="conn-btn-primary"
              disabled={busyAction}
              onClick={() => void handleQuickConnect(selectedItem)}
            >
              {busyAction ? <Loader2 size={14} className="spin" /> : null}
              <span>{selectedItem.mcpServer ? '重新连接' : '连接'}</span>
            </button>
          )}

          {selectedItem.backing !== 'builtin' && isConnected && (
            <>
              <button
                type="button"
                className="conn-btn-ghost"
                disabled={busyAction}
                onClick={() => void handleReconnect(selectedItem)}
              >
                <RefreshCw size={13} className={busyAction ? 'spin' : ''} />
                <span>重新连接</span>
              </button>
              <button
                type="button"
                className={`conn-btn-ghost ${confirmDisconnect ? 'is-danger' : ''}`}
                disabled={busyAction}
                onClick={() => void handleDisconnect(selectedItem)}
              >
                <span>{confirmDisconnect ? '确认断开？' : '断开连接'}</span>
              </button>
            </>
          )}

          {selectedItem.docs && (
            <a
              href={selectedItem.docs}
              target="_blank"
              rel="noreferrer"
              className="conn-btn-ghost"
            >
              <span>使用说明</span>
            </a>
          )}
        </div>

        <div className="conn-section">
          <div className="conn-section-head">
            <h5 className="conn-section-title">
              可用能力 ({selectedItem.tools.filter((t) => t.enabled).length}/{selectedItem.tools.length})
            </h5>
          </div>

          <div className="conn-group-card">
            {selectedItem.tools.length === 0 ? (
              <div className="conn-empty-row">
                {isConnected ? '该服务暂未暴露具体能力条目' : '连接后即可查看并管理此服务的具体能力'}
              </div>
            ) : (
              selectedItem.tools.map((tool) => {
                const isTrying = tryingToolName === tool.name;
                const schemaProps = (tool.inputSchema?.properties &&
                typeof tool.inputSchema.properties === 'object'
                  ? tool.inputSchema.properties
                  : {}) as Record<string, any>;
                const propEntries = Object.entries(schemaProps);

                return (
                  <div key={tool.name} className="conn-tool-item">
                    <div className="conn-tool-main-row">
                      <div className="conn-row-text">
                        <div className="conn-row-title">{tool.name}</div>
                        <div className="conn-row-sub">{tool.description}</div>
                      </div>

                      <div className="conn-tool-right">
                        {isMcp && isConnected && (
                          <button
                            type="button"
                            className="conn-row-link"
                            onClick={() => {
                              if (isTrying) {
                                setTryingToolName(null);
                              } else {
                                setTryingToolName(tool.name);
                                setTryArgs({});
                                setTryOutput(null);
                              }
                            }}
                          >
                            {isTrying ? '收起' : '试一下'}
                          </button>
                        )}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={tool.enabled}
                          aria-label={`切换 ${tool.name}`}
                          className={`conn-switch ${tool.enabled ? 'is-checked' : ''}`}
                          onClick={() => void handleToggleTool(selectedItem, tool)}
                        >
                          <span className="conn-switch-thumb" />
                        </button>
                      </div>
                    </div>

                    {isTrying && (
                      <div className="conn-try-box">
                        {propEntries.length === 0 ? (
                          <div className="conn-field-hint">该能力无需输入参数，可直接运行验证。</div>
                        ) : (
                          <div className="conn-form-stack">
                            {propEntries.map(([k, spec]) => (
                              <label key={k} className="conn-field">
                                <span className="conn-field-label">{k}</span>
                                <input
                                  type={spec?.type === 'number' || spec?.type === 'integer' ? 'number' : 'text'}
                                  className="conn-field-input"
                                  placeholder={spec?.description || k}
                                  value={tryArgs[k] === undefined ? '' : String(tryArgs[k])}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setTryArgs((prev) => ({
                                      ...prev,
                                      [k]:
                                        spec?.type === 'number' || spec?.type === 'integer'
                                          ? raw === '' ? undefined : Number(raw)
                                          : raw
                                    }));
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                        <div className="conn-try-actions">
                          <button
                            type="button"
                            className="conn-btn-primary"
                            disabled={tryRunning}
                            onClick={() => void handleRunPlaygroundTool(selectedItem, tool)}
                          >
                            {tryRunning ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
                            <span>{tryRunning ? '运行中...' : '运行'}</span>
                          </button>
                        </div>
                        {tryOutput && (
                          <pre className="conn-try-output">{tryOutput.outputText}</pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {(isMcp || selectedItem.group === 'custom') && (
          <details className="conn-advanced-details">
            <summary className="conn-advanced-summary">高级选项与连接诊断</summary>
            <div className="conn-advanced-body">
              {selectedItem.mcpServer && (
                <>
                  {selectedItem.mcpServer.transport === 'stdio' ? (
                    <div className="conn-form-row-2">
                      <label className="conn-field">
                        <span className="conn-field-label">启动命令</span>
                        <input
                          type="text"
                          className="conn-field-input"
                          value={advCommand}
                          onChange={(e) => setAdvCommand(e.target.value)}
                        />
                      </label>
                      <label className="conn-field">
                        <span className="conn-field-label">参数</span>
                        <input
                          type="text"
                          className="conn-field-input"
                          value={advArgs}
                          onChange={(e) => setAdvArgs(e.target.value)}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="conn-field">
                      <span className="conn-field-label">服务端点 URL</span>
                      <input
                        type="url"
                        className="conn-field-input"
                        value={advEndpoint}
                        onChange={(e) => setAdvEndpoint(e.target.value)}
                      />
                    </label>
                  )}

                  <div className="conn-form-row-2">
                    <label className="conn-field">
                      <span className="conn-field-label">安全审批级别</span>
                      <select
                        className="conn-field-input"
                        value={advRisk}
                        onChange={(e) => setAdvRisk(e.target.value as McpRiskLevel)}
                      >
                        <option value="safe">低风险（免确认）</option>
                        <option value="moderate">标准（按员工策略）</option>
                        <option value="sensitive">高风险（每次人工确认）</option>
                      </select>
                    </label>

                    <div className="conn-field">
                      <span className="conn-field-label">可用数字员工</span>
                      <label className="conn-check-inline">
                        <input
                          type="checkbox"
                          checked={advEveryBot}
                          onChange={(e) => setAdvEveryBot(e.target.checked)}
                        />
                        <span>全部数字员工可用</span>
                      </label>
                    </div>
                  </div>

                  {!advEveryBot && bots.length > 0 && (
                    <div className="conn-bot-pills">
                      {bots.map((b) => {
                        const checked = advAssignedBots.includes(b.id);
                        return (
                          <label key={b.id} className="conn-check-inline">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setAdvAssignedBots((prev) =>
                                  e.target.checked
                                    ? [...prev, b.id]
                                    : prev.filter((id) => id !== b.id)
                                )
                              }
                            />
                            <span>{b.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div className="conn-adv-actions">
                    <button
                      type="button"
                      className="conn-btn-ghost"
                      disabled={busyAction}
                      onClick={() => void handleTestDetail(selectedItem)}
                    >
                      <Activity size={13} />
                      <span>测试连通</span>
                    </button>
                    <button
                      type="button"
                      className="conn-btn-ghost"
                      onClick={async () => {
                        const next = !showLogs;
                        setShowLogs(next);
                        if (next) {
                          const r = await api.getMcpServerLogs(selectedItem.id).catch(() => ({ logs: [] }));
                          setAdvLogs(r.logs || []);
                        }
                      }}
                    >
                      <span>{showLogs ? '隐藏日志' : '查看日志'}</span>
                    </button>
                    <button
                      type="button"
                      className="conn-btn-primary"
                      disabled={busyAction}
                      onClick={() => void handleSaveAdvanced(selectedItem)}
                    >
                      <span>保存并重连</span>
                    </button>
                  </div>

                  {testingResult && (
                    <div className={testingResult.ok ? 'conn-inline-ok' : 'conn-inline-error'}>
                      <span>{testingResult.message}</span>
                    </div>
                  )}

                  {showLogs && (
                    <div className="conn-logs-box">
                      {advLogs.length === 0 ? (
                        <div className="conn-field-hint">暂无诊断日志</div>
                      ) : (
                        advLogs.slice(-40).map((log, i) => (
                          <div key={i} className="conn-log-line">
                            <span>{formatTime(log.ts)}</span> [{log.level}] {log.message}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="conn-adv-danger">
                <button
                  type="button"
                  className={`conn-btn-ghost ${confirmDelete ? 'is-danger' : ''}`}
                  onClick={() => void handleDeleteCustom(selectedItem)}
                >
                  <Trash2 size={13} />
                  <span>{confirmDelete ? '再次点击确认移除' : '移除此连接器'}</span>
                </button>
              </div>
            </div>
          </details>
        )}
      </div>
    );
  }

  // ==========================================
  // 分类下钻视图 (“查看全部 >”)
  // ==========================================
  if (activeGroupDrill) {
    const groupMeta = GROUP_SECTIONS.find((g) => g.id === activeGroupDrill);
    const groupItems = unifiedList.filter((item) => item.group === activeGroupDrill);

    return (
      <div className="conn-pane">
        <div className="conn-detail-nav">
          <button
            type="button"
            className="conn-back-link"
            onClick={() => setActiveGroupDrill(null)}
          >
            <ArrowLeft size={16} />
            <span>{groupMeta?.title || '返回'}</span>
          </button>
        </div>

        <div className="conn-group-card">
          {groupItems.map((item) => renderRow(item))}
        </div>
      </div>
    );
  }

  // ==========================================
  // 主视图：搜索 + 分段切换 (可用 / 已连接)
  // ==========================================
  const q = searchQuery.trim().toLowerCase();
  const nonBuiltin = unifiedList.filter((i) => i.group !== 'builtin');
  const builtinItems = unifiedList.filter((i) => i.group === 'builtin');

  const connectedExternal = nonBuiltin.filter(
    (i) => i.status === 'connected' || i.status === 'error' || i.status === 'auth_required' || Boolean(i.mcpServer)
  );

  const searchFiltered = q
    ? nonBuiltin.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q) ||
          i.tools.some((t) => t.name.toLowerCase().includes(q))
      )
    : [];

  const featuredItems = FEATURED_IDS.map((uid) => unifiedList.find((i) => i.uid === uid)).filter(
    (x): x is UnifiedConnector => Boolean(x)
  );
  const customItems = nonBuiltin.filter((i) => i.group === 'custom');

  return (
    <div className="conn-pane">
      {/* 顶部圆角搜索框 */}
      <div className="conn-search-bar">
        <Search size={15} className="conn-search-icon" />
        <input
          type="search"
          aria-label="搜索连接器"
          placeholder="搜索"
          className="conn-search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 可用 / 已连接 胶囊分段开关 */}
      <div className="conn-segmented" role="tablist" aria-label="连接器视图">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'available'}
          className="conn-seg-btn"
          onClick={() => setSubTab('available')}
        >
          可用
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'connected'}
          className="conn-seg-btn"
          onClick={() => setSubTab('connected')}
        >
          已连接{connectedExternal.length > 0 ? ` (${connectedExternal.length})` : ''}
        </button>
      </div>

      {loading && unifiedList.length === 0 ? (
        <div className="conn-empty-row">正在加载连接器...</div>
      ) : q ? (
        <div className="conn-section">
          <div className="conn-section-head">
            <h5 className="conn-section-title">搜索结果 ({searchFiltered.length})</h5>
          </div>
          <div className="conn-group-card">
            {searchFiltered.length === 0 ? (
              <div className="conn-empty-row">未找到匹配的连接器，可尝试下方自定义接入</div>
            ) : (
              searchFiltered.map((item) => renderRow(item))
            )}
          </div>
        </div>
      ) : subTab === 'available' ? (
        <>
          {/* 精选 3 卡片 */}
          {featuredItems.length > 0 && (
            <div className="conn-section">
              <div className="conn-section-head">
                <h5 className="conn-section-title">精选</h5>
              </div>
              <div className="conn-featured-grid">
                {featuredItems.map((item) => (
                  <button
                    key={item.uid}
                    type="button"
                    className="conn-featured-card"
                    onClick={() => {
                      if (item.status === 'connected' || item.mcpServer) {
                        setSelectedUid(item.uid);
                      } else {
                        void handleQuickConnect(item);
                      }
                    }}
                  >
                    <div className={`conn-app-icon is-md ${item.toneClass}`}>
                      {renderServiceIcon(item, 21)}
                    </div>
                    <div className="conn-featured-name">
                      {item.name}
                      {item.status === 'connected' && <span className="conn-dot-ok" aria-label="已连接" />}
                    </div>
                    <p className="conn-featured-desc">{item.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 分类分组列表 */}
          {GROUP_SECTIONS.map((sec) => {
            const items = nonBuiltin.filter((i) => i.group === sec.id);
            if (items.length === 0) return null;
            const visible = items.slice(0, 4);

            return (
              <div key={sec.id} className="conn-section">
                <div className="conn-section-head">
                  <h5 className="conn-section-title">{sec.title}</h5>
                  {items.length > 4 && (
                    <button
                      type="button"
                      className="conn-see-all"
                      onClick={() => setActiveGroupDrill(sec.id)}
                    >
                      <span>查看全部</span>
                      <ChevronRight size={14} />
                    </button>
                  )}
                </div>
                <div className="conn-group-card">
                  {visible.map((item) => renderRow(item))}
                </div>
              </div>
            );
          })}

          {/* 自定义扩展与新增入口 */}
          <div className="conn-section">
            <div className="conn-section-head">
              <h5 className="conn-section-title">自定义扩展</h5>
            </div>
            <div className="conn-group-card">
              {customItems.map((item) => renderRow(item))}
              <div
                className="conn-list-row"
                role="button"
                tabIndex={0}
                onClick={() => setIsCustomOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsCustomOpen(true);
                  }
                }}
              >
                <div className="conn-app-icon is-sm tone-blue">
                  <Plus size={17} />
                </div>
                <div className="conn-row-text">
                  <div className="conn-row-title">添加自定义连接器</div>
                  <div className="conn-row-sub">支持粘贴服务链接、命令或 MCP 配置</div>
                </div>
                <span className="conn-row-link">添加</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="conn-section">
            <div className="conn-section-head">
              <h5 className="conn-section-title">已接入服务</h5>
            </div>
            <div className="conn-group-card">
              {connectedExternal.length === 0 ? (
                <div className="conn-empty-row">
                  暂未连接外部服务，可切回「可用」页面一键连接或添加自定义连接器。
                </div>
              ) : (
                connectedExternal.map((item) => renderRow(item))
              )}
            </div>
          </div>

          {builtinItems.length > 0 && (
            <div className="conn-section">
              <div className="conn-section-head">
                <h5 className="conn-section-title">系统内置能力</h5>
              </div>
              <div className="conn-group-card">
                {builtinItems.map((item) => renderRow(item))}
              </div>
            </div>
          )}

          <div className="conn-section">
            <div className="conn-group-card">
              <div
                className="conn-list-row"
                role="button"
                tabIndex={0}
                onClick={() => setIsCustomOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsCustomOpen(true);
                  }
                }}
              >
                <div className="conn-app-icon is-sm tone-blue">
                  <Plus size={17} />
                </div>
                <div className="conn-row-text">
                  <div className="conn-row-title">添加自定义连接器</div>
                  <div className="conn-row-sub">支持粘贴服务链接、命令或 MCP 配置</div>
                </div>
                <span className="conn-row-link">添加</span>
              </div>
            </div>
          </div>
        </>
      )}

      <PresetConnectDialog
        target={connectTarget}
        onClose={() => setConnectTarget(null)}
        onConnected={loadAll}
      />

      <CustomConnectorDialog
        open={isCustomOpen}
        onClose={() => setIsCustomOpen(false)}
        onAdded={loadAll}
      />
    </div>
  );
};
