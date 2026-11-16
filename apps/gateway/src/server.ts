import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentLoop, type LLMMessage } from '../../../packages/sandbox-core/src/loop.ts';
import { createDefaultTools } from '../../../packages/sandbox-core/src/tools.ts';
import { createDeepSeekCaller } from '../../../packages/sandbox-core/src/llm.ts';
import { MicroSandbox, CHANNEL_RANK, CHANNEL_DETAILS } from '../../../packages/sandbox-core/src/index.ts';
import { SentinelPolicyManager } from '../../../apps/sentinel/src/guard.ts';
import { createInfoflowChannel } from '../channels/infoflow/index.ts';
import { createFeishuChannel } from '../channels/feishu/index.ts';
import { ProactiveManager } from '../proactive/index.ts';
import { BotRegistry, SessionStore, SessionRouter, BotMemoryManager } from '../bots/index.ts';
import { GoalStore, GoalEngine } from '../goals/index.ts';
import { McpClientManager } from '../mcp/client.ts';
import type { RouteResult, Session, ApprovalRequest, AgentProfile } from '@museclaw/protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 自动加载根目录 .env 文件
function loadEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val.replace(/^["']|["']$/g, '');
        }
      }
    }
  }
}
loadEnv();

// 全局未捕获异常与 Promise 拒绝防御，防止网关因偶发网络波动或第三方 SDK 异常崩溃
process.on('uncaughtException', (err) => {
  console.error('💥 [Server:UncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 [Server:UnhandledRejection]', reason);
});

const sentinel = new SentinelPolicyManager();
const baseTools = createDefaultTools();
const mcpManager = new McpClientManager();
let tools = [...baseTools];

function refreshTools() {
  tools = [...baseTools, ...mcpManager.getToolDefinitions()];
  return tools;
}

const callLLM = createDeepSeekCaller();

// 1. 多 Bot 注册中心与会话存储 (BotRegistry, SessionStore, SessionRouter, BotMemoryManager)
const botRegistry = new BotRegistry();
const sessionStore = new SessionStore();
const sessionRouter = new SessionRouter(botRegistry, sessionStore);
const botMemory = new BotMemoryManager();
botMemory.ensureDefaultMemory(
  'muse',
  '# Muse 核心记忆与准则\n- 企业自动化总协调助手。\n- 优先调用工具解决问题，回答清晰精炼。'
);

function getOrCreateSession(sessionId?: string, botId?: string): Session {
  const id = sessionId || `sess_${Date.now()}`;
  let session = sessionStore.get(id);
  if (!session) {
    const defaultBot = botRegistry.getCoordinator() || botRegistry.list()[0];
    const targetBotId = botId || (defaultBot ? defaultBot.id : 'muse');
    session = sessionStore.create(id, targetBotId, '新对话');
  }
  return session;
}

// 2. 初始化如流 (Infoflow) 通道配置
const infoflowToken = process.env.INFOFLOW_TOKEN || 'museclaw_token';
const infoflowAesKey = process.env.INFOFLOW_AES_KEY || '1234567890123456789012345678901234567890123'; // 43 位
const infoflowAppId = process.env.INFOFLOW_APP_ID;
const infoflowAppSecret = process.env.INFOFLOW_APP_SECRET;
const infoflowApiBase = process.env.INFOFLOW_API_BASE;
const infoflowWebhookUrl = process.env.INFOFLOW_WEBHOOK_URL;

const infoflowChannel = createInfoflowChannel(
  {
    token: infoflowToken,
    encodingAesKey: infoflowAesKey,
    appId: infoflowAppId,
    appSecret: infoflowAppSecret,
    apiBase: infoflowApiBase,
    webhookUrl: infoflowWebhookUrl
  },
  sentinel,
  async (userId, prompt) => {
    // 路由解析支持 @Mention 与 Bot 专属记忆/策略注入
    const routeResult = sessionRouter.route({
      text: prompt,
      session_id: `infoflow_user_${userId}`,
      user_id: userId
    });
    const { bot, session_id: finalSessionId } = routeResult;
    const botWithMemory: AgentProfile = {
      ...bot,
      memory: botMemory.getMemory(bot.id)
    };

    const loop = runAgentLoop(
      bot.system_prompt || '你是一个企业内部严谨、高效的自动化数字员工。请按步骤执行。',
      prompt,
      refreshTools(),
      sentinel,
      callLLM,
      { sessionId: finalSessionId, userId, botId: bot.id, profile: botWithMemory, maxSteps: 8 }
    );

    let output = '';
    for await (const event of loop) {
      if (event.type === 'stream:text-delta') {
        output += event.text;
      }
      if (event.type === 'sentinel:approval_needed') {
        // 自动将审批指令卡片推送给如流用户
        await infoflowChannel.approvalBridge.pushApprovalNotice(userId, event.request);
      }
    }
    return output || '任务已顺利完成。';
  }
);

