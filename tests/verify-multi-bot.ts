import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotRegistry } from '../apps/gateway/bots/registry.ts';
import { SessionStore } from '../apps/gateway/bots/session-store.ts';
import { SessionRouter } from '../apps/gateway/bots/router.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import { runAgentLoop, type LLMCaller, type ToolDefinition } from '../packages/sandbox-core/src/loop.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🧪 开始测试 MuseClaw 多 Bot 主框架（类型 + Registry + 路由 + 会话隔离 + Sentinel 联动）...\n');

// 临时测试存储路径
const testDataDir = path.resolve(__dirname, '../apps/gateway/data/test_run');
if (!fs.existsSync(testDataDir)) fs.mkdirSync(testDataDir, { recursive: true });

const testBotsFile = path.join(testDataDir, 'test_bots.json');
const testSessionsFile = path.join(testDataDir, 'test_sessions.json');
if (fs.existsSync(testBotsFile)) fs.unlinkSync(testBotsFile);
if (fs.existsSync(testSessionsFile)) fs.unlinkSync(testSessionsFile);

// ==========================================
// 1. 测试 BotRegistry (启动自动创建默认 Bot 与 CRUD)
// ==========================================
console.log('1. 测试 BotRegistry 自动创建默认 Bot 与 Coordinator 唯一性...');
const registry = new BotRegistry(testBotsFile);

const initialBots = registry.list();
assert.strictEqual(initialBots.length, 1, '空配置启动时必须自动创建 1 个默认 Bot');
const defaultBot = initialBots[0];
assert.strictEqual(defaultBot.name, 'Muse', '默认 Bot 名称必须为 Muse');
assert.strictEqual(defaultBot.is_coordinator, true, '默认 Bot 必须是 Coordinator');
assert.strictEqual(defaultBot.enabled, true, '默认 Bot 必须处于启用状态');
assert(defaultBot.memory_ns.includes('bots/'), '必须配置独立记忆空间');

// 创建第二个 Bot: 运维助手 Ops Bot
const opsBot = registry.create({
  id: 'ops_bot',
  name: 'Ops Bot',
  description: 'Linux 运维与故障排查专家',
  system_prompt: '你是一个精通 Linux 运维的数字员工。',
  tool_allowlist: ['execute_shell'],
  memory_ns: 'bots/ops_bot'
});
assert.strictEqual(opsBot.name, 'Ops Bot');
assert.strictEqual(opsBot.is_coordinator, false);
assert.deepStrictEqual(opsBot.tool_allowlist, ['execute_shell']);

// 创建第三个带空格名称的 Bot: Data Analyst
const dataBot = registry.create({
  id: 'data_analyst',
  name: 'Data Analyst',
  description: '数据统计分析助手',
  system_prompt: '你是一个数据统计分析专家。',
  tool_allowlist: ['*'],
  memory_ns: 'bots/data_analyst'
});

// 测试将 Data Analyst 设为 Coordinator，必须自动清除 Muse 的 Coordinator
registry.update('data_analyst', { is_coordinator: true });
assert.strictEqual(registry.get('data_analyst')?.is_coordinator, true);
assert.strictEqual(registry.get('muse')?.is_coordinator, false, '设新 Coordinator 时其他 Bot 的 Coordinator 必须被清除');

// 测试 case-insensitive 查找
assert.strictEqual(registry.findByName('ops bot')?.id, 'ops_bot');
assert.strictEqual(registry.findByName('OPS BOT')?.id, 'ops_bot');
assert.strictEqual(registry.findByName('data analyst')?.id, 'data_analyst');
assert.strictEqual(registry.findByName('NonExistent'), undefined);

console.log('  ✅ BotRegistry CRUD、默认创建与 Coordinator 唯一性 100% 通过\n');

// ==========================================
// 2. 测试 SessionStore (会话强从属与不可换绑)
// ==========================================
console.log('2. 测试 SessionStore 归属校验与禁止换绑...');
const sessionStore = new SessionStore(testSessionsFile);

