import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchesCron, computeNextRun } from '../apps/gateway/proactive/cron.ts';
import { ProactiveManager } from '../apps/gateway/proactive/manager.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import type { ToolDefinition } from '../packages/sandbox-core/src/loop.ts';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('🧪 开始验证定时任务执行引擎核心增强项...\n');

  // 1. 时区感知 Cron 匹配
  const utcOneAm = new Date('2026-11-25T01:00:00Z'); // Asia/Shanghai 09:00, UTC 01:00
  assert.strictEqual(matchesCron('0 9 * * *', utcOneAm, 'Asia/Shanghai'), true, 'Asia/Shanghai 09:00 应命中');
  assert.strictEqual(matchesCron('0 9 * * *', utcOneAm, 'UTC'), false, 'UTC 01:00 不应命中 0 9');
  console.log('✅ [1/9] 时区感知 Cron 匹配通过');

  // 2. 月级跨度 (366 天) 计算
  const jan2 = new Date('2026-01-02T10:00:00+08:00');
  const nextMonthFirst = computeNextRun('0 9 1 * *', jan2, 'Asia/Shanghai');
  const diffDays = (nextMonthFirst - jan2.getTime()) / (24 * 3600 * 1000);
  assert(diffDays > 28 && diffDays < 31, `预期 2 月 1 日 (约 30 天后)，实际 diffDays=${diffDays}`);
  console.log('✅ [2/9] 366 天月级 Cron 下次执行计算通过');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'museclaw-routines-test-'));
  try {
    // 3. JSONL 持久化 + 重启中断恢复
    const seededRun = {
      id: 'run_crashed_1',
      routineId: 'routine_health_check',
      routineName: '工作站资源与磁盘空间巡检',
      triggerSource: 'schedule',
      startedAt: Date.now() - 120000,
      status: 'running',
      approvalRequired: false,
    };
    fs.writeFileSync(path.join(tmpDir, 'routine-runs.jsonl'), JSON.stringify(seededRun) + '\n', 'utf-8');

    const sentinel = new SentinelPolicyManager();
    const slowTools: ToolDefinition[] = [
      {
        name: 'slow_ping',
        description: '模拟耗时操作',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          await sleep(150);
          return 'ok';
        },
      },
    ];

    let llmMode: 'normal' | 'hang' | 'fail' = 'normal';
    let failCount = 0;

    const manager = new ProactiveManager({
      sentinel,
      tools: slowTools,
      dataDir: tmpDir,
      callLLM: async (_messages, _tools, onChunk) => {
        if (llmMode === 'hang') {
          await sleep(5000);
          return { content: 'done' };
        }
        if (llmMode === 'fail') {
          failCount++;
          throw new Error(`simulated_upstream_error_${failCount}`);
        }
        onChunk?.('巡检完成，状态正常。');
        await sleep(80);
        return { content: '巡检完成，状态正常。' };
      },
    });

    const recovered = manager.listRuns().find((r) => r.id === 'run_crashed_1');
    assert.strictEqual(recovered?.status, 'interrupted', '重启遗留 running 记录应恢复为 interrupted');
    assert.strictEqual(recovered?.cancelledBy, 'restart');
    console.log('✅ [3/9] JSONL 持久化与重启中断记录恢复通过');

    // 4. 真实超时 AbortSignal 中断
    llmMode = 'hang';
    const timeoutRoutine = manager.createRoutine({
      name: '超时测试任务',
      instructions: '模拟超时',
      cronExpr: '0 9 * * *',
      timeoutSeconds: 1,
      circuitBreakerThreshold: 5,
    });
    const timeoutRun = await manager.executeRoutine(timeoutRoutine, 'manual');
    assert.strictEqual(timeoutRun.status, 'timeout', `预期 timeout，实际 ${timeoutRun.status}`);
    assert.strictEqual(timeoutRun.cancelledBy, 'timeout');
    console.log('✅ [4/9] 真实 timeoutSeconds AbortSignal 超时中断通过');

    // 5. 手动 cancelRun 立即停止
    const cancelRoutine = manager.createRoutine({
      name: '手动停止测试任务',
      instructions: '模拟可中止任务',
      cronExpr: '0 9 * * *',
      timeoutSeconds: 30,
    });
    const cancelPromise = manager.executeRoutine(cancelRoutine, 'manual');
    await sleep(60);
    const activeRun = manager.listRunsByRoutineId(cancelRoutine.id).find((r) => r.status === 'running');
    assert(activeRun, '应能查到运行中的 run');
    const cancelled = manager.cancelRun(activeRun.id);
    assert.strictEqual(cancelled, true, 'cancelRun 应返回 true');
    const cancelledRun = await cancelPromise;
    assert.strictEqual(cancelledRun.status, 'cancelled');
    assert.strictEqual(cancelledRun.cancelledBy, 'user');
    console.log('✅ [5/9] 手动 cancelRun 中止运行中任务通过');

    // 6. overlap: 'queue' 排队防重叠
    llmMode = 'normal';
    const queueRoutine = manager.createRoutine({
      name: '排队测试任务',
      instructions: '快速任务',
      cronExpr: '0 9 * * *',
      overlap: 'queue',
    });
    const firstPromise = manager.executeRoutine(queueRoutine, 'manual');
    await sleep(20);
    await manager.executeRoutine(queueRoutine, 'webhook', { seq: 2 });
    assert.strictEqual(queueRoutine.hasQueuedRun, true, '第二次触发应进入待执行队列');
    await firstPromise;
    await sleep(250);
    assert.strictEqual(queueRoutine.stats?.totalRuns, 2, `排队任务应连续完成 2 次，实际 ${queueRoutine.stats?.totalRuns}`);
    console.log('✅ [6/9] overlap=queue 排队拉起第二轮执行通过');

    // 7. 指数退避重试 + 连续失败熔断自动暂停
    llmMode = 'fail';
    failCount = 0;
    const breakerRoutine = manager.createRoutine({
      name: '熔断测试任务',
      instructions: '模拟持续报错',
      cronExpr: '0 9 * * *',
      maxRetries: 1,
      circuitBreakerThreshold: 2,
    });
    const failedRun1 = await manager.executeRoutine(breakerRoutine, 'schedule');
    assert.strictEqual(failedRun1.status, 'failed');
    assert.strictEqual(failedRun1.attempt, 2, 'maxRetries=1 应尝试 2 次');
    assert.strictEqual(breakerRoutine.enabled, true, '第 1 次失败尚未达到阈值 2');

    const failedRun2 = await manager.executeRoutine(breakerRoutine, 'schedule');
    assert.strictEqual(failedRun2.status, 'failed');
    assert.strictEqual(breakerRoutine.enabled, false, '连续失败达到阈值 2 后应自动暂停');
    assert(breakerRoutine.circuitBrokenAt, '应记录 circuitBrokenAt 时间戳');
    console.log('✅ [7/9] 指数退避重试与连续失败自动熔断通过');

    // 8. Misfire 跳过过期窗口保护
    llmMode = 'normal';
    const misfireRoutine = manager.createRoutine({
      name: 'Misfire 测试任务',
      instructions: '过期跳过',
      cronExpr: '0 9 * * *',
      misfirePolicy: 'skip',
    });
    misfireRoutine.nextRunAt = Date.now() - 10 * 60 * 1000; // 过期 10 分钟 (> 5 分钟宽限期)
    manager.tick();
    await sleep(50);
    assert.strictEqual(misfireRoutine.stats?.totalRuns, 0, '超过宽限期的过期触发应按 skip 策略跳过');
    assert((misfireRoutine.nextRunAt || 0) > Date.now(), 'Misfire 跳过后应滚动更新 nextRunAt');
    console.log('✅ [8/9] Misfire 过期窗口跳过与自动滚动通过');

    // 9. Webhook 空 Token 强制 401 鉴权
    const whResMissing = await manager.handleRoutineWebhookTrigger(queueRoutine.id, undefined, {});
    assert.strictEqual(whResMissing.status, 401, '未传 Token 时必须返回 401');
    const whResWrong = await manager.handleRoutineWebhookTrigger(queueRoutine.id, 'bad_secret', {});
    assert.strictEqual(whResWrong.status, 401, '错误 Token 时必须返回 401');
    console.log('✅ [9/9] Webhook 缺失与错误 Token 401 鉴权校验通过');

    console.log('\n🎉 定时任务执行引擎 9 项强化测试全部通过！');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
