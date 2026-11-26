import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join } from 'node:path';

const WINDOWS_SHIM_EXTENSIONS = new Set(['.cmd', '.bat', '.ps1']);

const CLAUDE_PACKAGE_ENTRIES = [
  ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'],
  ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'],
  ['..', 'Packages', 'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe', 'claude.exe']
] as const;

/**
 * 展开路径中的 ~ 为当前用户主目录
 */
export function expandHomePath(inputPath?: string): string | undefined {
  if (!inputPath) return undefined;
  const trimmed = inputPath.trim();
  if (!trimmed) return undefined;
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function isExistingFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * 扩充 PATH 环境变量以覆盖常见用户安装目录
 */
export function getAugmentedPath(): string {
  const home = homedir();
  const extraDirs = [
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.nvm', 'current', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ];

  const currentPath = process.env.PATH || '';
  const currentDirs = currentPath.split(delimiter).filter(Boolean);
  const merged = Array.from(new Set([...extraDirs, ...currentDirs]));
  return merged.filter((d) => existsSync(d)).join(delimiter);
}

/**
 * 在系统 PATH 或显式路径中查找可执行文件
 */
export function findExecutableInPath(command: string, customPath?: string): string | null {
  const expanded = expandHomePath(command) || command;
  if (!expanded) return null;

  const isExplicitPath = expanded.includes('/') || expanded.includes('\\') || expanded.startsWith('.');
  if (isExplicitPath || isExistingFile(expanded)) {
    if (isExistingFile(expanded)) return expanded;
    if (process.platform === 'win32') {
      for (const ext of ['.exe', '.cmd', '.bat']) {
        if (isExistingFile(`${expanded}${ext}`)) return `${expanded}${ext}`;
      }
    }
    if (isExplicitPath) return null;
  }

  const pathEnv = customPath || getAugmentedPath();
  const dirs = pathEnv.split(delimiter);
  const candidates =
    process.platform === 'win32' && !extname(expanded)
      ? [expanded, `${expanded}.exe`, `${expanded}.cmd`, `${expanded}.bat`]
      : [expanded];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of candidates) {
      const fullPath = join(dir, name);
      if (isExistingFile(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

/**
 * 解析 Windows 脚本启动器到真实的二进制或 Node 入口
 */
export function resolveExecutableLaunchTarget(executablePath: string): {
  command: string;
  argsPrefix: string[];
  sdkExecutablePath: string;
} {
  if (process.platform !== 'win32') {
    return { command: executablePath, argsPrefix: [], sdkExecutablePath: executablePath };
  }

  const ext = extname(executablePath).toLowerCase();
  if (!WINDOWS_SHIM_EXTENSIONS.has(ext)) {
    return { command: executablePath, argsPrefix: [], sdkExecutablePath: executablePath };
  }

  const shimDir = dirname(executablePath);
  for (const segments of CLAUDE_PACKAGE_ENTRIES) {
    const candidate = join(shimDir, ...segments);
    if (isExistingFile(candidate)) {
      if (candidate.toLowerCase().endsWith('.js')) {
        return { command: process.execPath, argsPrefix: [candidate], sdkExecutablePath: candidate };
      }
      return { command: candidate, argsPrefix: [], sdkExecutablePath: candidate };
    }
  }

  return { command: executablePath, argsPrefix: [], sdkExecutablePath: executablePath };
}

/**
 * 解析附加 CLI 参数字符串（支持引号包裹带空格参数）
 */
export function parseCliExtraArgs(raw?: string): string[] {
  if (!raw || !raw.trim()) return [];
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const val = match[1] ?? match[2] ?? match[3];
    if (val !== undefined && val.length > 0) {
      tokens.push(val);
    }
  }
  return tokens;
}

/**
 * 安全向子进程或进程组发送信号，校验 pid > 1 防止误杀宿主进程组
 */
export function signalProcessGroup(pid: number, signal: NodeJS.Signals | 0): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return;
  }
  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, signal);
    } else {
      process.kill(pid, signal);
    }
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // 进程已退出
    }
  }
}

/**
 * 执行带超时与环境隔离的版本探测
 */
export function executeVersionProbe(
  executablePath: string,
  args: string[] = ['--version'],
  timeoutMs = 8000
): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const cleanEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: getAugmentedPath(),
      CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
      CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1'
    };
    delete cleanEnv.OPENAI_API_KEY;
    delete cleanEnv.ANTHROPIC_API_KEY;

    const target = resolveExecutableLaunchTarget(executablePath);
    execFile(
      target.command,
      [...target.argsPrefix, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
        env: cleanEnv
      },
      (err, stdout, stderr) => {
        if (err) {
          const errMsg = err.killed ? '探针调用超时' : (stderr || err.message).trim().slice(0, 200);
          return resolve({ ok: false, error: errMsg });
        }
        const line = (stdout || '').trim().split('\n')[0] || '';
        resolve({ ok: true, version: line });
      }
    );
  });
}
