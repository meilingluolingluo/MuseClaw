export interface InfoflowSenderConfig {
  apiBase?: string; // 默认 https://api.im.baidu.com 或内网 https://apiin.im.baidu.com
  appId?: string;
  appSecret?: string;
  webhookUrl?: string; // 如果使用自定义群机器人 Webhook
}

export class InfoflowSender {
  private apiBase: string;
  private appId?: string;
  private appSecret?: string;
  private webhookUrl?: string;
  private cachedToken?: { token: string; expiresAt: number };

  constructor(config: InfoflowSenderConfig) {
    this.apiBase = config.apiBase || 'https://api.im.baidu.com';
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.webhookUrl = config.webhookUrl;
  }

  /**
   * 获取或刷新 Access Token
   */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    if (!this.appId || !this.appSecret) {
      throw new Error('未配置 appId 或 appSecret，无法获取如流 AccessToken');
    }

    const url = `${this.apiBase}/api/v1/token?app_id=${encodeURIComponent(this.appId)}&app_secret=${encodeURIComponent(this.appSecret)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.code !== 0) {
      throw new Error(`获取如流 Token 失败: ${JSON.stringify(data)}`);
    }

    // 默认缓存有效时间（扣减 60 秒缓冲区）
    const expiresIn = (data.expires_in || 7200) - 60;
    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000
    };

    return this.cachedToken.token;
  }

  /**
   * 发送私聊消息（支持 Markdown 与普通文本）
   */
  public async sendPrivateMessage(userId: string, content: string, format: 'markdown' | 'text' = 'markdown'): Promise<boolean> {
    // 优先支持通过自定义机器人 Webhook 发送
    if (this.webhookUrl) {
      return this.sendWebhookMessage(content, format);
    }

    const token = await this.getAccessToken();
    const url = `${this.apiBase}/api/v1/message/send?access_token=${token}`;

    const body = {
      to: [userId],
      message: {
        type: format,
        [format]: { content }
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await res.json();
    return res.ok && result.code === 0;
  }

  /**
   * 通过群机器人 Webhook 发送
   */
  public async sendWebhookMessage(content: string, format: 'markdown' | 'text' = 'markdown'): Promise<boolean> {
    if (!this.webhookUrl) {
      throw new Error('未配置 如流 webhookUrl');
    }

    const body = {
      message: {
        type: format,
        [format]: { content }
      }
    };

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const result = await res.json();
    return res.ok && result.code === 0;
  }
}
