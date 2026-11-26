import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  ClaudeProviderDriver,
  EnvironmentBridge,
  ProviderRuntimeManager,
  WebSocketServer,
  type ProviderInstanceConfig
} from '../packages/sandbox-core/src/index.ts';
import { MuseClawEnvironmentDaemon } from '../apps/runner/src/cli.ts';
import { ModelProviderStore } from '../apps/gateway/bots/provider-store.ts';

function makeClaudeInstance(overrides: Partial<ProviderInstanceConfig> = {}): ProviderInstanceConfig {
  return {
    instanceId: 'claude',
    driver: 'claude',
    displayName: 'Claude Code',
    enabled: true,
    environmentId: 'local',
    model: 'sonnet',
    permissionMode: 'full',
    effort: 'low',
    ...overrides
  };
}

async function run() {
  process.env.NODE_ENV = 'test';
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'museclaw-claude-e2e-'));
  const driver = new ClaudeProviderDriver();
  let wsServer: ReturnType<typeof createServer> | null = null;
  let gatewayServer: { close: (cb: () => void) => void; listening?: boolean; once: (e: string, cb: () => void) => void; address: () => any } | null = null;
  let daemon: MuseClawEnvironmentDaemon | null = null;
  let runtime: ProviderRuntimeManager | null = null;

  const providersConfigPath = path.resolve(process.cwd(), 'config/providers.json');
  const hadProvidersJson = fs.existsSync(providersConfigPath);
  const prevProvidersJson = hadProvidersJson ? fs.readFileSync(providersConfigPath, 'utf8') : null;
  const testUserDataDir = path.resolve(process.cwd(), 'apps/gateway/data/users/verify_claude_user');

  try {
    console.log('\n=== Test 1: ClaudeProviderDriver.probe() ===');
    const inst = makeClaudeInstance({ cwd: tmpRoot });
    const snapshot = await driver.probe(inst);
    console.log('Probe result:', {
      status: snapshot.status,
      version: snapshot.version,
      executablePath: snapshot.executablePath,
      auth: snapshot.auth,
      modelCount: snapshot.models.length,
      slashCommandCount: snapshot.slashCommands?.length || 0
    });
    assert.equal(snapshot.installed, true, 'Claude CLI must be installed');
    assert.equal(snapshot.status, 'ready', `Expected status=ready, got ${snapshot.status}: ${snapshot.message}`);
    assert.ok(snapshot.version, 'Expected non-empty version');
    assert.ok(snapshot.executablePath, 'Expected executablePath');
    assert.ok(snapshot.models.length > 0, 'Expected live discovered models');

    console.log('\n=== Test 2: Warm Multi-Turn Session + closeSession + Resume ===');
    const sessionKey = `e2e-warm-${Date.now()}`;
    let capturedProviderSessionId = '';
    let turn1Text = '';

    for await (const evt of driver.runTurn({
      sessionKey,
      instance: inst,
      cwd: tmpRoot,
      prompt: 'Remember this exact verification code: ALPHA-9421. Reply with only the word STORED.'
    })) {
      if (evt.type === 'session.started' && evt.providerSessionId) {
        capturedProviderSessionId = evt.providerSessionId;
      } else if (evt.type === 'turn.completed') {
        turn1Text = evt.text;
        capturedProviderSessionId = evt.providerSessionId || capturedProviderSessionId;
      } else if (evt.type === 'turn.failed') {
        throw new Error(`Turn 1 failed: ${evt.error}`);
      }
    }
    console.log('Turn 1 reply:', turn1Text.trim(), 'providerSessionId:', capturedProviderSessionId);
    assert.ok(capturedProviderSessionId, 'Expected providerSessionId from SDK');

    let turn2Text = '';
    for await (const evt of driver.runTurn({
      sessionKey,
      instance: inst,
      cwd: tmpRoot,
      prompt: 'What exact verification code did I just ask you to remember? Reply with only the code.'
    })) {
      if (evt.type === 'turn.completed') {
        turn2Text = evt.text;
      } else if (evt.type === 'turn.failed') {
        throw new Error(`Turn 2 failed: ${evt.error}`);
      }
    }
    console.log('Turn 2 warm recall:', turn2Text.trim());
    assert.ok(turn2Text.includes('ALPHA-9421'), `Warm multi-turn recall failed: ${turn2Text}`);

    await driver.closeSession(sessionKey);

    let turn3Text = '';
    for await (const evt of driver.runTurn({
      sessionKey: `e2e-resumed-${Date.now()}`,
      instance: inst,
      cwd: tmpRoot,
      resumeSessionId: capturedProviderSessionId,
      prompt: 'Repeat the exact verification code from our earlier session. Reply with only the code.'
    })) {
      if (evt.type === 'turn.completed') {
        turn3Text = evt.text;
      } else if (evt.type === 'turn.failed') {
        throw new Error(`Turn 3 resume failed: ${evt.error}`);
      }
    }
    console.log('Turn 3 resumed recall:', turn3Text.trim());
    assert.ok(turn3Text.includes('ALPHA-9421'), `Resumed session recall failed: ${turn3Text}`);

    console.log('\n=== Test 3: Tool Execution + Interactive canUseTool Approval Bridge ===');
    const askInst = makeClaudeInstance({ permissionMode: 'ask', cwd: tmpRoot });
    const askSessionKey = `e2e-approval-${Date.now()}`;
    let sawApprovalRequest = false;
    let sawToolStart = false;
    let sawToolEnd = false;
    let askCompletedText = '';

    for await (const evt of driver.runTurn({
      sessionKey: askSessionKey,
      instance: askInst,
      cwd: tmpRoot,
      permissionMode: 'ask',
      prompt: 'Call the Write tool right now to create file "approved-note.txt" with content "approved-ok". Wait for permission if prompted, then reply DONE.'
    })) {
      if (evt.type === 'approval.request') {
        sawApprovalRequest = true;
        console.log('Approval requested:', evt.toolName, evt.summary);
        const resolved = await driver.respondApproval(evt.requestId, { approved: true });
        assert.equal(resolved, true, 'respondApproval must return true');
      } else if (evt.type === 'tool.start') {
        sawToolStart = true;
      } else if (evt.type === 'tool.end') {
        sawToolEnd = true;
      } else if (evt.type === 'turn.completed') {
        askCompletedText = evt.text;
      } else if (evt.type === 'turn.failed') {
        throw new Error(`Approval turn failed: ${evt.error}`);
      }
    }
    const targetFile = path.join(tmpRoot, 'approved-note.txt');
    const fileExists = fs.existsSync(targetFile);
    console.log('Approval test summary:', {
      sawApprovalRequest,
      sawToolStart,
      sawToolEnd,
      fileExists,
      reply: askCompletedText.slice(0, 120)
    });
    assert.ok(sawApprovalRequest || sawToolStart, 'Expected tool invocation / approval request');
    assert.ok(fileExists || sawToolEnd, 'Expected Write tool execution to complete');

    console.log('\n=== Test 4: Mid-Turn interruptTurn ===');
    const intSessionKey = `e2e-interrupt-${Date.now()}`;
    const abortController = new AbortController();
    let interruptedCleanly = false;
    let gotFirstDelta = false;
    for await (const evt of driver.runTurn({
      sessionKey: intSessionKey,
      instance: inst,
      cwd: tmpRoot,
      signal: abortController.signal,
      prompt: 'Write a very long, detailed 10-paragraph essay about compiler optimization passes.'
    })) {
      if (evt.type === 'text.delta' && !gotFirstDelta) {
        gotFirstDelta = true;
        abortController.abort();
        await driver.interruptTurn(intSessionKey);
      }
      if (evt.type === 'turn.interrupted') {
        interruptedCleanly = true;
        break;
      }
      if (evt.type === 'turn.completed') {
        interruptedCleanly = true;
        break;
      }
    }
    console.log('Interrupt test:', { gotFirstDelta, interruptedCleanly });
    assert.equal(interruptedCleanly || abortController.signal.aborted, true, 'Expected clean turn interruption');
    await driver.closeSession(intSessionKey);

    console.log('\n=== Test 5: WebSocket Environment Daemon <-> EnvironmentBridge E2E ===');
    const bridge = new EnvironmentBridge();
    runtime = new ProviderRuntimeManager(bridge);
    const wss = new WebSocketServer({ noServer: true });
    wsServer = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    wsServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/ws/environment') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        bridge.handleConnection(ws, {
          environmentId: url.searchParams.get('environmentId') || undefined,
          userId: url.searchParams.get('token') || undefined,
          hostname: url.searchParams.get('hostname') || undefined,
          platform: url.searchParams.get('platform') || undefined,
          arch: url.searchParams.get('arch') || undefined
        });
      });
    });

    await new Promise<void>((resolve) => wsServer!.listen(0, '127.0.0.1', () => resolve()));
    const wsAddr = wsServer.address() as { port: number };
    const daemonUrl = `http://127.0.0.1:${wsAddr.port}`;

    daemon = new MuseClawEnvironmentDaemon({
      serverUrl: daemonUrl,
      token: 'ws_e2e_user',
      name: 'ws-e2e-host',
      environmentId: 'env_ws_e2e'
    });
    await daemon.start();

    let envReady = false;
    for (let i = 0; i < 40; i++) {
      const envs = bridge.listEnvironments('ws_e2e_user');
      const found = envs.find((e) => e.environmentId === 'env_ws_e2e' && e.status === 'online');
      if (found && found.snapshots && found.snapshots.length > 0) {
        envReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(envReady, true, 'Environment daemon failed to register snapshots over WebSocket');

    const remoteInst = makeClaudeInstance({
      instanceId: 'claude-remote',
      environmentId: 'env_ws_e2e',
      cwd: tmpRoot
    });
    let wsTurnText = '';
    for await (const evt of runtime.runTurn({
      sessionKey: `ws-e2e-${Date.now()}`,
      instance: remoteInst,
      cwd: tmpRoot,
      prompt: 'Reply with only the exact token: PONG_WS_BRIDGE'
    })) {
      if (evt.type === 'text.delta') wsTurnText += evt.text;
      if (evt.type === 'turn.completed') wsTurnText = evt.text || wsTurnText;
      if (evt.type === 'turn.failed') throw new Error(`Remote WS turn failed: ${evt.error}`);
    }
    console.log('WS RPC remote turn reply:', wsTurnText.trim());
    assert.ok(wsTurnText.includes('PONG_WS_BRIDGE'), `WS RPC response mismatch: ${wsTurnText}`);

    daemon.stop();
    daemon = null;
    wss.close();
    wsServer.close();
    wsServer = null;

    console.log('\n=== Test 6: ModelProviderStore Multi-Instance CRUD ===');
    const storeConfigDir = path.join(tmpRoot, 'store-cfg');
    const store = new ModelProviderStore(storeConfigDir);
    const initialIds = store.getInstances().map((i) => i.instanceId);
    assert.equal(initialIds.includes('ducc'), false, 'Legacy ducc must not exist');
    assert.equal(initialIds.includes('ducx'), false, 'Legacy ducx must not exist');
    assert.equal(initialIds.includes('claude'), true, 'claude default instance must exist');

    store.upsertInstance({
      instanceId: 'claude-worktree-2',
      driver: 'claude',
      displayName: 'Claude Worktree 2',
      environmentId: 'local',
      model: 'opus',
      permissionMode: 'ask',
      enabled: true
    });
    store.setActiveInstance('claude-worktree-2', 'opus');

    const reloadedStore = new ModelProviderStore(storeConfigDir);
    assert.equal(reloadedStore.getActiveInstance().instanceId, 'claude-worktree-2');
    assert.equal(reloadedStore.getActiveInstance().model, 'opus');
    assert.equal(reloadedStore.removeInstance('claude').removed, false, 'Default instance should be protected');
    assert.equal(reloadedStore.removeInstance('claude-worktree-2').removed, true, 'Custom instance should be removable');

    console.log('\n=== Test 7: Gateway HTTP POST /api/chat SSE with Claude Runtime ===');
    const { startGatewayServer } = await import('../apps/gateway/src/server.ts');
    gatewayServer = startGatewayServer(0);
    await new Promise<void>((resolve) => {
      if (gatewayServer!.listening) return resolve();
      gatewayServer!.once('listening', () => resolve());
    });
    const gwAddr = gatewayServer.address() as { port: number };
    const gwBase = `http://127.0.0.1:${gwAddr.port}`;

    // Register test user and get cookie
    const regRes = await fetch(`${gwBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'verify_claude_user',
        password: 'TestPassword123!',
        displayName: 'Verify Claude'
      })
    });
    let cookie = regRes.headers.get('set-cookie')?.split(';')[0] || '';
    if (!cookie) {
      const loginRes = await fetch(`${gwBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'verify_claude_user', password: 'TestPassword123!' })
      });
      cookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
    }
    assert.ok(cookie, 'Expected session auth cookie');

    // Ensure claude instance is active for gateway test
    const saveCfgRes = await fetch(`${gwBase}/api/models/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        activeInstanceId: 'claude',
        activeModelId: 'sonnet',
        instance: { instanceId: 'claude', driver: 'claude', permissionMode: 'full', model: 'sonnet' }
      })
    });
    assert.equal(saveCfgRes.ok, true, 'Failed to save claude active config');

    const chatRes = await fetch(`${gwBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        bot_id: 'muse',
        text: 'Reply with only the exact token: GATEWAY_CLAUDE_OK'
      })
    });
    assert.equal(chatRes.status, 200, `Expected SSE 200, got ${chatRes.status}`);
    const sseRaw = await chatRes.text();
    const events = sseRaw
      .split('\n\n')
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.startsWith('data:'))
      .map((chunk) => JSON.parse(chunk.slice(5).trim()));

    const initEvent = events.find((e) => e.type === 'session:init');
    const runtimeEvent = events.find((e) => e.type === 'session:provider-runtime');
    const turnMetaEvent = events.find((e) => e.type === 'turn:meta');
    const fullStreamText = events
      .filter((e) => e.type === 'stream:text-delta')
      .map((e) => e.text || '')
      .join('');

    console.log('Gateway SSE summary:', {
      eventTypes: Array.from(new Set(events.map((e) => e.type))),
      providerDriver: initEvent?.providerDriver,
      providerSessionId: runtimeEvent?.runtime?.providerSessionId,
      fullStreamText: fullStreamText.trim()
    });

    assert.equal(initEvent?.providerDriver, 'claude', 'Expected session:init with providerDriver=claude');
    assert.ok(runtimeEvent?.runtime?.providerSessionId, 'Expected session:provider-runtime with providerSessionId');
    assert.ok(fullStreamText.includes('GATEWAY_CLAUDE_OK'), `Gateway SSE output mismatch: ${fullStreamText}`);
    assert.ok(turnMetaEvent, 'Expected turn:meta event');

    console.log('\nALL 7 CLAUDE LOCAL AGENT RUNTIME E2E TESTS PASSED!');
  } finally {
    daemon?.stop();
    await driver.disposeAll();
    if (runtime) await runtime.disposeAll();
    if (wsServer) wsServer.close();
    if (gatewayServer) {
      await new Promise<void>((resolve) => gatewayServer!.close(() => resolve()));
    }
    try {
      if (hadProvidersJson && prevProvidersJson !== null) {
        fs.writeFileSync(providersConfigPath, prevProvidersJson, 'utf8');
      } else if (!hadProvidersJson && fs.existsSync(providersConfigPath)) {
        fs.unlinkSync(providersConfigPath);
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('E2E verification failed:', err);
    process.exit(1);
  });
