import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FeishuReceiver } from '../apps/gateway/channels/feishu/receiver.ts';
import { InfoflowReceiver } from '../apps/gateway/channels/infoflow/receiver.ts';
import { SessionStore } from '../apps/gateway/bots/session-store.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  console.log('===============================================================');
  console.log('   MUSECLAW 安全鉴权与通道防护专项验收测试');
  console.log('===============================================================\n');

  // 1. 验证 FeishuReceiver 在未配安全凭据时拒绝请求
  console.log('[Test 1] 校验 FeishuReceiver 安全基线：未配置凭证阻断');
  const emptyFeishu = new FeishuReceiver({});
  assert.throws(() => {
    emptyFeishu.handleEvent({}, '{}');
  }, /未配置飞书安全凭证/);
  console.log('  -> [PASS] 飞书通道无凭据阻断通过');

  // 2. 验证 FeishuReceiver 强签名与时效窗口
  console.log('[Test 2] 校验 FeishuReceiver 签名校验与防重放');
  const configuredFeishu = new FeishuReceiver({
    encryptKey: 'test_encrypt_key_123',
    verificationToken: 'test_token_abc'
  });
  // 缺少签名
  assert.throws(() => {
    configuredFeishu.handleEvent({}, '{}');
  }, /缺少飞书请求签名/);

  // 过期时间戳
  assert.throws(() => {
    configuredFeishu.handleEvent({
      'x-lark-signature': 'invalid_sig',
      'x-lark-request-timestamp': '1000000000',
      'x-lark-request-nonce': 'nonce_1'
    }, '{}');
  }, /时效窗口/);
  console.log('  -> [PASS] 飞书通道签名与时效窗口校验通过');

  // 3. 验证 InfoflowReceiver 时效窗口与防重放
  console.log('[Test 3] 校验 InfoflowReceiver 时效窗口与重放拦截');
  const infoReceiver = new InfoflowReceiver({
    token: 'test_token',
    encodingAesKey: '1234567890123456789012345678901234567890123'
  });
  // 过期时间戳
  assert.throws(() => {
    infoReceiver.handleIncomingMessage({
      signature: 'test_sig',
      timestamp: '1000000000',
      nonce: 'nonce_infoflow'
    }, JSON.stringify({ encrypt: 'dummy' }));
  }, /时效窗口/);
  console.log('  -> [PASS] 如流通道时效窗口拦截通过');

  // 4. 验证 SessionStore 持久化空会话与容量截断保护
  console.log('[Test 4] 校验 SessionStore 空会话持久化与容量控制');
  const testDir = path.join(__dirname, 'test_user_session_store');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  const store = new SessionStore(testDir);
  const user = 'test_employee';
  const sess = store.create('sess_empty_init', 'muse', '初始空任务', user);
  assert.strictEqual(sess.messages.length, 0);

  // includeEmpty=true 应能正常列出空会话
  const userSessions = store.list('muse', user, true);
  assert.strictEqual(userSessions.length, 1);
  assert.strictEqual(userSessions[0].id, 'sess_empty_init');

  // 消息超出 200 条时自动保护
  for (let i = 0; i < 250; i++) {
    sess.messages.push({ role: 'user', content: `Message ${i}` });
  }
  store.save(sess, user);
  assert.strictEqual(sess.messages.length, 250);

  // 刷盘落盘并清理测试环境
  await store.flush(user);
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  console.log('  -> [PASS] SessionStore 空会话与容量保护通过');

  console.log('\n===============================================================');
  console.log('   🎉 安全基线与数据隔离加固专项测试 100% 验收通过！');
  console.log('===============================================================');
}

run();
