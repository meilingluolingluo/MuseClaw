/**
 * Credential Vault & Sensitive Output Redaction
 *
 * 核心安全机制：
 * 1. 凭据隔离：真实凭据（API Key, App Secret, Database Password, Token 等）
 *    对模型上下文以占位符 {{vault:NAME}} 形式展现，杜绝直接暴露明文。
 * 2. 出站还原：在工具执行调用（execute_shell, http_request 等）前将 {{vault:NAME}} 还原为真实值。
 * 3. 输出脱敏：工具执行输出在返回给模型、保存日志或推送到前端前，自动扫描并
 *    将已知凭据打码替换为 [REDACTED:NAME]，防止由于工具报错、echo 或 dump 造成静默数据外泄。
 */

export class CredentialVault {
  private secrets = new Map<string, string>();
  private readonly minRedactLength = 4;

  constructor() {
    this.initFromEnv();
  }

  /**
   * 从当前进程环境变量中自动探测并纳管敏感凭据
   */
  public initFromEnv(env: NodeJS.ProcessEnv = process.env): void {
    const sensitiveKeyPatterns = [
      'KEY',
      'SECRET',
      'PASSWORD',
      'TOKEN',
      'PASS',
      'CREDENTIAL',
      'PRIVATE',
      'AUTH'
    ];

    for (const [key, value] of Object.entries(env)) {
      if (!value || typeof value !== 'string') continue;
      const keyUpper = key.toUpperCase();
      const isSensitive = sensitiveKeyPatterns.some((pattern) => keyUpper.includes(pattern));
      // 过滤太短或纯数字/布尔值类环境变量
      if (isSensitive && value.length >= this.minRedactLength && value !== 'true' && value !== 'false') {
        this.set(key, value);
      }
    }
  }

  public set(name: string, value: string): void {
    if (!name || !value) return;
    this.secrets.set(name, value);
  }

  public get(name: string): string | undefined {
    return this.secrets.get(name);
  }

  public has(name: string): boolean {
    return this.secrets.has(name);
  }

  public delete(name: string): boolean {
    return this.secrets.delete(name);
  }

  public names(): string[] {
    return Array.from(this.secrets.keys());
  }

  /**
   * 将参数中的占位符 {{vault:NAME}} 还原为真实的凭据明文
   */
  public resolve<T = any>(input: T): T {
    if (typeof input === 'string') {
      return input.replace(/\{\{\s*vault:([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) => {
        const val = this.get(key);
        return val !== undefined ? val : match;
      }) as unknown as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.resolve(item)) as unknown as T;
    }

    if (input !== null && typeof input === 'object') {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(input as Record<string, any>)) {
        result[k] = this.resolve(v);
      }
      return result as unknown as T;
    }

    return input;
  }

  /**
   * 将字符串中的真实敏感明文打码脱敏为 [REDACTED:KEY_NAME]
   * 采用“最长优先”排序替换，防止子串破坏外层凭据
   */
  public redact(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let sanitized = text;

    // 按明文长度从大到小排序
    const sortedEntries = Array.from(this.secrets.entries())
      .filter(([_, val]) => val && val.length >= this.minRedactLength)
      .sort((a, b) => b[1].length - a[1].length);

    for (const [key, val] of sortedEntries) {
      if (!val) continue;
      // 全局转义并替换
      const escapedVal = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedVal, 'g');
      sanitized = sanitized.replace(regex, `[REDACTED:${key}]`);
    }

    return sanitized;
  }

  /**
   * 将输入文本中的真实敏感明文转换为安全占位符 {{vault:KEY_NAME}}
   * 便于提供给 LLM 提示词上下文，使 LLM 能引用占位符而不知晓真实明文
   */
  public maskToPlaceholder(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let masked = text;
    const sortedEntries = Array.from(this.secrets.entries())
      .filter(([_, val]) => val && val.length >= this.minRedactLength)
      .sort((a, b) => b[1].length - a[1].length);

    for (const [key, val] of sortedEntries) {
      if (!val) continue;
      const escapedVal = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedVal, 'g');
      masked = masked.replace(regex, `{{vault:${key}}}`);
    }

    return masked;
  }
}

export const defaultVault = new CredentialVault();
