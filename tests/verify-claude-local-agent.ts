process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  probeLocalAgents,
  testLocalAgent,
  runLocalAgent,
  createLocalAgentCaller,
  parseClaudeStreamLine,
  parseCliExtraArgs,
  testProviderConnection,
  globalRunnerMesh
} from '../packages/sandbox-core/src/index.ts';
import { ModelProviderStore } from '../apps/gateway/bots/provider-store.ts';

async function main() {
  console.log('===============================================================');
  console.log('   MuseClaw Claude Code 本地 Agent 集成与端到端验证');
  console.log('===============================================================\n');

  // 1. 解析器单元测试
  console.log('[1/5] 验证 parseClaudeStreamLine 与 parseCliExtraArgs');
  assert.deepStrictEqual(parseCliExtraArgs('--max-turns 3 --append-system-prompt "hello world"'), [
    '--max-turns',
    '3',
    '--append-system-prompt',
    'hello world'
  ]);

  const evInit = parseClaudeStreamLine('{"type":"system","subtype":"init","model":"claude-sonnet-4-6","claude_code_version":"2.1.332"}');
  assert.deepStrictEqual(evInit, {
    kind: 'init',
    model: 'claude-sonnet-4-6',
    version: '2.1.332',
    sessionId: undefined,
    apiKeySource: undefined
  });

  const evThink = parseClaudeStreamLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"step 1"}}}');
  assert.deepStrictEqual(evThink, { kind: 'thinking_delta', thinking: 'step 1' });

  const evText = parseClaudeStreamLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}}');
  assert.deepStrictEqual(evText, { kind: 'text_delta', text: 'Hello' });

  const evErr = parseClaudeStreamLine('{"type":"assistant","is_api_error_message":true,"error":"authentication_failed","message":{"content":[{"type":"text","text":"Not logged in · Please run /login"}]}}');
  assert.strictEqual(evErr?.kind, 'assistant');
  assert.strictEqual(evErr.isApiError, true);
  assert.strictEqual(evErr.errorCode, 'authentication_failed');
  console.log('  -> [PASS] NDJSON 流式解析与参数解析正确');

  // 2. 真实探测本机安装的 Claude Code CLI
  console.log('\n[2/5] 探测本机 Claude Code CLI');
  const agents = await probeLocalAgents({ forceRefresh: true });
  const claude = agents.find((a) => a.id === 'claude');
  assert(claude, 'probeLocalAgents 必须包含 claude');
  assert.strictEqual(claude.installed, true, '本机应探测到已安装的 claude CLI');
  assert(claude.executablePath, '应返回 claude executablePath');
  assert(claude.version && claude.version.includes('Claude Code'), `版本号格式异常: ${claude.version}`);
  assert(claude.auth, '应返回结构化 auth 字段');
  assert(claude.candidateModels.includes('claude-sonnet-4-6'), '候选模型应包含 claude-sonnet-4-6');
  console.log(`  -> [PASS] 已探测到 Claude Code: ${claude.version}, path=${claude.executablePath}, status=${claude.status}, auth=${claude.auth?.label}`);

  // 3. 真实调用本机 Claude Code CLI（验证连通性与快速诊断，不卡死）
  console.log('\n[3/5] 执行本机 Claude Code CLI 真实调用 / 认证诊断');
  const t0 = Date.now();
  const realTest = await testLocalAgent('claude', 'claude-sonnet-4-6');
  const elapsed = Date.now() - t0;
  console.log(`  -> 耗时 ${elapsed}ms, result=`, realTest);
  assert(elapsed < 20000, `真实调用/诊断耗时过长 (${elapsed}ms)`);
  if (claude.status === 'ready') {
    assert.strictEqual(realTest.ok, true, `已认证状态下 testLocalAgent 应成功: ${realTest.error}`);
    assert.strictEqual(realTest.diagnosticCode, 'ready');
    assert(realTest.replyPreview && realTest.replyPreview.length > 0, '应返回真实回复预览');
  } else {
    assert.strictEqual(realTest.ok, false);
    assert.strictEqual(realTest.diagnosticCode, 'unauthenticated');
    assert(realTest.error && realTest.error.includes('claude auth login'), '未认证时应给出明确引导');
  }
  console.log('  -> [PASS] 本机 Claude Code CLI 实测行为与诊断符合预期');

  // 4. 端到端流式调用与配置覆写测试（使用可执行脚本桩模拟完整 API 响应流）
  console.log('\n[4/5] 验证 Claude Code 流式增量输出、思考分离与自定义网关/路径/目录参数传递');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'museclaw-claude-test-'));
  const mockClaudePath = path.join(tmpDir, 'mock-claude');
  const mockConfigDir = path.join(tmpDir, 'claude-home');
  fs.mkdirSync(mockConfigDir, { recursive: true });

  const mockScript = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('2.1.332 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'oauth', subscriptionType: 'Max', email: 'dev@example.com' }));
  process.exit(0);
}
let stdin = '';
process.stdin.on('data', d => stdin += d.toString());
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(path.join(tmpDir, 'captured.json'))}, JSON.stringify({
    args,
    stdin,
    cwd: process.cwd(),
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN
  }, null, 2));
  const events = [
    { type: 'system', subtype: 'init', model: 'claude-opus-4-6', claude_code_version: '2.1.332' },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Checking math. ' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK ' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '42' } } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'Checking math.' }, { type: 'text', text: 'OK 42' }] } },
    { type: 'result', is_error: false, result: 'OK 42', duration_ms: 12 }
  ];
  for (const ev of events) {
    process.stdout.write(JSON.stringify(ev) + '\\n');
  }
});
`;
  fs.writeFileSync(mockClaudePath, mockScript, { mode: 0o755 });

  const textChunks: string[] = [];
  const reasoningChunks: string[] = [];
  const caller = createLocalAgentCaller({
    id: 'claude',
    name: 'Claude Code',
    baseUrl: 'https://custom-anthropic.example.com',
    apiKey: 'sk-ant-test-999',
    model: 'claude-opus-4-6',
    binaryPath: mockClaudePath,
    configDir: mockConfigDir,
    cwd: tmpDir,
    extraArgs: '--max-turns 2',
    isLocalAgent: true
  });

  const callerRes = await caller(
    [{ role: 'user', content: 'What is 6*7?' }],
    [],
    (delta, rDelta) => {
      if (delta) textChunks.push(delta);
      if (rDelta) reasoningChunks.push(rDelta);
    }
  );

  assert.strictEqual(callerRes.content, 'OK 42');
  assert.strictEqual(callerRes.reasoning_content, 'Checking math.');
  assert.deepStrictEqual(textChunks, ['OK ', '42']);
  assert.deepStrictEqual(reasoningChunks, ['Checking math. ']);

  const captured = JSON.parse(fs.readFileSync(path.join(tmpDir, 'captured.json'), 'utf8'));
  assert(captured.args.includes('--include-partial-messages'), '必须传递 --include-partial-messages');
  assert(captured.args.includes('--strict-mcp-config'), '必须传递 --strict-mcp-config');
  assert(captured.args.includes('claude-opus-4-6'), '必须传递指定模型');
  assert(captured.args.includes('--max-turns'), '必须透传 extraArgs');
  assert.strictEqual(captured.CLAUDE_CONFIG_DIR, mockConfigDir);
  assert.strictEqual(captured.ANTHROPIC_BASE_URL, 'https://custom-anthropic.example.com');
  assert.strictEqual(captured.ANTHROPIC_API_KEY, 'sk-ant-test-999');
  assert.strictEqual(captured.ANTHROPIC_AUTH_TOKEN, 'sk-ant-test-999');
  assert.strictEqual(captured.cwd, tmpDir);

  const connRes = await testProviderConnection({
    id: 'claude',
    name: 'Claude Code',
    baseUrl: 'https://custom-anthropic.example.com',
    apiKey: 'sk-ant-test-999',
    model: 'claude-opus-4-6',
    binaryPath: mockClaudePath,
    configDir: mockConfigDir,
    isLocalAgent: true
  });
  assert.strictEqual(connRes.ok, true);
  assert.strictEqual(connRes.diagnosticCode, 'ready');
  assert.strictEqual(connRes.replyPreview, 'OK 42');
  console.log('  -> [PASS] 实时流式输出、思考剥离、自定义网关/路径/目录透传全部通过');

  // 5. ModelProviderStore 持久化与脱敏校验 + 远程节点聚合作业校验
  console.log('\n[5/5] 验证 ModelProviderStore 配置持久化、密钥脱敏与远程节点聚合');
  const tmpStorePath = path.join(tmpDir, 'models.json');
  const store = new ModelProviderStore(tmpStorePath);
  store.updateConfig({
    activeProviderId: 'claude',
    provider: {
      id: 'claude',
      model: 'claude-opus-4-6',
      baseUrl: 'https://custom-anthropic.example.com',
      apiKey: 'sk-ant-secret-abcdef',
      binaryPath: mockClaudePath,
      configDir: mockConfigDir,
      customModels: ['claude-custom-preview']
    }
  });

  const pub = await store.getPublicConfig(undefined, { forceRefresh: true });
  assert.strictEqual(pub.activeProviderId, 'claude');
  const pubClaude = pub.providers.find((p) => p.id === 'claude');
  assert(pubClaude, 'getPublicConfig 必须包含 claude');
  assert.strictEqual(pubClaude.apiKey, undefined, '不可向前端明文回传 apiKey');
  assert.strictEqual(pubClaude.hasKey, true);
  assert(pubClaude.maskedKey && pubClaude.maskedKey.includes('••••'), 'maskedKey 必须脱敏');
  assert(pubClaude.candidateModels?.includes('claude-custom-preview'), '自定义模型必须保留');
  assert.strictEqual(pubClaude.status, 'ready');

  // 模拟远程 Runner 注册 claude 运行时并测试聚合
  const reg = globalRunnerMesh.registerMachine({
    machineId: 'node_test_mac',
    hostname: 'test-macbook',
    platform: 'darwin',
    arch: 'arm64',
    userId: 'test_user_claude',
    runtimes: [
      {
        id: 'claude',
        name: 'Claude Code (本地 Agent)',
        version: '2.1.332 (Claude Code)',
        models: ['claude-sonnet-4-6', 'claude-opus-4-6'],
        defaultModel: 'claude-sonnet-4-6',
        status: 'ready',
        auth: { status: 'authenticated', method: 'oauth', label: 'Claude Max' }
      }
    ]
  });
  assert.strictEqual(reg.success, true);
  const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents('test_user_claude');
  const remoteClaude = remoteAgents.find((r) => r.id === 'claude');
  assert(remoteClaude, '远程计算节点应聚合 claude 运行时');
  assert.strictEqual(remoteClaude.source, 'remote');
  assert.strictEqual(remoteClaude.machineName, 'test-macbook');

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  -> [PASS] ModelProviderStore 与 RunnerMesh 聚合校验全部通过');

  // 6. 真实本机 Claude Code 流式对话调用校验
  if (claude.status === 'ready') {
    console.log('\n[6/7] 执行本机 Claude Code CLI 真实流式对话调用 (createLocalAgentCaller)');
    const liveChunks: string[] = [];
    const liveCaller = createLocalAgentCaller({
      id: 'claude',
      name: 'Claude Code',
      baseUrl: '',
      model: 'claude-sonnet-4-6',
      isLocalAgent: true
    });
    const tLive = Date.now();
    const liveRes = await liveCaller(
      [{ role: 'user', content: 'What is 12 + 30? Reply with just the number 42.' }],
      [],
      (delta) => {
        if (delta) liveChunks.push(delta);
      }
    );
    console.log(`  -> 耗时 ${Date.now() - tLive}ms, chunks=${liveChunks.length}, content=${JSON.stringify(liveRes.content)}`);
    assert(liveRes.content.includes('42'), `期望回复包含 42，实际: ${liveRes.content}`);
    assert(liveChunks.length >= 1, '期望收到流式文本分块');
    console.log('  -> [PASS] 真实本机 Claude Code 流式调用通过');
  } else {
    console.log('\n[6/7] 跳过真实流式对话（当前本机未认证）');
  }

  // 7. Gateway HTTP API 端到端检验 (独立临时端口 18799)
  console.log('\n[7/7] 验证 Gateway HTTP API 与安装脚本端点');
  const testPort = 18799;
  process.env.PORT = String(testPort);
  const { startGatewayServer } = await import('../apps/gateway/src/server.ts');
  const server = startGatewayServer(testPort);
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', () => resolve());
  });

  try {
    const base = `http://127.0.0.1:${testPort}`;
    const cfgRes = await fetch(`${base}/api/models/config?refresh=1`);
    assert.strictEqual(cfgRes.status, 200);
    const cfgJson = (await cfgRes.json()) as any;
    const httpClaude = cfgJson.providers?.find((p: any) => p.id === 'claude');
    assert(httpClaude, 'HTTP /api/models/config 必须返回 claude');
    assert.strictEqual(httpClaude.installed, true);
    assert.strictEqual(httpClaude.category, 'local_agent');

    const localAgentsRes = await fetch(`${base}/api/models/local-agents?refresh=1`);
    assert.strictEqual(localAgentsRes.status, 200);
    const localAgentsJson = (await localAgentsRes.json()) as any;
    assert(localAgentsJson.ok === true && Array.isArray(localAgentsJson.agents));
    assert(localAgentsJson.agents.some((a: any) => a.id === 'claude' && a.installed));

    const installShRes = await fetch(`${base}/runner/install.sh?token=demo`);
    assert.strictEqual(installShRes.status, 200);
    const installShText = await installShRes.text();
    assert(installShText.includes('/runner/client.js'));

    const installPs1Res = await fetch(`${base}/runner/install.ps1?token=demo`);
    assert.strictEqual(installPs1Res.status, 200);
    const installPs1Text = await installPs1Res.text();
    assert(installPs1Text.includes('Invoke-WebRequest'));

    const clientJsRes = await fetch(`${base}/runner/client.js`);
    assert.strictEqual(clientJsRes.status, 200);
    const clientJsText = await clientJsRes.text();
    assert(clientJsText.includes('Claude Code'));

    // 登录会话后验证 POST /api/models/test 连通性测试接口
    const loginRes = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `verify_claude_${Date.now()}`, displayName: 'VerifyClaude' })
    });
    const setCookie = loginRes.headers.get('set-cookie') || '';
    const cookieHeader = setCookie.split(';')[0];

    const testHttpRes = await fetch(`${base}/api/models/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      },
      body: JSON.stringify({ id: 'claude', providerId: 'claude', model: 'claude-sonnet-4-6' })
    });
    assert.strictEqual(testHttpRes.status, 200);
    const testHttpJson = (await testHttpRes.json()) as any;
    if (claude.status === 'ready') {
      assert.strictEqual(testHttpJson.ok, true, `HTTP /api/models/test 应成功: ${testHttpJson.error}`);
      assert.strictEqual(testHttpJson.diagnosticCode, 'ready');
      assert(testHttpJson.replyPreview && testHttpJson.replyPreview.length > 0, '应返回真实回复预览');
    } else {
      assert.strictEqual(typeof testHttpJson.ok, 'boolean');
      assert(testHttpJson.diagnosticCode, 'HTTP test 响应应包含 diagnosticCode');
    }
    console.log('  -> HTTP /api/models/test claude:', {
      ok: testHttpJson.ok,
      latencyMs: testHttpJson.latencyMs,
      version: testHttpJson.version,
      diagnosticCode: testHttpJson.diagnosticCode,
      replyPreview: testHttpJson.replyPreview
    });
    console.log('  -> [PASS] Gateway HTTP API 与伴侣脚本端点全部通过');
  } finally {
    server.close();
  }

  console.log('\n===============================================================');
  console.log('   🎉 Claude Code 本地 Agent 全链路验证 100% 通过！');
  console.log('===============================================================\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ 验证失败:', err);
  process.exit(1);
});
