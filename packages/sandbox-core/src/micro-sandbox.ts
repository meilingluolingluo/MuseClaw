import { exec, spawn, execSync, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

/**
 * 具有网络外出特性的核心命令集合
 * 凡包含这些程序或包含外网 URL 的命令，自动赋予网络权限；其余普通命令默认施加网络阻断 (--unshare-net)
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
 * 判断命令是否需要网络出站访问
 */
export function commandNeedsNetwork(command: string): boolean {
  if (URL_PATTERN.test(command)) {
    return true;
  }
  const tokens = command.split(/[\s|;&><()]+/).map((t) => t.trim().toLowerCase());
  return tokens.some((token) => NETWORK_PROGRAMS.has(token));
}

export interface MicroSandboxConfig {
  mode?: 'auto' | 'bwrap' | 'off';
  workspaceDir?: string;
  extraRoDirs?: string[];
  extraRwDirs?: string[];
  probeOnStart?: boolean;
  defaultAllowNetwork?: boolean;
}

export interface ExecutionOptions {
  cwd?: string;
  allowNetwork?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface MicroSandboxExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  isSandboxed: boolean;
  engine: 'bwrap' | 'env_scrubbed';
  networkBlocked: boolean;
  durationMs: number;
  command: string;
  reason?: string;
}

export interface MicroSandboxStatus {
  active: boolean;
  engine: 'bwrap' | 'env_scrubbed';
  version: string;
  blocksNetwork: boolean;
  workspaceDir: string;
  reason: string;
}

/**
 * 剥离宿主敏感环境变量，防止普通回退执行时泄露 API 密钥与凭证
 */
export function getSanitizedEnv(): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};
  const allowlist = ['PATH', 'HOME', 'USER', 'LANG', 'TERM', 'SHELL', 'PWD', 'TMPDIR', 'TEMP', 'TMP', 'NODE_ENV'];
  for (const key of allowlist) {
    if (process.env[key] !== undefined) {
      safeEnv[key] = process.env[key];
    }
  }
  safeEnv.SANDBOX_ENV = '1';
  safeEnv.MUSECLAW_SANDBOX = 'true';
  return safeEnv;
}

/**
 * Bubblewrap (bwrap) 微沙箱隔离引擎
 * 针对轻量 Shell 与脚本执行，毫秒级拉起内核命名空间与只读绑定，阻断私有主目录外泄与网络静默出逃
 */
export class MicroSandbox {
  private mode: 'auto' | 'bwrap' | 'off';
  private workspaceDir: string;
  private extraRoDirs: string[];
  private extraRwDirs: string[];
  private defaultAllowNetwork: boolean;

  private bwrapPath: string | null = null;
  private version = '';
  private active = false;
  private blocksNetwork = true;
  private reason = '';

  constructor(config: MicroSandboxConfig = {}) {
    this.mode = config.mode || 'auto';
    this.workspaceDir = path.resolve(config.workspaceDir || process.cwd());
    this.extraRoDirs = (config.extraRoDirs || []).map((p) => path.resolve(p));
    this.extraRwDirs = (config.extraRwDirs || []).map((p) => path.resolve(p));
    this.defaultAllowNetwork = config.defaultAllowNetwork ?? true;

    if (config.probeOnStart !== false) {
      this.probe();
    }
  }

  private appendSystemMounts(args: string[]): void {
    // 核心只读系统目录与网络/DNS解析支撑目录
    const roDirs = [
      '/usr',
      '/opt',
      '/etc',
      '/var',
      '/snap',
      '/nix',
      '/run',
      '/mnt/wsl'
    ];
    for (const dir of roDirs) {
      if (fs.existsSync(dir)) {
        args.push('--ro-bind-try', dir, dir);
      }
    }

    // 动态追踪并挂载 /etc/resolv.conf 符号链接真实目标目录，确保各 Linux 发行版与 WSL 环境下 DNS 解析物理可达
    if (fs.existsSync('/etc/resolv.conf')) {
      try {
        const realResolv = fs.realpathSync('/etc/resolv.conf');
        const realDir = path.dirname(realResolv);
        if (realDir && fs.existsSync(realDir) && !roDirs.includes(realDir)) {
          args.push('--ro-bind-try', realDir, realDir);
        }
      } catch {}
    }

    // 兼容 Linux merged-/usr 体系（/bin, /lib, /lib64 为符号链接或目录）
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

    // 基础伪文件系统与隔离 /tmp
    args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp');
  }

