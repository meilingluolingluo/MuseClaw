import type { McpImportGap, McpParsedImportEntry, McpServerConfig, McpTransportType } from './types.ts';

const URL_RE = /^https?:\/\/\S+$/i;
const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEADER_PAIR_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+:/;
const LAUNCHERS = new Set(['npx', 'uvx', 'bunx', 'node', 'python', 'python3']);
const DLX_RUNNERS = new Set(['pnpm', 'yarn']);

function isRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function normalizeTypography(text: string): string {
  return text
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/(^|\s)[–—](?=[a-zA-Z])/g, '$1--');
}

export function slugifyServerName(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'mcp-server';
}

function cleanupPackageName(base: string): string {
  const stripped = base
    .replace(/\.(cjs|js|mjs|py|ts)$/i, '')
    .replace(/^(mcp-server-|server-|mcp-)/i, '')
    .replace(/(-mcp-server|-mcp|-server)$/i, '');
  return slugifyServerName(stripped || base);
}

function nameFromPackageSpec(spec: string): string {
  let bare = spec.split('==')[0];
  const lastAt = bare.lastIndexOf('@');
  if (lastAt > 0) {
    bare = bare.slice(0, lastAt);
  }
  const segment = bare.split('/').pop() || bare;
  return cleanupPackageName(segment);
}

function nameFromUrl(rawUrl: string): string {
  try {
    const hostParts = new URL(rawUrl).hostname.split('.').filter(Boolean);
    while (hostParts.length > 1 && ['api', 'mcp', 'www'].includes(hostParts[0].toLowerCase())) {
      hostParts.shift();
    }
    return slugifyServerName(hostParts[0] || 'remote-mcp');
  } catch {
    return 'remote-mcp';
  }
}

function detectPlaceholder(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return true;
  if (/^\$\{[A-Za-z0-9_]+\}$/.test(trimmed)) return true;
  if (/^\$[A-Za-z0-9_]+$/.test(trimmed)) return true;
  if (/^<[A-Za-z0-9_ -]+>$/.test(trimmed)) return true;
  if (/^(YOUR_|REPLACE_|INSERT_|CHANGE_ME|XXX+)/i.test(trimmed)) return true;
  if (trimmed === '...' || trimmed === 'your-api-key' || trimmed === 'your_api_key') return true;
  return false;
}

function collectGaps(name: string, config: McpServerConfig): McpImportGap[] {
  const gaps: McpImportGap[] = [];
  if (config.url && detectPlaceholder(config.url)) {
    gaps.push({ target: 'url', key: 'url', rawValue: config.url, label: `${name} 服务地址 URL` });
  }
  if (config.env) {
    for (const [k, v] of Object.entries(config.env)) {
      if (detectPlaceholder(v)) {
        gaps.push({ target: 'env', key: k, rawValue: v, label: `环境变量 ${k}` });
      }
    }
  }
  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      if (detectPlaceholder(v) || /\bBearer\s+(<[^>]+>|\$\{?[^}]+\}?|YOUR_[A-Z0-9_]+)$/i.test(v)) {
        gaps.push({ target: 'header', key: k, rawValue: v, label: `请求头 ${k}` });
      }
    }
  }
  if (config.args) {
    config.args.forEach((arg, idx) => {
      if (/^<[^>]+>$/.test(arg.trim()) || /^\$\{[A-Za-z0-9_]+\}$/.test(arg.trim())) {
        gaps.push({ target: 'arg', key: String(idx), rawValue: arg, label: `启动参数 #${idx + 1} (${arg})` });
      }
    });
  }
  return gaps;
}

