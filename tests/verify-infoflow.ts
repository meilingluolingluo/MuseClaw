import assert from 'node:assert';
import crypto from 'node:crypto';
import { InfoflowCrypto } from '../apps/gateway/channels/infoflow/crypto.ts';
import { InfoflowApprovalBridge } from '../apps/gateway/channels/infoflow/approval.ts';
import { InfoflowSender } from '../apps/gateway/channels/infoflow/sender.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';

async function testInfoflowIntegration() {
  console.log('🧪 开始测试如流 (Infoflow) 加解密协议、命令解析与审批桥接...');

  // 1. 初始化测试凭证 (43 位 Base64 随机密钥)
  const token = 'my_test_token_123456';
  const aesKeyBytes = crypto.randomBytes(32);
  const encodingAesKey = aesKeyBytes.toString('base64').replace(/=+$/, ''); // 43 位
  const appId = 'app_museclaw_test';

  const infoflowCrypto = new InfoflowCrypto(token, encodingAesKey, appId);

  // 2. 测试加解密与签名闭环
  const testMessage = JSON.stringify({
    from: 'test_user_001',
    content: { text: '清理测试环境缓存' }
  });

  const encryptedBase64 = infoflowCrypto.encrypt(testMessage);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'random_nonce_9988';

  const list = [token, timestamp, nonce, encryptedBase64].sort();
  const signature = crypto.createHash('sha1').update(list.join('')).digest('hex');

  const isVerified = infoflowCrypto.verifySignature(timestamp, nonce, encryptedBase64, signature);
  assert.strictEqual(isVerified, true, 'SHA-1 签名校验应通过');

  const decryptedText = infoflowCrypto.decrypt(encryptedBase64);
  assert.strictEqual(decryptedText, testMessage, '解密内容必须与原始明文完全一致');
  console.log('  ✅ 如流 AES-256-CBC 验签与加解密测试 100% 通过');

  // 3. 测试审批指令与 Sentinel 解挂桥接
  const sentinel = new SentinelPolicyManager();
  const sender = new InfoflowSender({ webhookUrl: 'http://127.0.0.1:9999/mock' });
  const bridge = new InfoflowApprovalBridge(sender, sentinel);

  // 模拟 Sentinel 挂起一个审批
  let resolvedResult: boolean | null = null;
  const approvalPromise = sentinel.waitForApproval({
    approvalId: 'appr_live_7788',
    sessionId: 'sess_1',
    botId: 'ops_bot',
    userId: 'test_user_001',
    riskLevel: 'high_risk',
    actionSummary: '准备执行 rm -rf 危险命令',
    targetDetails: {},
    status: 'pending',
    requestedAt: Date.now()
  });

  approvalPromise.then((res) => {
    resolvedResult = res;
  });

  // 测试“批准”指令解析
  const cmdApprove = bridge.tryHandleApprovalCommand('批准 appr_live_7788');
  assert.strictEqual(cmdApprove.isApproval, true);
  assert.strictEqual(cmdApprove.approvalId, 'appr_live_7788');
  assert.strictEqual(cmdApprove.approved, true);

  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(resolvedResult, true, 'Sentinel 应被成功解挂并标记为批准');
  console.log('  ✅ 如流用户回复「批准 appr_live_7788」解挂 Sentinel 测试通过');

  console.log('🎉 如流 (Infoflow) 通道协议与审批闭环自测全部通过！');
}

testInfoflowIntegration().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
