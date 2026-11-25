import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
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
  McpTransportType
} from '../../types';

export interface PresetConnectTarget {
  backing: 'rest' | 'mcp';
  id: string;
  name: string;
  description: string;
  docs?: string;
  toneClass: string;
  // REST 连接器字段
  authType?: 'none' | 'key' | 'oauth' | 'stdio' | 'sse';
  keyHint?: string;
  url?: string;
  // MCP 目录字段
  catalogEntry?: McpCatalogEntry;
}

export function useNativeDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };
    dialog.addEventListener('close', handleClose);

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
        if (pressedOutside && isOutside(e)) dialog.close();
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

  return ref;
}

interface PresetConnectDialogProps {
  target: PresetConnectTarget | null;
  onClose: () => void;
  onConnected: () => Promise<void>;
}

export const PresetConnectDialog: React.FC<PresetConnectDialogProps> = ({
  target,
  onClose,
  onConnected
}) => {
  const { showToast } = useApp();
  const titleId = useId();
  const dialogRef = useNativeDialog(Boolean(target), onClose);

  // REST 字段
  const [keyInput, setKeyInput] = useState('');
  const [urlInput, setUrlInput] = useState('');

  // MCP 目录字段
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [headerValues, setHeaderValues] = useState<Record<string, string>>({});
  const [argValues, setArgValues] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setError(null);
    setKeyInput('');
    setUrlInput(target.url || '');
    setEnvValues({});
    setHeaderValues({});
    const argDefaults: Record<string, string> = {};
    (target.catalogEntry?.requiredArgs || []).forEach((f) => {
      argDefaults[f.key] = f.defaultValue || '';
    });
    setArgValues(argDefaults);
  }, [target]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setError(null);
    setSubmitting(true);

    try {
      if (target.backing === 'mcp' && target.catalogEntry) {
        const entry = target.catalogEntry;
        for (const f of entry.requiredArgs || []) {
          if (f.required && !(argValues[f.key] || '').trim()) {
            setError(`请填写${f.label}`);
            setSubmitting(false);
            return;
          }
        }
        for (const f of entry.requiredEnv || []) {
          if (f.required && !(envValues[f.key] || '').trim()) {
            setError(`请填写${f.label}`);
            setSubmitting(false);
            return;
          }
        }
        for (const f of entry.requiredHeaders || []) {
          if (f.required && !(headerValues[f.key] || '').trim()) {
            setError(`请填写${f.label}`);
            setSubmitting(false);
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

        if (res.server.status !== 'connected') {
          setError(res.server.error || '连接尚未就绪，请检查配置信息');
          await onConnected();
          return;
        }
        showToast(`已成功连接「${target.name}」`, 'success');
      } else {
        const res = await api.connectConnector({
          id: target.id,
          key: keyInput.trim() || undefined,
          url: urlInput.trim() || undefined
        });
        if (res.connector?.status === 'error') {
          setError(res.connector.error || '验证未通过，请核对凭据');
          await onConnected();
          return;
        }
        showToast(`已成功连接「${target.name}」`, 'success');
      }

      await onConnected();
      onClose();
    } catch (err: any) {
      setError(err?.message || '连接失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const entry = target?.catalogEntry;

  return (
    <dialog
      ref={dialogRef}
      className="conn-dialog"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as any)}
    >
      <form className="conn-dialog-form" onSubmit={handleSubmit}>
        <header className="conn-dialog-header">
          <div>
            <h1 id={titleId} className="conn-dialog-title">
              连接 {target?.name}
            </h1>
            <p className="conn-dialog-sub">{target?.description}</p>
          </div>
          <button
            type="button"
            className="conn-dialog-close"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="conn-dialog-body">
          {target?.backing === 'mcp' && entry ? (
            <div className="conn-form-stack">
              {(entry.requiredArgs || []).map((field, idx) => (
                <label key={field.key} className="conn-field">
                  <span className="conn-field-label">{field.label}</span>
                  <input
                    autoFocus={idx === 0}
                    type="text"
                    className="conn-field-input"
                    placeholder={field.placeholder}
                    value={argValues[field.key] ?? ''}
                    onChange={(e) =>
                      setArgValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </label>
              ))}

              {(entry.requiredEnv || []).map((field, idx) => (
                <label key={field.key} className="conn-field">
                  <span className="conn-field-label">{field.label}</span>
                  <input
                    autoFocus={idx === 0 && !(entry.requiredArgs?.length)}
                    type={field.secret ? 'password' : 'text'}
                    className="conn-field-input"
                    placeholder={field.placeholder}
                    value={envValues[field.key] ?? ''}
                    onChange={(e) =>
                      setEnvValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                  {field.help && <span className="conn-field-hint">{field.help}</span>}
                </label>
              ))}

              {(entry.requiredHeaders || []).map((field, idx) => (
                <label key={field.key} className="conn-field">
                  <span className="conn-field-label">{field.label}</span>
                  <input
                    autoFocus={
                      idx === 0 && !(entry.requiredArgs?.length) && !(entry.requiredEnv?.length)
                    }
                    type={field.secret ? 'password' : 'text'}
                    className="conn-field-input"
                    placeholder={field.placeholder}
                    value={headerValues[field.key] ?? ''}
                    onChange={(e) =>
                      setHeaderValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="conn-form-stack">
              {(target?.authType === 'key' || target?.authType === 'oauth') && (
                <label className="conn-field">
                  <span className="conn-field-label">
                    {target.authType === 'oauth' ? '访问令牌 (Token)' : 'API 密钥 / 凭据'}
                  </span>
                  <input
                    autoFocus
                    type="password"
                    className="conn-field-input"
                    placeholder={
                      target.id === 'discord'
                        ? '输入 Bot Token 或 Webhook 链接...'
                        : '粘贴访问密钥或令牌...'
                    }
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                  />
                  {target.keyHint && (
                    <span className="conn-field-hint">{target.keyHint}</span>
                  )}
                </label>
              )}

              {target?.url && target.authType === 'none' && (
                <label className="conn-field">
                  <span className="conn-field-label">服务端点地址</span>
                  <input
                    autoFocus
                    type="url"
                    className="conn-field-input"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                  />
                </label>
              )}
            </div>
          )}

          {target?.docs && (
            <a
              href={target.docs}
              target="_blank"
              rel="noreferrer"
              className="conn-doc-link"
            >
              <span>查看获取指引</span>
              <ExternalLink size={12} />
            </a>
          )}

          {error && (
            <div className="conn-inline-error" role="alert">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="conn-dialog-footer">
          <button type="button" className="conn-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="conn-btn-primary" disabled={submitting}>
            {submitting ? <Loader2 size={14} className="spin" /> : null}
            <span>{submitting ? '连接中...' : '确认连接'}</span>
          </button>
        </footer>
      </form>
    </dialog>
  );
};

interface CustomConnectorDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => Promise<void>;
}

export const CustomConnectorDialog: React.FC<CustomConnectorDialogProps> = ({
  open,
  onClose,
  onAdded
}) => {
  const { showToast } = useApp();
  const titleId = useId();
  const dialogRef = useNativeDialog(open, onClose);

  const [mode, setMode] = useState<'paste' | 'manual' | 'json'>('paste');

  // 智能粘贴状态
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsedEntries, setParsedEntries] = useState<McpParsedImportEntry[]>([]);
  const [gapValues, setGapValues] = useState<Record<string, string>>({});

  // 手动填写状态
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransportType>('http');
  const [url, setUrl] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [command, setCommand] = useState('npx');
  const [argsText, setArgsText] = useState('');
  const [envRows, setEnvRows] = useState<Array<{ key: string; value: string }>>([]);

  // mcp.json 编辑状态
  const [jsonText, setJsonText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'json' && !jsonText) {
      void api.getMcpJson().then((r) => setJsonText(r.json)).catch(() => {});
    }
  }, [open, mode]);

  useEffect(() => {
    const trimmed = pasteText.trim();
    if (!trimmed) {
      setParsedEntries([]);
      setError(null);
      return;
    }
    const timer = setTimeout(async () => {
      setParsing(true);
      try {
        const res = await api.parseMcpPaste(trimmed);
        if (res.ok && res.entries) {
          setParsedEntries(res.entries);
          setError(null);
          const nextGaps: Record<string, string> = {};
          res.entries.forEach((entry, idx) => {
            entry.gaps.forEach((g) => {
              const id = `${idx}:${g.target}:${g.key}`;
              nextGaps[id] = gapValues[id] ?? '';
            });
          });
          setGapValues(nextGaps);
        } else {
          setParsedEntries([]);
          setError(res.error || '未能识别配置内容');
        }
      } catch (err: any) {
        setParsedEntries([]);
        setError(err?.message || '识别失败');
      } finally {
        setParsing(false);
      }
    }, 240);
    return () => clearTimeout(timer);
  }, [pasteText]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'paste') {
        if (parsedEntries.length === 0) {
          setError('请粘贴有效的连接地址、启动命令或配置 JSON');
          setSubmitting(false);
          return;
        }
        const entries = parsedEntries.map((entry, idx) => {
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
              cfg.headers[g.key] =
                /^Bearer\s+/i.test(g.rawValue) && !/^Bearer\s+/i.test(val)
                  ? `Bearer ${val}`
                  : val;
            } else if (g.target === 'url') {
              cfg.url = val;
            } else if (g.target === 'arg' && cfg.args) {
              cfg.args[Number(g.key)] = val;
            }
          }
          return { name: entry.name, config: cfg };
        });
        await api.importMcpServers(entries, true);
        showToast(`已成功添加 ${entries.length} 个连接器`, 'success');
        setPasteText('');
        setParsedEntries([]);
      } else if (mode === 'manual') {
        if (!name.trim()) {
          setError('请输入连接器名称');
          setSubmitting(false);
          return;
        }
        if (transport === 'stdio' && !command.trim()) {
          setError('本地命令模式必须填写启动命令');
          setSubmitting(false);
          return;
        }
        if (transport !== 'stdio' && !url.trim()) {
          setError('远程服务模式必须填写连接地址');
          setSubmitting(false);
          return;
        }

        const kvMap = Object.fromEntries(
          envRows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value])
        );
        const headers: Record<string, string> = transport !== 'stdio' ? { ...kvMap } : {};
        if (transport !== 'stdio' && bearerToken.trim() && !headers.Authorization) {
          headers.Authorization = /^Bearer\s+/i.test(bearerToken.trim())
            ? bearerToken.trim()
            : `Bearer ${bearerToken.trim()}`;
        }

        const res = await api.addMcpServer({
          name: name.trim(),
          transport,
          command: transport === 'stdio' ? command.trim() : undefined,
          args:
            transport === 'stdio'
              ? argsText.split(/\s+/).filter(Boolean)
              : undefined,
          env: transport === 'stdio' && Object.keys(kvMap).length > 0 ? kvMap : undefined,
          url: transport !== 'stdio' ? url.trim() : undefined,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          connectNow: true
        });
        showToast(
          res.server.status === 'connected'
            ? `已连接「${res.server.name}」`
            : `已保存「${res.server.name}」，可前往详情查看状态`,
          res.server.status === 'connected' ? 'success' : 'warning'
        );
        setName('');
        setUrl('');
        setBearerToken('');
        setArgsText('');
        setEnvRows([]);
      } else {
        await api.saveMcpJson(jsonText);
        showToast('mcp.json 配置已生效', 'success');
      }

      await onAdded();
      onClose();
    } catch (err: any) {
      setError(err?.message || '添加失败，请检查配置');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="conn-dialog"
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as any)}
    >
      <form className="conn-dialog-form" onSubmit={handleSubmit}>
        <header className="conn-dialog-header">
          <div>
            <h1 id={titleId} className="conn-dialog-title">
              添加自定义连接器
            </h1>
            <p className="conn-dialog-sub">
              直接粘贴服务端点、命令行或标准 MCP 配置即可接入
            </p>
          </div>
          <button
            type="button"
            className="conn-dialog-close"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="conn-dialog-body">
          <div className="conn-mode-pills" role="tablist" aria-label="添加方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'paste'}
              className="conn-mode-pill"
              onClick={() => setMode('paste')}
            >
              智能粘贴
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'manual'}
              className="conn-mode-pill"
              onClick={() => setMode('manual')}
            >
              手动填写
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'json'}
              className="conn-mode-pill"
              onClick={() => setMode('json')}
            >
              高级：mcp.json
            </button>
          </div>

          {mode === 'paste' && (
            <div className="conn-form-stack">
              <label className="conn-field">
                <textarea
                  autoFocus
                  rows={4}
                  spellCheck={false}
                  className="conn-field-textarea"
                  placeholder={`直接粘贴以下任意内容：\n• 远程链接：https://mcp.example.com/mcp\n• 启动命令：npx -y @upstash/context7-mcp\n• JSON 片段：{ "mcpServers": { ... } }`}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
              </label>

              {parsing && (
                <div className="conn-field-hint">正在识别配置...</div>
              )}

              {parsedEntries.length > 0 && (
                <div className="conn-paste-cards">
                  {parsedEntries.map((entry, idx) => (
                    <div key={`${entry.name}_${idx}`} className="conn-paste-card">
                      <div className="conn-paste-card-head">
                        <strong>{entry.name}</strong>
                        <span className="conn-pill-tag">
                          {entry.config.command ? '本地工具' : '远程服务'}
                        </span>
                      </div>
                      <div className="conn-paste-card-sub">
                        {entry.config.command
                          ? `${entry.config.command} ${(entry.config.args || []).join(' ')}`
                          : entry.config.url}
                      </div>

                      {entry.gaps.length > 0 && (
                        <div className="conn-paste-gaps">
                          <div className="conn-paste-gap-title">
                            <KeyRound size={12} />
                            <span>请补充缺失信息：</span>
                          </div>
                          {entry.gaps.map((g) => {
                            const id = `${idx}:${g.target}:${g.key}`;
                            return (
                              <input
                                key={id}
                                type={g.target === 'env' || g.target === 'header' ? 'password' : 'text'}
                                className="conn-field-input"
                                placeholder={g.label}
                                value={gapValues[id] || ''}
                                onChange={(e) =>
                                  setGapValues((prev) => ({ ...prev, [id]: e.target.value }))
                                }
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === 'manual' && (
            <div className="conn-form-stack">
              <div className="conn-form-row-2">
                <label className="conn-field">
                  <span className="conn-field-label">名称</span>
                  <input
                    autoFocus
                    type="text"
                    className="conn-field-input"
                    placeholder="例如：my-service"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>

                <label className="conn-field">
                  <span className="conn-field-label">连接方式</span>
                  <select
                    className="conn-field-input"
                    value={transport}
                    onChange={(e) => setTransport(e.target.value as McpTransportType)}
                  >
                    <option value="http">远程服务 (HTTP)</option>
                    <option value="sse">远程流式 (SSE)</option>
                    <option value="stdio">本地命令 (Stdio)</option>
                  </select>
                </label>
              </div>

              {transport === 'stdio' ? (
                <>
                  <label className="conn-field">
                    <span className="conn-field-label">启动命令</span>
                    <input
                      type="text"
                      className="conn-field-input"
                      placeholder="例如：npx、uvx、node"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                    />
                  </label>
                  <label className="conn-field">
                    <span className="conn-field-label">命令参数</span>
                    <input
                      type="text"
                      className="conn-field-input"
                      placeholder="例如：-y @modelcontextprotocol/server-filesystem ."
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="conn-field">
                    <span className="conn-field-label">服务链接 URL</span>
                    <input
                      type="url"
                      className="conn-field-input"
                      placeholder="https://mcp.example.com/mcp"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </label>
                  <label className="conn-field">
                    <span className="conn-field-label">访问密钥 / Token (可选)</span>
                    <input
                      type="password"
                      className="conn-field-input"
                      placeholder="无认证要求可留空"
                      value={bearerToken}
                      onChange={(e) => setBearerToken(e.target.value)}
                    />
                  </label>
                </>
              )}

              <div className="conn-kv-block">
                <div className="conn-kv-head">
                  <span className="conn-field-label">
                    {transport === 'stdio' ? '环境变量 (可选)' : '自定义请求头 (可选)'}
                  </span>
                  <button
                    type="button"
                    className="conn-row-link"
                    onClick={() => setEnvRows((prev) => [...prev, { key: '', value: '' }])}
                  >
                    <Plus size={12} /> 添加
                  </button>
                </div>
                {envRows.map((row, idx) => (
                  <div key={idx} className="conn-kv-line">
                    <input
                      type="text"
                      className="conn-field-input"
                      placeholder="名称"
                      value={row.key}
                      onChange={(e) =>
                        setEnvRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      type="password"
                      className="conn-field-input"
                      placeholder="值"
                      value={row.value}
                      onChange={(e) =>
                        setEnvRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r))
                        )
                      }
                    />
                    <button
                      type="button"
                      className="conn-dialog-close"
                      aria-label="删除此行"
                      onClick={() => setEnvRows((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mode === 'json' && (
            <div className="conn-form-stack">
              <textarea
                autoFocus
                rows={11}
                spellCheck={false}
                className="conn-field-textarea conn-mono"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
              <span className="conn-field-hint">
                已保存的密钥以 •••••••• 脱敏显示，保留占位符不会覆盖原密钥。
              </span>
            </div>
          )}

          {error && (
            <div className="conn-inline-error" role="alert">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="conn-dialog-footer">
          <button type="button" className="conn-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="conn-btn-primary" disabled={submitting}>
            {submitting ? <Loader2 size={14} className="spin" /> : null}
            <span>{submitting ? '正在接入...' : mode === 'json' ? '保存配置' : '确认添加'}</span>
          </button>
        </footer>
      </form>
    </dialog>
  );
};
