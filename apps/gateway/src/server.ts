import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentLoop, type LLMMessage } from '../../../packages/sandbox-core/src/loop.ts';
import { createDefaultTools } from '../../../packages/sandbox-core/src/tools.ts';
import { createDeepSeekCaller } from '../../../packages/sandbox-core/src/llm.ts';
import { SentinelPolicyManager } from '../../../apps/sentinel/src/guard.ts';
import { createInfoflowChannel } from '../channels/infoflow/index.ts';
import { createFeishuChannel } from '../channels/feishu/index.ts';
import { ProactiveManager } from '../proactive/index.ts';
import { BotRegistry, SessionStore, SessionRouter, BotMemoryManager } from '../bots/index.ts';
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

const sentinel = new SentinelPolicyManager();
const baseTools = createDefaultTools();
const mcpManager = new McpClientManager();
let tools = [...baseTools];

function refreshTools() {
  tools = [...baseTools, ...mcpManager.getToolDefinitions()];
  return tools;
}

const callLLM = createDeepSeekCaller();

// 1. 初始化如流 (Infoflow) 通道配置
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
    // 异步执行 Agent 任务并支持审批桥接
    const loop = runAgentLoop(
      '你是一个企业内部严谨、高效的自动化数字员工。请按步骤执行。',
      prompt,
      tools,
      sentinel,
      callLLM,
      { sessionId: `infoflow_${Date.now()}`, userId, botId: 'ops_bot', maxSteps: 8 }
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

// 2. 初始化飞书 (Feishu) 通道配置
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
    const loop = runAgentLoop(
      '你是一个企业内部严谨、高效的自动化数字员工。请按步骤执行。',
      prompt,
      tools,
      sentinel,
      callLLM,
      { sessionId: `feishu_${Date.now()}`, userId, botId: 'ops_bot', maxSteps: 8 }
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

// 3. 多 Bot 注册中心与会话存储 (BotRegistry, SessionStore, SessionRouter, BotMemoryManager)
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

// 4. 初始化例行自动化与主动任务调度器 (Proactive Automation Manager)
const proactive = new ProactiveManager({
  sentinel,
  tools,
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

/**
 * MuseClaw Gateway & Relay HTTP Server
 */
export function startGatewayServer(port = 8799) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // A. 优先处理如流 Webhook (GET 校验 / POST 消息)
    const handledByInfoflow = await infoflowChannel.handleHttpRequest(req, res);
    if (handledByInfoflow) return;

    // A2. 优先处理飞书 Webhook (Challenge / 交互卡片按钮 / 消息事件)
    const handledByFeishu = await feishuChannel.handleHttpRequest(req, res);
    if (handledByFeishu) return;

    // B. 静态主页：Web 控制台
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const htmlPath = path.join(__dirname, 'ui.html');
      try {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      } catch {
        res.writeHead(500);
        return res.end('ui.html not found');
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

    // D. 审批结果回调接口 (供 Web 交互卡片或外部 Webhook 点击调用)
    if (req.method === 'POST' && url.pathname.startsWith('/api/approvals/')) {
      const approvalId = url.pathname.replace('/api/approvals/', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const { approved } = JSON.parse(body || '{}');

      const success = sentinel.resolveApproval(approvalId, Boolean(approved));
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success, approvalId, approved }));
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

    // E. Web 任务执行流式接口（多 Bot 路由与 @Mention 支持）
    if (req.method === 'POST' && url.pathname === '/api/tasks') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || '{}');
      const text = parsed.prompt || parsed.text || '';
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

    res.writeHead(404);
    res.end('Not Found');
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
