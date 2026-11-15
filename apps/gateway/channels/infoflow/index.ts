export * from './crypto.ts';
export * from './sender.ts';
export * from './approval.ts';
export * from './receiver.ts';

import type { IncomingMessage, ServerResponse } from 'node:http';
import { InfoflowReceiver } from './receiver.ts';
import { InfoflowSender } from './sender.ts';
import { InfoflowApprovalBridge } from './approval.ts';
import type { SentinelPolicyManager } from '../../../sentinel/src/guard.js';

/**
 * 创建并集成如流接入通道
 */
export function createInfoflowChannel(
  options: {
    token: string;
    encodingAesKey: string;
    appId?: string;
    appSecret?: string;
    apiBase?: string;
    webhookUrl?: string;
  },
  sentinel: SentinelPolicyManager,
  onTaskPrompt: (user: string, prompt: string) => Promise<string>
) {
  const sender = new InfoflowSender({
    apiBase: options.apiBase,
    appId: options.appId,
    appSecret: options.appSecret,
    webhookUrl: options.webhookUrl
  });

  const approvalBridge = new InfoflowApprovalBridge(sender, sentinel);
  const receiver = new InfoflowReceiver(options, approvalBridge);

  return {
    sender,
    approvalBridge,
    receiver,

    /**
     * 处理 Gateway 接收到的 /api/channels/infoflow/webhook HTTP 请求
     */
    async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (!url.pathname.startsWith('/api/channels/infoflow/webhook')) {
        return false;
      }

      const queryParams: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        queryParams[k] = v;
      });

      // 1. GET 请求：开放平台 Webhook URL 校验
      if (req.method === 'GET') {
        try {
          const echoStr = receiver.handleUrlVerification(queryParams);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(echoStr);
          console.log('[InfoflowChannel] Webhook URL 验证通过');
        } catch (err: any) {
          res.writeHead(403);
          res.end(err.message);
        }
        return true;
      }

      // 2. POST 请求：用户发送消息
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;

        try {
          const parsed = receiver.handleIncomingMessage(queryParams, body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 0, message: 'ok' }));

          // 如果是审批指令，回复审批结果
          if (parsed.isApproval) {
            const reply = parsed.approved !== undefined
              ? (parsed.approved ? '✅ 已批准操作，沙箱任务正在恢复执行...' : '❌ 已驳回该操作。')
              : '⚠️ 未找到对应的待审批项或该审批已超时。';
            await sender.sendPrivateMessage(parsed.fromUser, reply, 'text');
            return true;
          }

          // 如果是普通任务指令，异步派发到 Agent 沙箱并回传
          if (parsed.text) {
            (async () => {
              await sender.sendPrivateMessage(parsed.fromUser, `🐾 收到指令: "${parsed.text}"，沙箱任务已启动...`, 'text');
              const finalOutput = await onTaskPrompt(parsed.fromUser, parsed.text);
              await sender.sendPrivateMessage(parsed.fromUser, finalOutput, 'markdown');
            })().catch(err => {
              sender.sendPrivateMessage(parsed.fromUser, `❌ 任务执行出错: ${err.message}`, 'text');
            });
          }
        } catch (err: any) {
          console.error('[InfoflowChannel] 消息处理异常:', err.message);
          res.writeHead(400);
          res.end(err.message);
        }
        return true;
      }

      return false;
    }
  };
}
