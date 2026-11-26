#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import os, { homedir, hostname } from 'node:os';
import path, { join } from 'node:path';
import WebSocket from 'ws';
import {
  ClaudeProviderDriver,
  CodexProviderDriver,
  OpenAICompatProviderDriver,
  PiProviderDriver,
  getAugmentedPath,
  type ApprovalDecision,
  type ProviderDriver,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderSnapshot,
  type TurnRunParams
} from '../../../packages/sandbox-core/src/index.ts';

interface RpcMessage {
  jsonrpc: '2.0';
  id?: string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message: string };
}

function getServicePaths() {
  const home = homedir();
  const museclawDir = join(home, '.museclaw');
  return {
    home,
    museclawDir,
    configFile: join(museclawDir, 'runner.json'),
    clientScript: join(museclawDir, 'client.js'),
    logFile: join(museclawDir, 'runner.log'),
    errLogFile: join(museclawDir, 'runner.err.log'),
    isMac: os.platform() === 'darwin',
    launchdPlist: join(home, 'Library', 'LaunchAgents', 'com.museclaw.runner.plist'),
    systemdService: join(home, '.config', 'systemd', 'user', 'museclaw-runner.service')
  };
}

function loadPersistentConfig(): Record<string, string> {
  const paths = getServicePaths();
  if (existsSync(paths.configFile)) {
    try {
      return JSON.parse(readFileSync(paths.configFile, 'utf8'));
    } catch {}
  }
  return {};
}

function savePersistentConfig(cfg: Record<string, string>): void {
  const paths = getServicePaths();
  if (!existsSync(paths.museclawDir)) {
    mkdirSync(paths.museclawDir, { recursive: true });
  }
  try {
    const existing = loadPersistentConfig();
    writeFileSync(paths.configFile, JSON.stringify({ ...existing, ...cfg }, null, 2), 'utf8');
  } catch {}
}

