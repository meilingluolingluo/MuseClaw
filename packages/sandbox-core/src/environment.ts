import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { exec, spawn, execSync, execFileSync } from 'node:child_process';

/**
 * 具有网络外出特性的核心命令集合
 */
export const NETWORK_PROGRAMS = new Set([
  'apt',
  'apt-get',
  'brew',
  'cargo',
  'conda',
  'curl',
  'dig',
  'docker',
  'gem',
  'gh',
  'git',
  'go',
  'host',
  'nc',
  'ncat',
  'nslookup',
  'npm',
  'npx',
  'nmap',
  'ping',
  'pip',
  'pip3',
  'pipx',
  'pnpm',
  'poetry',
  'rsync',
  'scp',
  'sftp',
  'ssh',
  'telnet',
  'traceroute',
  'uv',
  'uvx',
  'wget',
  'yarn'
]);

const URL_PATTERN = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|org|net|io|dev|cn|ai)\b/i;

/**
 * 判断命令行指令是否可能需要出站网络连接
 */
export function commandNeedsNetwork(command: string): boolean {
  if (URL_PATTERN.test(command)) {
    return true;
  }
  const tokens = command.split(/[\s|;&><()]+/).map((t) => t.trim().toLowerCase());
  return tokens.some((token) => NETWORK_PROGRAMS.has(token));
}

/**
 * 安全环境变量基础白名单
 */
export const SAFE_BASE_ENV: Record<string, string> = {
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C.UTF-8',
  HOME: '/workspace',
  USER: 'sandbox-user',
  TMPDIR: '/tmp',
  SANDBOX_ENV: '1',
  MUSECLAW_SANDBOX: 'true'
};

/**
 * 敏感环境变量名称匹配规则（包含 API Key、Token、Secret 等凭据关键字）
 */
const SENSITIVE_KEY_PATTERN = /(key|token|secret|password|auth|bearer|credential|private|sig)/i;

/**
 * 清洗并过滤环境变量字典，剥离一切凭据与敏感字段
 */
export function scrubEnvironmentVariables(
  customEnv?: NodeJS.ProcessEnv,
  options: { allowlist?: string[] } = {}
): Record<string, string> {
  const result: Record<string, string> = { ...SAFE_BASE_ENV };

  // 继承安全的系统 PATH（若宿主环境 PATH 包含标准目录）
  if (process.env.PATH) {
    const validSegments = process.env.PATH.split(':').filter((segment) => {
      const s = segment.trim();
      return s.startsWith('/usr') || s.startsWith('/bin') || s.startsWith('/sbin') || s.startsWith('/opt') || s.startsWith('/snap') || s.startsWith('/nix');
    });
    if (validSegments.length > 0) {
      result.PATH = validSegments.join(':');
    }
  }

  if (customEnv) {
    const explicitAllow = new Set(options.allowlist || []);
    for (const [key, val] of Object.entries(customEnv)) {
      if (val === undefined) continue;
      if (explicitAllow.has(key)) {
        result[key] = String(val);
      } else if (!SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = String(val);
      }
    }
  }

  return result;
}

/**
 * 敏感路径与受限文件模式黑名单
 */
const SENSITIVE_PATH_PATTERNS = [
  /\.env(\..+)?$/i,
  /\.git\/hooks/i,
  /\.ssh(\/|$)/i,
  /\.aws(\/|$)/i,
  /\.gnupg(\/|$)/i,
  /\.config\/gcloud(\/|$)/i,
  /\.azure(\/|$)/i,
  /id_(rsa|ed25519|ecdsa|dsa)/i,
  /(authorized_keys|known_hosts)/i
];

/**
 * 应用层路径安全校验：检查目标路径是否完全位于安全根目录内，并拦截路径穿越与敏感文件
 */
