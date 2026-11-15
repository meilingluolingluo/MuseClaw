import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';
import { runAgentLoop, type LLMCaller } from '../packages/sandbox-core/src/loop.ts';
import { ProactiveManager } from '../apps/gateway/proactive/manager.ts';
import { BotRegistry } from '../apps/gateway/bots/registry.ts';
import { SessionStore } from '../apps/gateway/bots/session-store.ts';
import { McpClientManager } from '../apps/gateway/mcp/client.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.resolve(__dirname, './.tmp_test_five_features');

console.log('🧪 开始测试 MuseClaw 五项核心高阶能力（静默巡检 + 差异化审批 + 交付工件 + 对外 Bot API + MCP 工具生态）...\n');

if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}
fs.mkdirSync(testDir, { recursive: true });

try {
  const sentinel = new SentinelPolicyManager();
  const tools = createDefaultTools({ artifactsDir: path.join(testDir, 'artifacts') });

  // ==========================================
  // 1. 测试 Feature 1: 静默巡检与防骚扰机制 (Quiet When Green / NOTHING NEW)
  // ==========================================
  console.log('1. 测试静默巡检机制 (NOTHING NEW 自动抑制外部推送)...');
  let notifiedOutputs: string[] = [];
  const quietLLM: LLMCaller = async () => ({
    content: '巡检完毕：系统各项运行指标良好。\nNOTHING NEW',
    toolCalls: []
  });

  const proactiveQuiet = new ProactiveManager({
    sentinel,
    tools,
    callLLM: quietLLM,
    onRunCompleted: async (run, output) => {
      if (!run.quiet) {
        notifiedOutputs.push(output);
      }
    }
  });

  const routineA = {
    id: 'routine_green',
    name: '健康无异常例行任务',
    agentId: 'ops_bot',
    cronExpr: '0 9 * * *',
    instructions: '健康检查',
    enabled: true,
    status: 'idle' as const
  };

  const runQuiet = await proactiveQuiet.executeRoutine(routineA, 'manual');
  assert.strictEqual(runQuiet.status, 'success');
  assert.strictEqual(runQuiet.quiet, true, '包含 NOTHING NEW 的巡检结果必须标记为 quiet: true');
  assert.strictEqual(notifiedOutputs.length, 0, 'quiet: true 时绝不能向外部通知渠道发送推送');
  console.log('  ✅ NOTHING NEW 巡检自动静默沉淀，成功抑制无意义骚扰通知\n');

  // ==========================================
  // 2. 测试 Feature 2: Bot 差异化审批分级 (Per-Bot Approval Levels)
  // ==========================================
  console.log('2. 测试 Bot 差异化审批级别 (ask vs auto_edits vs full)...');

  // 2.1 ask 级别（严格模式）：写入或破坏均拦截
  const checkAsk = sentinel.evaluateToolCall('delete_data', {}, { approval_level: 'ask' });
  assert.strictEqual(checkAsk.isDangerous, true, 'ask 模式下危险名称动作必须拦截');

  // 2.2 auto_edits 级别：放行文档与工件保存，但仍然拦截命令破坏
  const checkAutoEdit = sentinel.evaluateToolCall('save_artifact', { filename: 'a.txt' }, { approval_level: 'auto_edits' });
  assert.strictEqual(checkAutoEdit.isDangerous, false, 'auto_edits 模式下编辑/工件动作必须自动免批放行');

  const checkAutoEditRm = sentinel.evaluateToolCall('execute_shell', { command: 'rm -rf /data' }, { approval_level: 'auto_edits' });
  assert.strictEqual(checkAutoEditRm.isDangerous, true, 'auto_edits 模式下底层系统破坏命令依然强制拦截');

  // 2.3 full 级别：普通工具放行，但云元数据死线依然物理拦截
  const checkFullNormal = sentinel.evaluateToolCall('delete_temp_cache', {}, { approval_level: 'full' });
  assert.strictEqual(checkFullNormal.isDangerous, false, 'full 模式下常规业务动作免批');

  const checkFullMetadata = sentinel.evaluateToolCall('execute_shell', { command: 'curl http://169.254.169.254/' }, { approval_level: 'full' });
  assert.strictEqual(checkFullMetadata.isDangerous, true, 'full 模式下探测云元数据死线依然必须拦截');
  console.log('  ✅ ask / auto_edits / full 三级审批策略执行精准，兼顾心流与底线安全\n');

  // ==========================================
  // 3. 测试 Feature 3: 产出物/工件归档与交付 (Artifacts Delivery)
  // ==========================================
  console.log('3. 测试 save_artifact 工具自动产出归档与下载能力...');
  const artifactTool = tools.find(t => t.name === 'save_artifact')!;
  assert(artifactTool, '必须存在 save_artifact 工具');

  const artifactRes = await artifactTool.execute({
    filename: 'server_weekly_report.md',
    title: '服务器周度巡检简报',
    content: '# 巡检总结\n- CPU: 正常\n- 内存: 充足'
  }) as { success: boolean; filename: string; url: string };

  assert.strictEqual(artifactRes.success, true);
  assert.strictEqual(artifactRes.filename, 'server_weekly_report.md');
  assert.strictEqual(artifactRes.url, '/api/artifacts/server_weekly_report.md');

  const savedFilePath = path.join(testDir, 'artifacts', 'server_weekly_report.md');
  assert(fs.existsSync(savedFilePath), '工件实体文件必须保存到指定目录');
  const savedContent = fs.readFileSync(savedFilePath, 'utf-8');
  assert(savedContent.includes('# 巡检总结'));
  console.log('  ✅ 任务交付工件自动归档落盘，生成有效下载路由\n');

  // ==========================================
  // 4. 测试 Feature 4: 对外独立 Bot API (Headless Bot API)
  // ==========================================
  console.log('4. 测试对特定 Bot 发起 Headless 独立 API 请求与会话承接...');
  const botRegistry = new BotRegistry(path.join(testDir, 'bots.json'));
  const sessionStore = new SessionStore(path.join(testDir, 'sessions.json'));

  const codeBot = botRegistry.create({
    name: 'Code Reviewer',
    system_prompt: '你是一个严格的代码审查机器人。',
    tool_allowlist: ['save_artifact'],
    approval_level: 'auto_edits'
  });

  const apiLLM: LLMCaller = async (messages) => {
    return { content: '代码审查通过：无潜在空指针异常。', toolCalls: [] };
  };

  const apiLoop = runAgentLoop(
    codeBot.system_prompt,
    '请审查 PR #128',
    tools,
    sentinel,
    apiLLM,
    {
      sessionId: `api_review_${Date.now()}`,
      userId: 'gitlab_ci',
      botId: codeBot.id,
      profile: codeBot,
      maxSteps: 8
    }
  );

  let apiReply = '';
  for await (const event of apiLoop) {
    if (event.type === 'stream:text-delta') apiReply += event.text;
  }
  assert(apiReply.includes('代码审查通过'));
  console.log('  ✅ 对特定 Bot 发起 Headless 调用闭环通过\n');

  // ==========================================
  // 5. 测试 Feature 5: 标准 MCP 工具生态接入 (Model Context Protocol)
  // ==========================================
  console.log('5. 测试标准 MCP (Model Context Protocol) Stdio 客户端握手与工具透传...');
  const mockServerPath = path.resolve(__dirname, './mock-mcp-server.mjs');
  const mcpConfigPath = path.join(testDir, 'mcp_servers.json');
  const mcpManager = new McpClientManager(mcpConfigPath);

  // 添加并启动一个 MCP 模拟工具服务器
  const mcpTools = await mcpManager.addServer('calc', {
    command: 'node',
    args: [mockServerPath]
  });

  assert(mcpTools.length >= 1, '必须成功发现 MCP 工具');
  const calcTool = mcpTools.find(t => t.name === 'mcp_calc_calculate_sum');
  assert(calcTool, '必须成功将 MCP calculate_sum 映射为 mcp_calc_calculate_sum');

  // 调用该 MCP 工具
  const calcResult = await calcTool.execute({ a: 15, b: 27 }) as any;
  assert(JSON.stringify(calcResult).includes('42'), 'MCP 工具计算执行结果必须正确返回 (15 + 27 = 42)');

  // 验证服务器列表与动态清理
  const serverList = mcpManager.listServers();
  assert.strictEqual(serverList.length, 1);
  assert.strictEqual(serverList[0].name, 'calc');

  await mcpManager.removeServer('calc');
  assert.strictEqual(mcpManager.listServers().length, 0);
  console.log('  ✅ 标准 MCP 客户端握手、工具发现、执行调用与注销 100% 成功\n');

  console.log('🎉 MuseClaw 5 大核心功能全链路验收 100% 通过！');
} finally {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}
