import { matchesCron, computeNextRun, computeNextRuns, detectScheduleKind, cronToHumanZh } from '../apps/gateway/proactive/cron.ts';
import { ProactiveManager } from '../apps/gateway/proactive/manager.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import { BotMemoryManager, BotRegistry, SessionStore } from '../apps/gateway/bots/index.ts';
import type { ToolDefinition } from '../packages/sandbox-core/src/loop.ts';

async function runTests() {
  console.log('--- 1. 测试 Cron 与多模式调度解析与中文转译 ---');

  const testCases = [
    { expr: '0 9 * * 1-5', expectedKind: 'cron', expectedZh: '工作日 (周一至周五) 上午 09:00' },
    { expr: '0 18 * * 1-5', expectedKind: 'cron', expectedZh: '工作日 (周一至周五) 傍晚 18:00' },
    { expr: '0 9 * * *', expectedKind: 'cron', expectedZh: '每天上午 09:00' },
    { expr: '0 * * * *', expectedKind: 'cron', expectedZh: '每小时整点执行' },
    { expr: '*/15 * * * *', expectedKind: 'cron', expectedZh: '每隔 15 分钟执行一次' },
    { expr: '@every 30m', expectedKind: 'every', expectedZh: '每隔 30 分钟周期性执行' },
    { expr: '@at 2026-11-22T10:00:00Z', expectedKind: 'at', expectedZh: '单次定时: 2026-11-22T10:00:00Z' },
  ];

  for (const tc of testCases) {
    const kind = detectScheduleKind(tc.expr);
    const zh = cronToHumanZh(tc.expr);
    const nextRuns = computeNextRuns(tc.expr, new Date(), 3);
    console.log(`[PASS] 表达式 "${tc.expr}" -> 类型: ${kind}, 中文: "${zh}", 预测运行数: ${nextRuns.length}`);
    if (kind !== tc.expectedKind) {
      throw new Error(`Kind mismatch for ${tc.expr}: got ${kind}, expected ${tc.expectedKind}`);
    }
  }

  console.log('\n--- 2. 测试 ProactiveManager 生命周期与调度方法 ---');

  const sentinel = new SentinelPolicyManager();
  const mockTools: ToolDefinition[] = [
    {
      name: 'execute_command',
      description: '执行系统命令',
      parameters: { type: 'object', properties: { command: { type: 'string' } } },
      execute: async (args) => {
        return `命令执行成功: ${args.command}\nFiles: index.ts, server.ts, types.ts`;
      },
    },
  ];

  const proactive = new ProactiveManager({
    sentinel,
    tools: mockTools,
    botRegistry: new BotRegistry(),
    botMemory: new BotMemoryManager(),
    sessionStore: new SessionStore(),
    callLLM: async (messages, tools) => {
      // 模拟 Agent 思考并调用 execute_command 工具，随后得出结论
      if (!messages.some((m) => m.role === 'assistant')) {
        return {
          content: '正在调用工具巡检工作区健康状态...',
          toolCalls: [
            {
              id: 'call_1',
              name: 'execute_command',
              args: { command: 'git status --short' },
            },
          ],
        };
      }
      return {
        content: '【正常】工作区健康度巡检完毕：所有文件暂存状态正常，无异常悬挂。\nNOTHING NEW',
      };
    },
  });

  // 测试创建高级 Routine
  const testRoutine = proactive.createRoutine({
    name: '自动化集成测试任务',
    instructions: '执行 git status --short 并汇报状态',
    cronExpr: '0 9 * * 1-5',
    scheduleKind: 'cron',
    deliverTo: 'feed',
    overlap: 'skip',
  });
  console.log(`[PASS] 创建例行任务成功: ${testRoutine.name} (${testRoutine.id})`);
  console.log(`       中文调度: ${testRoutine.scheduleHumanZh}`);
  console.log(`       Webhook 密钥: ${testRoutine.webhookSecret}`);

  // 测试更新
  const updated = proactive.updateRoutine(testRoutine.id, {
    cronExpr: '*/15 * * * *',
    timeoutSeconds: 120,
  });
  if (updated?.cronExpr !== '*/15 * * * *' || updated.scheduleHumanZh !== '每隔 15 分钟执行一次') {
    throw new Error('Update routine failed');
  }
  console.log(`[PASS] 更新例行任务成功: ${updated.scheduleHumanZh}`);

  // 测试执行任务并采集工具流水与 Quiet Green 判定
  console.log('\n--- 3. 测试 Routine 执行、工具轨迹跟踪与静默判定 ---');
  const run = await proactive.executeRoutine(testRoutine, 'manual');
  console.log(`[PASS] 任务执行状态: ${run.status}`);
  console.log(`       持续耗时: ${run.durationMs}ms`);
  console.log(`       工具调用数量: ${run.toolCalls?.length || 0}`);
  if (run.toolCalls && run.toolCalls.length > 0) {
    console.log(`       工具调用项: ${run.toolCalls[0].tool}, 参数:`, run.toolCalls[0].args);
    console.log(`       工具返回输出: ${run.toolCalls[0].output?.slice(0, 50)}...`);
  }
  console.log(`       静默判定 (Quiet Green): ${run.quiet}`);

  if (run.status !== 'success') {
    throw new Error('Routine execution failed');
  }
  if (!run.quiet) {
    throw new Error('Expected quiet=true for NOTHING NEW output');
  }

  // 检查运行统计指标
  const refreshedRoutine = proactive.getRoutine(testRoutine.id);
  console.log(`[PASS] 运行时统计:`, refreshedRoutine?.stats);
  if (!refreshedRoutine?.stats || refreshedRoutine.stats.totalRuns < 1) {
    throw new Error('Expected stats to be recorded');
  }

  // 测试 Webhook 触发
  console.log('\n--- 4. 测试 外部 Webhook 触发 ---');
  const triggerRes = await proactive.handleRoutineWebhookTrigger(
    testRoutine.id,
    testRoutine.webhookSecret,
    { event: 'ci_pipeline_success', commit: 'abc1234' }
  );
  console.log(`[PASS] Webhook 触发结果: status=${triggerRes.status}, body=`, triggerRes.body);
  if (triggerRes.status !== 202) {
    throw new Error(`Webhook trigger failed with status ${triggerRes.status}`);
  }

  // 测试鉴权失败
  const failTriggerRes = await proactive.handleRoutineWebhookTrigger(
    testRoutine.id,
    'wrong_token',
    {}
  );
  if (failTriggerRes.status !== 401) {
    throw new Error(`Expected status 401 for invalid token, got ${failTriggerRes.status}`);
  }
  console.log(`[PASS] Webhook 鉴权非法阻断校验通过 (401 Unauthorized)`);

  // 清理测试 Routine
  proactive.deleteRoutine(testRoutine.id);
  console.log(`[PASS] 清理测试任务完成\n`);

  console.log('🎉 所有自动化例行任务核心测试全部通过！');
}

runTests().catch((err) => {
  console.error('❌ 测试运行失败:', err);
  process.exit(1);
});
