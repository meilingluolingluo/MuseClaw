import React, { useState } from 'react';
import { Check, ChevronRight, FileText, Globe, Terminal, Wrench, X } from 'lucide-react';

export interface ToolTraceItem {
  tool: string;
  params?: any;
  result?: any;
  output?: any;
  status?: string;
  durationMs?: number;
  ok?: boolean;
}

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  web_fetch: Globe,
  execute_shell: Terminal,
  read_file: FileText,
  write_file: FileText,
  edit_file: FileText,
  list_dir: FileText,
};

function isRunning(item: ToolTraceItem): boolean {
  return (
    item.status === 'running' ||
    item.status === '调用中' ||
    item.status === '调用中...' ||
    item.status === 'waiting'
  );
}

function isFailed(item: ToolTraceItem): boolean {
  if (item.ok === false) return true;
  if (item.status === 'rejected' || item.status === 'failed') return true;
  if (typeof item.status === 'string' && (item.status.includes('失败') || item.status.includes('拒绝'))) {
    return true;
  }
  const res = item.result ?? item.output;
  if (res && typeof res === 'object') {
    if (res.exitCode !== undefined && res.exitCode !== 0) return true;
    if (res.error) return true;
  }
  return false;
}

function formatDuration(item: ToolTraceItem): string {
  if (item.durationMs) {
    const ms = item.durationMs;
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  }
  if (typeof item.status === 'string') {
    const m = item.status.match(/\((\d+(?:\.\d+)?ms)\)/);
    if (m) return m[1];
  }
  return '';
}

/** 从入参里挑一个最能说明“这次调用做了什么”的值（参考 OpenMausBot / nanoMuse 的 summary 提炼） */
function preview(input: any): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  const obj = typeof input === 'object' ? input : {};
  for (const key of ['url', 'command', 'cmd', 'query', 'path', 'file_path', 'filename', 'pattern', 'city', 'location', 'prompt']) {
    if (typeof obj[key] === 'string') return obj[key];
  }
  const first = Object.values(obj).find((value) => typeof value === 'string');
  return typeof first === 'string' ? first : JSON.stringify(input);
}

/** 格式化输出结果：优先提取标准输出与错误，对复杂对象结构美化呈现 */
function outputText(value: any): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.stdout !== undefined || value.stderr !== undefined) {
      const parts: string[] = [];
      if (value.stdout) parts.push(String(value.stdout));
      if (value.stderr) parts.push(`[stderr]\n${value.stderr}`);
      if (value.exitCode !== undefined && value.exitCode !== 0) {
        parts.push(`[exit code: ${value.exitCode}]`);
      }
      if (parts.length > 0) return parts.join('\n');
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

const ToolRow: React.FC<{ item: ToolTraceItem }> = ({ item }) => {
  const [open, setOpen] = useState(false);
  const running = isRunning(item);
  const failed = isFailed(item);
  const Icon = ICONS[item.tool] || Wrench;
  const arg = preview(item.params);
  const result = outputText(item.result ?? item.output);
  const duration = formatDuration(item);

  return (
    <details
      className={`tool-row${failed ? ' is-failed' : ''}${running ? ' is-running' : ''}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span className="tool-row-state" aria-hidden="true">
          {running ? <span className="tool-spin" /> : failed ? <X size={12} /> : <Check size={12} />}
        </span>
        <Icon size={13} className="tool-row-icon" />
        <span className="tool-row-name">{item.tool}</span>
        {arg && (
          <span className="tool-row-arg" title={arg}>
            {arg}
          </span>
        )}
        {duration && <span className="tool-row-duration">{running ? '' : duration}</span>}
        <ChevronRight size={12} className="tool-row-chevron" />
      </summary>
      <div className="tool-row-body">
        <div className="tool-row-label">入参</div>
        <pre>{item.params == null ? arg || '—' : JSON.stringify(item.params, null, 2)}</pre>
        <div className="tool-row-label">执行结果</div>
        {running ? (
          <p className="tool-row-hint">等待执行结果…</p>
        ) : result ? (
          <pre>{result}</pre>
        ) : (
          <p className="tool-row-hint">无输出</p>
        )}
      </div>
    </details>
  );
};

export const ToolTrace: React.FC<{ tools: ToolTraceItem[]; live?: boolean }> = ({ tools, live }) => {
  // 默认折叠工具调用过程，仅展示紧凑摘要栏，用户点击按需展开完整调用明细
  const [open, setOpen] = useState(false);
  if (!tools || tools.length === 0) return null;

  const running = tools.filter(isRunning);
  const failures = tools.filter(isFailed).length;
  const totalMs = tools.reduce((sum, item) => sum + (item.durationMs || 0), 0);
  const latestRunning = running[running.length - 1];

  return (
    <details className="tool-trace" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span
          className={`tool-trace-state ${running.length ? 'is-running' : failures ? 'is-failed' : 'is-done'}`}
          aria-hidden="true"
        >
          {running.length ? <span className="tool-spin" /> : failures ? <X size={13} /> : <Check size={13} />}
        </span>
        <span className="tool-trace-title">工具执行过程</span>
        <span className="tool-trace-meta">
          {latestRunning ? `正在调用 ${latestRunning.tool}…` : `${tools.length} 次工具调用`}
          {!running.length && totalMs > 0 ? ` · ${totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`}` : ''}
          {failures ? ` · ${failures} 个失败` : ''}
        </span>
        <ChevronRight size={13} className="tool-trace-chevron" />
      </summary>
      <div className="tool-trace-list">
        {tools.map((item, index) => (
          <ToolRow key={`${item.tool}-${index}`} item={item} />
        ))}
      </div>
    </details>
  );
};
