import assert from 'node:assert';
import crypto from 'node:crypto';
import { FeishuCrypto } from '../apps/gateway/channels/feishu/crypto.ts';
import { FeishuReceiver } from '../apps/gateway/channels/feishu/receiver.ts';
import { FeishuApprovalBridge } from '../apps/gateway/channels/feishu/approval.ts';
import { FeishuSender } from '../apps/gateway/channels/feishu/sender.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';

async function testFeishuIntegration() {
  console.log('🧪 开始测试飞书 (Feishu) 挑战校验、加解密、卡片按钮与审批桥接...');

  const encryptKey = 'my_feishu_encrypt_key_12345';
  const verificationToken = 'v_token_test';
  const feishuCrypto = new FeishuCrypto(encryptKey, verificationToken);

  // 1. 测试 URL 挑战校验 (Challenge)
  const sentinel = new SentinelPolicyManager();
  const sender = new FeishuSender({ webhookUrl: 'http://127.0.0.1:9999/mock' });
  const bridge = new FeishuApprovalBridge(sender, sentinel);
  const receiver = new FeishuReceiver({ encryptKey, verificationToken }, bridge);

  const challengePayload = JSON.stringify({
    type: 'url_verification',
    token: verificationToken,
    challenge: 'feishu_challenge_token_999'
  });

  const challengeRes = receiver.handleEvent({}, challengePayload);
  assert.strictEqual(challengeRes.isChallenge, true);
  assert.strictEqual(challengeRes.challengeResponse?.challenge, 'feishu_challenge_token_999');
  console.log('  ✅ 飞书开放平台 URL 挑战校验通过');

  // 2. 测试 AES-256 加解密与签名验证
  const encryptedStr = feishuCrypto.encrypt(challengePayload);
  const decryptedStr = feishuCrypto.decrypt(encryptedStr);
  assert.strictEqual(decryptedStr, challengePayload);

  const timestamp = '1700000000';
  const nonce = 'random_feishu_nonce';
  const signature = crypto.createHash('sha256').update(timestamp + nonce + encryptKey + encryptedStr).digest('hex');

  const isValidSig = feishuCrypto.verifySignature(timestamp, nonce, encryptedStr, signature);
  assert.strictEqual(isValidSig, true, 'SHA256 签名校验必须通过');
  console.log('  ✅ 飞书 AES-256 加解密与 SHA256 验签测试 100% 通过');

  // 3. 测试原生飞书卡片按钮点击解挂 Sentinel
  let cardResolved: boolean | null = null;
  sentinel.waitForApproval({
    approvalId: 'appr_feishu_btn_1',
    sessionId: 'sess_feishu',
    botId: 'ops_bot',
    userId: 'ou_123',
    riskLevel: 'high_risk',
    actionSummary: '准备删除测试目录',
    targetDetails: {},
    status: 'pending',
    requestedAt: Date.now()
  }).then((res) => {
    cardResolved = res;
  });

  // 模拟飞书发送卡片按钮点击数据包
  const cardActionPayload = JSON.stringify({
    open_id: 'ou_123',
    action: {
      value: {
        action: 'approve',
        approvalId: 'appr_feishu_btn_1'
      }
    }
  });

  const cardRes = receiver.handleEvent({}, cardActionPayload);
  assert.strictEqual(cardRes.isCardAction, true);
  assert.strictEqual(cardRes.cardActionResult?.approved, true);

  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(cardResolved, true, 'Sentinel 应被飞书卡片按钮成功批准');
  console.log('  ✅ 飞书原生交互卡片「允许执行」按钮一键解挂 Sentinel 测试通过');

  console.log('🎉 飞书 (Feishu) 通道协议与审批全闭环测试全部通过！');
}

testFeishuIntegration().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