// 创建属于 Ops Bot 的会话
const sessOps = sessionStore.create('sess_ops_1', 'ops_bot', '运维会话');
assert.strictEqual(sessOps.bot_id, 'ops_bot');

// 尝试给已有 sess_ops_1 换绑到 data_analyst 必须抛错
let rebindBlocked = false;
try {
  sessionStore.create('sess_ops_1', 'data_analyst');
} catch (err: any) {
  rebindBlocked = true;
  assert(err.message.includes('禁止将已有会话换绑到另一 Bot'));
}
assert.strictEqual(rebindBlocked, true, 'create() 尝试换绑已有会话必须被阻止');

// save() 尝试篡改 bot_id 也必须抛错
let saveRebindBlocked = false;
try {
  sessionStore.save({
    id: 'sess_ops_1',
    bot_id: 'data_analyst',
    updated_at: Date.now()
  });
} catch (err: any) {
  saveRebindBlocked = true;
  assert(err.message.includes('禁止将已有会话换绑到另一 Bot'));
}
assert.strictEqual(saveRebindBlocked, true, 'save() 尝试变更会话 bot_id 必须被阻止');

console.log('  ✅ SessionStore 强绑定与换绑防御 100% 通过\n');

// ==========================================
// 3. 测试 SessionRouter (@Mention 路由与跨 Bot 切会话)
// ==========================================
console.log('3. 测试 SessionRouter 路由解析与 @Mention 行为...');
const router = new SessionRouter(registry, sessionStore);

// 3.1 基础路由：无任何参数，默认路由到 Coordinator (data_analyst)
const defaultRoute = router.route({ text: '你好' });
assert.strictEqual(defaultRoute.bot.id, 'data_analyst');
assert(defaultRoute.session_id.startsWith('sess_'));

// 3.2 携带 session_id 路由：路由到会话原属 Bot (ops_bot)
const sessRoute = router.route({ text: '查看磁盘', session_id: 'sess_ops_1' });
assert.strictEqual(sessRoute.bot.id, 'ops_bot');
assert.strictEqual(sessRoute.session_id, 'sess_ops_1');

// 3.3 携带 session_id 但明确携带了不同的 bot_id -> 自动为新 Bot 开新 session，不破坏旧 session
const switchBotRoute = router.route({
  text: '帮我分析月报',
  session_id: 'sess_ops_1',
  bot_id: 'data_analyst'
});
assert.strictEqual(switchBotRoute.bot.id, 'data_analyst', '必须切到指定的 data_analyst');
assert.notStrictEqual(switchBotRoute.session_id, 'sess_ops_1', '必须分配新 session_id');
assert.strictEqual(sessionStore.get('sess_ops_1')?.bot_id, 'ops_bot', '旧会话的归属必须保持 ops_bot 不变');

// 3.4 在 A 的会话里 @B -> 自动路由到 B 并开新会话 (支持 @Name 与 @"Name With Space")
// 测试带引号的多单词 Mention: @"Data Analyst"
const mentionQuotedRoute = router.route({
  text: '@"Data Analyst" 统计今日活跃用户数',
  session_id: 'sess_ops_1'
});
assert.strictEqual(mentionQuotedRoute.bot.id, 'data_analyst');
assert.strictEqual(mentionQuotedRoute.mention_name, 'Data Analyst');
assert.notStrictEqual(mentionQuotedRoute.session_id, 'sess_ops_1', '@Mention 另一 Bot 必须生成独立新会话');

// 测试单单词 Mention: @Muse
const mentionMuseRoute = router.route({
  text: '@Muse 你好',
  session_id: 'sess_ops_1'
});
assert.strictEqual(mentionMuseRoute.bot.id, 'muse');
assert.strictEqual(mentionMuseRoute.mention_name, 'Muse');