  /**
   * 探测系统是否具备运行 bubblewrap 的内核条件
   */
  public probe(): { active: boolean; reason: string } {
    if (this.mode === 'off') {
      this.active = false;
      this.reason = 'MicroSandbox mode explicitly set to off';
      return { active: false, reason: this.reason };
    }

    if (process.platform !== 'linux') {
      this.active = false;
      this.reason = `bubblewrap is Linux-only (current platform: ${process.platform})`;
      return { active: false, reason: this.reason };
    }

    // 探测 bwrap 可执行文件
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

    // 探测版本
    try {
      const verOut = execSync(`${this.bwrapPath} --version`, { encoding: 'utf-8' }).trim();
      this.version = verOut.replace('bubblewrap', '').trim();
    } catch {
      this.version = 'unknown';
    }

    const trueBin = fs.existsSync('/usr/bin/true') ? '/usr/bin/true' : '/bin/true';

    // 探测命名空间能力及网络隔离是否被内核限制
    try {
      // 探测包含 network unshare 的完整测试
      const testCmd = [this.bwrapPath, '--unshare-user-try', '--unshare-net'];
      this.appendSystemMounts(testCmd);
      testCmd.push(trueBin);
      execFileSync(testCmd[0], testCmd.slice(1), { timeout: 3000 });
      this.active = true;
      this.blocksNetwork = true;
      this.reason = `Active: bubblewrap ${this.version} with full network unshare`;
      return { active: true, reason: this.reason };
    } catch (errNet: any) {
      const errMsg = String(errNet?.message || '');
      // 如果仅仅是网络接口配置受限（如某些老内核或无 CAP_NET_ADMIN）
      if (errMsg.includes('loopback') || errMsg.includes('network')) {
        try {
          const testWithoutNet = [this.bwrapPath, '--unshare-user-try'];
          this.appendSystemMounts(testWithoutNet);
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

  public getStatus(): MicroSandboxStatus {
    return {
      active: this.active,
      engine: this.active ? 'bwrap' : 'env_scrubbed',
      version: this.version,
      blocksNetwork: this.active && this.blocksNetwork,
      workspaceDir: this.workspaceDir,
      reason: this.reason
    };
  }

  /**
   * 构造 bwrap 命令行参数数组
   */
  public buildBwrapArgs(
    command: string,
    options: {
      workspaceDir?: string;
      allowNetwork?: boolean;
      extraRoDirs?: string[];
      extraRwDirs?: string[];
    } = {}
  ): string[] {
    const ws = path.resolve(options.workspaceDir || this.workspaceDir);
    const allowNet = options.allowNetwork ?? (this.defaultAllowNetwork || commandNeedsNetwork(command));

    const args: string[] = [
      '--die-with-parent',
      '--new-session',
      '--unshare-user-try',
      '--unshare-pid',
      '--unshare-ipc',
      '--unshare-uts',
      '--unshare-cgroup-try'
    ];

    // 如果无需网络且宿主支持网络阻断，施加 --unshare-net
    if (!allowNet && this.blocksNetwork) {
      args.push('--unshare-net');
    }

    // 挂载核心只读系统目录与 merged-/usr 符号链接
    this.appendSystemMounts(args);

    // 隔离用户 Home 目录，屏蔽 ~/.ssh、~/.aws、~/.bashrc 等私密文件
    args.push('--dir', '/tmp/home', '--setenv', 'HOME', '/tmp/home');
    args.push('--setenv', 'TMPDIR', '/tmp');
    args.push('--setenv', 'USER', 'sandbox-user');
    args.push('--setenv', 'LANG', 'C.UTF-8');
    args.push('--setenv', 'SANDBOX_ENV', '1');
    args.push('--setenv', 'MUSECLAW_SANDBOX', 'true');
    args.push('--setenv', 'MUSECLAW_SANDBOX_ENGINE', 'bwrap');
    args.push('--setenv', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', '1');

    // 传递安全的 PATH
    const safePath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin';
    args.push('--setenv', 'PATH', safePath);

    // 挂载工作区读写目录
    args.push('--bind-try', ws, ws);
    args.push('--chdir', ws);

    // 附加只读目录
    const roList = [...this.extraRoDirs, ...(options.extraRoDirs || [])];
    for (const ro of roList) {
      if (fs.existsSync(ro)) {
        args.push('--ro-bind-try', ro, ro);
      }
    }

    // 附加读写目录
    const rwList = [...this.extraRwDirs, ...(options.extraRwDirs || [])];
    for (const rw of rwList) {
      if (fs.existsSync(rw)) {
        args.push('--bind-try', rw, rw);
      }
    }

    // 执行实际命令
    const shellBin = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
    args.push(shellBin, '-c', command);

    return args;
  }

  /**
   * 执行 Shell 命令：自动选用 bwrap 隔离，失败或非 Linux 平台无缝回退到环境过滤执行
   */
  public async execute(command: string, options: ExecutionOptions = {}): Promise<MicroSandboxExecutionResult> {
    const startTime = Date.now();
    const ws = path.resolve(options.cwd || this.workspaceDir);
    const requiresNetwork = options.allowNetwork ?? (this.defaultAllowNetwork || commandNeedsNetwork(command));
    const timeoutMs = options.timeoutMs || 30000;

    // 1. 如果 bwrap 可用，使用内核级微沙箱执行
    if (this.active && this.bwrapPath) {
      const bwrapArgs = this.buildBwrapArgs(command, {
        workspaceDir: ws,
        allowNetwork: requiresNetwork,
        extraRoDirs: this.extraRoDirs,
        extraRwDirs: this.extraRwDirs
      });

      return new Promise<MicroSandboxExecutionResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let killed = false;

        const child = spawn(this.bwrapPath!, bwrapArgs, {
          cwd: ws,
          env: getSanitizedEnv()
        });

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
              stderr: stderr + `\n[MicroSandbox] Command timed out after ${timeoutMs}ms`,
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
          // 如果 bwrap 进程异常崩溃，快速安全降级为普通进程执行
          console.warn(`[MicroSandbox] bwrap invocation failed: ${err.message}. Degrading to sanitized execution.`);
          this.executeFallback(command, ws, timeoutMs, startTime).then(resolve);
        });
      });
    }

    // 2. 回退机制：Scrubbed Env 普通隔离执行
    return this.executeFallback(command, ws, timeoutMs, startTime);
  }

  private async executeFallback(
    command: string,
    cwd: string,
    timeoutMs: number,
    startTime: number
  ): Promise<MicroSandboxExecutionResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        env: getSanitizedEnv()
      });
      return {
        stdout,
        stderr,
        exitCode: 0,
        isSandboxed: false,
        engine: 'env_scrubbed',
        networkBlocked: false,
        durationMs: Date.now() - startTime,
        command,
        reason: this.reason || 'MicroSandbox unavailable or disabled'
      };
    } catch (err: any) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.code || 1,
        isSandboxed: false,
        engine: 'env_scrubbed',
        networkBlocked: false,
        durationMs: Date.now() - startTime,
        command,
        reason: this.reason || 'MicroSandbox unavailable or disabled'
      };
    }
  }
}
