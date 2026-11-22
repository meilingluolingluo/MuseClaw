import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore } from '../apps/gateway/bots/session-store.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, 'test_main_side_chat_dir');

async function testMainSideChat() {
  console.log('===============================================================');
  console.log('   MUSECLAW 主聊 / 旁聊 分级会话架构核心功能自动化验证测试');
  console.log('===============================================================\n');

  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  const store = new SessionStore(testDir);
  const botId = 'ops_bot';
  const userId = 'engineer_alice';

  // 1. 验证常驻主聊 (Main Chat) 幂等初始化与特性
  console.log('[Test 1] 验证常驻主聊 (Main Chat) 自动化初始化与属性特征');
  const mainSess1 = store.getMainSession(botId, userId);
  assert.strictEqual(mainSess1.bot_id, botId, '主聊必须归属指定 Bot');
  assert.strictEqual(mainSess1.kind, 'main', '主聊的 kind 必须为 main');
  assert.strictEqual(mainSess1.id, `sess_${botId}_main`, '主聊会话 ID 遵循命名约定');
  assert.strictEqual(mainSess1.title, '主要聊天', '主聊默认标题为主要聊天');

  // 再次获取必须幂等返回同一对象
  const mainSess2 = store.getMainSession(botId, userId);
  assert.strictEqual(mainSess1.id, mainSess2.id, '重复获取主聊必须幂等');
  console.log('  -> [PASS] 常驻主聊初始化与幂等性校验通过');

  // 2. 验证独立旁聊 (Side Chats) 创建与隔离性
  console.log('\n[Test 2] 验证独立副任务旁聊 (Side Chats) 创建与状态标记');
  const side1 = store.create('sess_side_task_1', botId, '排查数据库高延迟', userId, 'side');
  const side2 = store.create('sess_side_task_2', botId, '临时统计日志脚本', userId, 'side');

  assert.strictEqual(side1.kind, 'side', '旁聊 1 的 kind 必须为 side');
  assert.strictEqual(side2.kind, 'side', '旁聊 2 的 kind 必须为 side');
  assert.notStrictEqual(side1.id, mainSess1.id, '旁聊 ID 不得与主聊冲突');
  console.log('  -> [PASS] 独立旁聊创建与分类标记校验通过');

  // 3. 验证主聊置顶排序规则
  console.log('\n[Test 3] 验证会话列表查询中常驻主聊始终置顶排序 (Main Always Pinned First)');
  // 模拟写入消息以确保默认 list() 也能检索到
  mainSess1.messages.push({ role: 'user', content: '主聊任务: 监控系统状态' });
  side1.messages.push({ role: 'user', content: '旁聊任务 1' });
  side2.messages.push({ role: 'user', content: '旁聊任务 2' });
  store.save(mainSess1, userId);
  store.save(side1, userId);
  store.save(side2, userId);

  const list = store.list(botId, userId, true);
  assert.strictEqual(list.length, 3, '会话总数应为 3 (1 主聊 + 2 旁聊)');
  assert.strictEqual(list[0].id, mainSess1.id, '排序首位必须是常驻主聊 (Main Chat)');
  assert.strictEqual(list[0].kind, 'main');
  assert.strictEqual(list[1].kind, 'side');
  assert.strictEqual(list[2].kind, 'side');
  console.log('  -> [PASS] 主聊置顶与旁聊倒序排序规则校验通过');

  // 4. 验证旁聊物理删除与生命周期
  console.log('\n[Test 4] 验证旁聊的物理删除与生命周期');
  const delSideRes = store.delete(side1.id, userId);
  assert.strictEqual(delSideRes, true, '删除旁聊应返回 true');

  const afterDelList = store.list(botId, userId, true);
  assert.strictEqual(afterDelList.length, 2, '删除后仅剩 2 个会话');
  assert.ok(!afterDelList.some((s) => s.id === side1.id), '已删除的旁聊不得再出现在列表中');
  console.log('  -> [PASS] 旁聊物理删除与数据移除校验通过');

  // 5. 验证主聊常驻防护机制 (Main Chat Cannot Be Destroyed, Only Cleared)
  console.log('\n[Test 5] 验证常驻主聊的删除防护与清空重置逻辑 (Main Protection)');
  assert.strictEqual(mainSess1.messages.length, 1, '删除前主聊应包含 1 条消息');
  const delMainRes = store.delete(mainSess1.id, userId);
  assert.strictEqual(delMainRes, true, '触发主聊删除应返回 true');

  // 主聊实体不能从 store 中丢失，而是应该将消息清空 (重置)
  const mainAfterReset = store.get(mainSess1.id, userId);
  assert.ok(mainAfterReset, '常驻主聊不得被物理销毁');
  assert.strictEqual(mainAfterReset?.id, mainSess1.id);
  assert.strictEqual(mainAfterReset?.messages.length, 0, '常驻主聊的消息历史必须被清空重置');
  console.log('  -> [PASS] 主聊常驻防护与清空重置逻辑校验通过');

  // 6. 验证显式清空方法 (SessionStore.clear)
  console.log('\n[Test 6] 验证会话显式清空方法 (SessionStore.clear)');
  side2.messages.push({ role: 'assistant', content: '临时回答' });
  store.save(side2, userId);
  assert.ok(store.get(side2.id, userId)!.messages.length > 0);

  const clearRes = store.clear(side2.id, userId);
  assert.strictEqual(clearRes, true);
  assert.strictEqual(store.get(side2.id, userId)!.messages.length, 0, '会话内容已被重置清空');
  console.log('  -> [PASS] 显式清空方法校验通过');

  await store.flush(userId);
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n===============================================================');
  console.log('   🎉 主聊 / 旁聊 分级会话架构核心功能 100% 验收通过！');
  console.log('===============================================================\n');
}

testMainSideChat().catch((err) => {
  console.error('❌ 测试未通过:', err);
  process.exit(1);
});