function normalizeServerEntry(name: string, raw: Record<string, unknown>): McpServerConfig | null {
  const command = typeof raw.command === 'string' ? raw.command.trim() : undefined;
  const url = typeof raw.url === 'string'
    ? raw.url.trim()
    : typeof raw.serverUrl === 'string'
      ? raw.serverUrl.trim()
      : undefined;

  if (!command && !url) return null;

  const rawType = typeof raw.transport === 'string'
    ? raw.transport
    : typeof raw.type === 'string'
      ? raw.type
      : undefined;

  let transport: McpTransportType;
  if (command) {
    transport = 'stdio';
  } else if (rawType?.toLowerCase() === 'sse') {
    transport = 'sse';
  } else {
    transport = 'http';
  }

  const args = Array.isArray(raw.args) ? raw.args.map((a) => String(a)) : undefined;
  const env = isRecord(raw.env)
    ? Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [k, String(v ?? '')]))
    : undefined;
  const headers = isRecord(raw.headers)
    ? Object.fromEntries(Object.entries(raw.headers).map(([k, v]) => [k, String(v ?? '')]))
    : undefined;

  const cfg: McpServerConfig = {
    transport,
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(typeof raw.cwd === 'string' && raw.cwd.trim() ? { cwd: raw.cwd.trim() } : {}),
    ...(env ? { env } : {}),
    ...(url ? { url } : {}),
    ...(headers ? { headers } : {}),
    ...(typeof raw.description === 'string' && raw.description.trim() ? { description: raw.description.trim() } : {}),
    ...(typeof raw.category === 'string' && raw.category.trim() ? { category: raw.category.trim() } : {}),
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(typeof raw.timeoutMs === 'number' ? { timeoutMs: raw.timeoutMs } : {}),
    ...(typeof raw.connectTimeoutMs === 'number' ? { connectTimeoutMs: raw.connectTimeoutMs } : {}),
    ...(typeof raw.maxResultBytes === 'number' ? { maxResultBytes: raw.maxResultBytes } : {})
  };

  return cfg;
}

function parseJsonInput(trimmed: string, existingSet: Set<string>): McpParsedImportEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('JSON 格式无效，请检查括号与逗号语法');
  }

  const entries: Array<{ name: string; config: McpServerConfig }> = [];

  if (isRecord(parsed)) {
    const serverMap = isRecord(parsed.mcpServers)
      ? parsed.mcpServers
      : isRecord(parsed.servers)
        ? parsed.servers
        : null;

    if (serverMap) {
      for (const [rawName, val] of Object.entries(serverMap)) {
        if (!isRecord(val)) continue;
        const cfg = normalizeServerEntry(rawName, val);
        if (cfg) {
          entries.push({ name: slugifyServerName(rawName), config: cfg });
        }
      }
    } else if (typeof parsed.command === 'string' || typeof parsed.url === 'string' || typeof parsed.serverUrl === 'string') {
      const fallbackName =
        typeof parsed.name === 'string' && parsed.name.trim()
          ? slugifyServerName(parsed.name)
          : typeof parsed.url === 'string'
            ? nameFromUrl(parsed.url)
            : typeof parsed.command === 'string'
              ? nameFromPackageSpec(String((Array.isArray(parsed.args) && parsed.args[0]) || parsed.command))
              : 'mcp-server';
      const cfg = normalizeServerEntry(fallbackName, parsed);
      if (cfg) entries.push({ name: fallbackName, config: cfg });
    } else {
      // 可能是 { "my-server": { "command": ... } } 的裸映射
      for (const [rawName, val] of Object.entries(parsed)) {
        if (!isRecord(val)) continue;
        const cfg = normalizeServerEntry(rawName, val);
        if (cfg) entries.push({ name: slugifyServerName(rawName), config: cfg });
      }
    }
  } else if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!isRecord(item)) continue;
      const rawName = typeof item.name === 'string' ? item.name : 'mcp-server';
      const cfg = normalizeServerEntry(rawName, item);
      if (cfg) entries.push({ name: slugifyServerName(rawName), config: cfg });
    }
  }

  if (entries.length === 0) {
    throw new Error('未能从 JSON 中识别出包含 command 或 url 的 MCP 服务配置');
  }

  return entries.map((e) => ({
    name: e.name,
    config: e.config,
    gaps: collectGaps(e.name, e.config),
    exists: existingSet.has(e.name)
  }));
}