// 测试 @ 未知 Bot 必须报错
let unknownMentionError = false;
try {
  router.route({ text: '@Nobody 醒醒' });
} catch (err: any) {
  unknownMentionError = true;
  assert(err.message.includes('未找到名为 "Nobody" 的已启用 Bot'));
}
assert.strictEqual(unknownMentionError, true, '@ 未知 Bot 必须明确报错');

console.log('  ✅ SessionRouter @Mention 与切会话隔离 100% 通过\n');

// ==========================================
// 4. 测试 Loop 注入 profile 与 Sentinel 审批带 bot_id
// ==========================================
console.log('4. 测试 Agent Loop 工具白名单、提示词与 Sentinel 审批包含 bot_id...');
const sentinel = new SentinelPolicyManager();

// 构造两个工具：execute_shell 和 browser_open
const allTools: ToolDefinition[] = [
  {
    name: 'execute_shell',
    description: 'Shell',
    parameters: { type: 'object', properties: { command: { type: 'string' } } },
    execute: async (args) => ({ stdout: 'shell output' })
  },
  {
    name: 'browser_open',
    description: 'Browser',
    parameters: { type: 'object', properties: { url: { type: 'string' } } },
    execute: async (args) => ({ status: 'navigated' })
  }
];

let receivedToolsInLLM: string[] = [];
let capturedSystemPrompt = '';

const mockLLM: LLMCaller = async (messages, tools) => {
  receivedToolsInLLM = tools.map(t => t.name);
  capturedSystemPrompt = messages.find(m => m.role === 'system')?.content || '';
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role === 'tool') {
    return { content: '完成', toolCalls: [] };
  }
  return {
    content: '调用破坏性高危 Shell 命令',
    toolCalls: [{ id: 'c1', name: 'execute_shell', args: { command: 'rm -rf /test' } }]
  };
};

let capturedApprovalBotId = '';
let capturedApprovalSessionId = '';

const loop = runAgentLoop(
  '基础 Prompt',
  '清理测试目录',
  allTools,
  sentinel,
  mockLLM,
  {
    sessionId: 'sess_loop_test',
    userId: 'user_test',
    botId: 'ops_bot',
    profile: opsBot // Ops Bot 的 tool_allowlist 仅有 ['execute_shell']
  }
);

for await (const event of loop) {
  if (event.type === 'sentinel:approval_needed') {
    capturedApprovalBotId = event.request.botId || event.request.bot_id || '';
    capturedApprovalSessionId = event.request.sessionId || event.request.session_id || '';
    // 异步延时批准，确保生成器已经进入 waitForApproval 挂起态
    setTimeout(() => {
      sentinel.resolveApproval(event.request.approvalId, true);
    }, 20);
  }
}

// 4.1 校验工具白名单过滤：只保留了 execute_shell，browser_open 被过滤
assert.deepStrictEqual(receivedToolsInLLM, ['execute_shell'], '工具集必须根据 Profile 的 tool_allowlist 严格过滤');

// 4.2 校验 System Prompt 注入了 Profile 设定与 memory_ns
assert(capturedSystemPrompt.includes('精通 Linux 运维'), '必须注入 Profile 自身的 system_prompt');
assert(capturedSystemPrompt.includes('bots/ops_bot'), '必须注入 Profile 自身的 memory_ns');

// 4.3 校验 Sentinel 审批事件带上了 botId 和 sessionId
assert.strictEqual(capturedApprovalBotId, 'ops_bot', '审批请求必须包含发起它的 bot_id');
assert.strictEqual(capturedApprovalSessionId, 'sess_loop_test', '审批请求必须包含会话 session_id');

console.log('  ✅ Agent Loop Profile 注入与 Sentinel 审批带 bot_id 100% 通过\n');

// 清理测试目录
fs.rmSync(testDataDir, { recursive: true, force: true });

console.log('🎉 MuseClaw 第一阶段：多 Bot 主框架（类型 + Registry + 路由 + 会话隔离 + Sentinel 闭环）验收全部通过！');
