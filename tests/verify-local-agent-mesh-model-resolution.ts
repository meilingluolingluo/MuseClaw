import assert from 'node:assert';
import {
  resolveModelAlias,
  testLocalAgent,
  testProviderConnection,
  discoverPiModels,
  globalRunnerMesh
} from '../packages/sandbox-core/src/index.ts';

async function main() {
  console.log('===============================================================');
  console.log('   测试 Local Agent 模型别名解析、真实探测与 Runner 连通性校验');
  console.log('===============================================================');

  // 1. 验证 resolveModelAlias 逻辑
  console.log('\n[Test 1] 验证 resolveModelAlias 模糊与系列族自动归一化');
  const available = [
    'Opus 5.5-baidu-oneapi',
    'Claude Sonnet 5.5-baidu-oneapi',
    'DeepSeek-V4.1-Flash-baidu-oneapi',
    'gpt-6.1-sol-baidu-oneapi'
  ];

  const matchedExact = resolveModelAlias('DeepSeek-V4.1-Flash-baidu-oneapi', available);
  assert.strictEqual(matchedExact, 'DeepSeek-V4.1-Flash-baidu-oneapi');
  console.log('  -> 精确匹配正确');

  const matchedDeepseek = resolveModelAlias('deepseek/deepseek-chat', available);
  assert.strictEqual(matchedDeepseek, 'DeepSeek-V4.1-Flash-baidu-oneapi');
  console.log('  -> deepseek/deepseek-chat 自动映射至:', matchedDeepseek);

  const matchedSonnet = resolveModelAlias('anthropic/claude-3-7-sonnet', available);
  assert.strictEqual(matchedSonnet, 'Claude Sonnet 5.5-baidu-oneapi');
  console.log('  -> anthropic/claude-3-7-sonnet 自动映射至:', matchedSonnet);

  const matchedOpus = resolveModelAlias('claude-3-opus', available);
  assert.strictEqual(matchedOpus, 'Opus 5.5-baidu-oneapi');
  console.log('  -> claude-3-opus 自动映射至:', matchedOpus);

  const matchedFallback = resolveModelAlias('unknown-model-xyz', available, 'Opus 5.5-baidu-oneapi');
  assert.strictEqual(matchedFallback, 'Opus 5.5-baidu-oneapi');
  console.log('  -> 未知模型安全回退至默认模型');

  // 2. 验证 discoverPiModels 不会向已配置真实模型的列表中盲目注入 fallback 幽灵模型
  console.log('\n[Test 2] 验证 discoverPiModels 真实模型发现与幽灵模型隔离');
  const piInfo = discoverPiModels();
  console.log('  -> 本地探测到的 Pi 模型数量:', piInfo.models.length);
  // 如果机器存在 ~/.pi/agent/models.json，检查是否已过滤未配置的 openrouter 假模型
  if (piInfo.models.some((m) => m.includes('baidu-oneapi'))) {
    assert(!piInfo.models.includes('deepseek/deepseek-chat'), '已配置模型的环境中不应包含未配置的 openrouter deepseek/deepseek-chat');
    console.log('  -> [PASS] 成功隔离未配置的幽灵模型');
  }

  // 3. 验证 testLocalAgent 与 testProviderConnection 探针
  console.log('\n[Test 3] 验证 testLocalAgent 真实探针执行');
  const liveTestResult = await testLocalAgent('pi', 'DeepSeek-V4.1-Flash-baidu-oneapi');
  console.log('  -> 真实探针调用结果:', liveTestResult);
  assert.strictEqual(liveTestResult.ok, true, '可执行环境下的真实可用模型探针应返回成功');

  // 4. 验证 testProviderConnection 桥接
  console.log('\n[Test 4] 验证 testProviderConnection 连通性测试透传');
  const connResult = await testProviderConnection({
    id: 'pi',
    name: 'Pi Coding Agent',
    baseUrl: '',
    model: 'DeepSeek-V4.1-Flash-baidu-oneapi',
    isLocalAgent: true
  });
  console.log('  -> testProviderConnection 结果:', connResult);
  assert.strictEqual(connResult.ok, true);

  console.log('\n✅ 所有测试通过！');
}

main().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
