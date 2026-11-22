import crypto from 'node:crypto';

/**
 * 飞书开放平台加解密与验签工具
 * 遵循飞书开放平台规范：
 * - 验签：SHA256(timestamp + nonce + encryptKey + body)
 * - 解密：AES-256-CBC，Key = SHA256(encryptKey)，IV = 密文前 16 字节
 */
export class FeishuCrypto {
  private encryptKey?: string;
  private verificationToken?: string;

  constructor(encryptKey?: string, verificationToken?: string) {
    this.encryptKey = encryptKey;
    this.verificationToken = verificationToken;
  }

  /**
   * 校验飞书回调签名 (X-Lark-Signature)
   */
  public verifySignature(timestamp: string, nonce: string, body: string, signature: string): boolean {
    if (!this.encryptKey) return false;
    if (!timestamp || !nonce || !signature) return false;
    const strToSign = timestamp + nonce + this.encryptKey + body;
    const computed = crypto.createHash('sha256').update(strToSign).digest('hex');
    return computed === signature;
  }

  /**
   * 解密飞书推送的加密数据
   */
  public decrypt(encryptBase64: string): string {
    if (!this.encryptKey) {
      throw new Error('未配置 FEISHU_ENCRYPT_KEY，无法解密');
    }

    // 飞书 AES Key 是 EncryptKey 的 SHA256 哈希 (32 字节)
    const key = crypto.createHash('sha256').update(this.encryptKey).digest();
    const rawBuffer = Buffer.from(encryptBase64, 'base64');

    // 密文前 16 字节为 IV
    const iv = rawBuffer.subarray(0, 16);
    const encryptedData = rawBuffer.subarray(16);

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

    return decrypted.toString('utf-8');
  }

  /**
   * 加密数据（用于测试或自签名回包）
   */
  public encrypt(plainText: string): string {
    if (!this.encryptKey) {
      throw new Error('未配置 FEISHU_ENCRYPT_KEY，无法加密');
    }

    const key = crypto.createHash('sha256').update(this.encryptKey).digest();
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(plainText, 'utf-8')), cipher.final()]);

    // 拼接 IV + 密文后 Base64 输出
    return Buffer.concat([iv, encrypted]).toString('base64');
  }
}
