export interface FeishuSenderConfig {
  appId?: string;
  appSecret?: string;
  webhookUrl?: string; // 自定义群机器人 Webhook (可选)
  apiBase?: string;    // 默认 https://open.feishu.cn
}

export interface FeishuSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  raw?: unknown;
}

export class FeishuSender {
  private appId?: string;
  private appSecret?: string;
  private webhookUrl?: string;
  private apiBase: string;
  private cachedToken?: { token: string; expiresAt: number };

  constructor(config: FeishuSenderConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.webhookUrl = config.webhookUrl;
    this.apiBase = config.apiBase || 'https://open.feishu.cn';
  }

  /**
   * 获取或刷新飞书 tenant_access_token
   */
  public async getTenantAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    if (!this.appId || !this.appSecret) {
      throw new Error('未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
    }

    const res = await fetch(`${this.apiBase}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret
      })
    });

    const data = await res.json();
    if (!res.ok || data.code !== 0) {
      throw new Error(`获取飞书 Token 失败: ${JSON.stringify(data)}`);
    }

    const expiresIn = (data.expire || 7200) - 60;
    this.cachedToken = {
      token: data.tenant_access_token,
      expiresAt: Date.now() + expiresIn * 1000
    };

    return this.cachedToken.token;
  }

  /**
   * 发送飞书消息（支持私聊、群聊、默认接收人，支持纯文本与互动卡片）
   */
  public async sendMessage(
    receiveId?: string,
    content?: Record<string, unknown> | string,
    msgType: 'text' | 'interactive' = 'text',
    receiveIdType?: 'open_id' | 'user_id' | 'chat_id' | 'email',
    title?: string
  ): Promise<FeishuSendResult> {
    const targetId = receiveId || process.env.FEISHU_NOTIFY_USER_ID;

    // 优先支持自定义机器人 Webhook
    if (this.webhookUrl && !targetId) {
      return this.sendWebhook(content || '', msgType, title);
    }

    if (!targetId && !this.webhookUrl) {
      return {
        success: false,
        error: '未指定接收人 ID (receive_id)，且环境变量未配置 FEISHU_NOTIFY_USER_ID 或 FEISHU_WEBHOOK_URL'
      };
    }

    // 智能推断 receive_id_type
    let effectiveIdType = receiveIdType;
    if (!effectiveIdType && targetId) {
      if (targetId.startsWith('oc_')) effectiveIdType = 'chat_id';
      else if (targetId.startsWith('ou_')) effectiveIdType = 'open_id';
      else if (targetId.startsWith('on_')) effectiveIdType = 'open_id';
      else if (targetId.includes('@')) effectiveIdType = 'email';
      else effectiveIdType = 'open_id';
    }

    try {
      const token = await this.getTenantAccessToken();
      const url = `${this.apiBase}/open-apis/im/v1/messages?receive_id_type=${effectiveIdType || 'open_id'}`;

      let bodyContent: string;
      if (msgType === 'interactive') {
        let cardObj: Record<string, unknown>;
        if (typeof content === 'string') {
          // 如果传入普通 Markdown 或文本，自动格式化为飞书标准富文本卡片
          cardObj = {
            config: { wide_screen_mode: true },
            header: {
              template: 'blue',
              title: { tag: 'plain_text', content: title || 'MuseClaw 巡检与通知' }
            },
            elements: [
              {
                tag: 'div',
                text: { tag: 'lark_md', content }
              }
            ]
          };
        } else {
          cardObj = content || {};
        }
        bodyContent = JSON.stringify(cardObj);
      } else {
        const textStr = typeof content === 'string' ? content : JSON.stringify(content);
        bodyContent = JSON.stringify({ text: textStr });
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          receive_id: targetId,
          msg_type: msgType,
          content: bodyContent
        })
      });

      const data = await res.json();
      if (!res.ok || data.code !== 0) {
        return {
          success: false,
          error: `飞书 API 调用失败 (code: ${data?.code}): ${data?.msg || JSON.stringify(data)}`,
          raw: data
        };
      }

      return {
        success: true,
        messageId: data.data?.message_id,
        raw: data.data
      };
    } catch (err: any) {
      return {
        success: false,
        error: `发送飞书消息异常: ${err?.message || String(err)}`
      };
    }
  }

  /**
   * 通过群机器人 Webhook 发送
   */
  public async sendWebhook(
    content: Record<string, unknown> | string,
    msgType: 'text' | 'interactive' = 'text',
    title?: string
  ): Promise<FeishuSendResult> {
    if (!this.webhookUrl) {
      return { success: false, error: '未配置 飞书 webhookUrl' };
    }

    try {
      let payload: Record<string, unknown>;
      if (msgType === 'text') {
        const textStr = typeof content === 'string' ? content : JSON.stringify(content);
        payload = { msg_type: 'text', content: { text: textStr } };
      } else {
        let card = typeof content === 'string' ? null : content;
        if (!card && typeof content === 'string') {
          card = {
            config: { wide_screen_mode: true },
            header: {
              template: 'blue',
              title: { tag: 'plain_text', content: title || 'MuseClaw 巡检与通知' }
            },
            elements: [{ tag: 'div', text: { tag: 'lark_md', content } }]
          };
        }
        payload = { msg_type: 'interactive', card };
      }

      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || data.code !== 0) {
        return { success: false, error: `Webhook 发送失败: ${data?.msg || JSON.stringify(data)}`, raw: data };
      }
      return { success: true, raw: data };
    } catch (err: any) {
      return { success: false, error: `Webhook 异常: ${err?.message || err}` };
    }
  }
}
