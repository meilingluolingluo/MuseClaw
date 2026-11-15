import crypto from 'node:crypto';

/**
 * 如流 (Infoflow) 消息加解密与签名工具
 * 遵循如流开放平台标准：AES-256-CBC + PKCS#7 + SHA-1 签名
 */
export class InfoflowCrypto {
  private token: string;
  private aesKey: Buffer;
  private iv: Buffer;
  private appId?: string;

  constructor(token: string, encodingAesKey: string, appId?: string) {
    this.token = token;
    this.appId = appId;
    // 如流 EncodingAESKey 为 43 位 Base64 字符串，末尾补 '=' 为 32 字节 AES 密钥
    this.aesKey = Buffer.from(encodingAesKey + '=', 'base64');
    if (this.aesKey.length !== 32) {
      throw new Error(`EncodingAESKey 长度无效，解码后必须为 32 字节 (当前: ${this.aesKey.length})`);
    }
    // IV 为 AESKey 前 16 字节
    this.iv = this.aesKey.subarray(0, 16);
  }

  /**
   * 校验如流 Webhook 签名 (SHA-1)
   */
  public verifySignature(timestamp: string, nonce: string, encryptOrEchoStr: string, signature: string): boolean {
    const list = [this.token, timestamp, nonce, encryptOrEchoStr].sort();
    const sha1 = crypto.createHash('sha1').update(list.join('')).digest('hex');
    return sha1 === signature;
  }

  /**
   * 验签并解密 URL 验证时的 echostr
   */
  public verifyAndDecryptEchoStr(timestamp: string, nonce: string, echoStr: string, signature: string): string {
    if (!this.verifySignature(timestamp, nonce, echoStr, signature)) {
      throw new Error('如流 Webhook 验签失败');
    }
    return this.decrypt(echoStr);
  }

  /**
   * 解密如流收到的加密密文
   */
  public decrypt(encryptedBase64: string): string {
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, this.iv);
    decipher.setAutoPadding(false);

    let decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedBase64, 'base64')), decipher.final()]);

    // 剔除 PKCS#7 填充
    const padLength = decrypted[decrypted.length - 1];
    if (padLength < 1 || padLength > 32) {
      throw new Error('解密数据填充长度无效');
    }
    decrypted = decrypted.subarray(0, decrypted.length - padLength);

    // 协议格式：16字节随机数 + 4字节内容长度 (网络大端字节序) + 内容明文 + appId
    const contentLen = decrypted.readUInt32BE(16);
    const content = decrypted.subarray(20, 20 + contentLen).toString('utf-8');

    return content;
  }

  /**
   * 加密回复明文（如需加密回包）
   */
  public encrypt(plainText: string): string {
    const random16 = crypto.randomBytes(16);
    const msgBuf = Buffer.from(plainText, 'utf-8');
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(msgBuf.length, 0);

    const appIdBuf = Buffer.from(this.appId || '', 'utf-8');
    const rawBuf = Buffer.concat([random16, lengthBuf, msgBuf, appIdBuf]);

    // PKCS#7 填充至 32 字节整数倍
    const padLen = 32 - (rawBuf.length % 32);
    const padBuf = Buffer.alloc(padLen, padLen);
    const fullBuf = Buffer.concat([rawBuf, padBuf]);

    const cipher = crypto.createCipheriv('aes-256-cbc', this.aesKey, this.iv);
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(fullBuf), cipher.final()]);

    return encrypted.toString('base64');
  }
}