// 3. 初始化飞书 (Feishu) 通道配置
const feishuAppId = process.env.FEISHU_APP_ID;
const feishuAppSecret = process.env.FEISHU_APP_SECRET;
const feishuEncryptKey = process.env.FEISHU_ENCRYPT_KEY;
const feishuVerificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
const feishuWebhookUrl = process.env.FEISHU_WEBHOOK_URL;

const feishuChannel = createFeishuChannel(
  {
    appId: feishuAppId,
    appSecret: feishuAppSecret,
    encryptKey: feishuEncryptKey,
    verificationToken: feishuVerificationToken,
    webhookUrl: feishuWebhookUrl
  },
  sentinel,
  async (userId, prompt) => {
    // 路由解析支持 @Mention 与 Bot 专属记忆/策略注入
    const routeResult = sessionRouter.route({
      text: prompt,
      session_id: `feishu_user_${userId}`,
      user_id: userId
    });
    const { bot, session_id: finalSessionId } = routeResult;
    const botWithMemory: AgentProfile = {
      ...bot,
      memory: botMemory.getMemory(bot.id)
    };

    const loop = runAgentLoop(
      bot.system_prompt || '你是一个企业内部严谨、高效的自动化数字员工。请按步骤执行。',
      prompt,
      refreshTools(),
      sentinel,
      callLLM,
      { sessionId: finalSessionId, userId, botId: bot.id, profile: botWithMemory, maxSteps: 8 }
    );

    let output = '';
    for await (const event of loop) {
      if (event.type === 'stream:text-delta') {
        output += event.text;
      }
      if (event.type === 'sentinel:approval_needed') {
        // 推送飞书原生互动卡片（带允许/拒绝按钮）
        await feishuChannel.approvalBridge.pushApprovalCard(userId, event.request);
      }
    }
    return output || '任务已顺利完成。';
  }
);

// 4. 初始化例行自动化与主动任务调度器 (Proactive Automation Manager)
const proactive = new ProactiveManager({
  sentinel,
  tools: refreshTools(),
  callLLM,
  botRegistry,
  sessionStore,
  botMemory,
  onApprovalNeeded: async (request, routine) => {
    console.log(`⚠️ [Proactive] 例行任务触发审批需求: ${routine.name} (${request.approvalId})`);
    // 若配置了飞书通知目标，自动推送原生审批卡片
    const alertTarget = process.env.FEISHU_NOTIFY_USER_ID;
    if (alertTarget) {
      await feishuChannel.approvalBridge.pushApprovalCard(alertTarget, request);
    }
  },
  onRunCompleted: async (run, output) => {
    // 写入会话历史以便 Web 前端同步显示
    const session = getOrCreateSession(run.sessionId, 'ops_bot');
    session.title = `[主动巡检] ${run.routineName}`;
    session.messages.push({ role: 'user', content: `[触发源: ${run.triggerSource}] 执行例行任务: ${run.routineName}` });
    session.messages.push({ role: 'assistant', content: output });

    // 静默抑制 (Quiet When Green)：正常无异常时静默沉淀历史，不向飞书/如流骚扰推送
    if (run.quiet) {
      console.log(`[Proactive] 任务 [${run.routineName}] 运行正常 (NOTHING NEW)，静默沉淀，已抑制外部通知。`);
      return;
    }

    // 推送巡检简报到飞书
    const alertTarget = process.env.FEISHU_NOTIFY_USER_ID;
    if (alertTarget) {
      const summaryText = `📋 【MuseClaw 自动化巡检简报】${run.routineName}\n状态: ${run.status === 'success' ? '✅ 顺利完成' : '❌ 存在异常'}\n\n${output.slice(0, 450)}`;
      feishuChannel.sender.sendMessage(alertTarget, summaryText, 'text').catch(() => {});
    }
  }
});

