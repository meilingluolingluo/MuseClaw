import assert from 'node:assert';
import { splitReasoningAndContent } from '../packages/sandbox-core/src/reasoning.ts';
import { SessionStore } from '../apps/gateway/bots/session-store.ts';
import fs from 'node:fs';
import path from 'node:path';

console.log('===============================================================');
console.log('   MUSECLAW 模型思考推理与正式答复分离验证测试');
console.log('===============================================================\n');

// Test 1: splitReasoningAndContent 基础分离逻辑
console.log('[Test 1] 验证 splitReasoningAndContent 多格式解析');
{
  // 1.1 标准 <think> 标签格式
  const r1 = splitReasoningAndContent('<think>Need to greet user politely</think>你好！我是数字员工。');
  assert.strictEqual(r1.content, '你好！我是数字员工。');
  assert.strictEqual(r1.reasoning, 'Need to greet user politely');

  // 1.2 Markdown 引用块思考格式
  const r2 = splitReasoningAndContent(
    '> 💭 **思考推理**：\n> The user just said "nihao".\n> Should be brief.\n\n你好！我是 Ducc，企业研发智能助手。'
  );
  assert.strictEqual(r2.content, '你好！我是 Ducc，企业研发智能助手。');
  assert.strictEqual(r2.reasoning, 'The user just said "nihao".\nShould be brief.');

  // 1.3 非引用块纯文本思考前缀
  const r3 = splitReasoningAndContent(
    '💭 思考推理：\nAnalyzing code changes.\n\n这是分析结果：没有发现潜在缺陷。'
  );
  assert.strictEqual(r3.content, '这是分析结果：没有发现潜在缺陷。');
  assert.strictEqual(r3.reasoning, 'Analyzing code changes.');

  // 1.4 未闭合的流式 <think> 尾部
  const r4 = splitReasoningAndContent('<think>Thinking in progress...');
  assert.strictEqual(r4.content, '');
  assert.strictEqual(r4.reasoning, 'Thinking in progress...');

  // 1.5 既有独立 reasoning 字段且正文中含有 think 标签的合并
  const r5 = splitReasoningAndContent('<think>Part 2</think>Clean answer', 'Part 1');
  assert.strictEqual(r5.content, 'Clean answer');
  assert.strictEqual(r5.reasoning, 'Part 1\n\nPart 2');

  console.log('  -> [PASS] 多种格式思考推理内容解析分离正确');
}

// Test 2: SessionStore 历史会话加载自动清洗
console.log('\n[Test 2] 验证 SessionStore 会话载入与持久化时自动清洗思考过程');
{
  const tmpDir = path.resolve(process.cwd(), 'data', `test_sessions_${Date.now()}`);
  fs.mkdirSync(path.join(tmpDir, 'test_user'), { recursive: true });

  const historicalData = [
    {
      id: 'sess_hist_1',
      bot_id: 'muse',
      userId: 'test_user',
      title: '测试历史会话',
      kind: 'side',
      created_at: Date.now(),
      updated_at: Date.now(),
      messages: [
        { role: 'user', content: 'nihao' },
        {
          role: 'assistant',
          content: '> 💭 **思考推理**：\n> Internal monologue here\n\n正式回答内容'
        }
      ]
    }
  ];

  fs.writeFileSync(
    path.join(tmpDir, 'test_user', 'sessions.json'),
    JSON.stringify(historicalData, null, 2),
    'utf-8'
  );

  const store = new SessionStore(tmpDir);
  const loadedSession = store.get('sess_hist_1', 'test_user');
  assert.ok(loadedSession, '必须成功载入历史会话');
  const assistantMsg = loadedSession.messages[1];
  assert.strictEqual(assistantMsg.content, '正式回答内容', '正文必须清洗为纯净回复');
  assert.strictEqual(assistantMsg.reasoning, 'Internal monologue here', '思考过程必须剥离至 reasoning 字段');

  // 清理临时测试目录
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('  -> [PASS] 历史持久化会话载入时成功无损剥离思考推理');
}

console.log('\n===============================================================');
console.log('   🎉 思考推理分离全链路验证 100% 通过！');
console.log('===============================================================\n');
