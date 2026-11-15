import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import { CredentialVault } from '../packages/sandbox-core/src/vault.ts';
import { GrantStore } from '../apps/sentinel/src/grants.ts';
import { AuditLog } from '../apps/sentinel/src/audit.ts';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testScratchDir = path.resolve(__dirname, '../scratch/enterprise_test');
if (!fs.existsSync(testScratchDir)) fs.mkdirSync(testScratchDir, { recursive: true });

console.log('===============================================================');
console.log('   MUSECLAW 企业级安全基线加固专项测试');
console.log('   (消除Mock假成功 + 凭据Vault与脱敏 + 审批Grants复用 + 声明式策略 + 结构化Audit)');
console.log('===============================================================\n');

async function runTests() {
  // ---------------------------------------------------------------------------
  // 1. 验证真实工具执行行为（杜绝假成功与幻觉引导）
  // ---------------------------------------------------------------------------
  console.log('[Test 1] 验证消除 Mock 虚假成功 (Truthful Tools)...');
  const tools = createDefaultTools({ scratchDir: testScratchDir, browserWorkerUrl: 'http://127.0.0.1:9999' });
  const emailTool = tools.find((t) => t.name === 'send_external_email')!;
  const phoneScreenTool = tools.find((t) => t.name === 'phone_screen')!;
  const phoneActTool = tools.find((t) => t.name === 'phone_act')!;
  const browserTool = tools.find((t) => t.name === 'browser_open')!;

  // 1.1 未配置 SMTP / Resend 凭据时，发信严禁返回 success: true
  delete process.env.SMTP_HOST;
  delete process.env.RESEND_API_KEY;
  const emailResult = (await emailTool.execute({ to: 'ceo@corp.com', subject: 'hi', body: 'test' })) as any;
  assert.strictEqual(emailResult.success, false, '未配置发信凭据时严禁假装发送成功');
  assert.ok(emailResult.error.includes('Email service unconfigured'), '必须明确提示未配置发信服务');
  console.log('  ✅ send_external_email 无凭据时真实报错并阻断，杜绝幻觉误导');

  // 1.2 无真机 Bridge 时，手机屏幕与触控严禁返回虚假微信页面或空成功
  delete process.env.DEVICE_BRIDGE_URL;
  const screenResult = (await phoneScreenTool.execute({ target: 'phone_1' })) as any;
  assert.strictEqual(screenResult.success, false, '无真机连接时严禁返回伪造屏幕');
  assert.ok(screenResult.error.includes('GUI device offline'), '必须提示真机离线');

  const actResult = (await phoneActTool.execute({ action: 'tap', x: 100, y: 200 })) as any;
  assert.strictEqual(actResult.success, false, '无真机连接时严禁触控假成功');
  console.log('  ✅ phone_screen / phone_act 无真机连接时真实报错，杜绝伪造界面');

  // 1.3 浏览器 Worker 离线时，降级轻量 HTTP 抓取，不伪造 Chromium 渲染
  const browserResult = (await browserTool.execute({ url: 'http://127.0.0.1:9999/not_found' })) as any;
  assert.strictEqual(browserResult.success, false, '目标不可达且 Worker 离线时不伪造 navigated 成功');
  console.log('  ✅ browser_open 离线时真实反馈，消除伪造成功标志\n');

  // ---------------------------------------------------------------------------
  // 2. 验证凭据隔离与输出脱敏 (Vault & Redaction)
  // ---------------------------------------------------------------------------
  console.log('[Test 2] 验证凭据隔离与全局输出脱敏 (Credential Vault)...');
  const vault = new CredentialVault();
  const testSecretKey = 'CORP_INTERNAL_PAYMENT_SECRET';
  const testSecretVal = 'sk_live_998877665544332211corp';
  vault.set(testSecretKey, testSecretVal);

  // 2.1 占位符转换与掩码
  const rawPrompt = `请调用支付系统，密钥是: ${testSecretVal}`;
  const maskedPrompt = vault.maskToPlaceholder(rawPrompt);
  assert.strictEqual(maskedPrompt, `请调用支付系统，密钥是: {{vault:${testSecretKey}}}`);
  assert.ok(!maskedPrompt.includes(testSecretVal), '模型上下文中的敏感密钥已彻底替换为安全占位符');

  // 2.2 出站参数真实值还原
  const toolInput = { token: `{{vault:${testSecretKey}}}`, amount: 100 };
  const resolvedInput = vault.resolve(toolInput);
  assert.strictEqual(resolvedInput.token, testSecretVal, '工具执行前占位符正确还原为真实凭据');

  // 2.3 工具输出全局脱敏 (Redact)
  const dirtyOutput = `Database error: connection string postgres://user:${testSecretVal}@db.corp failed!`;
  const cleanOutput = vault.redact(dirtyOutput);
  assert.ok(!cleanOutput.includes(testSecretVal), '工具输出中的明文凭据已彻底打码脱敏');
  assert.ok(cleanOutput.includes(`[REDACTED:${testSecretKey}]`), '明文凭据正确打码为 [REDACTED:KEY_NAME]');
  console.log('  ✅ Vault 占位符隔离、出站参数还原与输出全局脱敏 100% 验证通过\n');

  // ---------------------------------------------------------------------------
  // 3. 验证审批授权复用与落盘 (Grants Store with Scopes)
  // ---------------------------------------------------------------------------
  console.log('[Test 3] 验证审批授权复用机制 (Grants Store: once / session / 24h / always)...');
  const grantFile = path.resolve(testScratchDir, 'test-grants.json');
  if (fs.existsSync(grantFile)) fs.unlinkSync(grantFile);

  const grantStore = new GrantStore(grantFile);
  const sessionIdA = 'sess_user_001';
  const sessionIdB = 'sess_user_002';

  // 3.1 初始无授权
  assert.strictEqual(grantStore.check('execute_shell', 'git status', sessionIdA).hasGrant, false);

  // 3.2 授予 Session 级别授权
  grantStore.addGrant({
    tool: 'execute_shell',
    target: 'git',
    scope: 'session',
    sessionId: sessionIdA
  });

  // 在同一会话中命中复用授权
  const checkSessionHit = grantStore.check('execute_shell', 'git status', sessionIdA);
  assert.strictEqual(checkSessionHit.hasGrant, true, '同会话同目标必须命中 Grant 自动免批放行');

  // 在不同会话中隔离阻断
  const checkOtherSession = grantStore.check('execute_shell', 'git status', sessionIdB);
  assert.strictEqual(checkOtherSession.hasGrant, false, '不同会话不得越权复用 session 级别授权');

  // 3.3 授予 Always 级别授权并验证磁盘持久化
  grantStore.addGrant({
    tool: 'write_file',
    target: '/var/log/app.log',
    scope: 'always'
  });
  assert.ok(fs.existsSync(grantFile), '24h / always 授权必须落盘持久化');

  // 重启载入验证
  const restartedGrantStore = new GrantStore(grantFile);
  const checkAlwaysHit = restartedGrantStore.check('write_file', '/var/log/app.log', sessionIdB);
  assert.strictEqual(checkAlwaysHit.hasGrant, true, '重启后持久化授权必须依然生效');
  console.log('  ✅ Grants 作用域隔离、会话复用与跨进程重启持久化验证通过\n');

  // ---------------------------------------------------------------------------
  // 4. 验证声明式外部安全策略 (Declarative Sentinel Policy)
  // ---------------------------------------------------------------------------
  console.log('[Test 4] 验证声明式外部安全策略与动态重载 (Declarative Policy)...');
  const customPolicyFile = path.resolve(testScratchDir, 'policy.json');
  fs.writeFileSync(
    customPolicyFile,
    JSON.stringify({
      version: '2.0',
      deny_tools: ['forbidden_tool_x'],
      high_risk_patterns: ['custom_danger_cmd'],
      always_ask_tools: ['special_audit_tool'],
      egress_allowlist: ['*.internal.corp']
    }),
    'utf-8'
  );

  const sentinel = new SentinelPolicyManager(grantFile, customPolicyFile);
  assert.strictEqual(sentinel.getPolicyConfig().version, '2.0');

  // 4.1 deny_tools 全局禁用拦截
  const checkDeny = sentinel.evaluateToolCall('forbidden_tool_x', {});
  assert.strictEqual(checkDeny.isDangerous, true);
  assert.ok(checkDeny.reason?.includes('全局禁用'));

  // 4.2 custom high_risk_patterns 拦截
  const checkCustomRisk = sentinel.evaluateToolCall('execute_shell', { command: 'custom_danger_cmd --all' });
  assert.strictEqual(checkCustomRisk.isDangerous, true);

  // 4.3 always_ask_tools 拦截
  const checkAlwaysAsk = sentinel.evaluateToolCall('special_audit_tool', {}, { approval_level: 'full' });
  assert.strictEqual(checkAlwaysAsk.isDangerous, true, '即使在 full 模式下，策略配置的 always_ask_tools 也必须拦截确认');
  console.log('  ✅ 声明式外部策略加载、自定义高危命令与策略黑名单拦截验证通过\n');

  // ---------------------------------------------------------------------------
  // 5. 验证结构化审计日志与全链路联动 (Structured AuditLog)
  // ---------------------------------------------------------------------------
  console.log('[Test 5] 验证结构化审计日志输出与审批全链路 (Structured AuditLog)...');
  const auditFile = path.resolve(testScratchDir, 'test-audit.jsonl');
  if (fs.existsSync(auditFile)) fs.unlinkSync(auditFile);
  const auditLog = new AuditLog(auditFile);

  auditLog.record('TOOL_CALL', {
    sessionId: 'sess_123',
    botId: 'ops_bot',
    tool: 'execute_shell',
    target: 'df -h'
  });

  auditLog.record('APPROVAL_DECISION', {
    sessionId: 'sess_123',
    botId: 'ops_bot',
    decision: 'approved',
    operator: 'admin_user',
    details: { scope: 'session' }
  });

  const recentAudits = auditLog.query({ sessionId: 'sess_123' });
  assert.strictEqual(recentAudits.length, 2, '必须成功记录并检索到结构化审计事件');
  assert.strictEqual(recentAudits[0].event, 'APPROVAL_DECISION');
  assert.ok(fs.existsSync(auditFile), '审计日志必须以 JSONL 形式落盘');

  const fileLines = fs.readFileSync(auditFile, 'utf-8').trim().split('\n');
  assert.strictEqual(fileLines.length, 2, '落盘文件行数必须与记录数完全一致');
  console.log('  ✅ 结构化 JSONL 审计日志记录、查询与落盘追踪 100% 验证通过\n');

  console.log('===============================================================');
  console.log('   🎉 企业级五大加固项全量测试 100% 验收通过！');
  console.log('===============================================================');
}

runTests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
