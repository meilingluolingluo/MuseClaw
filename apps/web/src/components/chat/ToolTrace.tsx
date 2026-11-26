import React, { useEffect, useMemo, useState } from 'react';
import { copyToClipboard } from '../../utils/clipboard';
import { ansiToHtml } from '../../utils/markdown';
import {
  Check,
  ChevronRight,
  FileText,
  Globe,
  Terminal,
  Wrench,
  X,
  Copy,
  CheckCheck,
  Code,
  Database,
  Search,
  Brain,
  Clock,
  Target,
  Sparkles,
} from 'lucide-react';

export interface ToolTraceItem {
  tool: string;
  params?: any;
  result?: any;
  output?: any;
  status?: string;
  durationMs?: number;
  ok?: boolean;
  startedAt?: number;
}

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  web_fetch: Globe,
  fetch: Globe,
  browse: Globe,
  curl: Globe,
  execute_shell: Terminal,
  bash: Terminal,
  Bash: Terminal,
  sh: Terminal,
  terminal: Terminal,
  read_file: FileText,
  Read: FileText,
  write_file: FileText,
  Write: FileText,
  edit_file: FileText,
  Edit: FileText,
  MultiEdit: FileText,
  patch_file: FileText,
  NotebookEdit: FileText,
  list_dir: FileText,
  LS: FileText,
  search: Search,
  grep: Search,
  Grep: Search,
  Glob: Search,
  WebSearch: Globe,
  WebFetch: Globe,
  Task: Sparkles,
  Skill: Sparkles,
  python: Code,
  node: Code,
  sql: Database,
  database: Database,
  db: Database,
  cron: Clock,
  schedule: Clock,
  create_routine: Clock,
  memory: Brain,
  memory_search: Brain,
  memory_save: Brain,
  save_memory: Brain,
  create_goal: Target,
  update_goal: Target,
  advance_goal: Target,
  show_widget: Sparkles,
};

const TOOL_LABELS: Record<string, string> = {
  execute_shell: '运行终端命令',
  bash: '运行 Shell',
  Bash: '运行终端命令',
  sh: '运行脚本',
  terminal: '终端执行',
  read_file: '读取文件',
  Read: '读取文件',
  write_file: '写入文件',
  Write: '写入文件',
  create_file: '创建文件',
  edit_file: '编辑文件',
  Edit: '精确修改文件',
  MultiEdit: '批量编辑文件',
  patch_file: '修改文件',
  NotebookEdit: '编辑 Notebook',
  delete_file: '删除文件',
  list_dir: '查看目录',
  LS: '查看目录',
  search: '搜索内容',
  grep: '检索代码',
  Grep: '搜索文件内容',
  Glob: '匹配文件路径',
  web_fetch: '抓取网页',
  WebFetch: '读取网页内容',
  WebSearch: '网页搜索',
  fetch: '请求接口',
  browse: '浏览页面',
  python: '运行 Python',
  node: '运行 Node.js',
  Task: '委派子任务',
  Skill: '调用技能规程',
  memory_search: '检索长期记忆',
  memory_save: '写入长期记忆',
  save_memory: '写入长期记忆',
  create_goal: '创建长周期目标',
  update_goal: '更新目标状态',
  advance_goal: '推进目标阶段',
  create_routine: '创建定时例程',
  publish_feed: '发布态势动态',
  show_widget: '渲染交互组件',
};

function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName;
}

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

function preview(input: any): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  const obj = typeof input === 'object' ? input : {};
  for (const key of ['url', 'command', 'cmd', 'query', 'path', 'file_path', 'filename', 'pattern', 'city', 'location', 'title', 'name', 'prompt']) {
    if (typeof obj[key] === 'string') return obj[key];
  }
  const first = Object.values(obj).find((value) => typeof value === 'string');
  return typeof first === 'string' ? first : JSON.stringify(input);
}

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

function extractEditDiff(params: any): { before: string; after: string } | null {
  if (!params || typeof params !== 'object') return null;
  const before = params.old_str ?? params.target ?? params.oldText ?? params.search;
  const after = params.new_str ?? params.replacement ?? params.newText ?? params.replace;
  if (typeof before === 'string' && typeof after === 'string' && before !== after) {
    return { before, after };
  }
  return null;
}

