import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuSender } from './sender.ts';
import type { FeishuApprovalBridge } from './approval.ts';

/**
 * 启动飞书 WebSocket 长连接监听（无需公网 IP 和 Webhook）
 */
export async function startFeishuWebSocket(
  appId: string,
  appSecret: string,
  approvalBridge: FeishuApprovalBridge,
  sender: FeishuSender,
  onTaskPrompt: (user: string, prompt: string) => Promise<string>
) {
  try {
    const wsClient = new Lark.WSClient({
      appId,
      appSecret,
      loggerLevel: Lark.LoggerLevel.info
    });

    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        const senderId = data.sender?.sender_id?.open_id || data.sender?.sender_id?.user_id;
        let text = '';
        try {
          const content = JSON.parse(data.message?.content || '{}');
          text = content.text || '';
        } catch {
          // ignore parse error
        }

        if (!senderId || !text) return;

        // 检查是否为审批指令
        const handled = approvalBridge.handleTextApproval(senderId, text);
        if (handled) return;

        // 作为新任务派发到沙箱
        sender.sendMessage(senderId, `🐾 收到指令: "${text}"，沙箱任务已启动...`, 'text').catch(() => {});
        try {
          const result = await onTaskPrompt(senderId, text);
          await sender.sendMessage(senderId, result, 'text');
        } catch (err: any) {
          await sender.sendMessage(senderId, `❌ 任务执行出错: ${err.message}`, 'text');
        }
      },
      'card.action.trigger': async (data: any) => {
        const action = data.action?.value;
        if (action && action.approvalId && action.action) {
          const approved = action.action === 'approve';
          const success = approvalBridge.resolveApproval(action.approvalId, approved);
          return {
            toast: {
              type: success ? 'success' : 'warning',
              content: success ? (approved ? '已批准执行' : '已拒绝操作') : '审批无效或已处理'
            }
          };
        }
        return {};
      }
    });

    await wsClient.start({ eventDispatcher });
    console.log('📡 飞书 (Feishu) WebSocket 长连接已连接成功，正在监听事件...');
    return wsClient;
  } catch (err: any) {
    console.warn(`[FeishuWS] 长连接启动提示: ${err.message} (待飞书后台开启长连接并发布生效)`);
    return null;
  }
}
