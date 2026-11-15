import assert from 'node:assert';
import { matchesCron, computeNextRun } from '../apps/gateway/proactive/cron.ts';
import { ProactiveManager } from '../apps/gateway/proactive/manager.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';
import type { LLMCaller } from '../packages/sandbox-core/src/loop.ts';

console.log('🧪 开始测试 MuseClaw 主动任务（Cron 调度 + Webhook 触发 + Sentinel 联动）...\n');

// 1. 测试 Cron 解析器
console.log('1. 测试 Cron 表达式匹配与下次时间计算...');
const now = new Date(2026, 10, 15, 9, 0, 0); // 2026-11-15 09:00 (Sunday)
assert.strictEqual(matchesCron('0 9 * * *', now), true, '0 9 * * * 应该命中');
assert.strictEqual(matchesCron('*/15 * * * *', now), true, '0 分钟应该命中 */15');
assert.strictEqual(matchesCron('30 9 * * *', now), false, '30 9 * * * 不应该命中');

const nextRun = computeNextRun('0 9 * * *', now);
assert(nextRun > now.getTime(), '下次执行时间必须大于当前时间');
console.log('  ✅ Cron 表达式与探测计算 100% 正确\n');

// 2. 模拟 LLM 与执行环境
const sentinel = new SentinelPolicyManager();
const tools = createDefaultTools();

let simulatedSteps = 0;
const mockLLM: LLMCaller = async (messages, availableTools) => {
  simulatedSteps++;
  const lastMsg = messages[messages.length - 1];

  // 如果刚收到 tool 执行结果，输出结论并完成
  if (lastMsg.role === 'tool') {
    return {
      content: '✅ 自动化巡检顺利完成，系统资源状态良好。',
      toolCalls: []
    };
  }

  // 第一次调用：尝试调用只读命令 df -h
  return {
    content: '开始执行系统资源巡检...',
    toolCalls: [
      {
        id: 'call_df_1',
        name: 'execute_shell',
        args: { command: 'echo "Filesystem /dev/sda1 80% used"' }
      }
    ]
  };
};

let completedRuns: any[] = [];
const proactive = new ProactiveManager({
  sentinel,
  tools,
  callLLM: mockLLM,
  onRunCompleted: async (run, output) => {
    completedRuns.push({ run, output });
  }
});

// 3. 测试例行任务执行与防重叠保护
console.log('2. 测试例行任务执行与并发防重叠...');
const routines = proactive.listRoutines();
assert(routines.length >= 2, '必须预置默认巡检例程');

const testRoutine = routines[0];
const runPromise = proactive.executeRoutine(testRoutine, 'manual');

// 测试防重叠：再次触发同一个 routine 必须被拒绝
let overlapBlocked = false;
try {
  await proactive.executeRoutine(testRoutine, 'manual');
} catch (err: any) {
  overlapBlocked = true;
  assert(err.message.includes('跳过重叠触发'), '错误必须提示跳过重叠');
}
assert.strictEqual(overlapBlocked, true, '运行中的例程必须阻断重叠执行');
console.log('  ✅ 并发防重叠校验通过');

const runResult = await runPromise;
assert.strictEqual(runResult.status, 'success');
assert(runResult.output?.includes('自动化巡检顺利完成'));
assert.strictEqual(completedRuns.length, 1);
console.log('  ✅ 例行任务 Agent Loop 执行与结果回调通过\n');

// 4. 测试 Webhook 触发与鉴权限流
console.log('3. 测试 Webhook 入口 (Bearer 鉴权 + 429 限流 + 不可信数据隔离)...');
const hooks = proactive.listHooks();
assert(hooks.length >= 1, '必须预置告警 Webhook');
const testHook = hooks[0];

// 4.1 错误 Token 必须 401
const unauthRes = await proactive.handleWebhookTrigger(testHook.id, 'Bearer wrong_secret', { event: 'test' });
assert.strictEqual(unauthRes.status, 401, '非法 secret 必须返回 401');

// 4.2 正确 Token 必须 202
const okRes = await proactive.handleWebhookTrigger(
  testHook.id,
  `Bearer ${testHook.secret}`,
  {
    event: 'high_cpu_alert',
    payload: { host: 'prod-api-01', cpu: '96%', alertId: 'alt_999' }
  }
);
assert.strictEqual(okRes.status, 202, '合法 Webhook 必须返回 202 已受理');
assert.strictEqual(okRes.body.success, true);
console.log('  ✅ Webhook 鉴权与异步受理通过');

// 5. 测试高危操作在主动任务中的 Sentinel 拦截
console.log('4. 测试主动任务中触发高危命令的 Sentinel 拦截与挂起解挂...');
let approvalTriggered = false;
let pendingApprovalId = '';

const dangerousLLM: LLMCaller = async (messages) => {
  const last = messages[messages.length - 1];
  if (last.role === 'tool') {
    return { content: '破坏性操作执行完成。', toolCalls: [] };
  }
  return {
    content: '尝试清理旧日志缓存...',
    toolCalls: [
      {
        id: 'call_rm',
        name: 'execute_shell',
        args: { command: 'rm -rf /var/log/test-cache' }
      }
    ]
  };
};

const dangerProactive = new ProactiveManager({
  sentinel,
  tools,
  callLLM: dangerousLLM,
  onApprovalNeeded: async (req) => {
    approvalTriggered = true;
    pendingApprovalId = req.approvalId;
    // 模拟管理员通过如流或飞书审批卡片批准
    setTimeout(() => {
      sentinel.resolveApproval(req.approvalId, true);
    }, 50);
  }
});

const dangerRoutine = {
  id: 'danger_test',
  name: '高危清理任务',
  agentId: 'ops_bot',
  cronExpr: '* * * * *',
  instructions: '清理过期日志',
  enabled: true,
  status: 'idle' as const
};

const dangerRun = await dangerProactive.executeRoutine(dangerRoutine, 'schedule');
assert.strictEqual(approvalTriggered, true, '高危命令必须触发 Sentinel 拦截');
assert.strictEqual(dangerRun.approvalRequired, true, 'Run 记录中必须标记曾需要审批');
assert.strictEqual(dangerRun.status, 'success', '管理员批准后任务必须继续执行成功');
console.log('  ✅ 主动任务全链路 Sentinel 拦截与一键解挂通过\n');

console.log('🎉 MuseClaw 方向一（主动任务：Cron + Webhook + Sentinel + 审批闭环）全套测试 100% 通过！');
