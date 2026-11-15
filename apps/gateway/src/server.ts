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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sentinel = new SentinelPolicyManager();
const tools = createDefaultTools();
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

// 3. 会话持久化与多轮历史存储
interface SessionData {
  id: string;
  title: string;
  botId: string;
  messages: LLMMessage[];
  createdAt: number;
}

const sessions = new Map<string, SessionData>();

function getOrCreateSession(sessionId?: string, botId = 'ops_bot'): SessionData {
  const id = sessionId || `sess_${Date.now()}`;
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      title: '新对话',
      botId,
      messages: [],
      createdAt: Date.now()
    });
  }
  return sessions.get(id)!;
}

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

    // C. 会话列表接口
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const list = Array.from(sessions.values()).map(s => ({
        id: s.id,
        title: s.title,
        botId: s.botId,
        createdAt: s.createdAt,
        messageCount: s.messages.length
      })).reverse();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(list));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
      const id = url.pathname.replace('/api/sessions/', '');
      const s = sessions.get(id);
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

    // E. Web 任务执行流式接口（多轮上下文支持）
    if (req.method === 'POST' && url.pathname === '/api/tasks') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { prompt = '', userId = 'user_web', botId = 'ops_bot', sessionId } = JSON.parse(body || '{}');

      const session = getOrCreateSession(sessionId, botId);
      if (session.messages.length === 0) {
        session.title = prompt.slice(0, 16) || '新任务';
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      res.write(`data: ${JSON.stringify({ type: 'session:init', sessionId: session.id, title: session.title })}\n\n`);

      const systemPrompt = `你是一个企业内部严谨、高效的自动化数字员工。
你可以自主调用已提供的工具链（Shell 执行、浏览器导航等）来完成用户的复杂指令。
回答请结构清晰、言简意赅。`;

      const loop = runAgentLoop(
        systemPrompt,
        prompt,
        tools,
        sentinel,
        callLLM,
        { sessionId: session.id, userId, botId, maxSteps: 8 }
      );

      let fullAssistantText = '';

      try {
        for await (const event of loop) {
          if (event.type === 'stream:text-delta') {
            fullAssistantText += event.text;
          }
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }

        session.messages.push({ role: 'user', content: prompt });
        if (fullAssistantText) {
          session.messages.push({ role: 'assistant', content: fullAssistantText });
        }
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ type: 'stream:text-delta', text: `\n[执行出错: ${err.message}]` })}\n\n`);
      }

      return res.end();
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, () => {
    console.log(`🐾 MuseClaw Gateway & Web UI 运行在: http://localhost:${port}`);
    console.log(`📡 如流 (Infoflow) Webhook 接收端点: http://localhost:${port}/api/channels/infoflow/webhook`);
    console.log(`📡 飞书 (Feishu) Webhook 接收端点: http://localhost:${port}/api/channels/feishu/webhook`);
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startGatewayServer();
}