function splitShellCommands(text: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let current = '';
  let inWord = false;

  const endWord = () => {
    if (inWord) words.push(current);
    current = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      if (text[i + 1] === '\n') {
        i += 1;
        continue;
      }
      if (text[i + 1] === '\r' && text[i + 2] === '\n') {
        i += 2;
        continue;
      }
      if (i + 1 < text.length) {
        current += text[i + 1];
        inWord = true;
        i += 1;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      inWord = true;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (quote === '"' && text[i] === '\\' && i + 1 < text.length) {
          current += text[i + 1];
          i += 2;
          continue;
        }
        current += text[i];
        i += 1;
      }
      if (i >= text.length) {
        throw new Error('命令行引号未闭合');
      }
      continue;
    }

    if (ch === '#' && !inWord) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1;
      continue;
    }

    if (ch === '\n' || ch === ';') {
      endCommand();
      continue;
    }

    if (ch === '&' && text[i + 1] === '&') {
      endCommand();
      i += 1;
      continue;
    }

    if (/\s/.test(ch)) {
      endWord();
      continue;
    }

    current += ch;
    inWord = true;
  }

  endCommand();
  return commands;
}

function parseClaudeAdd(args: string[]): { name: string; config: McpServerConfig } {
  let transport: string | undefined;
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  const positionals: string[] = [];
  let afterDashes: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      afterDashes = args.slice(i + 1);
      break;
    }
    const optMatch = /^(--[a-zA-Z][a-zA-Z-]*|-[a-zA-Z])(?:=([\s\S]*))?$/.exec(arg);
    if (!optMatch) {
      positionals.push(arg);
      continue;
    }
    const flag = optMatch[1];
    const readValue = () => optMatch[2] ?? args[++i] ?? '';

    if (flag === '--transport' || flag === '-t') {
      transport = readValue().toLowerCase();
    } else if (flag === '--env' || flag === '-e') {
      const pair = readValue();
      const eq = pair.indexOf('=');
      if (eq > 0) env[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
      else if (pair.trim()) env[pair.trim()] = '';
    } else if (flag === '--header' || flag === '-H') {
      const pair = readValue();
      const colon = pair.indexOf(':');
      if (colon > 0) headers[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim();
    } else if (flag === '--scope' || flag === '-s' || flag === '--client-id' || flag === '--callback-port') {
      readValue();
    }
  }

  const [rawName, target, ...rest] = [...positionals, ...afterDashes];
  if (!rawName || !target) {
    throw new Error('命令行缺少服务名称或命令/URL 目标');
  }

  const name = slugifyServerName(rawName);
  if (transport !== 'stdio' && (transport === 'http' || transport === 'sse' || URL_RE.test(target))) {
    return {
      name,
      config: {
        transport: transport === 'sse' ? 'sse' : 'http',
        url: target,
        ...(Object.keys(headers).length > 0 ? { headers } : {})
      }
    };
  }

  return {
    name,
    config: {
      transport: 'stdio',
      command: target,
      args: rest,
      ...(Object.keys(env).length > 0 ? { env } : {})
    }
  };
}

function parseClaudeAddJson(args: string[]): { name: string; config: McpServerConfig } {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--scope' || arg === '-s') {
      i += 1;
      continue;
    }
    if (arg.startsWith('-') && !arg.startsWith('{')) continue;
    positionals.push(arg);
  }
  const [rawName, jsonStr] = positionals;
  if (!rawName || !jsonStr) {
    throw new Error('add-json 命令缺少服务名或 JSON 字符串');
  }
  const parsed = JSON.parse(jsonStr);
  if (!isRecord(parsed)) {
    throw new Error('add-json 的第二个参数必须是 JSON 对象');
  }
  const name = slugifyServerName(rawName);
  const cfg = normalizeServerEntry(name, parsed);
  if (!cfg) throw new Error('add-json 中缺少有效的 command 或 url');
  return { name, config: cfg };
}

