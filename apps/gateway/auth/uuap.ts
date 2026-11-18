import crypto from 'node:crypto';
import type http from 'node:http';

export interface AuthUser {
  username: string;
  displayName?: string;
  email?: string;
  department?: string;
  isDev?: boolean;
}

export interface UuapAuthConfig {
  serverUrl: string;
  appKey: string;
  appSecret?: string;
  env?: 'product' | 'develop';
  devUser?: string;
  callbackPath: string;
  enableSso: boolean;
}

interface CachedSession {
  username: string;
  displayName?: string;
  expiresAt: number;
}

// 验票结果本地缓存 (10 分钟 TTL，对齐企业 UUAP 鉴权缓存策略)
const tokenCache = new Map<string, CachedSession>();

/**
 * 解析 HTTP 请求头中的 Cookie
 */
export function parseCookies(header?: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!header) return map;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx !== -1) {
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      try {
        map[key] = decodeURIComponent(val);
      } catch {
        map[key] = val;
      }
    }
  }
  return map;
}

/**
 * 获取当前鉴权配置
 */
export function getUuapConfig(): UuapAuthConfig {
  const devUser = process.env.MUSECLAW_DEV_USER || process.env.ROCLAW_DEV_USER || process.env.DEV_USER;
  const serverUrl = (process.env.UUAP_SERVER_URL || 'https://uuap.baidu.com').replace(/\/+$/, '');
  const appKey = process.env.UUAP_APP_KEY || 'museclaw';
  const appSecret = process.env.UUAP_APP_SECRET;
  const env = (process.env.UUAP_ENV as 'product' | 'develop') || 'product';
  const callbackPath = '/api/v1/callbackUrl';
  const enableSso = process.env.ENABLE_UUAP === 'true' || Boolean(process.env.UUAP_APP_KEY);

  return {
    serverUrl,
    appKey,
    appSecret,
    env,
    devUser,
    callbackPath,
    enableSso
  };
}

/**
 * 从请求提取 p_token 与 s_token 对
 */
export function extractUuapTokens(req: http.IncomingMessage, queryTicket?: string): { pToken?: string; sToken?: string; ticket?: string } {
  const cookies = parseCookies(req.headers.cookie);

  // 1. 优先提取生产/开发环境 Cookie 对
  let pToken = cookies['SECURE_UUAP_P_TOKEN'] || cookies['SECURE_UUAP_P_TOKEN_OFFLINE'];
  let sToken = cookies['SECURE_UUAP_S_TOKEN'] || cookies['UUAP_S_TOKEN'];

  // 2. Cookie 不完整时，从 SECURE_ZT_GW_TOKEN 零信任网关 JWT 中提取字段 (不将 JWT 自身当作身份凭证)
  const ztToken = cookies['SECURE_ZT_GW_TOKEN'] || (req.headers['x-zt-gw-token']?.toString());
  if ((!pToken || !sToken) && ztToken && ztToken.includes('.')) {
    try {
      const parts = ztToken.split('.');
      if (parts.length >= 2) {
        const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
        const payload = JSON.parse(payloadJson);
        if (!pToken) pToken = payload.p_token || payload.pToken;
        if (!sToken) sToken = payload.s_token || payload.sToken;
      }
    } catch {
      // 忽略无法解析的 JWT
    }
  }

  return { pToken, sToken, ticket: queryTicket };
}

/**
 * 调用 UUAP /sTokenDecrypt 将 ticket 兑换为 s_token
 */