// 5. 初始化长周期目标自驱推进引擎 (Long-Horizon Goals Engine)
const goalStore = new GoalStore();
const goalEngine = new GoalEngine({
  store: goalStore,
  sentinel,
  tools: refreshTools(),
  callLLM,
  botRegistry,
  botMemory,
  onGoalCheckInCompleted: async (result, goal) => {
    console.log(`[Goals:CheckIn] 目标 "${goal.title}" 阶段推进完成: 步骤 [${result.stepTitle || result.stepId}] -> ${result.status}`);
  }
});

/**
 * MuseClaw Gateway & Relay HTTP Server
 */
export function startGatewayServer(defaultPort = 8799) {
  const port = Number(process.env.PORT) || defaultPort;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // A. 优先处理如流 Webhook (GET 校验 / POST 消息)
    const handledByInfoflow = await infoflowChannel.handleHttpRequest(req, res);
    if (handledByInfoflow) return;

    // A2. 优先处理飞书 Webhook (Challenge / 交互卡片按钮 / 消息事件)
    const handledByFeishu = await feishuChannel.handleHttpRequest(req, res);
    if (handledByFeishu) return;

    // B. 静态主页：Web 控制台 (优先载入现代化数字员工工作台 data/web 或 apps/web，平滑兼容旧版 ui.html)
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      const modernWebCandidates = [
        path.resolve(__dirname, '../data/web/index.html'),
        path.resolve(__dirname, '../../web/index.html'),
      ];
      const modernWebPath = modernWebCandidates.find((p) => fs.existsSync(p));
      const htmlPath = modernWebPath || path.join(__dirname, 'ui.html');
      try {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      } catch {
        res.writeHead(500);
        return res.end('Web UI not found');
      }
    }

    // B2. 多 Bot 管理接口 (BotRegistry)
    if (req.method === 'GET' && url.pathname === '/api/bots') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(botRegistry.list()));
    }

    if (req.method === 'POST' && url.pathname === '/api/bots') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      if (!data.name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Bot name is required' }));
      }
      const created = botRegistry.create(data);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(created));
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/bots/')) {
      const id = url.pathname.replace('/api/bots/', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const patch = JSON.parse(body || '{}');
      try {
        const updated = botRegistry.update(id, patch);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(updated));
      } catch (err: any) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/bots/') && url.pathname.endsWith('/sessions')) {
      const id = url.pathname.replace('/api/bots/', '').replace('/sessions', '');
      const sessions = sessionStore.list(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sessions));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/bots/') && url.pathname.endsWith('/memory')) {
      const id = url.pathname.replace('/api/bots/', '').replace('/memory', '');
      const memory = botMemory.getMemory(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ bot_id: id, memory }));
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/api/bots/') && url.pathname.endsWith('/memory')) {
      const id = url.pathname.replace('/api/bots/', '').replace('/memory', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const { memory } = JSON.parse(body || '{}');
      if (typeof memory !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Field "memory" must be a string' }));
      }
      botMemory.saveMemory(id, memory);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, bot_id: id, memory }));
    }

    // 记忆受控自整理 (Memory Consolidation: POST /api/bots/:id/memory/consolidate)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/consolidate$/)) {
      const id = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const { dry_run, budget_share } = JSON.parse(body || '{}');

      try {
        const report = await botMemory.consolidateMemory(
          id,
          async (prompt) => {
            const resp = await callLLM([{ role: 'user', content: prompt }], []);
            return resp.content || '';
          },
          { dryRun: Boolean(dry_run), budgetShare: typeof budget_share === 'number' ? budget_share : 0.2 }
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, bot_id: id, report }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 记忆整理一键撤销 (Memory Consolidation Undo: POST /api/bots/:id/memory/undo)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/undo$/)) {
      const id = url.pathname.split('/')[3];
      const result = botMemory.undoLastConsolidation(id);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ bot_id: id, ...result }));
    }

    // 获取记忆整理历史审计报告 (GET /api/bots/:id/memory/reports)
    if (req.method === 'GET' && url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/reports$/)) {
      const id = url.pathname.split('/')[3];
      const reports = botMemory.getConsolidationHistory(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ bot_id: id, reports }));
    }

    // B3. 对外独立 Bot API (Headless Bot API: POST /api/bots/:id/chat)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/bots\/[^/]+\/chat$/)) {
      const botId = url.pathname.split('/')[3];
      const bot = botRegistry.get(botId);
      if (!bot || !bot.enabled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Bot [${botId}] not found or disabled` }));
      }

      let body = '';
      for await (const chunk of req) body += chunk;
      const { message, session_id } = JSON.parse(body || '{}');
      if (!message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Field "message" is required' }));
      }

      const targetSessionId = session_id || `api_${botId}_${Date.now()}`;
      const session = sessionStore.create(targetSessionId, bot.id, `[API] ${message.slice(0, 16)}`);

      const botWithMemory: AgentProfile = {
        ...bot,
        memory: botMemory.getMemory(bot.id)
      };

      const loop = runAgentLoop(
        bot.system_prompt || '你是一个企业内部严谨、高效的自动化数字员工。',
        message,
        refreshTools(),
        sentinel,
        callLLM,
        { sessionId: session.id, userId: 'external_api', botId: bot.id, profile: botWithMemory, maxSteps: 8 }
      );

      let output = '';
      let needsApproval = false;
      let pendingApprovalReq: ApprovalRequest | null = null;

      for await (const event of loop) {
        if (event.type === 'stream:text-delta') {
          output += event.text;
        }
        if (event.type === 'sentinel:approval_needed') {
          needsApproval = true;
          pendingApprovalReq = event.request;
          const alertTarget = process.env.FEISHU_NOTIFY_USER_ID;
          if (alertTarget) {
            feishuChannel.approvalBridge.pushApprovalCard(alertTarget, event.request).catch(() => {});
          }
        }
      }

      if (session.messages) {
        session.messages.push({ role: 'user', content: message });
        if (output) session.messages.push({ role: 'assistant', content: output });
        sessionStore.save(session);
      }

      if (needsApproval && pendingApprovalReq) {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: 'needs_approval',
          approval_id: pendingApprovalReq.approvalId,
          action_summary: pendingApprovalReq.actionSummary,
          session_id: session.id,
          bot_id: bot.id,
          message: '操作涉及高危动作，已被 Sentinel 拦截并推送到管理员审批通道'
        }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'completed',
        reply: output || '任务已顺利执行完毕。',
        session_id: session.id,
        bot_id: bot.id
      }));
    }

    // B4. 交付工件与产出物接口 (Artifacts Delivery)
    const artifactsDir = path.resolve(__dirname, '../data/artifacts');
    if (req.method === 'GET' && url.pathname === '/api/artifacts') {
      if (!fs.existsSync(artifactsDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([]));
      }
      const files = fs.readdirSync(artifactsDir).map((file) => {
        const stat = fs.statSync(path.join(artifactsDir, file));
        return {
          filename: file,
          sizeBytes: stat.size,
          updatedAt: stat.mtimeMs,
          url: `/api/artifacts/${encodeURIComponent(file)}`
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(files));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/artifacts/')) {
      const filename = path.basename(decodeURIComponent(url.pathname.replace('/api/artifacts/', '')));
      const filePath = path.join(artifactsDir, filename);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Artifact not found' }));
      }
      const content = fs.readFileSync(filePath);
      const isText = filename.endsWith('.txt') || filename.endsWith('.md') || filename.endsWith('.json') || filename.endsWith('.csv');
      res.writeHead(200, {
        'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/octet-stream',
        'Content-Disposition': `inline; filename="${filename}"`
      });
      return res.end(content);
    }

    // B5. 标准 MCP 工具生态管理接口 (Model Context Protocol)
    if (req.method === 'GET' && url.pathname === '/api/mcp/servers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        servers: mcpManager.listServers(),
        totalTools: mcpManager.getToolDefinitions().length
      }));
    }

    if (req.method === 'POST' && url.pathname === '/api/mcp/servers') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { name, command, args, env } = JSON.parse(body || '{}');
      if (!name || !command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Fields "name" and "command" are required' }));
      }
      try {
        await mcpManager.addServer(name, { command, args, env });
        refreshTools();
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          name,
          servers: mcpManager.listServers()
        }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/mcp/servers/')) {
      const name = url.pathname.replace('/api/mcp/servers/', '');
      const success = await mcpManager.removeServer(name);
      refreshTools();
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success }));
    }

    // C. 会话列表接口
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const botIdParam = url.searchParams.get('bot_id') || url.searchParams.get('botId') || undefined;
      const list = sessionStore.list(botIdParam).map(s => ({
        id: s.id,
        title: s.title,
        botId: s.bot_id,
        bot_id: s.bot_id,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        messageCount: s.messages ? s.messages.length : 0
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(list));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
      const id = url.pathname.replace('/api/sessions/', '');
      const s = sessionStore.get(id);
      if (!s) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Session not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(s));
    }

    // C2. 沙箱与技能阶梯状态接口 (Sandbox & Channel Ladder Status)
    if (req.method === 'GET' && url.pathname === '/api/sandbox/status') {
      const msb = new MicroSandbox();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        microSandbox: msb.getStatus(),
        channelLadder: {
          channels: CHANNEL_RANK,
          details: CHANNEL_DETAILS
        }
      }));
    }

    if (req.method === 'GET' && url.pathname.match(/^\/api\/sessions\/[^/]+\/ladder$/)) {
      const targetSessionId = url.pathname.split('/')[2]; // /api/sessions/:id/ladder -> index 3
      const actualSessionId = url.pathname.replace('/api/sessions/', '').replace('/ladder', '');
      const stats = sentinel.getChannelLadder().getSessionStats(actualSessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stats));
    }

    // D. 审批结果回调接口 (供 Web 交互卡片或外部 Webhook 点击调用，支持 scope: once | session | 24h | always)
    if (req.method === 'POST' && url.pathname.startsWith('/api/approvals/')) {
      const approvalId = url.pathname.replace('/api/approvals/', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const { approved, scope, operator } = JSON.parse(body || '{}');

      const success = sentinel.resolveApproval(approvalId, Boolean(approved), scope || 'once', operator || 'human');
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success, approvalId, approved, scope: scope || 'once' }));
    }

    // D1. 结构化审计日志接口 (Audit Trail)
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      const sessionId = url.searchParams.get('sessionId') || undefined;
      const limit = Number(url.searchParams.get('limit')) || 50;
      const logs = sentinel.getAuditLog().query({ sessionId, limit });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(logs));
    }

    // D1.2 复用授权管理接口 (Grants)
    if (req.method === 'GET' && url.pathname === '/api/grants') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sentinel.getGrantStore().list()));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/grants/') && url.pathname.endsWith('/revoke')) {
      const grantId = url.pathname.replace('/api/grants/', '').replace('/revoke', '');
      const revoked = sentinel.getGrantStore().revoke(grantId);
      res.writeHead(revoked ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: revoked, grantId }));
    }

    // D1.3 声明式外部安全策略接口 (Policy)
    if (req.method === 'GET' && url.pathname === '/api/policy') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sentinel.getPolicyConfig()));
    }

    if (req.method === 'POST' && url.pathname === '/api/policy/reload') {
      sentinel.loadPolicy();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, policy: sentinel.getPolicyConfig() }));
    }

    // D2. 例行自动化任务管理接口 (Routines)
    if (req.method === 'GET' && url.pathname === '/api/routines') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(proactive.listRoutines()));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/routines/') && url.pathname.endsWith('/run')) {
      const id = url.pathname.replace('/api/routines/', '').replace('/run', '');
      const r = proactive.getRoutine(id);
      if (!r) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Routine not found' }));
      }
      proactive.executeRoutine(r, 'manual').catch(err => {
        console.error(`[Proactive:Manual] 执行异常:`, err.message);
      });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: `任务 [${r.name}] 已手动触发` }));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/routines/') && url.pathname.endsWith('/toggle')) {
      const id = url.pathname.replace('/api/routines/', '').replace('/toggle', '');
      const enabled = proactive.toggleRoutine(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, enabled }));
    }

    if (req.method === 'GET' && url.pathname === '/api/routines/runs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(proactive.listRuns()));
    }

    // D3. 外部 Webhook 触发入口 (带 Bearer 鉴权与限流)
    if (req.method === 'GET' && url.pathname === '/api/hooks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(proactive.listHooks()));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/hooks/')) {
      const hookId = url.pathname.replace('/api/hooks/', '');
      let bodyStr = '';
      for await (const chunk of req) bodyStr += chunk;
      let bodyJson = {};
      try { bodyJson = JSON.parse(bodyStr || '{}'); } catch {}

      const authHeader = req.headers.authorization;
      const result = await proactive.handleWebhookTrigger(hookId, authHeader, bodyJson);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result.body));
    }

    // ==========================================
    // D2. 长周期目标与自主推进 API (Long-Horizon Goals API)
    // ==========================================
    // 获取目标列表 (GET /api/goals)
    if (req.method === 'GET' && url.pathname === '/api/goals') {
      const botId = url.searchParams.get('bot_id') || undefined;
      const status = (url.searchParams.get('status') as any) || undefined;
      const goals = goalStore.list({ botId, status });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(goals));
    }

    // 创建新长周期目标 (POST /api/goals)
    if (req.method === 'POST' && url.pathname === '/api/goals') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      if (!data.title) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Field "title" is required' }));
      }
      const goal = goalStore.create({
        title: data.title,
        description: data.description || data.title,
        botId: data.botId || data.bot_id || 'ops_bot',
        userId: data.userId || data.user_id || 'admin',
        category: data.category,
        cadence: data.cadence,
        steps: data.steps
      });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(goal));
    }

    // 获取特定目标详情 (GET /api/goals/:id)
    if (req.method === 'GET' && url.pathname.match(/^\/api\/goals\/[^/]+$/)) {
      const goalId = url.pathname.split('/')[3];
      const goal = goalStore.get(goalId);
      if (!goal) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Goal not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(goal));
    }

    // 自主推进当前步骤 (POST /api/goals/:id/advance)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/advance$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const override = JSON.parse(body || '{}');
      try {
        const result = await goalEngine.advanceGoal(goalId, override);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 提交计划修订提案 (POST /api/goals/:id/proposal)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/proposal$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const { reason, proposed_steps, proposedSteps } = JSON.parse(body || '{}');
      const steps = proposed_steps || proposedSteps;
      if (!reason || !Array.isArray(steps)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({ error: 'Fields "reason" and "proposed_steps" (array) are required' })
        );
      }
      const proposal = goalStore.proposeReplan(goalId, reason, steps);
      if (!proposal) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Goal not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, proposal }));
    }

    // 审批重新规划提案 (POST /api/goals/:id/proposal/resolve)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/proposal\/resolve$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const { accept } = JSON.parse(body || '{}');
      if (typeof accept !== 'boolean') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Field "accept" (boolean) is required' }));
      }
      const result = goalStore.resolveProposal(goalId, accept);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // 删除目标 (DELETE /api/goals/:id)
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/goals\/[^/]+$/)) {
      const goalId = url.pathname.split('/')[3];
      const deleted = goalStore.delete(goalId);
      res.writeHead(deleted ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: deleted }));
    }

    // E. Web 任务执行流式接口（多 Bot 路由、@Mention 支持与 /api/chat 双兼容）
    if (req.method === 'POST' && (url.pathname === '/api/tasks' || url.pathname === '/api/chat')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || '{}');
      const text = parsed.prompt || parsed.text || parsed.message || '';
      const userId = parsed.userId || parsed.user_id || 'user_web';
      const requestedSessionId = parsed.sessionId || parsed.session_id;
      const requestedBotId = parsed.botId || parsed.bot_id;

      // 1. 先进行多 Bot 路由解析 (@Mention 优先，再考虑 session_id 与 bot_id)
      let routeResult: RouteResult;
      try {
        routeResult = sessionRouter.route({
          text,
          session_id: requestedSessionId,
          bot_id: requestedBotId,
          user_id: userId
        });
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }

      const { bot, session_id: finalSessionId, mention_name } = routeResult;
      const session = sessionStore.get(finalSessionId)!;
      if (!session.messages) session.messages = [];
      if (session.messages.length === 0) {
        session.title = text.slice(0, 16) || '新任务';
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      // 发送 session 初始化事件，包含 bot_id 与 session_id
      res.write(`data: ${JSON.stringify({
        type: 'session:init',
        sessionId: session.id,
        session_id: session.id,
        botId: bot.id,
        bot_id: bot.id,
        botName: bot.name,
        title: session.title,
        mentionName: mention_name
      })}\n\n`);

      // 启动 Agent Loop，注入该 Bot 的 Profile 及专属静态记忆
      const botWithMemory: AgentProfile = {
        ...bot,
        memory: botMemory.getMemory(bot.id)
      };

      const loop = runAgentLoop(
        bot.system_prompt || '你是一个企业内部严谨、高效的自动化数字员工。',
        text,
        refreshTools(),
        sentinel,
        callLLM,
        { sessionId: session.id, userId, botId: bot.id, profile: botWithMemory, maxSteps: 8 }
      );

      let fullAssistantText = '';

      try {
        for await (const event of loop) {
          if (event.type === 'stream:text-delta') {
            fullAssistantText += event.text;
          }
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        session.messages.push({ role: 'user', content: text });
        if (fullAssistantText) {
          session.messages.push({ role: 'assistant', content: fullAssistantText });
        }
        sessionStore.save(session);
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({
          type: 'stream:text-delta',
          text: `\n[执行出错: ${err.message}]`,
          bot_id: bot.id,
          session_id: session.id
        })}\n\n`);
      }

      return res.end();
    }

    // 静态前端资源托管 (SPA 模式: 提供 MuseClaw 数字员工工作台 Web UI)
    const webDirCandidates = [
      path.resolve(__dirname, '../data/web'),
      path.resolve(__dirname, '../../web'),
    ];
    const webDir = webDirCandidates.find((d) => fs.existsSync(d) && fs.existsSync(path.join(d, 'index.html'))) || path.resolve(__dirname, '../data/web');
    if (fs.existsSync(webDir) && (req.method === 'GET' || req.method === 'HEAD')) {
      // 路径遍历攻击防御
      if (req.url && (req.url.includes('..') || req.url.includes('%2e%2e') || req.url.includes('%2E%2E'))) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Forbidden: path traversal blocked' }));
      }

      let reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
      let filePath = path.join(webDir, reqPath);
      if (!filePath.startsWith(webDir)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Forbidden' }));
      }

      // 如果请求带扩展名且文件不存在，返回 404
      const ext = path.extname(filePath).toLowerCase();
      if (ext && !fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Static asset not found' }));
      }

      // 如果属于已声明的前端 SPA 路由，fallback 到 index.html (SPA History 模式)
      const isSpaRoute = [
        '/',
        '/index.html',
        '/chat',
        '/goals',
        '/routines',
        '/memory',
        '/skills',
        '/audit',
        '/artifacts',
        '/sessions',
        '/bots'
      ].some((r) => url.pathname === r || url.pathname.startsWith(`${r}/`));

      if (isSpaRoute) {
        filePath = path.join(webDir, 'index.html');
      } else if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not found' }));
      }

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.mjs': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff2': 'font/woff2',
          '.webp': 'image/webp'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(filePath);
        return stream.pipe(res);
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Route not found' }));
  });

  server.listen(port, async () => {
    console.log(`🐾 MuseClaw Gateway & Web UI 运行在: http://localhost:${port}`);
    console.log(`📡 如流 (Infoflow) Webhook 接收端点: http://localhost:${port}/api/channels/infoflow/webhook`);
    console.log(`📡 飞书 (Feishu) Webhook 接收端点: http://localhost:${port}/api/channels/feishu/webhook`);
    console.log(`⏰ 主动任务管理端点: http://localhost:${port}/api/routines | 外部 Webhook: http://localhost:${port}/api/hooks/:id`);
    console.log(`📦 交付工件存储端点: http://localhost:${port}/api/artifacts`);
    console.log(`🔌 MCP 工具生态端点: http://localhost:${port}/api/mcp/servers`);

    // 初始化已配置的 MCP 服务器工具生态
    try {
      await mcpManager.init();
      refreshTools();
    } catch (err: any) {
      console.warn(`[MCP] 初始化提示: ${err.message}`);
    }

    // 启动 Proactive 自动化例行调度器 (每 30 秒心跳)
    proactive.start(30000);

    // 启动长周期目标 Check-in 自驱推进调度器 (每 60 秒心跳)
    goalEngine.startScheduler(60000);

    // 尝试启动飞书 WebSocket 长连接 (若已在后台开启长连接订阅)
    if (feishuAppId && feishuAppSecret) {
      feishuChannel.startWebSocket().catch((err) => {
        console.warn(`[FeishuWS] 长连接未启动: ${err.message}`);
      });
    }
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startGatewayServer();
}
