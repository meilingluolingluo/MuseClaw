export interface FeishuSenderConfig {
  appId?: string;
  appSecret?: string;
  webhookUrl?: string; // 自定义群机器人 Webhook (可选)
  apiBase?: string;    // 默认 https://open.feishu.cn
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
   * 发送私聊消息（支持文本或互动卡片）
   */
  public async sendMessage(
    receiveId: string,
    content: Record<string, unknown> | string,
    msgType: 'text' | 'interactive' = 'text',
    receiveIdType: 'open_id' | 'user_id' | 'chat_id' = 'open_id'
  ): Promise<boolean> {
    // 优先支持自定义机器人 Webhook
    if (this.webhookUrl) {
      return this.sendWebhook(content, msgType);
    }

    const token = await this.getTenantAccessToken();
    const url = `${this.apiBase}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;

    const bodyContent = typeof content === 'string'
      ? (msgType === 'text' ? JSON.stringify({ text: content }) : content)
      : JSON.stringify(content);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: msgType,
        content: bodyContent
      })
    });

    const data = await res.json();
    return res.ok && data.code === 0;
  }

  /**
   * 通过群机器人 Webhook 发送
   */
  public async sendWebhook(content: Record<string, unknown> | string, msgType: 'text' | 'interactive' = 'text'): Promise<boolean> {
    if (!this.webhookUrl) {
      throw new Error('未配置 飞书 webhookUrl');
    }

    const payload = msgType === 'text'
      ? { msg_type: 'text', content: { text: typeof content === 'string' ? content : JSON.stringify(content) } }
      : { msg_type: 'interactive', card: typeof content === 'string' ? JSON.parse(content) : content };

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    return res.ok && data.code === 0;
  }
}
