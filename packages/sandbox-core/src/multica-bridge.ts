import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findExecutableInPath, getAugmentedPath } from './providers/executable.ts';

export interface MulticaRuntimeInfo {
  id: string;
  name: string;
  provider: string;
  status: string;
  lastSeenAt?: string;
  agentId?: 'ducc' | 'ducx' | string;
}

export interface MulticaStatus {
  installed: boolean;
  executablePath?: string;
  profile: string;
  serverUrl?: string;
  appUrl?: string;
  workspaceId?: string;
  daemonRunning: boolean;
  daemonPid?: string;
  uptime?: string;
  runtimes: MulticaRuntimeInfo[];
  error?: string;
}

/**
 * Multica (Team Mesh) 企业本地运行时桥接器
 * 对接企业级 Multica Daemon 守护进程体系，实时读取本地已绑定的 ducc、ducx 运行时及状态
 */
export class MulticaBridge {
  private defaultProfile: string;

  constructor(profile = 'qijunhui') {
    this.defaultProfile = process.env.MULTICA_PROFILE || profile;
  }

  /**
   * 探测并获取本地 Multica 配置、守护进程运行状态与已上线运行时
   */
  public getStatus(): MulticaStatus {
    const home = homedir();
    const multicaBin = findExecutableInPath('multica', `${join(home, '.local', 'bin')}:${getAugmentedPath()}`);

    if (!multicaBin) {
      return {
        installed: false,
        profile: this.defaultProfile,
        daemonRunning: false,
        runtimes: [],
        error: '未在系统 PATH 或 ~/.local/bin 中检测到 multica CLI'
      };
    }

    const profileDir = join(home, '.multica', 'profiles');
    let profile = this.defaultProfile;
    if (existsSync(profileDir)) {
      try {
        const list = readdirSync(profileDir);
        if (!list.includes(profile) && list.length > 0) {
          profile = list[0];
        }
      } catch {}
    }

    const configPath = join(profileDir, profile, 'config.json');
    let config: any = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch {}
    }

    let daemonRunning = false;
    let daemonPid: string | undefined;
    let uptime: string | undefined;

    try {
      const statusOut = execSync(`"${multicaBin}" --profile ${profile} daemon status`, {
        timeout: 3000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, PATH: getAugmentedPath() }
      });
      const pidMatch = statusOut.match(/running\s*\(pid\s*(\d+)(?:,\s*uptime\s*([^)]+))?\)/i);
      if (pidMatch) {
        daemonRunning = true;
        daemonPid = pidMatch[1];
        uptime = pidMatch[2];
      }
    } catch {}

    const runtimes: MulticaRuntimeInfo[] = [];
    try {
      const runtimesOut = execSync(`"${multicaBin}" --profile ${profile} runtime list --output json`, {
        timeout: 4000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, PATH: getAugmentedPath() }
      });
      const rawList = JSON.parse(runtimesOut);
      if (Array.isArray(rawList)) {
        for (const r of rawList) {
          const lowerName = (r.name || '').toLowerCase();
          let agentId: 'ducc' | 'ducx' | string = 'ducc';
          if (lowerName.includes('ducx') || r.provider === 'codex') {
            agentId = 'ducx';
          } else if (lowerName.includes('ducc') || r.provider === 'claude') {
            agentId = 'ducc';
          }
          runtimes.push({
            id: r.id,
            name: r.name,
            provider: r.provider,
            status: r.status,
            lastSeenAt: r.last_seen_at || r.last_seen,
            agentId
          });
        }
      }
    } catch {}

    return {
      installed: true,
      executablePath: multicaBin,
      profile,
      serverUrl: config.server_url || 'http://team-mesh.loop.baidu-int.com:8006',
      appUrl: config.app_url || 'http://team-mesh.loop.baidu-int.com:8004',
      workspaceId: config.workspace_id,
      daemonRunning,
      daemonPid,
      uptime,
      runtimes
    };
  }

  /**
   * 检查 Multica 是否已就绪且后台守护进程正在运行
   */
  public isDaemonActive(): boolean {
    const status = this.getStatus();
    return status.installed && status.daemonRunning;
  }
}

export const globalMulticaBridge = new MulticaBridge();
