import assert from 'node:assert';
import { probeLocalAgents } from '../packages/sandbox-core/src/local-agent-prober.ts';
import { globalModelStore } from '../apps/gateway/bots/provider-store.ts';
import { resolveApiKey } from '../packages/sandbox-core/src/llm.ts';

async function run() {
  console.log('===============================================================');
  console.log('   MUSECLAW 本地 Ollama 真实状态检测与就绪判断验收测试');
  console.log('===============================================================\n');

  // Test 1: 校验 resolveApiKey 不再虚构返回 dummy key
  console.log('[Test 1] 校验 resolveApiKey(undefined, "ollama")');
  const emptyKey = resolveApiKey(undefined, 'ollama');
  assert.strictEqual(emptyKey, '', '未配置 Key 时 resolveApiKey 必须返回空字符串');
  console.log('  -> [PASS] 未配置凭证时正确返回空字符串，避免状态误判为 hasKey=true');

  // Test 2: 校验本地探针对未安装 Ollama 的检测
  console.log('\n[Test 2] 校验核心探针 probeLocalAgents() 对 Ollama 的检测');
  const agents = await probeLocalAgents();
  const ollama = agents.find((a) => a.id === 'ollama');
  assert(ollama, '必须包含 ollama 探针项');
  assert.strictEqual(ollama.installed, false, '未安装 Ollama 时 installed 必须为 false');
  assert.strictEqual(ollama.isAvailable, false, '未运行 Ollama 时 isAvailable 必须为 false');
  console.log(`  -> [PASS] 本地探针正确识别: installed=${ollama.installed}, isAvailable=${ollama.isAvailable}`);

  // Test 3: 校验网关 getPublicConfig 对 Ollama 的状态合并
  console.log('\n[Test 3] 校验 getPublicConfig() 中 Ollama 的状态属性');
  const config = await globalModelStore.getPublicConfig();
  const ollamaConfig = config.providers.find((p) => p.id === 'ollama');
  assert(ollamaConfig, '配置列表必须包含 ollama');
  assert.strictEqual(ollamaConfig.isLocalAgent, true, 'isLocalAgent 必须为 true');
  assert.strictEqual(ollamaConfig.installed, false, '未安装 Ollama 时 installed 必须为 false');
  assert.strictEqual(ollamaConfig.isAvailable, false, '未运行 Ollama 时 isAvailable 必须为 false');
  assert.strictEqual(ollamaConfig.hasKey, false, '未就绪 Ollama 的 hasKey 必须为 false');
  assert.strictEqual(ollamaConfig.maskedKey, '未检测到', '未检测到时 maskedKey 必须为 "未检测到"');
  console.log(`  -> [PASS] 网关状态配置正确: isLocalAgent=true, installed=false, hasKey=false, maskedKey=${ollamaConfig.maskedKey}`);

  // Test 4: 校验连通性测试针对未运行服务的响应
  console.log('\n[Test 4] 校验 testProvider({ id: "ollama" }) 失败拦截与友好提示');
  const testRes = await globalModelStore.testProvider({ id: 'ollama' });
  assert.strictEqual(testRes.ok, false, '未运行服务时连通性测试必须返回 ok=false');
  assert(testRes.error && testRes.error.includes('11434'), '错误信息必须提示 11434 端口未响应');
  console.log(`  -> [PASS] 连通性测试拦截正确: ok=false, error="${testRes.error}"`);

  console.log('\n===============================================================');
  console.log('   🎉 本地 Ollama 状态探测与配置界面显示逻辑 100% 验收通过！');
  console.log('===============================================================\n');
}

run().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
