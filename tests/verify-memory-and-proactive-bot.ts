import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotMemoryManager } from '../apps/gateway/bots/memory.ts';
import { BotRegistry } from '../apps/gateway/bots/registry.ts';
import { SessionStore } from '../apps/gateway/bots/session-store.ts';
import { ProactiveManager } from '../apps/gateway/proactive/manager.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import { runAgentLoop, type LLMCaller } from '../packages/sandbox-core/src/loop.ts';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = path.resolve(__dirname, './.tmp_test_memory');

console.log('🧪 开始测试 MuseClaw A/B 方向（最简静态记忆 MEMORY.md + 主动巡检多 Bot 打通）...\n');

// 清理临时目录
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true });
}

try {
  // ==========================================
  // 测试 A: 最简 Bot 静态记忆 (MEMORY.md)
  // ==========================================
  console.log('1. 测试 Bot 专属 MEMORY.md 读写与预算控制 (200行 / 24KB)...');
  const memoryManager = new BotMemoryManager(testDataDir);

  // 1.1 初始不存在返回空串
  assert.strictEqual(memoryManager.getMemory('bot_a'), '');

  // 1.2 保存并读取记忆
  const customMemory = '# Ops 专用运维记忆\n- 重点关注 /var/log 目录\n- 严禁未经审批删除生产数据';
  memoryManager.saveMemory('bot_a', customMemory);
  assert.strictEqual(memoryManager.getMemory('bot_a'), customMemory);

  // 1.3 测试 200 行截断预算
  const largeLines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`).join('\n');
  memoryManager.saveMemory('bot_overflow_lines', largeLines);
  const truncatedByLines = memoryManager.getMemory('bot_overflow_lines');
  assert(truncatedByLines.includes('[记忆行数已按 200 行预算截断]'), '超过 200 行必须触发截断');

  // 1.4 测试 24KB 截断预算
  const largeBytes = 'A'.repeat(30 * 1024);
  memoryManager.saveMemory('bot_overflow_bytes', largeBytes);
  const truncatedByBytes = memoryManager.getMemory('bot_overflow_bytes');
  assert(truncatedByBytes.includes('[记忆内容已按 24KB 预算截断]'), '超过 24KB 必须触发截断');

  console.log('  ✅ MEMORY.md 读写、隔离与双重预算截断 100% 正确\n');

  // ==========================================
  // 测试 A2: Agent Loop 提示词注入验证
  // ==========================================
  console.log('2. 测试 Agent Loop 自动注入 [Bot Memory & Preferences]...');
  let capturedSystemPrompt = '';
  const captureLLM: LLMCaller = async (messages) => {
    const sys = messages.find(m => m.role === 'system');
    if (sys) capturedSystemPrompt = sys.content || '';
    return { content: '收到记忆', toolCalls: [] };
  };

  const sentinel = new SentinelPolicyManager();
  const tools = createDefaultTools();

  const loop = runAgentLoop(
    'Base prompt',
    'Goal',
    tools,
    sentinel,
    captureLLM,
    {
      sessionId: 'sess_mem_test',
      userId: 'test_user',
      botId: 'bot_a',
      profile: {
        id: 'bot_a',
        name: 'Bot A',
        system_prompt: 'System prompt from profile.',
        tool_allowlist: ['*'],
        memory_ns: 'bots/bot_a',
        memory: customMemory,
        enabled: true,
        created_at: Date.now(),
        updated_at: Date.now()
      }
    }
  );

  for await (const _ of loop) {}
  assert(capturedSystemPrompt.includes('System prompt from profile.'));
  assert(capturedSystemPrompt.includes('[Bot Memory & Preferences]:'));
  assert(capturedSystemPrompt.includes('重点关注 /var/log 目录'));
  console.log('  ✅ Agent Loop 成功将 MEMORY.md 内容精准注入系统上下文中\n');

  // ==========================================
  // 测试 B: 打通主动巡检与多 Bot 体系
  // ==========================================
  console.log('3. 测试主动巡检任务按 agentId 挂载到专属 Bot (Profile / 工具白名单 / 会话隔离)...');

  const botRegistry = new BotRegistry(path.join(testDataDir, 'bots.json'));
  const sessionStore = new SessionStore(path.join(testDataDir, 'sessions.json'));

  // 创建一个专属运维 Bot，仅允许 execute_shell
  const opsBot = botRegistry.create({
    name: 'Ops Specialist',
    system_prompt: '你是一个严格的运维机器人。',
    tool_allowlist: ['execute_shell'],
    memory_ns: 'bots/ops_specialist'
  });

  memoryManager.saveMemory(opsBot.id, '运维专有备忘：机器 IP 192.168.1.100');

  let executedTools: string[] = [];
  let capturedBotIdInApproval = '';
  let capturedSessionIdInApproval = '';

  const proactiveLLM: LLMCaller = async (messages, availableTools) => {
    // 验证可用的工具确实被工具白名单裁剪了
    assert.strictEqual(availableTools.length, 1, 'Ops Bot 应该只被允许执行 execute_shell');
    assert.strictEqual(availableTools[0].name, 'execute_shell');

    const last = messages[messages.length - 1];
    if (last.role === 'tool') {
      return { content: '巡检报告输出成功。', toolCalls: [] };
    }

    // 尝试执行高危 shell
    return {
      content: '准备执行高危清理命令...',
      toolCalls: [
        {
          id: 'call_danger_shell',
          name: 'execute_shell',
          args: { command: 'rm -rf /tmp/proactive_test_cache' }
        }
      ]
    };
  };

  const proactiveManager = new ProactiveManager({
    sentinel,
    tools,
    callLLM: proactiveLLM,
    botRegistry,
    sessionStore,
    botMemory: memoryManager,
    onApprovalNeeded: async (request, routine) => {
      capturedBotIdInApproval = request.botId;
      capturedSessionIdInApproval = request.sessionId;
      // 模拟审批通过
      setTimeout(() => {
        sentinel.resolveApproval(request.approvalId, true);
      }, 30);
    }
  });

  const routineForOps = {
    id: 'routine_ops_clean',
    name: 'Ops 专有日志清理',
    agentId: opsBot.id,
    cronExpr: '0 3 * * *',
    instructions: '执行 /tmp/proactive_test_cache 清理',
    enabled: true,
    status: 'idle' as const
  };

  const runResult = await proactiveManager.executeRoutine(routineForOps, 'schedule');
  assert.strictEqual(runResult.status, 'success');
  assert.strictEqual(runResult.approvalRequired, true);

  // 校验 Sentinel 审批单正确携带了 opsBot 的身份
  assert.strictEqual(capturedBotIdInApproval, opsBot.id, '审批请求必须包含执行该任务的 Bot ID');
  assert(capturedSessionIdInApproval.startsWith('routine_routine_ops_clean_'), '审批请求必须带上会话 ID');

  // 校验 SessionStore 中已经自动沉淀了属于该 Bot 的独立巡检会话
  const botSessions = sessionStore.list(opsBot.id);
  assert(botSessions.length >= 1, 'SessionStore 必须记录下归属于 opsBot 的巡检会话');
  const routineSession = botSessions.find(s => s.id === runResult.sessionId);
  assert(routineSession, '归属会话必须存在');
  assert.strictEqual(routineSession.bot_id, opsBot.id);
  assert(routineSession.messages!.length >= 2, '会话必须记录用户输入与助手输出');

  console.log('  ✅ 主动巡检任务成功完成多 Bot 绑定、权限裁剪、会话沉淀与 Sentinel 审批带身份\n');

  console.log('🎉 MuseClaw A/B 方向（最简静态记忆 + 主动巡检多 Bot 打通）验收测试全部通过！');
} finally {
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}