function parseLauncherCommand(words: string[]): { name: string; config: McpServerConfig } {
  let idx = 0;
  const env: Record<string, string> = {};
  while (idx < words.length && ENV_ASSIGN_RE.test(words[idx])) {
    const pair = words[idx++];
    const eq = pair.indexOf('=');
    env[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  const [command, ...args] = words.slice(idx);
  if (!command) throw new Error('无法识别的命令行格式');

  if (command === 'docker' && args[0] === 'run') {
    const cleanArgs: string[] = ['run'];
    let imageName: string | undefined;
    for (let i = 1; i < args.length; i += 1) {
      const a = args[i];
      if ((a === '-e' || a === '--env') && i + 1 < args.length) {
        const pair = args[++i];
        const eq = pair.indexOf('=');
        if (eq > 0) {
          const k = pair.slice(0, eq);
          env[k] = pair.slice(eq + 1);
          cleanArgs.push(a, k);
        } else {
          env[pair] = env[pair] ?? '';
          cleanArgs.push(a, pair);
        }
        continue;
      }
      if (!imageName && !a.startsWith('-')) {
        imageName = a;
      }
      cleanArgs.push(a);
    }
    const name = imageName ? cleanupPackageName(imageName.split('/').pop()!.split(':')[0]) : 'docker-mcp';
    return {
      name,
      config: {
        transport: 'stdio',
        command: 'docker',
        args: cleanArgs,
        ...(Object.keys(env).length > 0 ? { env } : {})
      }
    };
  }

  const isDlx = DLX_RUNNERS.has(command) && args[0] === 'dlx';
  if (!LAUNCHERS.has(command) && !isDlx) {
    throw new Error(`暂不支持直接导入 "${command}" 命令，请使用 JSON 配置或标准启动器 (npx/uvx/docker/node)`);
  }

  const pkgToken = args.find((a, i) => !a.startsWith('-') && !(isDlx && i === 0));
  if (!pkgToken) {
    throw new Error(`"${command}" 命令缺少包名或脚本路径`);
  }

  return {
    name: nameFromPackageSpec(pkgToken),
    config: {
      transport: 'stdio',
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {})
    }
  };
}

/**
 * 通用粘贴导入解析器：支持 mcp.json 片段、CLI 命令、npx/uvx/docker 命令与纯 HTTP/SSE URL
 */
export function parseMcpPaste(
  text: string,
  existingNames: string[] = []
): { ok: true; entries: McpParsedImportEntry[] } | { ok: false; error: string } {
  const trimmed = normalizeTypography(text).trim();
  if (!trimmed) {
    return { ok: false, error: '请输入或粘贴 MCP 配置、启动命令或服务端点 URL' };
  }

  const existingSet = new Set(existingNames);

  try {
    // 1. 纯 URL
    if (URL_RE.test(trimmed) && !/\s/.test(trimmed)) {
      const name = nameFromUrl(trimmed);
      const config: McpServerConfig = {
        transport: /\/sse(\?|$)/i.test(trimmed) ? 'sse' : 'http',
        url: trimmed
      };
      return {
        ok: true,
        entries: [
          {
            name,
            config,
            gaps: collectGaps(name, config),
            exists: existingSet.has(name)
          }
        ]
      };
    }

    // 2. JSON 对象或数组
    if (/^[{[]/.test(trimmed)) {
      const entries = parseJsonInput(trimmed, existingSet);
      return { ok: true, entries };
    }

    // 3. 命令行解析
    const commands = splitShellCommands(trimmed);
    if (commands.length === 0) {
      return { ok: false, error: '未识别到有效的 MCP 配置或命令' };
    }

    const entries: McpParsedImportEntry[] = [];
    for (const rawWords of commands) {
      const words = rawWords[0] === '$' || rawWords[0] === '>' ? rawWords.slice(1) : rawWords;
      if (words.length === 0) continue;

      let item: { name: string; config: McpServerConfig };
      if (words.length >= 3 && words[1] === 'mcp' && words[2] === 'add') {
        item = parseClaudeAdd(words.slice(3));
      } else if (words.length >= 3 && words[1] === 'mcp' && words[2] === 'add-json') {
        item = parseClaudeAddJson(words.slice(3));
      } else if (HEADER_PAIR_RE.test(words[0]) && words.length === 1) {
        continue;
      } else {
        item = parseLauncherCommand(words);
      }

      entries.push({
        name: item.name,
        config: item.config,
        gaps: collectGaps(item.name, item.config),
        exists: existingSet.has(item.name)
      });
    }

    if (entries.length === 0) {
      return { ok: false, error: '未能解析出有效 MCP 服务' };
    }

    return { ok: true, entries };
  } catch (err: any) {
    return { ok: false, error: err?.message || '无法识别的 MCP 配置格式' };
  }
}
