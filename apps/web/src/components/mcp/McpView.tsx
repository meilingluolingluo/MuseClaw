import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Sparkles,
  Wrench
} from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { copyToClipboard } from '../../utils/clipboard';
import type {
  Bot,
  McpCatalogEntry,
  McpRuntimeStatus,
  McpServer
} from '../../types';
import { McpServerCard } from './McpServerCard';
import { McpAddImportModal, McpCatalogInstallDialog } from './McpAddImportModal';
import { McpWorkbenchDrawer, type McpDrawerTab } from './McpWorkbenchDrawer';

type MainViewTab = 'servers' | 'catalog' | 'json';
type QuickStatusFilter = 'all' | 'connected' | 'issue' | 'disabled';

const CATALOG_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'all', label: '全部分类' },
  { id: 'dev', label: '代码研发' },
  { id: 'search', label: '网页检索' },
  { id: 'data', label: '数据存储' },
  { id: 'browser', label: '浏览器' },
  { id: 'design', label: '设计系统' },
  { id: 'work', label: '办公协同' },
  { id: 'utility', label: '通用工具' }
];

export const McpView: React.FC = () => {
  const { showToast } = useApp();

  const [viewTab, setViewTab] = useState<MainViewTab>('servers');
  const [servers, setServers] = useState<McpServer[]>([]);
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([]);
  const [runtimes, setRuntimes] = useState<McpRuntimeStatus | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // 列表筛选
  const [statusFilter, setStatusFilter] = useState<QuickStatusFilter>('all');
  const [transportFilter, setTransportFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 目录筛选
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [installEntry, setInstallEntry] = useState<McpCatalogEntry | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  // 弹窗与工作台抽屉
  const [addModalMode, setAddModalMode] = useState<'paste' | 'form' | null>(null);
  const [drawerServerName, setDrawerServerName] = useState<string | null>(null);
  const [drawerInitialTab, setDrawerInitialTab] = useState<McpDrawerTab>('tools');

  // mcp.json 编辑器
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonSavedText, setJsonSavedText] = useState('');
  const [savingJson, setSavingJson] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [srvRes, catRes, jsonRes, botsRes] = await Promise.all([
        api.getMcpServers().catch((err) => {
          setLoadError(err?.message || '无法加载 MCP 服务列表');
          return {
            servers: [],
            totalTools: 0,
            enabledTools: 0,
            connectedCount: 0,
            estimatedTokens: 0,
            runtimes: undefined
          };
        }),
        api.getMcpCatalog().catch(() => ({ catalog: [], runtimes: null, installedNames: [] })),
        api.getMcpJson().catch(() => ({ json: '{\n  "mcpServers": {}\n}' })),
        api.getBots().catch(() => [])
      ]);
      setServers(srvRes.servers || []);
      setCatalog(catRes.catalog || []);
      setRuntimes(catRes.runtimes || srvRes.runtimes || null);
      setJsonDraft(jsonRes.json || '{\n  "mcpServers": {}\n}');
      setJsonSavedText(jsonRes.json || '{\n  "mcpServers": {}\n}');
      setBots(Array.isArray(botsRes) ? botsRes : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const stats = useMemo(() => {
    const total = servers.length;
    const connected = servers.filter((s) => s.status === 'connected').length;
    const issues = servers.filter((s) => s.status === 'error' || s.status === 'auth_required').length;
    const disabled = servers.filter((s) => !s.enabled || s.status === 'disabled').length;
    const totalTools = servers.reduce((sum, s) => sum + s.toolCount, 0);
    const enabledTools = servers.reduce((sum, s) => sum + s.enabledToolCount, 0);
    const estimatedTokens = servers.reduce((sum, s) => sum + s.estimatedTokens, 0);
    return { total, connected, issues, disabled, totalTools, enabledTools, estimatedTokens };
  }, [servers]);

  const filteredServers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return servers.filter((s) => {
      if (statusFilter === 'connected' && s.status !== 'connected') return false;
      if (statusFilter === 'issue' && s.status !== 'error' && s.status !== 'auth_required') return false;
      if (statusFilter === 'disabled' && s.enabled && s.status !== 'disabled') return false;
      if (transportFilter !== 'all' && s.transport !== transportFilter) return false;
      if (q) {
        const hitName = s.name.toLowerCase().includes(q);
        const hitDesc = s.description.toLowerCase().includes(q);
        const hitEndpoint = (s.url || s.command || '').toLowerCase().includes(q);
        const hitTool = s.tools.some(
          (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
        );
        if (!hitName && !hitDesc && !hitEndpoint && !hitTool) return false;
      }
      return true;
    });
  }, [servers, statusFilter, transportFilter, searchQuery]);

  const installedNames = useMemo(() => new Set(servers.map((s) => s.name)), [servers]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return catalog.filter((item) => {
      if (catalogCategory !== 'all' && item.category !== catalogCategory) return false;
      if (q) {
        const hit =
          item.name.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          (item.tags || []).some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [catalog, catalogCategory, catalogSearch]);

  const activeDrawerServer = useMemo(
    () => (drawerServerName ? servers.find((s) => s.name === drawerServerName) || null : null),
    [servers, drawerServerName]
  );

  const handleToggleEnabled = async (server: McpServer) => {
    setBusyAction(`toggle:${server.name}`);
    try {
      const res = await api.patchMcpServer(server.name, { enabled: !server.enabled });
      setServers(res.servers);
      showToast(
        res.server.enabled
          ? `已启用「${server.name}」`
          : `已停用「${server.name}」`,
        'info'
      );
    } catch (err: any) {
      showToast(err?.message || '状态切换失败', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestServer = async (server: McpServer) => {
    setBusyAction(`test:${server.name}`);
    try {
      const res = await api.testMcpServer(server.name);
      if (res.server) {
        setServers((prev) => prev.map((s) => (s.name === server.name ? res.server! : s)));
      }
      if (res.ok) {
        showToast(`「${server.name}」握手成功，${res.toolCount} 个工具 (${res.latencyMs}ms)`, 'success');
      } else {
        showToast(`「${server.name}」测试异常：${res.error || '连接失败'}`, 'warning');
      }
    } catch (err: any) {
      showToast(err?.message || '测试请求失败', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleReconnectServer = async (server: McpServer) => {
    setBusyAction(`reconnect:${server.name}`);
    try {
      const res = await api.reconnectMcpServer(server.name);
      setServers((prev) => prev.map((s) => (s.name === server.name ? res.server : s)));
      showToast(
        res.server.status === 'connected'
          ? `「${server.name}」已重连就绪`
          : `「${server.name}」重连异常：${res.server.error || res.server.status}`,
        res.server.status === 'connected' ? 'success' : 'warning'
      );
    } catch (err: any) {
      showToast(err?.message || '重连失败', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCatalogInstallClick = async (entry: McpCatalogEntry) => {
    const needsConfig =
      (entry.requiredEnv && entry.requiredEnv.length > 0) ||
      (entry.requiredHeaders && entry.requiredHeaders.length > 0) ||
      (entry.requiredArgs && entry.requiredArgs.length > 0);

    if (needsConfig) {
      setInstallEntry(entry);
      return;
    }

    setInstallingId(entry.id);
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
      setServers(res.servers);
      if (res.server.status === 'connected') {
        showToast(`已接入「${entry.name}」(${res.server.toolCount} 个工具)`, 'success');
      } else {
        showToast(`已添加「${entry.name}」，状态：${res.server.error || res.server.status}`, 'warning');
      }
      setViewTab('servers');
    } catch (err: any) {
      showToast(err?.message || '安装失败', 'error');
    } finally {
      setInstallingId(null);
    }
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      setJsonDraft(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (err: any) {
      setJsonError(`JSON 语法错误：${err?.message || '请检查括号或引号'}`);
    }
  };

  const handleSaveJson = async () => {
    setJsonError(null);
    setSavingJson(true);
    try {
      const res = await api.saveMcpJson(jsonDraft);
      setServers(res.servers);
      setJsonDraft(res.json);
      setJsonSavedText(res.json);
      showToast('mcp.json 已保存并完成热重载', 'success');
    } catch (err: any) {
      setJsonError(err?.message || '保存失败');
    } finally {
      setSavingJson(false);
    }
  };

  const jsonDirty = jsonDraft !== jsonSavedText;

  return (
    <div className="mcp-page">
      <header className="mcp-header">
        <div className="mcp-header-main">
          <div className="mcp-title-row">
            <h1 className="mcp-title">MCP 服务中心</h1>
            <span className="mcp-count-pill">{stats.connected} / {stats.total} 运行中</span>
            <span className="mcp-env-chip">
              <Wrench size={12} />
              <span>{stats.enabledTools} / {stats.totalTools} 工具可用</span>
            </span>
            <span
              className={`mcp-env-chip ${stats.estimatedTokens > 8000 ? 'is-warn' : ''}`}
              title="所有已启用 MCP 工具 Schema 注入对话上下文的近似 Token 占用"
            >
              ~{stats.estimatedTokens >= 1000 ? `${(stats.estimatedTokens / 1000).toFixed(1)}k` : stats.estimatedTokens} tokens
            </span>
            {runtimes && (
              <span className="mcp-env-chip" title="本机 MCP 运行时可用状态">
                <span>npx {runtimes.npx ? '✓' : '×'}</span>
                <span>· uvx {runtimes.uvx ? '✓' : '×'}</span>
                <span>· docker {runtimes.docker ? '✓' : '×'}</span>
              </span>
            )}
          </div>
          <p className="mcp-sub">
            统一管理 Stdio、Streamable HTTP 与 Legacy SSE 协议服务，支持粘贴配置一键导入、工具级风险门禁与交互式试运行。
          </p>
        </div>

        <div className="mcp-header-actions">
          <button
            type="button"
            className="om-btn-subtle"
            onClick={() => void loadAll()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>刷新</span>
          </button>
          <button
            type="button"
            className="om-btn-subtle"
            onClick={() => setAddModalMode('paste')}
          >
            <ClipboardPaste size={14} />
            <span>粘贴导入</span>
          </button>
          <button
            type="button"
            className="om-btn-primary"
            onClick={() => setAddModalMode('form')}
          >
            <Plus size={15} />
            <span>添加 MCP 服务</span>
          </button>
        </div>
      </header>

      {loadError && (
        <div className="view-load-error is-spaced" role="alert">
          <AlertTriangle size={14} />
          <span>MCP 服务加载失败：{loadError}</span>
          <button type="button" onClick={() => void loadAll()} disabled={loading}>
            重试
          </button>
        </div>
      )}

      <div className="mcp-main-tabs" role="tablist" aria-label="MCP 工作区视图">
        <button
          type="button"
          role="tab"
          aria-selected={viewTab === 'servers'}
          className="mcp-tab-btn"
          onClick={() => setViewTab('servers')}
        >
          <Server size={14} />
          <span>已接入服务 ({stats.total})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewTab === 'catalog'}
          className="mcp-tab-btn"
          onClick={() => setViewTab('catalog')}
        >
          <Sparkles size={14} />
          <span>精选服务目录 ({catalog.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewTab === 'json'}
          className="mcp-tab-btn"
          onClick={async () => {
            setViewTab('json');
            try {
              const res = await api.getMcpJson();
              setJsonDraft(res.json);
              setJsonSavedText(res.json);
            } catch {}
          }}
        >
          <FileJson size={14} />
          <span>mcp.json 配置{jsonDirty ? ' •' : ''}</span>
        </button>
      </div>

      {viewTab === 'servers' && (
        <section className="mcp-section-stack">
          <div className="mcp-summary-bar" role="group" aria-label="状态筛选">
            <button
              type="button"
              className={`summary-pill ${statusFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              <span>全部服务</span>
              <strong>{stats.total}</strong>
            </button>
            <button
              type="button"
              className={`summary-pill is-ok ${statusFilter === 'connected' ? 'is-active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === 'connected' ? 'all' : 'connected')}
            >
              <span>已连接</span>
              <strong>{stats.connected}</strong>
            </button>
            <button
              type="button"
              className={`summary-pill is-warn ${statusFilter === 'issue' ? 'is-active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === 'issue' ? 'all' : 'issue')}
            >
              <span>异常 / 需凭据</span>
              <strong>{stats.issues}</strong>
            </button>
            <button
              type="button"
              className={`summary-pill ${statusFilter === 'disabled' ? 'is-active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === 'disabled' ? 'all' : 'disabled')}
            >
              <span>已停用</span>
              <strong>{stats.disabled}</strong>
            </button>
          </div>

          <div className="mcp-filter-bar">
            <div className="mcp-search-box mcp-search-wide">
              <Search size={14} />
              <input
                type="search"
                aria-label="搜索 MCP 服务或工具"
                placeholder="搜索服务名称、命令、URL 或挂载工具..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              aria-label="传输协议筛选"
              className="mcp-select mcp-select-sm"
              value={transportFilter}
              onChange={(e) => setTransportFilter(e.target.value)}
            >
              <option value="all">全部协议</option>
              <option value="stdio">Stdio</option>
              <option value="http">Streamable HTTP</option>
              <option value="sse">Legacy SSE</option>
            </select>
          </div>

          {loading && servers.length === 0 ? (
            <div className="mcp-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="mcp-card mcp-skeleton" />
              ))}
            </div>
          ) : filteredServers.length === 0 ? (
            <div className="mcp-empty-state">
              <Plug size={34} />
              <h3>{servers.length === 0 ? '尚未接入任何 MCP 服务' : '没有匹配的 MCP 服务'}</h3>
              <p>
                {servers.length === 0
                  ? '可直接粘贴 README 中的 mcp.json / npx 命令一键导入，或从精选目录中一键安装常用工具服务。'
                  : '请调整上方的搜索词或状态筛选条件。'}
              </p>
              {servers.length === 0 && (
                <div className="mcp-empty-actions">
                  <button
                    type="button"
                    className="om-btn-primary"
                    onClick={() => setAddModalMode('paste')}
                  >
                    <ClipboardPaste size={14} />
                    <span>粘贴配置一键导入</span>
                  </button>
                  <button
                    type="button"
                    className="om-btn-subtle"
                    onClick={() => setViewTab('catalog')}
                  >
                    <Sparkles size={14} />
                    <span>浏览精选目录</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="mcp-grid">
              {filteredServers.map((server) => (
                <McpServerCard
                  key={server.name}
                  server={server}
                  bots={bots}
                  busyAction={busyAction}
                  onToggleEnabled={handleToggleEnabled}
                  onTest={handleTestServer}
                  onReconnect={handleReconnectServer}
                  onOpenDrawer={(target, tab = 'tools') => {
                    setDrawerServerName(target.name);
                    setDrawerInitialTab(tab);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {viewTab === 'catalog' && (
        <section className="mcp-section-stack">
          <div className="mcp-catalog-toolbar">
            <div className="mcp-cats-row">
              {CATALOG_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`cat-pill ${catalogCategory === cat.id ? 'is-active' : ''}`}
                  onClick={() => setCatalogCategory(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="mcp-search-box">
              <Search size={14} />
              <input
                type="search"
                aria-label="搜索精选目录"
                placeholder="搜索服务名称、标签或能力..."
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="mcp-grid">
            {filteredCatalog.map((entry) => {
              const isInstalled = installedNames.has(entry.id);
              const missingRuntime =
                entry.requiresRuntime && runtimes && !runtimes[entry.requiresRuntime];
              const isBusy = installingId === entry.id;

              return (
                <article key={entry.id} className="mcp-catalog-card">
                  <div className="mcp-catalog-top">
                    <div className="mcp-catalog-title-row">
                      <h3>{entry.name}</h3>
                      <span className="mcp-transport-tag">{entry.transport.toUpperCase()}</span>
                    </div>
                    <p className="mcp-card-desc">{entry.description}</p>
                  </div>

                  <div className="mcp-catalog-tags">
                    {(entry.tags || []).map((tag) => (
                      <span key={tag} className="mcp-metric-pill">
                        {tag}
                      </span>
                    ))}
                    {entry.requiresRuntime && (
                      <span className={`mcp-metric-pill ${missingRuntime ? 'is-warn' : 'is-ok'}`}>
                        需要 {entry.requiresRuntime}
                        {missingRuntime ? ' (未检测到)' : ''}
                      </span>
                    )}
                    {isInstalled && (
                      <span className="mcp-metric-pill is-ok">
                        <CheckCircle2 size={11} /> 已安装
                      </span>
                    )}
                  </div>

                  <div className="mcp-catalog-footer">
                    {entry.docs ? (
                      <a
                        href={entry.docs}
                        target="_blank"
                        rel="noreferrer"
                        className="mcp-doc-link"
                      >
                        <span>文档</span>
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span />
                    )}

                    <button
                      type="button"
                      className={isInstalled ? 'om-btn-subtle mcp-btn-xs' : 'om-btn-primary mcp-btn-xs'}
                      disabled={isBusy}
                      onClick={() => void handleCatalogInstallClick(entry)}
                    >
                      {isBusy ? (
                        <Loader2 size={13} className="spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      <span>
                        {isBusy ? '接入中...' : isInstalled ? '重新配置 / 安装' : '一键接入'}
                      </span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {viewTab === 'json' && (
        <section className="mcp-json-panel">
          <div className="mcp-json-toolbar">
            <div className="mcp-json-hint">
              标准 <code>mcp.json</code> 格式（已保存的密钥以 <code>"••••••••"</code> 脱敏展示，保留占位符即不会覆盖原密钥）
            </div>
            <div className="mcp-json-actions">
              <button type="button" className="om-btn-subtle mcp-btn-xs" onClick={handleFormatJson}>
                格式化 JSON
              </button>
              <button
                type="button"
                className="om-btn-subtle mcp-btn-xs"
                onClick={async () => {
                  const ok = await copyToClipboard(jsonDraft);
                  showToast(ok ? '已复制 mcp.json' : '复制失败', ok ? 'info' : 'error');
                }}
              >
                <Copy size={13} />
                <span>复制</span>
              </button>
              <button
                type="button"
                className="om-btn-subtle mcp-btn-xs"
                disabled={!jsonDirty}
                onClick={() => {
                  setJsonDraft(jsonSavedText);
                  setJsonError(null);
                }}
              >
                还原
              </button>
              <button
                type="button"
                className="om-btn-primary mcp-btn-xs"
                disabled={savingJson}
                onClick={handleSaveJson}
              >
                {savingJson ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                <span>{savingJson ? '保存并重载中...' : '保存并热重载'}</span>
              </button>
            </div>
          </div>

          {jsonError && (
            <div className="mcp-alert-box is-error" role="alert">
              <AlertTriangle size={14} />
              <span>{jsonError}</span>
            </div>
          )}

          <textarea
            aria-label="mcp.json 编辑器"
            className="mcp-json-editor"
            spellCheck={false}
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
          />
        </section>
      )}

      <McpAddImportModal
        open={addModalMode !== null}
        initialMode={addModalMode || 'paste'}
        onClose={() => setAddModalMode(null)}
        onCompleted={(nextServers) => {
          setServers(nextServers);
          setViewTab('servers');
        }}
      />

      <McpCatalogInstallDialog
        entry={installEntry}
        onClose={() => setInstallEntry(null)}
        onInstalled={(nextServers) => {
          setServers(nextServers);
          setViewTab('servers');
        }}
      />

      <McpWorkbenchDrawer
        server={activeDrawerServer}
        initialTab={drawerInitialTab}
        bots={bots}
        onClose={() => setDrawerServerName(null)}
        onServerUpdated={(updated) => {
          setServers((prev) => prev.map((s) => (s.name === updated.name ? updated : s)));
        }}
        onServerDeleted={(deletedName) => {
          setServers((prev) => prev.filter((s) => s.name !== deletedName));
          setDrawerServerName(null);
        }}
      />
    </div>
  );
};
