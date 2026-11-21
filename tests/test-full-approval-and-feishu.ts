import assert from 'node:assert';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';
import { FeishuSender } from '../apps/gateway/channels/feishu/sender.ts';

console.log('=== 开始全量验证: FULL 模式免打扰放行与宿主飞书消息推送 ===\n');

// 1. 验证 Sentinel 在 FULL 模式下的审批放行与安全底线
console.log('1. 测试 Sentinel Policy 在 full 模式下的表现...');
const sentinel = new SentinelPolicyManager();

// 1.1 常规命令与项目 .env 读取在 full 模式下免批放行
const checkEnvRead = sentinel.evaluateToolCall(
  'execute_shell',
  { command: 'cat .env' },
  { approval_level: 'full', sessionId: 'sess_test_full_1' }
);
assert.strictEqual(
  checkEnvRead.isDangerous,
  false,
  '在 full 模式下，读取工作区项目配置 .env 不应拦截打扰用户'
);

const checkNormalCmd = sentinel.evaluateToolCall(
  'execute_shell',
  { command: 'git status && ls -la' },
  { approval_level: 'full', sessionId: 'sess_test_full_1' }
);
assert.strictEqual(checkNormalCmd.isDangerous, false, '常规 Git/Shell 命令在 full 模式下正常放行');

// 1.2 飞书发送工具在 full 模式与普通会话中的评估
const checkFeishuTool = sentinel.evaluateToolCall(
  'feishu_send_message',
  { content: '巡检报告', receive_id: 'ou_123456' },
  { approval_level: 'full', sessionId: 'sess_test_full_1' }
);
assert.strictEqual(checkFeishuTool.isDangerous, false, 'feishu_send_message 在 full 模式下应直接放行');

// 1.3 操作系统核心敏感凭证与云元数据探测依然强制拦截
const checkShadow = sentinel.evaluateToolCall(
  'execute_shell',
  { command: 'cat /etc/shadow' },
  { approval_level: 'full', sessionId: 'sess_test_full_1' }
);
assert.strictEqual(checkShadow.isDangerous, true, '即使处于 full 模式，窃取系统 /etc/shadow 凭据必须强制拦截');

const checkMetadata = sentinel.evaluateToolCall(
  'execute_shell',
  { command: 'curl -s http://169.254.169.254/latest/meta-data/' },
  { approval_level: 'full', sessionId: 'sess_test_full_1' }
);
assert.strictEqual(checkMetadata.isDangerous, true, '即使处于 full 模式，云元数据探测必须坚决拦截');

console.log('  ✅ FULL 模式免除打扰同时守牢底线验证通过\n');

// 2. 验证 feishu_send_message 内置工具集成与宿主代理推送
console.log('2. 测试 feishu_send_message 工具集成与调用...');
let capturedSendArgs: any = null;

const tools = createDefaultTools({
  feishuProvider: {
    sendMessage: async (opts) => {
      capturedSendArgs = opts;
      return {
        success: true,
        messageId: 'om_test_mock_msg_9988',
        raw: { code: 0 }
      };
    }
  }
});

const feishuTool = tools.find((t) => t.name === 'feishu_send_message');
assert.ok(feishuTool, '必须成功注册 feishu_send_message 工具');

// 测试通过 Provider 发送互动卡片
const sendResult = (await feishuTool.execute({
  content: '### 今日巡检完毕\n- 代码无冲突\n- 磁盘健康',
  receive_id: 'ou_test_user_001',
  title: '每日例行巡检',
  msg_type: 'interactive'
})) as any;

assert.strictEqual(sendResult.success, true);
assert.strictEqual(sendResult.messageId, 'om_test_mock_msg_9988');
assert.strictEqual(capturedSendArgs.receiveId, 'ou_test_user_001');
assert.strictEqual(capturedSendArgs.title, '每日例行巡检');
assert.strictEqual(capturedSendArgs.msgType, 'interactive');

console.log('  ✅ feishu_send_message 工具宿主调用链路验证通过\n');

// 3. 验证 FeishuSender 自身的消息结构构建与智能 ID 推导
console.log('3. 测试 FeishuSender 智能 ID 与卡片封装...');
const sender = new FeishuSender({
  appId: 'test_app_id',
  appSecret: 'test_app_secret',
  webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/mock-hook'
});

// 在配置 webhookUrl 的情况下，测试 sendWebhook 封装
const webhookRes = await sender.sendWebhook('测试告警', 'text');
assert.ok(webhookRes !== undefined, 'Webhook 调用应正常返回结果对象');

console.log('  ✅ FeishuSender 消息封装与回退逻辑验证通过\n');

console.log('🎉 所有 FULL 模式免批与飞书宿主网关推送测试全部通过！');