const ToolRow: React.FC<{ item: ToolTraceItem }> = ({ item }) => {
  const [open, setOpen] = useState(false);
  const [copiedSection, setCopiedSection] = useState<'params' | 'result' | null>(null);
  const running = isRunning(item);
  const failed = isFailed(item);
  const Icon = ICONS[item.tool] || Wrench;
  const label = getToolLabel(item.tool);
  const arg = preview(item.params);
  const result = outputText(item.result ?? item.output);
  const duration = formatDuration(item);
  const isTerminal = ['execute_shell', 'bash', 'sh', 'terminal'].includes(item.tool);
  const editDiff = useMemo(() => extractEditDiff(item.params), [item.params]);

  const terminalHtml = useMemo(() => {
    if (!isTerminal || !result) return '';
    return ansiToHtml(result);
  }, [isTerminal, result]);

  const handleCopy = async (text: string, section: 'params' | 'result', e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 1800);
    }
  };

  const paramsText = item.params == null ? arg || '—' : JSON.stringify(item.params, null, 2);

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
        <span className="tool-row-name" title={item.tool}>{label}</span>
        {arg && (
          <span className="tool-row-arg" title={arg}>
            {arg}
          </span>
        )}
        {duration && <span className="tool-row-duration">{running ? '' : duration}</span>}
        <ChevronRight size={12} className="tool-row-chevron" />
      </summary>
      <div className="tool-row-body">
        {editDiff && (
          <div className="tool-diff-preview">
            <div className="tool-row-label">变更预览</div>
            <pre className="tool-code-block is-diff-preview">
              {editDiff.before.split('\n').slice(0, 12).map((line, i) => (
                <span key={`d-${i}`} className="diff-line diff-line-del">- {line}{'\n'}</span>
              ))}
              {editDiff.after.split('\n').slice(0, 12).map((line, i) => (
                <span key={`a-${i}`} className="diff-line diff-line-add">+ {line}{'\n'}</span>
              ))}
            </pre>
          </div>
        )}

        <div className="tool-row-header-line">
          <div className="tool-row-label">入参（{item.tool}）</div>
          {paramsText && (
            <button
              type="button"
              className="tool-copy-btn"
              onClick={(e) => handleCopy(paramsText, 'params', e)}
              title="复制入参"
            >
              {copiedSection === 'params' ? <CheckCheck size={11} className="copy-success" /> : <Copy size={11} />}
              <span>{copiedSection === 'params' ? '已复制' : '复制'}</span>
            </button>
          )}
        </div>
        <pre className="tool-code-block">{paramsText}</pre>

        <div className="tool-row-header-line">
          <div className="tool-row-label">执行结果</div>
          {result && (
            <button
              type="button"
              className="tool-copy-btn"
              onClick={(e) => handleCopy(result, 'result', e)}
              title="复制执行结果"
            >
              {copiedSection === 'result' ? <CheckCheck size={11} className="copy-success" /> : <Copy size={11} />}
              <span>{copiedSection === 'result' ? '已复制' : '复制'}</span>
            </button>
          )}
        </div>
        {running ? (
          <p className="tool-row-hint">等待执行结果…</p>
        ) : result ? (
          isTerminal ? (
            <pre
              className="tool-code-block is-terminal-output"
              dangerouslySetInnerHTML={{ __html: terminalHtml }}
            />
          ) : (
            <pre className="tool-code-block">{result}</pre>
          )
        ) : (
          <p className="tool-row-hint">无输出</p>
        )}
      </div>
    </details>
  );
};

export const ToolTrace: React.FC<{ tools: ToolTraceItem[]; live?: boolean }> = ({ tools }) => {
  const [open, setOpen] = useState(false);
  const [runningSeconds, setRunningSeconds] = useState(0);

  const running = tools.filter(isRunning);
  const isAnyRunning = running.length > 0;

  useEffect(() => {
    if (!isAnyRunning) {
      setRunningSeconds(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      setRunningSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [isAnyRunning]);

  if (!tools || tools.length === 0) return null;

  const failures = tools.filter(isFailed).length;
  const totalMs = tools.reduce((sum, item) => sum + (item.durationMs || 0), 0);
  const latestRunning = running[running.length - 1];
  const latestArg = latestRunning ? preview(latestRunning.params) : '';

  return (
    <details className="tool-trace" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span
          className={`tool-trace-state ${isAnyRunning ? 'is-running' : failures ? 'is-failed' : 'is-done'}`}
          aria-hidden="true"
        >
          {isAnyRunning ? <span className="tool-spin" /> : failures ? <X size={13} /> : <Check size={13} />}
        </span>
        <span className="tool-trace-title">
          {latestRunning ? `正在执行：${getToolLabel(latestRunning.tool)}` : '工具执行过程'}
        </span>
        <span className="tool-trace-meta">
          {latestRunning
            ? `${latestArg ? `${latestArg.slice(0, 32)}${latestArg.length > 32 ? '…' : ''} · ` : ''}${runningSeconds}s`
            : `${tools.length} 次工具调用`}
          {!isAnyRunning && totalMs > 0
            ? ` · ${totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`}`
            : ''}
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
