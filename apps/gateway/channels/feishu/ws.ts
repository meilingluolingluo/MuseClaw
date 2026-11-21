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
  let wsClient: any = null;

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

      console.log(`[FeishuWS] 收到来自用户 ${senderId} 的消息: "${text}"`);

      // 检查是否为审批指令
      const approvalRes = approvalBridge.tryHandleTextApproval(text);
      if (approvalRes.isApproval) {
        console.log(`[FeishuWS] 审批指令已处理: ${text} -> ${approvalRes.approved}`);
        return;
      }

      // 作为新任务派发到沙箱
      console.log(`[FeishuWS] 启动 Agent 沙箱任务: "${text}"`);
      sender.sendMessage(senderId, `🐾 收到指令: "${text}"，沙箱任务已启动...`, 'text').catch((err) => {
        console.warn(`[FeishuWS] 发送确认消息提示: ${err.message}`);
      });

      try {
        const result = await onTaskPrompt(senderId, text);
        await sender.sendMessage(senderId, result, 'text');
        console.log(`[FeishuWS] 任务执行完成，结果已推送到飞书。`);
      } catch (err: any) {
        console.error(`[FeishuWS] 任务执行或回传异常: ${err.message}`);
        await sender.sendMessage(senderId, `❌ 任务执行出错: ${err.message}`, 'text').catch(() => {});
      }
    },
    'card.action.trigger': async (data: any) => {
      const action = data.action?.value;
      if (action && action.approvalId && action.action) {
        const res = approvalBridge.handleCardAction(action);
        return {
          toast: {
            type: res.success ? 'success' : 'warning',
            content: res.success ? (res.approved ? '已批准执行' : '已拒绝操作') : '审批无效或已处理'
          }
        };
      }
      return {};
    }
  });

  const connect = async () => {
    try {
      wsClient = new Lark.WSClient({
        appId,
        appSecret,
        loggerLevel: Lark.LoggerLevel.info,
        autoReconnect: true,
        onError: (err: any) => {
          console.warn(`[FeishuWS] WebSocket 状态提示: ${err?.message || err}`);
        },
        onReconnecting: () => {
          console.log(`[FeishuWS] 正在尝试重新连接飞书长连接网关...`);
        },
        onReconnected: () => {
          console.log(`[FeishuWS] 飞书长连接已重新建立就绪。`);
        }
      });

      await wsClient.start({ eventDispatcher });
      console.log('📡 飞书 (Feishu) WebSocket 长连接已连接成功，正在监听事件...');
      return wsClient;
    } catch (err: any) {
      console.warn(`[FeishuWS] 长连接启动提示: ${err.message} (待飞书后台开启长连接并发布生效)`);
      return null;
    }
  };

  return connect();
}
