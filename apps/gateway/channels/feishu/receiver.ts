import { FeishuCrypto } from './crypto.ts';
import { FeishuApprovalBridge } from './approval.ts';

export interface FeishuReceiverConfig {
  encryptKey?: string;
  verificationToken?: string;
}

export class FeishuReceiver {
  private crypto: FeishuCrypto;
  private bridge?: FeishuApprovalBridge;

  constructor(config: FeishuReceiverConfig, bridge?: FeishuApprovalBridge) {
    this.crypto = new FeishuCrypto(config.encryptKey, config.verificationToken);
    this.bridge = bridge;
  }

  /**
   * 处理飞书 Webhook 回调核心逻辑
   */
  public handleEvent(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string
  ): {
    isChallenge: boolean;
    challengeResponse?: { challenge: string };
    isCardAction?: boolean;
    cardActionResult?: { success: boolean; approvalId: string; approved: boolean };
    isTextMessage?: boolean;
    fromUser?: string;
    text?: string;
    isApprovalCommand?: boolean;
  } {
    // 1. 签名校验 (如果配置了 EncryptKey)
    const timestamp = String(headers['x-lark-request-timestamp'] || '');
    const nonce = String(headers['x-lark-request-nonce'] || '');
    const signature = String(headers['x-lark-signature'] || '');

    if (signature && !this.crypto.verifySignature(timestamp, nonce, rawBody, signature)) {
      throw new Error('飞书请求签名校验失败');
    }

    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error('飞书推送数据非法 JSON');
    }

    // 2. 如果数据经过 AES 加密，先解密
    if (payload.encrypt) {
      const decrypted = this.crypto.decrypt(payload.encrypt);
      payload = JSON.parse(decrypted);
    }

    // 3. 校验请求 (URL 挑战校验)
    if (payload.type === 'url_verification' && payload.challenge) {
      return {
        isChallenge: true,
        challengeResponse: { challenge: payload.challenge }
      };
    }

    // 4. 处理飞书卡片按钮点击事件 (交互卡片回调)
    if (payload.action && payload.action.value && this.bridge) {
      const result = this.bridge.handleCardAction(payload.action.value);
      return {
        isCardAction: true,
        cardActionResult: result
      };
    }

    // 5. 处理 v2.0 消息接收事件 (im.message.receive_v1)
    if (payload.header?.event_type === 'im.message.receive_v1') {
      const event = payload.event;
      const fromUser = event.sender?.sender_id?.open_id || event.sender?.sender_id?.user_id || 'unknown';
      let text = '';

      if (event.message?.message_type === 'text') {
        try {
          const contentObj = JSON.parse(event.message.content || '{}');
          text = contentObj.text || '';
        } catch {
          text = event.message.content || '';
        }
      }

      // 检查文本是否为“批准/拒绝”指令
      let isApprovalCommand = false;
      if (this.bridge && text) {
        const check = this.bridge.tryHandleTextApproval(text);
        if (check.isApproval) {
          isApprovalCommand = true;
        }
      }

      return {
        isChallenge: false,
        isTextMessage: true,
        fromUser,
        text,
        isApprovalCommand
      };
    }

    return { isChallenge: false };
  }
}