export function isSafeWritePath(targetPath: string, safeRoot: string): boolean {
  if (!targetPath || typeof targetPath !== 'string') return false;

  let expanded = targetPath.trim();
  // 展开用户家目录简写
  if (expanded.startsWith('~')) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }

  const safeRootResolved = fs.existsSync(safeRoot) ? fs.realpathSync(path.resolve(safeRoot)) : path.resolve(safeRoot);

  // 若路径以 /workspace 开头，将其映射到安全根目录实际路径
  let resolved: string;
  if (expanded === '/workspace' || expanded.startsWith('/workspace/')) {
    const subPath = expanded === '/workspace' ? '' : expanded.slice('/workspace/'.length);
    resolved = path.resolve(safeRootResolved, subPath);
  } else {
    resolved = path.resolve(safeRootResolved, expanded);
  }

  // 递归寻找最接近的已存在父目录，解析软链接真实路径以防御软链接目录穿越
  let probe = resolved;
  let remainingSegments: string[] = [];
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    remainingSegments.unshift(path.basename(probe));
    probe = parent;
  }

  if (fs.existsSync(probe)) {
    try {
      const realProbe = fs.realpathSync(probe);
      resolved = path.join(realProbe, ...remainingSegments);
    } catch {
      return false;
    }
  }

  // 确保目标路径严格在 safeRootResolved 内部
  const rel = path.relative(safeRootResolved, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }

  // 检查敏感黑名单文件与目录
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(resolved) || pattern.test(expanded)) {
      return false;
    }
  }

  return true;
}

/**
 * 应用层路径安全读取校验：防止通过目录穿越读取宿主私密凭据
 */
export function isSafeReadPath(targetPath: string, safeRoot: string): boolean {
  if (!targetPath || typeof targetPath !== 'string') return false;

  let expanded = targetPath.trim();
  if (expanded.startsWith('~')) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }

  const safeRootResolved = fs.existsSync(safeRoot) ? fs.realpathSync(path.resolve(safeRoot)) : path.resolve(safeRoot);

  let resolved: string;
  if (expanded === '/workspace' || expanded.startsWith('/workspace/')) {
    const subPath = expanded === '/workspace' ? '' : expanded.slice('/workspace/'.length);
    resolved = path.resolve(safeRootResolved, subPath);
  } else {
    resolved = path.resolve(safeRootResolved, expanded);
  }

  // 检查是否试图读取宿主高危敏感凭据
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(resolved) || pattern.test(expanded)) {
      return false;
    }
  }

  return true;
}

export interface ExecutionOptions {
  cwd?: string;
  allowNetwork?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  sessionId?: string;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  isSandboxed: boolean;
  engine: 'bwrap' | 'env_scrubbed' | 'container' | 'process';
  networkBlocked: boolean;
  durationMs: number;
  command: string;
  reason?: string;
}

export interface EnvironmentStatus {
  active: boolean;
  engine: 'bwrap' | 'env_scrubbed' | 'container' | 'process';
  version: string;
  blocksNetwork: boolean;
  workspaceDir: string;
  reason: string;
}

export interface EnvironmentConfig {
  mode?: 'auto' | 'bwrap' | 'off';
  workspaceDir?: string;
  extraRoDirs?: string[];
  extraRwDirs?: string[];
  probeOnStart?: boolean;
  defaultAllowNetwork?: boolean;
}

/**
 * 统一执行环境抽象基类 (BaseEnvironment)
 * 向上层 Agent 与 Tools 提供统一的命令执行、安全文件读写与环境隔离能力
 */
export abstract class BaseEnvironment {
  public readonly workspaceDir: string;
  protected defaultAllowNetwork: boolean;

  constructor(workspaceDir?: string, defaultAllowNetwork = true) {
    this.workspaceDir = path.resolve(workspaceDir || process.cwd());
    this.defaultAllowNetwork = defaultAllowNetwork;
  }

