import { createServer } from 'node:http';
import { runAgentLoop, type LLMCaller } from '@museclaw/sandbox-core/src/loop.js';
import { createDefaultTools } from '@museclaw/sandbox-core/src/tools.js';
import { exportToShareGPT } from '@museclaw/sandbox-core/src/trajectory.js';
import { SentinelPolicyManager } from '@museclaw/sentinel/src/guard.js';

const sentinel = new SentinelPolicyManager();
const tools = createDefaultTools();

// 简单的 Mock LLM Caller (演示状态机流转；生产中可直接走 OpenAI / LiteLLM)
const defaultLLMCaller: LLMCaller = async (messages) => {
  const lastMsg = messages[messages.length - 1];
  const userText = String(lastMsg.content || '');

  // 模拟对删除操作的识别
  if (userText.includes('删除') || userText.includes('清理')) {
    return {
      content: '检测到清理数据需求，准备调用系统工具执行删除...',
      toolCalls: [
        {
          id: `call_${Date.now()}`,
          name: 'execute_shell',
          args: { command: 'rm -rf /tmp/test_cache_*' }
        }
      ]
    };
  }

  return {
    content: `已收到任务并分析完毕：${userText}。`
  };
};

/**
 * 极简中继 HTTP 服务 (可作为 Web 与 企业微信/飞书的网关)
 */
export function startGatewayServer(port = 8799) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // 1. 审批结果回调接口 (供 Web 按钮或企业微信/飞书点击回传)
    if (req.method === 'POST' && url.pathname.startsWith('/api/approvals/')) {
      const approvalId = url.pathname.replace('/api/approvals/', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const { approved } = JSON.parse(body || '{}');

      const success = sentinel.resolveApproval(approvalId, Boolean(approved));
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success, approvalId, approved }));
    }

    // 2. 派发任务入口 (以 SSE 流式输出 AG-UI 事件)
    if (req.method === 'POST' && url.pathname === '/api/tasks') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { prompt = '请帮我清理过期临时数据', userId = 'user_001', botId = 'bot_cleaner' } = JSON.parse(body || '{}');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      const loop = runAgentLoop(
        '你是一个企业内部的自动化运维助手',
        prompt,
        tools,
        sentinel,
        defaultLLMCaller,
        { sessionId: `sess_${Date.now()}`, userId, botId }
      );

      try {
        for await (const event of loop) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      }

      return res.end();
    }

    // 默认健康检查
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'MuseClaw Gateway', port }));
  });

  server.listen(port, () => {
    console.log(`🌐 MuseClaw Gateway & Relay Server 运行在: http://localhost:${port}`);
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startGatewayServer();
}
