import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentLoop } from '../../../packages/sandbox-core/src/loop.ts';
import { createDefaultTools } from '../../../packages/sandbox-core/src/tools.ts';
import { createDeepSeekCaller } from '../../../packages/sandbox-core/src/llm.ts';
import { SentinelPolicyManager } from '../../../apps/sentinel/src/guard.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sentinel = new SentinelPolicyManager();
const tools = createDefaultTools();
const callLLM = createDeepSeekCaller();

/**
 * MuseClaw Gateway & Relay HTTP Server
 */
export function startGatewayServer(port = 8799) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // 1. 静态主页：Web 控制台 (通讯录 Roster UI)
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

    // 2. 审批结果回调接口 (供 Web 交互卡片或企业 IM 机器人点击调用)
    if (req.method === 'POST' && url.pathname.startsWith('/api/approvals/')) {
      const approvalId = url.pathname.replace('/api/approvals/', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const { approved } = JSON.parse(body || '{}');

      const success = sentinel.resolveApproval(approvalId, Boolean(approved));
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success, approvalId, approved }));
    }

    // 3. 任务执行流式接口 (SSE 输出 AG-UI / MuseEvent)
    if (req.method === 'POST' && url.pathname === '/api/tasks') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { prompt = '', userId = 'user_web', botId = 'ops_bot' } = JSON.parse(body || '{}');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      const loop = runAgentLoop(
        '你是一个企业内部严谨的自动化助手。请根据指令调用工具解决问题。',
        prompt,
        tools,
        sentinel,
        callLLM,
        { sessionId: `sess_${Date.now()}`, userId, botId, maxSteps: 8 }
      );

      try {
        for await (const event of loop) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ type: 'stream:text-delta', text: `\n[执行出错: ${err.message}]` })}\n\n`);
      }

      return res.end();
    }

    // 默认 404
    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(port, () => {
    console.log(`\n========================================================`);
    console.log(`🐾 MuseClaw Web 控制台与 Gateway 已启动!`);
    console.log(`👉 请在浏览器直接打开: http://localhost:${port}`);
    console.log(`========================================================\n`);
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startGatewayServer();
}