export async function decryptTicketToSToken(
  serverUrl: string,
  appKey: string,
  ticket: string
): Promise<string | null> {
  try {
    const res = await fetch(`${serverUrl}/sTokenDecrypt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({ appKey, ticket }).toString()
    });

    if (res.ok) {
      const data = await res.json() as any;
      const token = data.sToken || data.s_token || data.result?.sToken || data.result?.s_token || data.data?.sToken;
      if (token && typeof token === 'string') {
        return token;
      }
    }
  } catch (err: any) {
    console.warn(`[UUAP] 调用 sTokenDecrypt 解密 ticket 失败: ${err.message}`);
  }
  return null;
}

/**
 * 校验 UUAP 成对 token 真实性 (带 10 分钟内存缓存)
 */
export async function validateUuapSession(
  config: UuapAuthConfig,
  pToken: string,
  sToken: string
): Promise<AuthUser | null> {
  const cacheKey = `uuap:${config.appKey}-${pToken}-${sToken}`;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      username: cached.username,
      displayName: cached.displayName || cached.username
    };
  }

  const timestamp = String(now);
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  const params: Record<string, string> = {
    appKey: config.appKey,
    pToken,
    sToken,
    timestamp,
    nonce
  };

  if (config.appSecret) {
    const sortedStr = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    params.sign = crypto.createHmac('sha256', config.appSecret).update(sortedStr).digest('hex');
  }

  try {
    const url = new URL(`${config.serverUrl}/session/validate`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (res.ok) {
      const data = await res.json() as any;
      const username = data.username || data.result?.username || data.data?.username;
      const isSuccess = data.code === 200 || data.code === 0 || data.status === 'success' || data.success === true;

      if (isSuccess && username) {
        const displayName = data.displayName || data.result?.displayName || data.name || username;
        tokenCache.set(cacheKey, {
          username,
          displayName,
          expiresAt: now + 10 * 60 * 1000 // 10 分钟缓存
        });
        return {
          username,
          displayName,
          email: data.email || data.result?.email,
          department: data.department || data.result?.department
        };
      }
    }
  } catch (err: any) {
    console.warn(`[UUAP] 请求 session/validate 验证异常: ${err.message}`);
  }

  return null;
}

/**
 * 按照规范顺序获取当前请求的登录用户身份：
 * 1. 本机开发且配置了 DEV_USER 时，仅允许回环 IP 直通
 * 2. 从 Cookie 提取 p_token 与 s_token
 * 3. 从 SECURE_ZT_GW_TOKEN 提取 token 字段
 * 4. 仅有 p_token 且带 ticket 时，兑换 s_token
 * 5. 成对 token 验票 (优先命中缓存，未命中向 UUAP 发送校验)
 */
export async function getCurrentUser(
  req: http.IncomingMessage,
  config: UuapAuthConfig,
  queryTicket?: string
): Promise<AuthUser | null> {
  // 1. 本机开发且配置了 DEV_USER 时，只允许 127.0.0.1、localhost、::1 直接使用这个用户
  if (config.devUser) {
    const remoteIp = (req.socket.remoteAddress || req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || '').replace('::ffff:', '');
    const isLoopback = ['127.0.0.1', '::1', 'localhost'].includes(remoteIp) ||
                       remoteIp.startsWith('127.') ||
                       req.headers.host?.startsWith('localhost') ||
                       req.headers.host?.startsWith('127.0.0.1');
    if (isLoopback) {
      return {
        username: config.devUser,
        displayName: `${config.devUser} (本地开发免密)`,
        isDev: true
      };
    }
  }

  // 2 & 3. 提取成对 Token
  let { pToken, sToken } = extractUuapTokens(req, queryTicket);

  // 4. 只有 p_token、URL 上还有 ticket 时，调用 UUAP /sTokenDecrypt 把 ticket 换成 s_token
  if (pToken && !sToken && queryTicket) {
    sToken = (await decryptTicketToSToken(config.serverUrl, config.appKey, queryTicket)) || undefined;
  }

  // 5. 校验成对 token
  if (pToken && sToken) {
    const user = await validateUuapSession(config, pToken, sToken);
    if (user) return user;
  }

  // 独立模式兼容：若未启用 UUAP，且处于内网服务器部署状态，兜底兼容管理员身份
  if (!config.enableSso) {
    const defaultUser = config.devUser || process.env.USER || 'admin';
    return {
      username: defaultUser,
      displayName: defaultUser,
      isDev: true
    };
  }

  return null;
}

/**
 * 构造 UUAP 统一重定向登录 URL
 */
export function buildUuapLoginUrl(
  req: http.IncomingMessage,
  config: UuapAuthConfig,
  targetOriginalUrl?: string
): string {
  const host = req.headers.host || 'localhost:8799';
  const proto = req.headers['x-forwarded-proto']?.toString().split(',')[0].trim() ||
                (host.includes('baidu-int.com') ? 'https' : 'http');

  let originalUrl = targetOriginalUrl;
  if (!originalUrl) {
    const parsed = new URL(req.url || '/', `http://${host}`);
    originalUrl = parsed.searchParams.get('originalUrl') ||
                  req.headers['x-original-url']?.toString() ||
                  `${proto}://${host}${req.url || '/'}`;
  }

  const callbackUrl = `${proto}://${host}${config.callbackPath}?originalUrl=${encodeURIComponent(originalUrl)}`;
  return `${config.serverUrl}/login?service=${encodeURIComponent(callbackUrl)}&appKey=${encodeURIComponent(config.appKey)}&version=v2`;
}

/**
 * 鉴权失败时的响应处置 (遵循标准：AJAX 返回 401 附带 Uuap-Location 头；普通页面导航 302 重定向；Bearer Token 仅返回 401 不跳转)
 */
export function handleAuthFailure(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: UuapAuthConfig,
  targetOriginalUrl?: string
) {
  // Bearer Token 请求失败仅返回 401，不跳转 UUAP
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      code: 401,
      error: 'Unauthorized',
      message: 'Invalid or expired Bearer token'
    }));
  }

  const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest' ||
                 req.headers.accept?.includes('application/json') ||
                 req.url?.startsWith('/api/');

  const loginUrl = buildUuapLoginUrl(req, config, targetOriginalUrl);

  if (isAjax) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'Uuap-Code': '302',
      'Uuap-Location': loginUrl,
      Location: loginUrl
    });
    return res.end(JSON.stringify({
      code: 401,
      error: 'AuthenticationRequired',
      message: '请登录企业统一 UUAP 身份认证',
      location: loginUrl,
      uuapLocation: loginUrl
    }));
  }

  res.writeHead(302, {
    Location: loginUrl,
    'Cache-Control': 'no-cache'
  });
  return res.end();
}
