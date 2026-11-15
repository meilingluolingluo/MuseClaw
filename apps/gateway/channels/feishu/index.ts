export * from './crypto.ts';
export * from './sender.ts';
export * from './approval.ts';
export * from './receiver.ts';

import type { IncomingMessage, ServerResponse } from 'node:http';
import { FeishuReceiver } from './receiver.ts';
import { FeishuSender } from './sender.ts';
import { FeishuApprovalBridge } from './approval.ts';
import type { SentinelPolicyManager } from '../../../sentinel/src/guard.ts';

export interface FeishuChannelOptions {
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  webhookUrl?: string;
  apiBase?: string;
}

/**
 * 创建飞书 (Feishu / Lark) 通道
 */
export function createFeishuChannel(
  options: FeishuChannelOptions,
  sentinel: SentinelPolicyManager,
  onTaskPrompt: (user: string, prompt: string) => Promise<string>
) {
  const sender = new FeishuSender(options);
  const approvalBridge = new FeishuApprovalBridge(sender, sentinel);
  const receiver = new FeishuReceiver(options, approvalBridge);

  return {
    sender,
    approvalBridge,
    receiver,

    /**
     * 处理 Gateway 接收到的 /api/channels/feishu/webhook HTTP 请求
     */
    async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (!url.pathname.startsWith('/api/channels/feishu/webhook')) {
        return false;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method Not Allowed');
        return true;
      }

      let rawBody = '';
      for await (const chunk of req) rawBody += chunk;

      try {
        const parsed = receiver.handleEvent(req.headers, rawBody);

        // 1. 响应开放平台 URL 校验请求 (Challenge)
        if (parsed.isChallenge && parsed.challengeResponse) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(parsed.challengeResponse));
          console.log('[FeishuChannel] Webhook URL 校验通过');
          return true;
        }

        // 2. 响应卡片按钮点击 (即时回写卡片状态)
        if (parsed.isCardAction && parsed.cardActionResult) {
          const { approved, success } = parsed.cardActionResult;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          // 返回 toast 提示以及更新后的卡片内容
          const cardReply = {
            toast: {
              type: success ? 'success' : 'warning',
              content: success ? (approved ? '已批准执行' : '已拒绝操作') : '审批无效或已处理'
            }
          };
          res.end(JSON.stringify(cardReply));
          return true;
        }

        // 3. 响应用户私聊文本消息
        if (parsed.isTextMessage && parsed.fromUser) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 0 }));

          // 如果是文本方式回复的“批准/拒绝”指令
          if (parsed.isApprovalCommand) {
            return true;
          }

          // 否则作为新任务提交进沙箱
          if (parsed.text) {
            (async () => {
              await sender.sendMessage(parsed.fromUser!, `🐾 收到指令: "${parsed.text}"，沙箱任务已启动...`, 'text');
              const finalOutput = await onTaskPrompt(parsed.fromUser!, parsed.text);
              await sender.sendMessage(parsed.fromUser!, finalOutput, 'text');
            })().catch((err) => {
              sender.sendMessage(parsed.fromUser!, `❌ 任务执行出错: ${err.message}`, 'text');
            });
          }
          return true;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 0 }));
        return true;
      } catch (err: any) {
        console.error('[FeishuChannel] 处理异常:', err.message);
        res.writeHead(400);
        res.end(err.message);
        return true;
      }
    }
  };
}
