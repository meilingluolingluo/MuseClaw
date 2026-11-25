import type { McpToolSchema } from './types.ts';

export const MASK_PLACEHOLDER = '••••••••';

const QUERY_SECRET_RE = /([?&])([^=&\s'"]+)=([^&\s'"]+)/g;
const BEARER_RE = /\b(Bearer\s+)([^\s'"]+)/gi;
const BASIC_RE = /\b(Basic\s+)([^\s'"]+)/gi;

/**
 * 将敏感值统一脱敏为固定掩码占位符，空值保持为空串
 */
export function maskSecretValue(value: string): string {
  if (!value) return '';
  return MASK_PLACEHOLDER;
}

/**
 * 脱敏字符串中可能出现的 URL 查询凭据、Authorization 头与已知明文密钥
 */
export function scrubSecrets(text: string, secretValues: string[] = []): string {
  if (!text) return '';
  let scrubbed = text
    .replace(QUERY_SECRET_RE, (_, prefix: string, key: string, val: string) => {
      if (/(key|token|secret|auth|password|passwd|api_key|apikey|sig|signature)/i.test(key)) {
        return `${prefix}${key}=***`;
      }
      return `${prefix}${key}=${val}`;
    })
    .replace(BEARER_RE, '$1***')
    .replace(BASIC_RE, '$1***');

  for (const secret of secretValues) {
    if (typeof secret === 'string' && secret.length >= 6) {
      scrubbed = scrubbed.split(secret).join('***');
    }
  }
  return scrubbed;
}

/**
 * 脱敏 Record 中的值（用于向前端展示已保存密钥的键名与占位状态）
 */
export function maskSecretRecord(record?: Record<string, string>): Record<string, string> {
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = v ? MASK_PLACEHOLDER : '';
  }
  return out;
}

/**
 * 规范化暴露给 LLM 的工具名称，保证仅含合法字符且长度不超过 64
 */
export function sanitizeToolName(serverName: string, toolName: string): string {
  const raw = `mcp_${serverName}_${toolName}`;
  if (/^[a-zA-Z0-9_-]+$/.test(raw) && raw.length <= 64) {
    return raw;
  }
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (cleaned.length <= 64) return cleaned;
  return cleaned.slice(0, 64);
}

/**
 * 估算单个 MCP 工具 Schema 注入上下文后占用的近似 Token 数量
 */
export function estimateToolTokens(tool: McpToolSchema): number {
  const payload = JSON.stringify({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || {}
  });
  return Math.max(1, Math.ceil(payload.length / 4));
}

/**
 * 按字节上限裁剪文本或序列化输出，防止超大工具响应撑爆上下文
 */
export function truncateToolResult(
  value: unknown,
  maxBytes: number
): { output: string; truncated: boolean; originalBytes: number } {
  const rawText = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const originalBytes = Buffer.byteLength(rawText, 'utf8');
  if (maxBytes <= 0 || originalBytes <= maxBytes) {
    return { output: rawText, truncated: false, originalBytes };
  }

  const notice = `\n\n...[结果已截断: 原始 ${originalBytes} bytes，已按预算限制保留前 ${maxBytes} bytes]`;
  const budget = Math.max(128, maxBytes - Buffer.byteLength(notice, 'utf8'));
  let sliced = Buffer.from(rawText, 'utf8').subarray(0, budget).toString('utf8');
  // 去除末尾可能截断的替换字符
  sliced = sliced.replace(/\uFFFD+$/g, '');
  return {
    output: `${sliced}${notice}`,
    truncated: true,
    originalBytes
  };
}

/**
 * 将 MCP tools/call 返回对象规范化为可阅读文本并执行字节预算控制
 */
export function normalizeToolCallResult(
  res: any,
  maxBytes: number
): { text: string; isError: boolean; truncated: boolean; originalBytes: number; raw: unknown } {
  const isError = Boolean(res?.isError ?? res?.is_error ?? false);
  const parts: string[] = [];

  const contentList = Array.isArray(res?.content) ? res.content : Array.isArray(res) ? res : null;
  if (contentList) {
    for (const item of contentList) {
      if (!item || typeof item !== 'object') {
        parts.push(String(item ?? ''));
        continue;
      }
      if (item.type === 'text' && typeof item.text === 'string') {
        parts.push(item.text);
      } else if (item.type === 'image') {
        const mime = item.mimeType || item.mime_type || 'image';
        parts.push(`[image ${mime}]`);
      } else if (item.type === 'resource') {
        const resource = item.resource;
        if (resource && typeof resource.text === 'string') {
          parts.push(resource.text);
        } else {
          parts.push(`[resource ${resource?.uri || ''}]`);
        }
      } else {
        parts.push(JSON.stringify(item, null, 2));
      }
    }
  }

  const structured = res?.structuredContent ?? res?.structured_content;
  if (structured !== undefined && parts.length === 0) {
    parts.push(typeof structured === 'string' ? structured : JSON.stringify(structured, null, 2));
  }

  if (parts.length === 0 && res !== undefined && res !== null && !Array.isArray(res)) {
    if (typeof res === 'string') {
      parts.push(res);
    } else if (!Array.isArray(res.content)) {
      parts.push(JSON.stringify(res, null, 2));
    }
  }

  const joined = parts.filter((p) => p !== '').join('\n') || '(no output)';
  const { output, truncated, originalBytes } = truncateToolResult(joined, maxBytes);
  return {
    text: output,
    isError,
    truncated,
    originalBytes,
    raw: res
  };
}
