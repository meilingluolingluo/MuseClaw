import {
  probeLocalAgents,
  discoverDuccModels,
  discoverDucxModels,
  runLocalAgent,
  createLocalAgentCaller
} from '../packages/sandbox-core/src/index.ts';
import { ModelProviderStore } from '../apps/gateway/bots/provider-store.ts';

async function main() {
  console.log('=== Step 1: 探测本地 ducc 与 ducx 运行状态 ===');
  const agents = await probeLocalAgents();
  const ducc = agents.find((a) => a.id === 'ducc');
  const ducx = agents.find((a) => a.id === 'ducx');

  console.log('ducc probe:', ducc);
  console.log('ducx probe:', ducx);

  if (!ducc?.installed && !ducx?.installed) {
    console.log('⚠️ 本机环境未安装 ducc / ducx 本地命令行工具，优雅跳过环境依赖型集成测试 (非代码缺陷)');
    return;
  }
  if (!ducc?.installed) {
    throw new Error('ducc 未被识别为 installed');
  }
  if (!ducx?.installed) {
    throw new Error('ducx 未被识别为 installed');
  }

  console.log('\n=== Step 2: 动态模型发现 ===');
  const duccModels = discoverDuccModels();
  console.log('ducc models count:', duccModels.models.length, 'default:', duccModels.defaultModel);
  const ducxModels = discoverDucxModels();
  console.log('ducx models count:', ducxModels.models.length, 'default:', ducxModels.defaultModel);

  if (duccModels.models.length === 0 || !duccModels.defaultModel) {
    throw new Error('ducc 模型发现失败');
  }
  if (ducxModels.models.length === 0 || !ducxModels.defaultModel) {
    throw new Error('ducx 模型发现失败');
  }

  console.log('\n=== Step 3: ProviderStore 公开配置与解析 ===');
  const store = new ModelProviderStore();
  const publicConfig = await store.getPublicConfig();
  const pDucc = publicConfig.providers.find((p) => p.id === 'ducc');
  const pDucx = publicConfig.providers.find((p) => p.id === 'ducx');

  console.log('ProviderStore ducc:', {
    id: pDucc?.id,
    installed: pDucc?.installed,
    version: pDucc?.version,
    model: pDucc?.model,
    candidateCount: pDucc?.candidateModels?.length
  });
  console.log('ProviderStore ducx:', {
    id: pDucx?.id,
    installed: pDucx?.installed,
    version: pDucx?.version,
    model: pDucx?.model,
    candidateCount: pDucx?.candidateModels?.length
  });

  if (!pDucc?.installed || !pDucx?.installed) {
    throw new Error('ProviderStore 未正确标注 ducc 或 ducx 为 installed');
  }

  console.log('\n=== Step 4: 运行 ducc 调用 (带流式 onChunk) ===');
  const duccStart = Date.now();
  let duccChunks: string[] = [];
  const duccCaller = createLocalAgentCaller({
    id: 'ducc',
    name: 'Baidu CC',
    baseUrl: 'local://ducc',
    model: duccModels.defaultModel,
    isLocalAgent: true
  });

  const duccRes = await duccCaller(
    [{ role: 'user', content: '请只回复数字 12345' }],
    [],
    (chunk) => {
      duccChunks.push(chunk);
    }
  );
  console.log(`ducc 执行成功 (${Date.now() - duccStart}ms):`, duccRes.content);
  console.log('ducc received chunks count:', duccChunks.length);

  console.log('\n=== Step 5: 运行 ducx 调用 (带流式 onChunk) ===');
  const ducxStart = Date.now();
  let ducxChunks: string[] = [];
  const ducxCaller = createLocalAgentCaller({
    id: 'ducx',
    name: 'Baidu CX',
    baseUrl: 'local://ducx',
    model: ducxModels.defaultModel,
    isLocalAgent: true
  });

  const ducxRes = await ducxCaller(
    [{ role: 'user', content: '请只回复数字 67890' }],
    [],
    (chunk) => {
      ducxChunks.push(chunk);
    }
  );
  console.log(`ducx 执行成功 (${Date.now() - ducxStart}ms):`, ducxRes.content);
  console.log('ducx received chunks count:', ducxChunks.length);

  console.log('\n🎉 ALL DUCC & DUCX INTEGRATION VERIFICATIONS PASSED!');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
