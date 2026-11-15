import assert from 'node:assert';
import { runAgentLoop, type LLMCaller } from '../packages/sandbox-core/src/loop.ts';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';
import { exportToShareGPT } from '../packages/sandbox-core/src/trajectory.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import type { MuseEvent } from '../packages/protocol/src/index.ts';

async function testThinCore() {
  console.log('🧪 开始自检 MuseClaw Thin-Core 状态机与 Sentinel 拦截流...');

  const sentinel = new SentinelPolicyManager();
  const tools = createDefaultTools();

  // 1. Mock 一个产生高危 Shell 调用的大模型
  let callCount = 0;
  const mockLLM: LLMCaller = async () => {
    callCount++;
    if (callCount === 1) {
      return {
        content: '分析完毕，需要删除旧缓存。',
        toolCalls: [
          {
            id: 'call_1',
            name: 'execute_shell',
            args: { command: 'rm -rf /tmp/test_dir' }
          }
        ]
      };
    }
    return {
      content: '任务已经顺利完成。'
    };
  };

  const loop = runAgentLoop(
    '你是系统助手',
    '清理目录',
    tools,
    sentinel,
    mockLLM,
    { sessionId: 'test_sess', userId: 'user_test', botId: 'cleaner_bot' }
  );

  let approvalReceived = false;
  let taskCompleted = false;

  // 消费事件流
  for await (const event of loop) {
    if (event.type === 'sentinel:approval_needed') {
      approvalReceived = true;
      assert.strictEqual(event.request.riskLevel, 'high_risk');
      console.log('  ✅ Sentinel 成功物理拦截高危命令:', event.request.actionSummary);

      // 模拟人类在移动端/Web端点击“批准”
      setTimeout(() => {
        const ok = sentinel.resolveApproval(event.request.approvalId, true);
        assert.strictEqual(ok, true);
        console.log('  ✅ 人类审批批准生效，沙箱恢复执行');
      }, 50);
    }

    if (event.type === 'tool:call_end') {
      console.log('  ✅ 工具实际完成执行，耗时:', event.durationMs, 'ms');
    }
  }

  assert.strictEqual(approvalReceived, true, '必须触发 Sentinel 审批');
  console.log('🎉 MuseClaw Thin-Core 闭环测试全部通过！');
}

testThinCore().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
