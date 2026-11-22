import { InfoflowCrypto } from './crypto.ts';
import { InfoflowApprovalBridge } from './approval.ts';

export interface InfoflowReceiverConfig {
  token: string;
  encodingAesKey: string;
  appId?: string;
}

export class InfoflowReceiver {
  private crypto: InfoflowCrypto;
  private bridge?: InfoflowApprovalBridge;
  private seenNonces = new Map<string, number>();

  constructor(config: InfoflowReceiverConfig, bridge?: InfoflowApprovalBridge) {
    this.crypto = new InfoflowCrypto(config.token, config.encodingAesKey, config.appId);
    this.bridge = bridge;
  }

  /**
   * 处理如流开放平台后台的 Webhook URL 校验 (GET 请求)
   */
  public handleUrlVerification(query: Record<string, string>): string {
    const { signature, timestamp, nonce, echostr } = query;
    if (!signature || !timestamp || !nonce || !echostr) {
      throw new Error('如流 URL 验证参数缺失');
    }
    return this.crypto.verifyAndDecryptEchoStr(timestamp, nonce, echostr, signature);
  }

  /**
   * 处理如流用户发来的实际消息 (POST 请求)
   */
  public handleIncomingMessage(
    query: Record<string, string>,
    rawBody: string
  ): { fromUser: string; text: string; isApproval: boolean; approved?: boolean } {
    const { signature, timestamp, nonce } = query;
    if (!signature || !timestamp || !nonce) {
      throw new Error('如流消息回调签名参数缺失');
    }

    // 时间戳时效窗口校验 (5 分钟)
    const tsNum = parseInt(timestamp, 10);
    if (!isNaN(tsNum)) {
      const nowSec = Math.floor(Date.now() / 1000);
      const diff = Math.abs(nowSec - tsNum);
      if (diff > 300) {
        throw new Error('如流消息时间戳超出时效窗口 (5分钟)');
      }
    }

    // Nonce 去重防重放
    const now = Date.now();
    for (const [n, t] of this.seenNonces.entries()) {
      if (now - t > 600000) this.seenNonces.delete(n);
    }
    if (this.seenNonces.has(nonce)) {
      throw new Error('如流消息 nonce 重复，疑似重放请求');
    }
    this.seenNonces.set(nonce, now);

    let parsedBody: { encrypt?: string } = {};
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      throw new Error('如流消息 Body 非法 JSON');
    }

    if (!parsedBody.encrypt) {
      throw new Error('如流消息缺少 encrypt 密文字段');
    }

    // 1. 签名校验
    const isValid = this.crypto.verifySignature(timestamp, nonce, parsedBody.encrypt, signature);
    if (!isValid) {
      throw new Error('如流消息签名校验失败');
    }

    // 2. 解密明文
    const plainText = this.crypto.decrypt(parsedBody.encrypt);
    const msgObj = JSON.parse(plainText);

    // 3. 提取发送人与文本内容（根据如流开放协议格式）
    const fromUser = msgObj.from || msgObj.user_id || 'unknown_user';
    const text = msgObj.content?.text || msgObj.message?.text?.content || '';

    // 4. 检查是否为“批准/拒绝”审批指令
    if (this.bridge) {
      const check = this.bridge.tryHandleApprovalCommand(text);
      if (check.isApproval) {
        return {
          fromUser,
          text,
          isApproval: true,
          approved: check.approved
        };
      }
    }

    return {
      fromUser,
      text,
      isApproval: false
    };
  }
}