  /**
   * 执行 Shell 命令
   */
  public abstract execute(command: string, options?: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * 安全读取文件内容
   */
  public async readFile(targetPath: string, options?: { sessionId?: string }): Promise<string> {
    if (!this.isSafeRead(targetPath)) {
      throw new Error(`[SecurityException] Path access rejected: "${targetPath}" is blocked by safe read policy`);
    }

    const tmpResolved = this.resolveTmpPath(targetPath, options?.sessionId);
    const resolved = tmpResolved ?? this.resolveWorkspacePath(targetPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${targetPath}`);
    }

    return fs.readFileSync(resolved, 'utf-8');
  }

  /**
   * 解析当前环境对应的 /tmp 映射路径（若不支持则返回 null）
   */
  public resolveTmpPath(_targetPath: string, _sessionId?: string): string | null {
    return null;
  }

  /**
   * 清理指定会话的独立 /tmp 目录
   */
  public clearSessionTmp(_sessionId?: string): void {}

  /**
   * 安全写入文件内容（应用层安全根路径拦截）
   */
  public async writeFile(targetPath: string, content: string): Promise<void> {
    if (!this.isSafeWrite(targetPath)) {
      throw new Error(`[SecurityException] Write access rejected: "${targetPath}" violates safe root boundary or matches protected file blacklist`);
    }

    const resolved = this.resolveWorkspacePath(targetPath);
    const parentDir = path.dirname(resolved);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(resolved, content, 'utf-8');
  }

  /**
   * 检查目标写入路径是否安全
   */
  public isSafeWrite(targetPath: string): boolean {
    return isSafeWritePath(targetPath, this.workspaceDir);
  }

  /**
   * 检查目标读取路径是否安全
   */
  public isSafeRead(targetPath: string): boolean {
    return isSafeReadPath(targetPath, this.workspaceDir);
  }

  /**
   * 将工作区虚拟路径 (/workspace/...) 映射为宿主真实物理路径
   */
  public resolveWorkspacePath(targetPath: string): string {
    const trimmed = targetPath.trim();
    if (trimmed === '/workspace' || trimmed.startsWith('/workspace/')) {
      const sub = trimmed === '/workspace' ? '' : trimmed.slice('/workspace/'.length);
      return path.resolve(this.workspaceDir, sub);
    }
    return path.resolve(this.workspaceDir, trimmed);
  }

  /**
   * 获取环境当前隔离状态
   */
  public abstract getStatus(): EnvironmentStatus;
}

/**
 * 进程级受洗环境 (LocalEnvironment)
 * 当 bwrap 不可用或显式关闭时，通过剥离敏感环境变量与应用层安全根实施保护
 */
export class LocalEnvironment extends BaseEnvironment {
  private reason: string;

  constructor(workspaceDir?: string, reason = 'Local execution with scrubbed environment') {
    super(workspaceDir, true);
    this.reason = reason;
  }

  public async execute(command: string, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();
    const ws = options.cwd ? path.resolve(options.cwd) : this.workspaceDir;
    const timeoutMs = options.timeoutMs || 30000;
    const sanitizedEnv = scrubEnvironmentVariables(options.env);

    return new Promise<ExecutionResult>((resolve) => {
      const child = exec(
        command,
        {
          cwd: ws,
          timeout: timeoutMs,
          env: sanitizedEnv
        },
        (err, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          if (!err) {
            return resolve({
              stdout: stdout || '',
              stderr: stderr || '',
              exitCode: 0,
              isSandboxed: false,
              engine: 'env_scrubbed',
              networkBlocked: false,
              durationMs,
              command,
              reason: this.reason
            });
          }

          const code = typeof (err as any).code === 'number' ? (err as any).code : ((err as any).code || 1);
          resolve({
            stdout: stdout || '',
            stderr: stderr || err.message,
            exitCode: code,
            isSandboxed: false,
            engine: 'env_scrubbed',
            networkBlocked: false,
            durationMs,
            command,
            reason: this.reason
          });
        }
      );

      if (child.stdin) {
        child.stdin.on('error', () => {});
        if (options.stdin !== undefined) {
          child.stdin.end(options.stdin);
        } else {
          child.stdin.end();
        }
      }
    });
  }

  public getStatus(): EnvironmentStatus {
    return {
      active: false,
      engine: 'env_scrubbed',
      version: 'process',
      blocksNetwork: false,
      workspaceDir: this.workspaceDir,
      reason: this.reason
    };
  }
}

/**
 * Bubblewrap 微沙箱隔离环境 (BwrapEnvironment)
 * 具备内核级命名空间、分级挂载、DNS 注入、环境变量清洗与网络分级阻断能力
 */
export class BwrapEnvironment extends BaseEnvironment {
  private mode: 'auto' | 'bwrap' | 'off';
  private extraRoDirs: string[];
  private extraRwDirs: string[];
  private bwrapPath: string | null = null;
  private version = '';
  private active = false;
  private blocksNetwork = true;
  private reason = '';
  private dnsConfigFile: string | null = null;
  private instanceTmpId = crypto.randomBytes(6).toString('hex');
  private tmpRootDir = path.join(os.tmpdir(), 'museclaw-sandbox-tmp');
  private lastPruneAt = 0;

  constructor(config: EnvironmentConfig = {}) {
    super(config.workspaceDir, config.defaultAllowNetwork ?? true);
    this.mode = config.mode || 'auto';
    this.extraRoDirs = (config.extraRoDirs || []).map((p) => path.resolve(p));
    this.extraRwDirs = (config.extraRwDirs || []).map((p) => path.resolve(p));

    if (config.probeOnStart !== false) {
      this.probe();
    }
  }

  /**
   * 构造会话或实例级 /tmp 宿主持久化目录名（防止路径穿越与名称冲突）
   */
  private getSessionTmpDirName(sessionId?: string): string {
    if (sessionId && sessionId.trim()) {
      const normalized = sessionId.trim();
      const safePrefix = normalized.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'session';
      const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
      return `sess_${safePrefix}_${hash}`;
    }
    return `inst_${this.instanceTmpId}`;
  }

  /**
   * 清理超过 24 小时未活跃的过期会话 /tmp 目录
   */
  private pruneStaleTmpDirs(excludeDir: string): void {
    const now = Date.now();
    this.lastPruneAt = now;
    const maxAgeMs = 24 * 60 * 60 * 1000;
    try {
      if (!fs.existsSync(this.tmpRootDir)) return;
      const entries = fs.readdirSync(this.tmpRootDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(this.tmpRootDir, entry.name);
        if (fullPath === excludeDir) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > maxAgeMs) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        } catch {}
      }
    } catch {}
  }

  /**
   * 获取或创建会话级 /tmp 宿主绑定目录（支持同会话跨工具调用持久化）
   */
  public getSessionTmpDir(sessionId?: string): string {
    const targetDir = path.join(this.tmpRootDir, this.getSessionTmpDirName(sessionId));
    fs.mkdirSync(this.tmpRootDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    const nowDate = new Date();
    try {
      fs.utimesSync(targetDir, nowDate, nowDate);
    } catch {}

    if (Date.now() - this.lastPruneAt > 10 * 60 * 1000) {
      this.pruneStaleTmpDirs(targetDir);
    }
    return targetDir;
  }

  /**
   * 清理指定会话（或默认实例）对应的持久化 /tmp 目录
   */
  public override clearSessionTmp(sessionId?: string): void {
    const targetDir = path.join(this.tmpRootDir, this.getSessionTmpDirName(sessionId));
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch {}
  }

  /**
   * 将沙箱内 /tmp/... 路径安全映射为当前会话的宿主绑定目录路径
   */
  public override resolveTmpPath(targetPath: string, sessionId?: string): string | null {
    if (!this.active) return null;
    const trimmed = targetPath.trim();
    if (trimmed !== '/tmp' && !trimmed.startsWith('/tmp/')) {
      return null;
    }
    const tmpDir = this.getSessionTmpDir(sessionId);
    const sub = trimmed === '/tmp' ? '' : trimmed.slice('/tmp/'.length);
    const resolved = path.resolve(tmpDir, sub);
    const rel = path.relative(tmpDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return null;
    }
    return resolved;
  }

  /**
   * 初始化公共 DNS 配置文件
   */
  private ensureDnsConfig(): string {
    if (this.dnsConfigFile && fs.existsSync(this.dnsConfigFile)) {
      return this.dnsConfigFile;
    }
    const targetPath = path.join(os.tmpdir(), '.museclaw_dns.conf');
    const content = 'nameserver 8.8.8.8\nnameserver 1.1.1.1\nnameserver 114.114.114.114\n';
    try {
      fs.writeFileSync(targetPath, content, 'utf-8');
      this.dnsConfigFile = targetPath;
    } catch {
      this.dnsConfigFile = null;
    }
    return targetPath;
  }

  /**
   * 系统分级挂载矩阵构造
   */
  protected appendMountMatrix(args: string[], allowNetwork: boolean, tmpDir?: string): void {
    // 1. 系统核心目录严格只读挂载
    const roDirs = ['/usr', '/opt', '/etc', '/var', '/snap', '/nix', '/run', '/mnt/wsl'];
    for (const dir of roDirs) {
      if (fs.existsSync(dir)) {
        args.push('--ro-bind-try', dir, dir);
      }
    }

    // 2. 兼容 Linux merged-/usr 体系（符号链接与真实目录适配）
    const sysLinks = ['/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32'];
    for (const sysPath of sysLinks) {
      try {
        const stat = fs.lstatSync(sysPath);
        if (stat.isSymbolicLink()) {
          const target = fs.readlinkSync(sysPath);
          const relTarget = target.startsWith('/') ? path.relative('/', target) : target;
          args.push('--symlink', relTarget, sysPath);
        } else if (stat.isDirectory()) {
          args.push('--ro-bind-try', sysPath, sysPath);
        }
      } catch {}
    }

    // 3. 基础设备树与进程树挂载
    args.push('--proc', '/proc', '--dev', '/dev');

    // 4. 临时目录（会话级持久化目录绑定或降级为 tmpfs）
    if (tmpDir && fs.existsSync(tmpDir)) {
      args.push('--bind', tmpDir, '/tmp');
    } else {
      args.push('--tmpfs', '/tmp');
    }

    // 5. 工作区读写绑定：双向映射宿主真实路径与统一的 /workspace 路径
    args.push('--bind-try', this.workspaceDir, '/workspace');
    args.push('--bind-try', this.workspaceDir, this.workspaceDir);

    // 6. 附加只读与读写目录挂载
    for (const ro of this.extraRoDirs) {
      if (fs.existsSync(ro)) {
        args.push('--ro-bind-try', ro, ro);
      }
    }
    for (const rw of this.extraRwDirs) {
      if (fs.existsSync(rw)) {
        args.push('--bind-try', rw, rw);
      }
    }

    // 7. 网络与 DNS 针对性注入（关键修复：避免软链接断裂导致 DNS 解析失败）
    if (allowNetwork) {
      const dnsFile = this.ensureDnsConfig();
      if (fs.existsSync(dnsFile)) {
        if (fs.existsSync('/etc/resolv.conf')) {
          try {
            const stat = fs.lstatSync('/etc/resolv.conf');
            if (stat.isSymbolicLink()) {
              const realResolv = fs.realpathSync('/etc/resolv.conf');
              const realDir = path.dirname(realResolv);
              if (realDir && fs.existsSync(realDir) && !roDirs.includes(realDir)) {
                args.push('--ro-bind-try', realDir, realDir);
              }
              args.push('--ro-bind-try', dnsFile, realResolv);
            } else {
              args.push('--ro-bind-try', dnsFile, '/etc/resolv.conf');
            }
          } catch {
            args.push('--ro-bind-try', dnsFile, '/etc/resolv.conf');
          }
        }
      }
    }
  }

  /**
   * 探测环境与内核能力
   */
  public probe(): { active: boolean; reason: string } {
    if (this.mode === 'off') {
      this.active = false;
      this.reason = 'BwrapEnvironment mode explicitly set to off';
      return { active: false, reason: this.reason };
    }

    if (process.platform !== 'linux') {
      this.active = false;
      this.reason = `bubblewrap is Linux-only (current platform: ${process.platform})`;
      return { active: false, reason: this.reason };
    }

    const candidates = ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'];
    let foundPath: string | null = null;
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        foundPath = c;
        break;
      }
    }

    if (!foundPath) {
      try {
        const whichOut = execSync('which bwrap 2>/dev/null', { encoding: 'utf-8' }).trim();
        if (whichOut && fs.existsSync(whichOut)) {
          foundPath = whichOut;
        }
      } catch {}
    }

    if (!foundPath) {
      this.active = false;
      this.reason = 'bubblewrap executable not found (install via: apt install bubblewrap)';
      return { active: false, reason: this.reason };
    }

    this.bwrapPath = foundPath;

    try {
      const verOut = execSync(`${this.bwrapPath} --version`, { encoding: 'utf-8' }).trim();
      this.version = verOut.replace('bubblewrap', '').trim();
    } catch {
      this.version = 'unknown';
    }

    const trueBin = fs.existsSync('/usr/bin/true') ? '/usr/bin/true' : '/bin/true';

    try {
      const testCmd = [this.bwrapPath, '--unshare-user-try', '--unshare-net'];
      this.appendMountMatrix(testCmd, false);
      testCmd.push(trueBin);
      execFileSync(testCmd[0], testCmd.slice(1), { timeout: 3000 });
      this.active = true;
      this.blocksNetwork = true;
      this.reason = `Active: bubblewrap ${this.version} with full network unshare`;
      return { active: true, reason: this.reason };
    } catch (errNet: any) {
      const errMsg = String(errNet?.message || '');
      if (errMsg.includes('loopback') || errMsg.includes('network')) {
        try {
          const testWithoutNet = [this.bwrapPath, '--unshare-user-try'];
          this.appendMountMatrix(testWithoutNet, true);
          testWithoutNet.push(trueBin);
          execFileSync(testWithoutNet[0], testWithoutNet.slice(1), { timeout: 3000 });
          this.active = true;
          this.blocksNetwork = false;
          this.reason = `Active: bubblewrap ${this.version} (filesystem isolated, network unshare restricted by kernel)`;
          return { active: true, reason: this.reason };
        } catch {}
      }

      this.active = false;
      this.reason = `bubblewrap cannot create unprivileged namespace: ${errMsg.slice(0, 100)}`;
      return { active: false, reason: this.reason };
    }
  }

  /**
   * 构造 bubblewrap 命令行参数列表
   */
  public buildBwrapArgs(
    command: string,
    options: {
      workspaceDir?: string;
      allowNetwork?: boolean;
      extraRoDirs?: string[];
      extraRwDirs?: string[];
      customEnv?: NodeJS.ProcessEnv;
      sessionId?: string;
      tmpDir?: string;
    } = {}
  ): string[] {
    const ws = options.workspaceDir ? path.resolve(options.workspaceDir) : this.workspaceDir;
    const allowNet = options.allowNetwork ?? (this.defaultAllowNetwork || commandNeedsNetwork(command));
    const effectiveTmpDir = options.tmpDir ?? this.getSessionTmpDir(options.sessionId);

    const args: string[] = [
      '--die-with-parent',
      '--new-session',
      '--unshare-user-try',
      '--unshare-pid',
      '--unshare-ipc',
      '--unshare-uts',
      '--unshare-cgroup-try'
    ];

    // 网络按需授权或内核网络命名空间切断
    if (!allowNet && this.blocksNetwork) {
      args.push('--unshare-net');
    }

    // 分级文件系统挂载
    this.appendMountMatrix(args, allowNet, effectiveTmpDir);

    // 工作目录与家目录重设
    args.push('--chdir', '/workspace');

    // 彻底清洗宿主环境变量 (bwrap --clearenv)
    args.push('--clearenv');

    // 白名单注入安全基础环境变量与任务显式变量
    const sanitizedEnv = scrubEnvironmentVariables(options.customEnv);
    for (const [key, val] of Object.entries(sanitizedEnv)) {
      args.push('--setenv', key, val);
    }
    // 强制家目录锚定为工作区
    args.push('--setenv', 'HOME', '/workspace');
    args.push('--setenv', 'PWD', '/workspace');

    // 执行具体命令
    const shellBin = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
    args.push(shellBin, '-c', command);

    return args;
  }

  public async execute(command: string, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();
    const ws = options.cwd ? path.resolve(options.cwd) : this.workspaceDir;
    const requiresNetwork = options.allowNetwork ?? (this.defaultAllowNetwork || commandNeedsNetwork(command));
    const timeoutMs = options.timeoutMs || 30000;

    // 1. 若 bwrap 引擎活跃就绪，执行内核沙箱调用
    if (this.active && this.bwrapPath) {
      const bwrapArgs = this.buildBwrapArgs(command, {
        workspaceDir: ws,
        allowNetwork: requiresNetwork,
        extraRoDirs: this.extraRoDirs,
        extraRwDirs: this.extraRwDirs,
        customEnv: options.env,
        sessionId: options.sessionId
      });

      return new Promise<ExecutionResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let killed = false;

        const child = spawn(this.bwrapPath!, bwrapArgs, {
          cwd: ws
        });

        if (child.stdin) {
          child.stdin.on('error', () => {});
          if (options.stdin !== undefined) {
            child.stdin.end(options.stdin);
          } else {
            child.stdin.end();
          }
        }

        const timer = setTimeout(() => {
          killed = true;
          try {
            child.kill('SIGKILL');
          } catch {}
        }, timeoutMs);

        child.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          const durationMs = Date.now() - startTime;
          const networkBlocked = !requiresNetwork && this.blocksNetwork;

          if (killed) {
            return resolve({
              stdout,
              stderr: stderr + `\n[BwrapEnvironment] Command timed out after ${timeoutMs}ms`,
              exitCode: 124,
              isSandboxed: true,
              engine: 'bwrap',
              networkBlocked,
              durationMs,
              command
            });
          }

          resolve({
            stdout,
            stderr,
            exitCode: code ?? 0,
            isSandboxed: true,
            engine: 'bwrap',
            networkBlocked,
            durationMs,
            command
          });
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          console.warn(`[BwrapEnvironment] bwrap invocation error: ${err.message}. Falling back to sanitized execution.`);
          const fallback = new LocalEnvironment(ws, this.reason);
          fallback.execute(command, options).then(resolve);
        });
      });
    }

    // 2. 回退机制：使用清洗环境的本地执行
    const fallback = new LocalEnvironment(ws, this.reason || 'Bwrap unavailable or disabled');
    return fallback.execute(command, options);
  }

  public getStatus(): EnvironmentStatus {
    return {
      active: this.active,
      engine: this.active ? 'bwrap' : 'env_scrubbed',
      version: this.version,
      blocksNetwork: this.active && this.blocksNetwork,
      workspaceDir: this.workspaceDir,
      reason: this.reason
    };
  }
}

/**
 * 工厂函数：创建执行环境实例
 */
export function createExecutionEnvironment(config: EnvironmentConfig = {}): BaseEnvironment {
  const mode = config.mode || 'auto';
  if (mode === 'off' || process.platform !== 'linux') {
    return new LocalEnvironment(config.workspaceDir);
  }
  return new BwrapEnvironment(config);
}
