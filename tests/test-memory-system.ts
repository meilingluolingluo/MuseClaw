import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { BotMemoryManager } from '../apps/gateway/bots/memory.ts';
import {
  parseMemoryMarkdown,
  calculateMemoryStats,
  insertItemToMarkdown,
  updateItemInMarkdown,
  deleteItemFromMarkdown,
  similarity,
  tokenize,
  noNewEntities,
  planConsolidation,
  applyConsolidation
} from '../apps/gateway/bots/consolidate.ts';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';

async function runTests() {
  console.log('🧪 开始长期受控记忆系统自动化集成测试...\n');

  // 1. 测试分词与相似度计算
  console.log('1️⃣ 测试 CJK 与英文分词及 Jaccard 相似度...');
  const tokens1 = tokenize('工作日 18:00 巡检未提交 Git 代码');
  assert(tokens1.size > 0, 'CJK 分词应包含二元分词与英文单词');
  assert(tokens1.has('git'), '英文单词应转为小写');
  assert(tokens1.has('工作'), '应提取中文二元分词');

  const sim1 = similarity('工作日 18:00 巡检未提交 Git 代码', '工作日 18:00 检查 Git 仓库未提交文件');
  assert(sim1 > 0.3, `相似度应大于 0.3，实际为: ${sim1}`);
  console.log(`   ✓ 分词与相似度测试通过 (相似度: ${sim1.toFixed(3)})`);

  // 2. 测试 Markdown 结构化解析与分类识别
  console.log('\n2️⃣ 测试结构化 Markdown 解析与类别划分...');
  const sampleMarkdown = `# OpsBot 运维专员记忆与准则
## 用户画像与核心身份 (Profile)
- 专职企业环境监控与运维管理 [user]

## 偏好与工作习惯 (Preferences)
- 优先输出中文结论并附带关键指标

## 业务约束与红线 (Constraints)
- 严禁未经授权重启生产容器 [user]
`;

  const { items } = parseMemoryMarkdown(sampleMarkdown);
  assert.strictEqual(items.length, 3, `应解析出 3 条事实，实际为: ${items.length}`);

  const profileItem = items.find((i) => i.category === 'profile');
  assert(profileItem, '应识别出 profile 类别事实');
  assert.strictEqual(profileItem?.source, 'user');
  assert.strictEqual(profileItem?.protected, true);
  assert(!profileItem?.content.includes('[user]'), 'content 中应剥离 [user] 标签以供界面整洁展示');

  const prefItem = items.find((i) => i.category === 'preference');
  assert(prefItem, '应识别出 preference 类别事实');
  assert.strictEqual(prefItem?.source, 'agent');
  assert.strictEqual(prefItem?.protected, false);

  const constrItem = items.find((i) => i.category === 'constraint');
  assert(constrItem, '应识别出 constraint 类别事实');
  assert.strictEqual(constrItem?.source, 'user');
  console.log('   ✓ 结构化解析与类别识别通过');

  // 3. 测试记忆库健康指标与预算压力计算
  console.log('\n3️⃣ 测试记忆容量与预算健康度指标计算...');
  const stats = calculateMemoryStats(sampleMarkdown, items);
  assert.strictEqual(stats.itemCount, 3);
  assert.strictEqual(stats.userAnchorCount, 2);
  assert.strictEqual(stats.agentItemCount, 1);
  assert.strictEqual(stats.status, 'healthy');
  assert(stats.totalBytes > 0);
  assert(stats.usagePercent < 60);
  console.log(`   ✓ 指标计算通过 (容量占用: ${stats.totalBytes}B, 使用率: ${stats.usagePercent}%, 状态: ${stats.status})`);

  // 4. 测试单条事实增删改
  console.log('\n4️⃣ 测试单条事实插入、就地更新与删除...');
  const insertedMd = insertItemToMarkdown(
    sampleMarkdown,
    '工作日 09:00 例行巡检集群磁盘空间',
    'routine',
    false
  );
  const parsedAfterInsert = parseMemoryMarkdown(insertedMd);
  assert.strictEqual(parsedAfterInsert.items.length, 4, '插入后应为 4 条事实');
  const routineItem = parsedAfterInsert.items.find((i) => i.category === 'routine');
  assert(routineItem, '新插入的事实应位于 routine 分类下');

  const { newMarkdown: updatedMd } = updateItemInMarkdown(
    insertedMd,
    routineItem!.id,
    '工作日 09:30 例行巡检集群磁盘与内存',
    'routine'
  );
  const parsedAfterUpdate = parseMemoryMarkdown(updatedMd);
  assert(
    parsedAfterUpdate.items.some((i) => i.content.includes('09:30 例行巡检集群磁盘与内存')),
    '内容应已就地更新'
  );

  const { newMarkdown: deletedMd } = deleteItemFromMarkdown(updatedMd, routineItem!.id);
  const parsedAfterDelete = parseMemoryMarkdown(deletedMd);
  assert.strictEqual(parsedAfterDelete.items.length, 3, '删除后应恢复为 3 条事实');
  console.log('   ✓ 事实增删改单元测试通过');

  // 5. 测试防幻觉与自整理保护硬拦截
  console.log('\n5️⃣ 测试受控自整理死线审查 (防幻觉与用户锚点保护)...');
  const testItems = [
    { id: 'm_1', content: '小明住在北京市朝阳区', source: 'user' as const, category: 'profile' as const, protected: true, rawLine: '- 小明住在北京市朝阳区 [user]', prefix: '- ' },
    { id: 'm_2', content: '小明在海淀区工作', source: 'agent' as const, category: 'profile' as const, protected: false, rawLine: '- 小明在海淀区工作', prefix: '- ' },
    { id: 'm_3', content: '一次性临时调试已结束', source: 'agent' as const, category: 'general' as const, protected: false, rawLine: '- 一次性临时调试已结束', prefix: '- ' }
  ];

  // 实体守恒检验
  assert.strictEqual(
    noNewEntities('小明住在北京并工作于海淀区', [testItems[0], testItems[1]]),
    true,
    '使用已有实体与合规过渡词应通过'
  );
  assert.strictEqual(
    noNewEntities('小明在阿里巴巴杭州园区工作', [testItems[0], testItems[1]]),
    false,
    '捏造未经提及的新实体（阿里巴巴、杭州）应被拦截'
  );

  // 提议规划审查 (测试用户声明不可 drop)
  const illegalProposals = [
    { op: 'drop', id: 'm_1' }, // 企图删除 [user] 锚点
    { op: 'drop', id: 'm_3' }  // 删除普通 agent 碎片
  ];

  const plan = planConsolidation(testItems, illegalProposals, 0.5);
  assert(
    plan.skipped.some((s) => s.includes('严禁删除用户核心声明')),
    '应成功拦截针对用户声明的删除提议'
  );
  assert.strictEqual(plan.ops.length, 1, '仅合法 agent 碎片 drop 应被采纳');
  assert.strictEqual(plan.ops[0].items[0].id, 'm_3');
  console.log('   ✓ 防幻觉与用户锚点硬拦截审查通过');

  // 6. 测试沙箱 memory 工具 (Autonomous Agent Tool)
  console.log('\n6️⃣ 测试沙箱内置 memory 工具 (recall / remember / forget)...');
  const tempTestDir = path.resolve(process.cwd(), 'data/test_memory_users');
  if (fs.existsSync(tempTestDir)) {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  }

  const manager = new BotMemoryManager(tempTestDir);
  const memoryTools = createDefaultTools({
    memoryProvider: {
      getMemory: (botId, userId) => manager.getMemory(botId, userId || 'test_user'),
      addItem: (botId, content, category, isUser, userId) =>
        manager.addMemoryItem(botId, content, category as any, isUser ?? false, userId || 'test_user'),
      search: (botId, query, userId, options) => manager.searchMemory(botId, query, userId || 'test_user', options),
      deleteItem: (botId, itemId, userId) => manager.deleteMemoryItem(botId, itemId, userId || 'test_user', true)
    }
  });

  const memTool = memoryTools.find((t) => t.name === 'memory');
  assert(memTool, 'sandbox-core 工具集中应注册 memory 工具');

  const testContext = { userId: 'test_user', botId: 'test_bot' };

  // Agent 执行 remember
  const remRes = await memTool.execute({
    action: 'remember',
    botId: 'test_bot',
    content: '测试环境网关端口为 8799',
    category: 'general'
  }, testContext);
  assert(remRes.success, 'Agent remember 应执行成功');

  // Agent 执行 recall
  const recRes = await memTool.execute({
    action: 'recall',
    botId: 'test_bot',
    query: '网关端口'
  }, testContext);
  assert(recRes.matchedCount > 0, 'Agent recall 应能检索到刚才沉淀的事实');
  assert(recRes.facts[0].content.includes('8799'));

  // 6.1 验证多关键词、分类语义与用户标识 recall 召回
  await memTool.execute({
    action: 'remember',
    botId: 'test_bot',
    content: '用户习惯中文简洁回复，优先输出代码',
    category: 'preference'
  }, testContext);
  await memTool.execute({
    action: 'remember',
    botId: 'test_bot',
    content: '企业系统架构核心协调员',
    category: 'profile'
  }, testContext);

  const catRec = await memTool.execute({
    action: 'recall',
    botId: 'test_bot',
    query: '偏好'
  }, testContext);
  assert(catRec.matchedCount > 0, '按分类词“偏好”检索应成功召回 preference 类事实');
  assert(catRec.facts.some((f: any) => f.content.includes('简洁回复')));

  const multiRec = await memTool.execute({
    action: 'recall',
    botId: 'test_bot',
    query: '用户画像 身份 偏好 习惯 约束 人物 例行'
  }, testContext);
  assert(multiRec.matchedCount >= 2, '复合多领域分类词检索应成功召回所有关联分类记忆');

  const userRec = await memTool.execute({
    action: 'recall',
    botId: 'test_bot',
    query: 'test_user'
  }, testContext);
  assert(userRec.matchedCount >= 2, '按目标用户名检索应成功返回该用户空间下的持久化记忆');

  const allRec = await memTool.execute({
    action: 'recall',
    botId: 'test_bot',
    query: ''
  }, testContext);
  assert(allRec.matchedCount >= 3, '空查询词或 all 应返回当前全部受控记忆条目');
  assert(allRec.memory.length > 0, '返回结构中必须包含完整的原始 MEMORY.md 文本');

  // Agent 执行 forget
  const forRes = await memTool.execute({
    action: 'forget',
    botId: 'test_bot',
    query: recRes.facts[0].id
  }, testContext);
  assert(forRes.success, 'Agent forget 应执行成功');

  // 清理测试目录
  if (fs.existsSync(tempTestDir)) {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  }
  console.log('   ✓ 沙箱 Agent memory 工具测试通过');

  console.log('\n🎉 所有记忆系统自动化单元与沙箱工具测试全部通过！');
}

runTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