function installService(config: { serverUrl: string; token: string; name: string }): void {
  const paths = getServicePaths();
  if (!existsSync(paths.museclawDir)) mkdirSync(paths.museclawDir, { recursive: true });
  savePersistentConfig(config);

  try {
    const currentScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
    if (currentScript && existsSync(currentScript) && currentScript !== path.resolve(paths.clientScript)) {
      copyFileSync(currentScript, paths.clientScript);
    }
  } catch {}

  if (os.platform() === 'win32') {
    console.log('\n===========================================================');
    console.log('Windows 环境下请使用以下命令直接启动常驻连接:');
    console.log(`  node "${paths.clientScript}" --server "${config.serverUrl}" --token "${config.token}"`);
    console.log('===========================================================\n');
    return;
  }

  const nodeBin = process.execPath;
  const envPath = getAugmentedPath();

  if (paths.isMac) {
    const launchAgentsDir = join(paths.home, 'Library', 'LaunchAgents');
    if (!existsSync(launchAgentsDir)) mkdirSync(launchAgentsDir, { recursive: true });
    try {
      execSync(`launchctl unload -w "${paths.launchdPlist}" 2>/dev/null`, { stdio: 'ignore' });
    } catch {}
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.museclaw.runner</string>
  <key>ProgramArguments</key>
  <array><string>${nodeBin}</string><string>${paths.clientScript}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${paths.museclawDir}</string>
  <key>StandardOutPath</key><string>${paths.logFile}</string>
  <key>StandardErrorPath</key><string>${paths.errLogFile}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${envPath}</string><key>HOME</key><string>${paths.home}</string></dict>
</dict>
</plist>`;
    writeFileSync(paths.launchdPlist, plist, 'utf8');
    execSync(`launchctl load -w "${paths.launchdPlist}"`);
    console.log('macOS LaunchAgent 守护服务已安装并启动: com.museclaw.runner');
  } else {
    const systemdDir = join(paths.home, '.config', 'systemd', 'user');
    if (!existsSync(systemdDir)) mkdirSync(systemdDir, { recursive: true });
    try {
      execSync('systemctl --user stop museclaw-runner.service 2>/dev/null', { stdio: 'ignore' });
    } catch {}
    const service = `[Unit]
Description=MuseClaw WebSocket Environment Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${paths.clientScript}
WorkingDirectory=${paths.museclawDir}
Restart=always
RestartSec=5
StandardOutput=append:${paths.logFile}
StandardError=append:${paths.errLogFile}
Environment="PATH=${envPath}"
Environment="HOME=${paths.home}"

[Install]
WantedBy=default.target
`;
    writeFileSync(paths.systemdService, service, 'utf8');
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable --now museclaw-runner.service');
    console.log('Linux systemd 用户常驻服务已安装并启动: museclaw-runner.service');
  }
}

function uninstallService(): void {
  const paths = getServicePaths();
  if (paths.isMac) {
    try {
      execSync(`launchctl unload -w "${paths.launchdPlist}" 2>/dev/null`, { stdio: 'ignore' });
    } catch {}
    if (existsSync(paths.launchdPlist)) unlinkSync(paths.launchdPlist);
    console.log('macOS LaunchAgent 服务已卸载');
  } else {
    try {
      execSync('systemctl --user stop museclaw-runner.service 2>/dev/null', { stdio: 'ignore' });
      execSync('systemctl --user disable museclaw-runner.service 2>/dev/null', { stdio: 'ignore' });
    } catch {}
    if (existsSync(paths.systemdService)) {
      unlinkSync(paths.systemdService);
      execSync('systemctl --user daemon-reload 2>/dev/null || true');
    }
    console.log('Linux systemd 服务已卸载');
  }
}

export class MuseClawEnvironmentDaemon {
  private serverUrl: string;
  private token: string;
  private machineName: string;
  private environmentId: string;
  private drivers: Map<ProviderDriverKind, ProviderDriver>;
  private socket: WebSocket | null = null;
  private isRunning = true;
  private reconnectAttempt = 0;

  constructor(options: { serverUrl: string; token?: string; name?: string; environmentId?: string }) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.token = options.token || process.env.MUSECLAW_TOKEN || 'default-mesh-token';
    this.machineName = options.name || hostname();
    this.environmentId =
      options.environmentId ||
      `env_${Buffer.from(`${this.token}:${this.machineName}`).toString('hex').slice(0, 10)}`;

    this.drivers = new Map<ProviderDriverKind, ProviderDriver>([
      ['claude', new ClaudeProviderDriver()],
      ['codex', new CodexProviderDriver()],
      ['pi', new PiProviderDriver()],
      ['ollama', new OpenAICompatProviderDriver('ollama')],
      ['openai-compat', new OpenAICompatProviderDriver('openai-compat')]
    ]);
  }

  public async probeAll(): Promise<ProviderSnapshot[]> {
    const defaults: ProviderInstanceConfig[] = [
      {
        instanceId: 'claude',
        driver: 'claude',
        displayName: 'Claude Code',
        enabled: true,
        environmentId: this.environmentId,
        model: 'claude-sonnet-4-6'
      },
      {
        instanceId: 'codex',
        driver: 'codex',
        displayName: 'OpenAI Codex',
        enabled: true,
        environmentId: this.environmentId,
        model: 'gpt-5.4'
      },
      {
        instanceId: 'pi',
        driver: 'pi',
        displayName: 'Pi Coding Agent',
        enabled: true,
        environmentId: this.environmentId,
        model: 'anthropic/claude-sonnet-4-6'
      },
      {
        instanceId: 'ollama',
        driver: 'ollama',
        displayName: 'Ollama Local',
        enabled: true,
        environmentId: this.environmentId,
        model: 'llama3.2',
        baseUrl: 'http://127.0.0.1:11434'
      }
    ];

    return Promise.all(
      defaults.map((inst) =>
        this.drivers.get(inst.driver)!.probe(inst, {
          environmentId: this.environmentId,
          environmentLabel: this.machineName
        })
      )
    );
  }

  private buildWsUrl(): string {
    const parsed = new URL(this.serverUrl);
    const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = new URL(`${proto}//${parsed.host}/ws/environment`);
    wsUrl.searchParams.set('token', this.token);
    wsUrl.searchParams.set('environmentId', this.environmentId);
    wsUrl.searchParams.set('hostname', this.machineName);
    wsUrl.searchParams.set('platform', os.platform());
    wsUrl.searchParams.set('arch', os.arch());
    return wsUrl.toString();
  }

  private send(msg: RpcMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  public async start(): Promise<void> {
    console.log('\n===========================================================');
    console.log('MuseClaw Environment Daemon (WebSocket RPC)');
    console.log(`主机: ${this.machineName} (${os.platform()}-${os.arch()})`);
    console.log(`网关: ${this.serverUrl}`);
    console.log('===========================================================\n');
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (!this.isRunning) return;
    const url = this.buildWsUrl();
    const ws = new WebSocket(url);
    this.socket = ws;

    ws.on('open', async () => {
      this.reconnectAttempt = 0;
      const snapshots = await this.probeAll();
      const readyNames = snapshots
        .filter((s) => s.installed)
        .map((s) => `${s.driver}(${s.status})`)
        .join(', ');
      console.log(`已连接至网关 [${this.environmentId}]，已发现本地运行环境: ${readyNames || '无'}`);

      this.send({
        jsonrpc: '2.0',
        id: `reg_${Date.now()}`,
        method: 'env.register',
        params: {
          environmentId: this.environmentId,
          label: this.machineName,
          hostname: this.machineName,
          platform: os.platform(),
          arch: os.arch(),
          userId: this.token,
          snapshots
        }
      });
    });

    ws.on('message', (raw) => {
      let msg: RpcMessage;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      if (!msg.method) return;
      void this.handleRpcRequest(msg);
    });

    ws.on('close', () => {
      this.socket = null;
      if (!this.isRunning) return;
      const delayMs = Math.min(30_000, 1000 * Math.pow(2, Math.min(this.reconnectAttempt++, 5)));
      console.log(`连接已断开，${Math.round(delayMs / 1000)}s 后自动重连...`);
      setTimeout(() => void this.connect(), delayMs).unref();
    });

    ws.on('error', (err) => {
      console.error(`WebSocket 异常: ${err.message}`);
    });
  }

  private async handleRpcRequest(msg: RpcMessage): Promise<void> {
    const { id, method, params } = msg;
    try {
      if (method === 'env.probe') {
        const instance = params.instance as ProviderInstanceConfig;
        const driver = this.drivers.get(instance.driver);
        if (!driver) throw new Error(`未知驱动: ${instance.driver}`);
        const snapshot = await driver.probe(instance, {
          environmentId: this.environmentId,
          environmentLabel: this.machineName
        });
        if (id) this.send({ jsonrpc: '2.0', id, result: { snapshot } });
        return;
      }

      if (method === 'env.turn.start') {
        const { turnId, ...turnParams } = params as TurnRunParams & { turnId: string };
        const driver = this.drivers.get(turnParams.instance.driver);
        if (!driver) throw new Error(`未知驱动: ${turnParams.instance.driver}`);
        if (id) this.send({ jsonrpc: '2.0', id, result: { ok: true, turnId } });

        void (async () => {
          try {
            for await (const ev of driver.runTurn(turnParams)) {
              this.send({
                jsonrpc: '2.0',
                method: 'env.turn.event',
                params: { turnId, event: ev }
              });
            }
          } catch (err: any) {
            this.send({
              jsonrpc: '2.0',
              method: 'env.turn.event',
              params: {
                turnId,
                event: { type: 'turn.failed', error: err?.message || String(err) }
              }
            });
          }
        })();
        return;
      }

      if (method === 'env.turn.interrupt') {
        const sessionKey = String(params?.sessionKey || '');
        await Promise.all(Array.from(this.drivers.values()).map((d) => d.interruptTurn(sessionKey)));
        if (id) this.send({ jsonrpc: '2.0', id, result: { ok: true } });
        return;
      }

      if (method === 'env.approval.respond') {
        const requestId = String(params?.requestId || '');
        const decision = params?.decision as ApprovalDecision;
        let handled = false;
        for (const d of this.drivers.values()) {
          if (await d.respondApproval(requestId, decision)) {
            handled = true;
            break;
          }
        }
        if (id) this.send({ jsonrpc: '2.0', id, result: { ok: handled } });
        return;
      }

      if (method === 'env.session.close') {
        const sessionKey = String(params?.sessionKey || '');
        await Promise.all(Array.from(this.drivers.values()).map((d) => d.closeSession(sessionKey)));
        if (id) this.send({ jsonrpc: '2.0', id, result: { ok: true } });
        return;
      }

      if (id) {
        this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    } catch (err: any) {
      if (id) {
        this.send({ jsonrpc: '2.0', id, error: { message: err?.message || String(err) } });
      }
    }
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    try {
      this.socket?.close();
    } catch {}
    await Promise.all(Array.from(this.drivers.values()).map((d) => d.disposeAll()));
  }
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const fileConfig = loadPersistentConfig();
  let serverUrl = process.env.MUSECLAW_SERVER_URL || fileConfig.serverUrl || 'http://localhost:8799';
  let token = process.env.MUSECLAW_TOKEN || fileConfig.token || 'default-mesh-token';
  let name = fileConfig.name || hostname();
  let action = 'run';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--server' || arg === '-s') && args[i + 1]) serverUrl = args[++i];
    else if ((arg === '--token' || arg === '-t') && args[i + 1]) token = args[++i];
    else if ((arg === '--name' || arg === '-n') && args[i + 1]) name = args[++i];
    else if (arg === '--install-service' || arg === '--daemon') action = 'install-service';
    else if (arg === '--uninstall-service') action = 'uninstall-service';
    else if (arg === '--probe') action = 'probe';
  }
  return { serverUrl, token, name, action };
}

const isEntryMain =
  process.argv[1] &&
  (process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('client.js'));

if (isEntryMain) {
  const cliConfig = parseCliArgs();
  if (cliConfig.action === 'probe') {
    const daemon = new MuseClawEnvironmentDaemon(cliConfig);
    daemon
      .probeAll()
      .then(async (snapshots) => {
        console.log(JSON.stringify(snapshots, null, 2));
        await daemon.stop();
        process.exit(0);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else if (cliConfig.action === 'install-service') {
    installService({ serverUrl: cliConfig.serverUrl, token: cliConfig.token, name: cliConfig.name });
    process.exit(0);
  } else if (cliConfig.action === 'uninstall-service') {
    uninstallService();
    process.exit(0);
  } else {
    savePersistentConfig({
      serverUrl: cliConfig.serverUrl,
      token: cliConfig.token,
      name: cliConfig.name
    });
    const daemon = new MuseClawEnvironmentDaemon(cliConfig);
    daemon.start().catch((err) => {
      console.error('Fatal daemon error:', err);
      process.exit(1);
    });
    process.on('SIGINT', () => {
      void daemon.stop().then(() => process.exit(0));
    });
  }
}
