import assert from 'node:assert';
import { probeLocalAgents } from '../packages/sandbox-core/src/local-agent-prober.ts';
import { testLocalAgent } from '../packages/sandbox-core/src/local-agent-runner.ts';

async function run() {
  console.log('===============================================================');
  console.log('   MUSECLAW 本地 Agent (Codex / Pi / DSH) 自动探针验收测试');
  console.log('===============================================================\n');

  // Test 1: 校验 probeLocalAgents()
  console.log('[Test 1] 校验核心探针 probeLocalAgents() 扫描结果');
  const agents = await probeLocalAgents();
  assert(Array.isArray(agents), 'agents 必须是数组');
  assert(agents.length >= 4, '至少包含 4 个本地运行时候选');

  const codex = agents.find(a => a.id === 'codex');
  const pi = agents.find(a => a.id === 'pi');
  const dsh = agents.find(a => a.id === 'dsh');
  const ollama = agents.find(a => a.id === 'ollama');

  assert(codex, '必须包含 codex');
  assert(pi, '必须包含 pi');
  assert(dsh, '必须包含 dsh');
  assert(ollama, '必须包含 ollama');

  console.log(`  -> 探测结果: codex(installed=${codex.installed}, ver=${codex.version})`);
  console.log(`  -> 探测结果: pi(installed=${pi.installed}, ver=${pi.version})`);
  console.log(`  -> 探测结果: dsh(installed=${dsh.installed}, ver=${dsh.version})`);
  console.log('  -> [PASS] 本地探针结构解析正确\n');

  // Test 2: 校验 testLocalAgent 延迟探针
  console.log('[Test 2] 校验 testLocalAgent 响应延迟探针');
  if (codex.installed) {
    const codexTest = await testLocalAgent('codex');
    assert(codexTest.ok, 'codex 测试应成功');
    assert(codexTest.latencyMs >= 0, '延迟应 >= 0');
    console.log(`  -> [PASS] codex 延迟探针测试成功 (${codexTest.latencyMs}ms, ${codexTest.version})`);
  }
  if (pi.installed) {
    const piTest = await testLocalAgent('pi');
    assert(piTest.ok, 'pi 测试应成功');
    console.log(`  -> [PASS] pi 延迟探针测试成功 (${piTest.latencyMs}ms, ${piTest.version})`);
  }
  if (dsh.installed) {
    const dshTest = await testLocalAgent('dsh');
    assert(dshTest.ok, 'dsh 测试应成功');
    console.log(`  -> [PASS] dsh 延迟探针测试成功 (${dshTest.latencyMs}ms, ${dshTest.version})`);
  }

  // Test 3: 校验网关 REST API: GET /api/models/local-agents
  console.log('\n[Test 3] 校验网关 REST API: GET /api/models/local-agents');
  const res = await fetch('http://localhost:8799/api/models/local-agents');
  assert.strictEqual(res.status, 200, '网关必须返回 200');
  const body = await res.json();
  assert(body.ok === true, 'body.ok 必须为 true');
  assert(Array.isArray(body.agents), 'body.agents 必须为数组');
  console.log(`  -> [PASS] 网关接口响应就绪，返回 ${body.agents.length} 个 Agent 探针项`);

  // Test 4: 校验 /api/models/config 综合状态合并
  console.log('\n[Test 4] 校验 /api/models/config 本地 Agent 状态合并与指示徽标');
  const configRes = await fetch('http://localhost:8799/api/models/config');
  const configData = await configRes.json();
  const configCodex = configData.providers.find((p: any) => p.id === 'codex');
  assert(configCodex, '配置列表必须包含 codex');
  assert.strictEqual(configCodex.isLocalAgent, true, 'isLocalAgent 必须为 true');
  console.log(`  -> [PASS] 状态合并正常: codex isLocalAgent=true, hasKey=${configCodex.hasKey}, version=${configCodex.version}`);

  console.log('\n===============================================================');
  console.log('   🎉 本地 Agent 探针与多模型接入体系 100% 验收通过！');
  console.log('===============================================================\n');
}

run().catch((err) => {
  console.error('测试未通过:', err);
  process.exit(1);
});
