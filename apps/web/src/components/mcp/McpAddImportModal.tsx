import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  FileCode2,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
  X
} from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import type {
  McpCatalogEntry,
  McpParsedImportEntry,
  McpProbeResult,
  McpRiskLevel,
  McpServer,
  McpTransportType
} from '../../types';

interface KeyValueRow {
  key: string;
  value: string;
}

function useModalDialogBehavior(
  open: boolean,
  onClose: () => void
) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };
    dialog.addEventListener('close', handleClose);

    // 针对不支持 closedby="any" 的浏览器补充外部点击关闭兜底
    let cleanupOutside: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onDown);
      dialog.addEventListener('pointerup', onUp);
      cleanupOutside = () => {
        dialog.removeEventListener('pointerdown', onDown);
        dialog.removeEventListener('pointerup', onUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupOutside?.();
    };
  }, [onClose]);

  return dialogRef;
}

interface McpAddImportModalProps {
  open: boolean;
  initialMode: 'paste' | 'form';
  onClose: () => void;
  onCompleted: (servers: McpServer[]) => void;
}

export const McpAddImportModal: React.FC<McpAddImportModalProps> = ({
  open,
  initialMode,
  onClose,
  onCompleted
}) => {
  const { showToast } = useApp();
  const titleId = useId();
  const dialogRef = useModalDialogBehavior(open, onClose);

  const [mode, setMode] = useState<'paste' | 'form'>(initialMode);

  // 智能粘贴状态
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedEntries, setParsedEntries] = useState<McpParsedImportEntry[]>([]);
  const [gapValues, setGapValues] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);

  // 手动表单状态
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransportType>('stdio');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('custom');
  const [command, setCommand] = useState('npx');
  const [argsText, setArgsText] = useState('');
  const [cwd, setCwd] = useState('');
  const [url, setUrl] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [kvRows, setKvRows] = useState<KeyValueRow[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connectTimeoutMs, setConnectTimeoutMs] = useState(20000);
  const [timeoutMs, setTimeoutMs] = useState(60000);
  const [maxResultBytes, setMaxResultBytes] = useState(65536);
  const [risk, setRisk] = useState<McpRiskLevel>('moderate');
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<McpProbeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setFormError(null);
      setProbeResult(null);
    }
  }, [open, initialMode]);

  useEffect(() => {
    const trimmed = pasteText.trim();
    if (!trimmed) {
      setParsedEntries([]);
      setParseError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setParsing(true);
      try {
        const res = await api.parseMcpPaste(trimmed);
        if (res.ok && res.entries) {
          setParsedEntries(res.entries);
          setParseError(null);
          const initGaps: Record<string, string> = {};
          res.entries.forEach((entry, idx) => {
            entry.gaps.forEach((g) => {
              const id = `${idx}:${g.target}:${g.key}`;
              initGaps[id] = gapValues[id] ?? '';
            });
          });
          setGapValues(initGaps);
        } else {
          setParsedEntries([]);
          setParseError(res.error || '未能识别配置格式');
        }
      } catch (err: any) {
        setParsedEntries([]);
        setParseError(err?.message || '解析失败');
      } finally {
        setParsing(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [pasteText]);

  const handleImportSubmit = async () => {
    if (parsedEntries.length === 0) return;

    const prepared = parsedEntries.map((entry, idx) => {
      const cfg = {
        ...entry.config,
        env: entry.config.env ? { ...entry.config.env } : undefined,
        headers: entry.config.headers ? { ...entry.config.headers } : undefined,
        args: entry.config.args ? [...entry.config.args] : undefined
      };

      for (const g of entry.gaps) {
        const val = (gapValues[`${idx}:${g.target}:${g.key}`] || '').trim();
        if (!val) continue;
        if (g.target === 'env') {
          cfg.env = cfg.env || {};
          cfg.env[g.key] = val;
        } else if (g.target === 'header') {
          cfg.headers = cfg.headers || {};
          if (/^Bearer\s+/i.test(g.rawValue) && !/^Bearer\s+/i.test(val)) {
            cfg.headers[g.key] = `Bearer ${val}`;
          } else {
            cfg.headers[g.key] = val;
          }
        } else if (g.target === 'url') {
          cfg.url = val;
        } else if (g.target === 'arg') {
          const argIdx = Number(g.key);
          if (cfg.args && Number.isInteger(argIdx)) {
            cfg.args[argIdx] = val;
          }
        }
      }

      return { name: entry.name, config: cfg };
    });

    setImporting(true);
    try {
      const res = await api.importMcpServers(prepared, true);
      showToast(`已成功导入 ${res.imported.length} 个 MCP 服务`, 'success');
      setPasteText('');
      setParsedEntries([]);
      onCompleted(res.servers);
      onClose();
    } catch (err: any) {
      setParseError(err?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const buildDraftPayload = () => {
    const cleanName = name.trim();
    const kvMap: Record<string, string> = {};
    for (const row of kvRows) {
      if (row.key.trim()) {
        kvMap[row.key.trim()] = row.value;
      }
    }

    if (transport === 'stdio') {
      const parsedArgs = argsText
        .split(/\r?\n/)
        .flatMap((line) => line.trim().split(/\s+/))
        .filter(Boolean);
      return {
        name: cleanName,
        transport,
        description: description.trim() || undefined,
        category,
        command: command.trim(),
        args: parsedArgs,
        cwd: cwd.trim() || undefined,
        env: Object.keys(kvMap).length > 0 ? kvMap : undefined,
        connectTimeoutMs,
        timeoutMs,
        maxResultBytes,
        risk
      };
    }

    const headers: Record<string, string> = { ...kvMap };
    if (bearerToken.trim() && !headers.Authorization) {
      headers.Authorization = /^Bearer\s+/i.test(bearerToken.trim())
        ? bearerToken.trim()
        : `Bearer ${bearerToken.trim()}`;
    }
    return {
      name: cleanName,
      transport,
      description: description.trim() || undefined,
      category,
      url: url.trim(),
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      connectTimeoutMs,
      timeoutMs,
      maxResultBytes,
      risk
    };
  };

  const handleProbeDraft = async () => {
    setFormError(null);
    if (transport === 'stdio' && !command.trim()) {
      setFormError('Stdio 模式必须填写启动命令');
      return;
    }
    if (transport !== 'stdio' && !url.trim()) {
      setFormError('远程模式必须填写服务端点 URL');
      return;
    }
    setProbing(true);
    try {
      const res = await api.probeMcpConfig(buildDraftPayload());
      setProbeResult(res);
    } catch (err: any) {
      setFormError(err?.message || '探测失败');
    } finally {
      setProbing(false);
    }
  };

  const handleFormSubmit = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError('请输入 MCP 服务名称（如 context7、github）');
      return;
    }
    if (transport === 'stdio' && !command.trim()) {
      setFormError('Stdio 模式必须填写启动命令');
      return;
    }
    if (transport !== 'stdio' && !url.trim()) {
      setFormError('远程模式必须填写服务端点 URL');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.addMcpServer({
        ...buildDraftPayload(),
        connectNow: true
      });
      if (res.server.status === 'connected') {
        showToast(`MCP 服务「${res.server.name}」已接入并发现 ${res.server.toolCount} 个工具`, 'success');
      } else {
        showToast(`服务已保存，当前状态：${res.server.error || res.server.status}`, 'warning');
      }
      setName('');
      setArgsText('');
      setUrl('');
      setBearerToken('');
      setKvRows([]);
      onCompleted(res.servers);
      onClose();
    } catch (err: any) {
      setFormError(err?.message || '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="mcp-dialog"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as any)}
    >
      <div className="mcp-dialog-shell">
        <header className="mcp-dialog-header">
          <div>
            <h1 id={titleId} className="mcp-dialog-title">
              接入 MCP 服务
            </h1>
            <p className="mcp-dialog-sub">
              支持粘贴配置一键识别，或通过标准表单连接 Stdio / Streamable HTTP / SSE 服务
            </p>
          </div>
          <button
            type="button"
            className="mcp-icon-btn"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="mcp-dialog-tabs" role="tablist" aria-label="接入方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'paste'}
            className="mcp-tab-btn"
            onClick={() => setMode('paste')}
          >
            <ClipboardPaste size={14} />
            <span>智能粘贴导入</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'form'}
            className="mcp-tab-btn"
            onClick={() => setMode('form')}
          >
            <FileCode2 size={14} />
            <span>表单配置</span>
          </button>
        </div>

        <div className="mcp-dialog-body">
          {mode === 'paste' ? (
            <div className="mcp-form-stack">
              <label className="mcp-field">
                <span className="mcp-field-label">粘贴任意 MCP 配置、启动命令或端点 URL</span>
                <textarea
                  autoFocus={mode === 'paste'}
                  className="mcp-textarea mcp-mono"
                  rows={6}
                  spellCheck={false}
                  placeholder={`支持以下任意格式：\n1. mcpServers JSON 片段：{ "mcpServers": { "context7": { "command": "npx", "args": ["-y", "@upstash/context7-mcp"] } } }\n2. 启动命令行：npx -y @modelcontextprotocol/server-filesystem /path/to/dir\n3. CLI 命令：claude mcp add linear --transport http https://mcp.linear.app/mcp\n4. 远程端点地址：https://mcp.deepwiki.com/mcp`}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
              </label>

              {parsing && (
                <div className="mcp-status-note">
                  <Loader2 size={14} className="spin" />
                  <span>正在智能识别配置格式...</span>
                </div>
              )}

              {parseError && (
                <div className="mcp-alert-box is-error" role="alert">
                  <AlertCircle size={14} />
                  <span>{parseError}</span>
                </div>
              )}

              {parsedEntries.length > 0 && (
                <div className="mcp-paste-preview">
                  <div className="mcp-preview-header">
                    已识别 {parsedEntries.length} 个 MCP 服务配置
                  </div>
                  {parsedEntries.map((entry, idx) => (
                    <div key={`${entry.name}_${idx}`} className="mcp-preview-item">
                      <div className="mcp-preview-item-top">
                        <strong>{entry.name}</strong>
                        <span className="mcp-transport-tag">
                          {(entry.config.transport || 'stdio').toUpperCase()}
                        </span>
                        {entry.exists && (
                          <span className="mcp-warn-tag">将覆盖同名配置</span>
                        )}
                      </div>
                      <code className="mcp-preview-cmd">
                        {entry.config.command
                          ? `${entry.config.command} ${(entry.config.args || []).join(' ')}`
                          : entry.config.url}
                      </code>

                      {entry.gaps.length > 0 && (
                        <div className="mcp-gaps-box">
                          <div className="mcp-gaps-title">
                            <KeyRound size={12} />
                            <span>检测到待补充的占位凭据或参数：</span>
                          </div>
                          {entry.gaps.map((g) => {
                            const id = `${idx}:${g.target}:${g.key}`;
                            return (
                              <label key={id} className="mcp-field">
                                <span className="mcp-field-label">{g.label}</span>
                                <input
                                  type={g.target === 'env' || g.target === 'header' ? 'password' : 'text'}
                                  className="mcp-input"
                                  placeholder={`替换占位符 ${g.rawValue}`}
                                  value={gapValues[id] || ''}
                                  onChange={(e) =>
                                    setGapValues((prev) => ({ ...prev, [id]: e.target.value }))
                                  }
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mcp-form-stack">
              <div className="mcp-form-grid-2">
                <label className="mcp-field">
                  <span className="mcp-field-label">服务标识名称 *</span>
                  <input
                    autoFocus={mode === 'form'}
                    type="text"
                    className="mcp-input"
                    placeholder="如 context7、github、deepwiki"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>

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
              </div>

              <div className="mcp-form-grid-2">
                <label className="mcp-field">
                  <span className="mcp-field-label">功能简述</span>
                  <input
                    type="text"
                    className="mcp-input"
                    placeholder="说明此服务提供的工具能力"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>

                <label className="mcp-field">
                  <span className="mcp-field-label">业务分类</span>
                  <select
                    className="mcp-select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="dev">代码研发</option>
                    <option value="search">网页检索</option>
                    <option value="data">数据存储</option>
                    <option value="browser">浏览器</option>
                    <option value="design">设计工具</option>
                    <option value="work">办公协同</option>
                    <option value="utility">通用工具</option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
              </div>

              {transport === 'stdio' ? (
                <>
                  <div className="mcp-form-grid-2">
                    <label className="mcp-field">
                      <span className="mcp-field-label">启动命令 (Command) *</span>
                      <input
                        type="text"
                        className="mcp-input mcp-mono"
                        placeholder="npx / uvx / node / python3 / docker"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                      />
                    </label>
                    <label className="mcp-field">
                      <span className="mcp-field-label">工作目录 (可选)</span>
                      <input
                        type="text"
                        className="mcp-input mcp-mono"
                        placeholder="默认当前工作区"
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                      />
                    </label>
                  </div>

                  <label className="mcp-field">
                    <span className="mcp-field-label">命令参数 (Args，支持换行或空格分隔)</span>
                    <textarea
                      className="mcp-textarea mcp-mono"
                      rows={3}
                      spellCheck={false}
                      placeholder="-y&#10;@upstash/context7-mcp"
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="mcp-field">
                    <span className="mcp-field-label">服务端点 URL *</span>
                    <input
                      type="url"
                      className="mcp-input mcp-mono"
                      placeholder="https://mcp.example.com/mcp"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </label>

                  <label className="mcp-field">
                    <span className="mcp-field-label">Bearer Token / API 密钥 (可选)</span>
                    <input
                      type="password"
                      className="mcp-input mcp-mono"
                      placeholder="自动注入为 Authorization: Bearer <token>"
                      value={bearerToken}
                      onChange={(e) => setBearerToken(e.target.value)}
                    />
                  </label>
                </>
              )}

              <div className="mcp-kv-section">
                <div className="mcp-kv-header">
                  <span className="mcp-field-label">
                    {transport === 'stdio' ? '环境变量 (Env)' : '自定义请求头 (Headers)'}
                  </span>
                  <button
                    type="button"
                    className="om-btn-subtle mcp-btn-xs"
                    onClick={() => setKvRows((prev) => [...prev, { key: '', value: '' }])}
                  >
                    <Plus size={12} />
                    <span>添加一行</span>
                  </button>
                </div>
                {kvRows.map((row, idx) => (
                  <div key={idx} className="mcp-kv-row">
                    <input
                      type="text"
                      className="mcp-input mcp-mono"
                      placeholder={transport === 'stdio' ? 'KEY' : 'Header-Name'}
                      value={row.key}
                      onChange={(e) =>
                        setKvRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      type="password"
                      className="mcp-input mcp-mono"
                      placeholder="Value"
                      value={row.value}
                      onChange={(e) =>
                        setKvRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r))
                        )
                      }
                    />
                    <button
                      type="button"
                      className="mcp-icon-btn"
                      aria-label="删除此行"
                      onClick={() => setKvRows((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mcp-advanced-box">
                <button
                  type="button"
                  className="mcp-link-btn"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? '收起高级参数与安全预算' : '展开高级参数与安全预算'}
                </button>
                {showAdvanced && (
                  <div className="mcp-form-grid-2 mcp-advanced-grid">
                    <label className="mcp-field">
                      <span className="mcp-field-label">默认风险级别</span>
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
                    <label className="mcp-field">
                      <span className="mcp-field-label">单次结果字节预算</span>
                      <input
                        type="number"
                        className="mcp-input"
                        min={1024}
                        step={4096}
                        value={maxResultBytes}
                        onChange={(e) => setMaxResultBytes(Number(e.target.value) || 65536)}
                      />
                    </label>
                    <label className="mcp-field">
                      <span className="mcp-field-label">握手超时 (ms)</span>
                      <input
                        type="number"
                        className="mcp-input"
                        min={3000}
                        step={1000}
                        value={connectTimeoutMs}
                        onChange={(e) => setConnectTimeoutMs(Number(e.target.value) || 20000)}
                      />
                    </label>
                    <label className="mcp-field">
                      <span className="mcp-field-label">调用超时 (ms)</span>
                      <input
                        type="number"
                        className="mcp-input"
                        min={5000}
                        step={5000}
                        value={timeoutMs}
                        onChange={(e) => setTimeoutMs(Number(e.target.value) || 60000)}
                      />
                    </label>
                  </div>
                )}
              </div>

              {probeResult && (
                <div className={`mcp-alert-box ${probeResult.ok ? 'is-ok' : 'is-error'}`}>
                  {probeResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  <span>
                    {probeResult.ok
                      ? `握手成功 (${probeResult.transport.toUpperCase()}, ${probeResult.latencyMs}ms)，发现 ${probeResult.toolCount} 个工具`
                      : probeResult.error || '探测失败'}
                  </span>
                </div>
              )}

              {formError && (
                <div className="mcp-alert-box is-error" role="alert">
                  <AlertCircle size={14} />
                  <span>{formError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="mcp-dialog-footer">
          <button type="button" className="om-btn-subtle" onClick={onClose}>
            取消
          </button>

          {mode === 'paste' ? (
            <button
              type="button"
              className="om-btn-primary"
              disabled={importing || parsedEntries.length === 0}
              onClick={handleImportSubmit}
            >
              {importing ? <Loader2 size={14} className="spin" /> : null}
              <span>{importing ? '正在导入连接...' : `导入并连接 (${parsedEntries.length})`}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                className="om-btn-subtle"
                disabled={probing}
                onClick={handleProbeDraft}
              >
                {probing ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}
                <span>探测连通</span>
              </button>
              <button
                type="button"
                className="om-btn-primary"
                disabled={submitting}
                onClick={handleFormSubmit}
              >
                {submitting ? <Loader2 size={14} className="spin" /> : null}
                <span>{submitting ? '接入中...' : '保存并接入'}</span>
              </button>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
};

interface McpCatalogInstallDialogProps {
  entry: McpCatalogEntry | null;
  onClose: () => void;
  onInstalled: (servers: McpServer[]) => void;
}

export const McpCatalogInstallDialog: React.FC<McpCatalogInstallDialogProps> = ({
  entry,
  onClose,
  onInstalled
}) => {
  const { showToast } = useApp();
  const titleId = useId();
  const dialogRef = useModalDialogBehavior(Boolean(entry), onClose);

  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [headerValues, setHeaderValues] = useState<Record<string, string>>({});
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setError(null);
    setEnvValues({});
    setHeaderValues({});
    const defaults: Record<string, string> = {};
    (entry.requiredArgs || []).forEach((arg) => {
      defaults[arg.key] = arg.defaultValue || '';
    });
    setArgValues(defaults);
  }, [entry?.id]);

  const handleInstall = async () => {
    if (!entry) return;
    setError(null);

    for (const f of entry.requiredEnv || []) {
      if (f.required && !(envValues[f.key] || '').trim()) {
        setError(`请填写必填环境变量：${f.label}`);
        return;
      }
    }
    for (const f of entry.requiredHeaders || []) {
      if (f.required && !(headerValues[f.key] || '').trim()) {
        setError(`请填写必填认证请求头：${f.label}`);
        return;
      }
    }
    for (const f of entry.requiredArgs || []) {
      if (f.required && !(argValues[f.key] || '').trim()) {
        setError(`请填写必填参数：${f.label}`);
        return;
      }
    }

    const args = [...(entry.args || [])];
    for (const f of entry.requiredArgs || []) {
      args[f.index] = (argValues[f.key] || '').trim();
    }

    const env = Object.fromEntries(
      Object.entries(envValues).filter(([, v]) => v.trim().length > 0)
    );
    const headers = Object.fromEntries(
      Object.entries(headerValues).filter(([, v]) => v.trim().length > 0)
    );

    setInstalling(true);
    try {
      const res = await api.addMcpServer({
        name: entry.id,
        transport: entry.transport,
        command: entry.command,
        args: args.length > 0 ? args : undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
        url: entry.url,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        description: entry.description,
        category: entry.category,
        docs: entry.docs,
        risk: entry.risk || 'moderate',
        connectNow: true
      });
      if (res.server.status === 'connected') {
        showToast(`已安装并接入「${entry.name}」(${res.server.toolCount} 个工具)`, 'success');
      } else {
        showToast(`服务已写入，当前状态：${res.server.error || res.server.status}`, 'warning');
      }
      onInstalled(res.servers);
      onClose();
    } catch (err: any) {
      setError(err?.message || '安装失败');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="mcp-dialog"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as any)}
    >
      <div className="mcp-dialog-shell mcp-dialog-compact">
        <header className="mcp-dialog-header">
          <div>
            <h1 id={titleId} className="mcp-dialog-title">
              配置并安装 · {entry?.name || ''}
            </h1>
            <p className="mcp-dialog-sub">{entry?.description}</p>
          </div>
          <button type="button" className="mcp-icon-btn" aria-label="关闭弹窗" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="mcp-dialog-body">
          <div className="mcp-form-stack">
            {(entry?.requiredArgs || []).map((field, idx) => (
              <label key={field.key} className="mcp-field">
                <span className="mcp-field-label">
                  {field.label} {field.required ? '*' : ''}
                </span>
                <input
                  autoFocus={idx === 0}
                  type="text"
                  className="mcp-input mcp-mono"
                  placeholder={field.placeholder}
                  value={argValues[field.key] ?? ''}
                  onChange={(e) =>
                    setArgValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
              </label>
            ))}

            {(entry?.requiredEnv || []).map((field, idx) => (
              <label key={field.key} className="mcp-field">
                <span className="mcp-field-label">
                  {field.label} ({field.key}) {field.required ? '*' : ''}
                </span>
                <input
                  autoFocus={idx === 0 && !(entry?.requiredArgs?.length)}
                  type={field.secret ? 'password' : 'text'}
                  className="mcp-input mcp-mono"
                  placeholder={field.placeholder}
                  value={envValues[field.key] ?? ''}
                  onChange={(e) =>
                    setEnvValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
                {field.help && <span className="mcp-field-help">{field.help}</span>}
              </label>
            ))}

            {(entry?.requiredHeaders || []).map((field, idx) => (
              <label key={field.key} className="mcp-field">
                <span className="mcp-field-label">
                  {field.label} {field.required ? '*' : ''}
                </span>
                <input
                  autoFocus={
                    idx === 0 && !(entry?.requiredArgs?.length) && !(entry?.requiredEnv?.length)
                  }
                  type={field.secret ? 'password' : 'text'}
                  className="mcp-input mcp-mono"
                  placeholder={field.placeholder}
                  value={headerValues[field.key] ?? ''}
                  onChange={(e) =>
                    setHeaderValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                />
              </label>
            ))}

            {error && (
              <div className="mcp-alert-box is-error" role="alert">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <footer className="mcp-dialog-footer">
          <button type="button" className="om-btn-subtle" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="om-btn-primary"
            disabled={installing}
            onClick={handleInstall}
          >
            {installing ? <Loader2 size={14} className="spin" /> : null}
            <span>{installing ? '安装并握手中...' : '安装并接入'}</span>
          </button>
        </footer>
      </div>
    </dialog>
  );
};
