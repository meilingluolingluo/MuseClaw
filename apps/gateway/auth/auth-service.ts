import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface UserAccount {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  createdAt?: string;
}

export interface UserSession {
  token: string;
  userId: string;
  username: string;
  displayName: string;
  createdAt: string;
  expiresAt: string;
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const bufA = Buffer.from(hash, 'hex');
  const bufB = Buffer.from(expectedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export class AuthService {
  private usersFile: string;
  private sessionsFile: string;
  private users: Map<string, UserAccount> = new Map();
  private sessions: Map<string, UserSession> = new Map();

  constructor(storageDir?: string) {
    const baseDir = storageDir || path.resolve(__dirname, '../data/auth');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    this.usersFile = path.join(baseDir, 'users.json');
    this.sessionsFile = path.join(baseDir, 'sessions.json');
    this.loadUsers();
    this.loadSessions();
  }

  private loadUsers(): void {
    if (fs.existsSync(this.usersFile)) {
      try {
        const raw = fs.readFileSync(this.usersFile, 'utf8');
        const list: UserAccount[] = JSON.parse(raw);
        for (const u of list) {
          this.users.set(u.username.toLowerCase(), u);
        }
      } catch (err) {
        console.warn('[AuthService] 加载用户数据异常:', err);
      }
    }
  }

  private saveUsers(): void {
    const list = Array.from(this.users.values());
    const tempFile = `${this.usersFile}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tempFile, this.usersFile);
  }

  private loadSessions(): void {
    if (fs.existsSync(this.sessionsFile)) {
      try {
        const raw = fs.readFileSync(this.sessionsFile, 'utf8');
        const list: UserSession[] = JSON.parse(raw);
        const now = Date.now();
        for (const s of list) {
          if (new Date(s.expiresAt).getTime() > now) {
            this.sessions.set(s.token, s);
          }
        }
      } catch (err) {
        console.warn('[AuthService] 加载会话数据异常:', err);
      }
    }
  }

  private saveSessions(): void {
    const list = Array.from(this.sessions.values());
    const tempFile = `${this.sessionsFile}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tempFile, this.sessionsFile);
  }

  public register(usernameInput: string, passwordInput: string, displayNameInput?: string): { user: AuthUser; token: string } {
    const username = (usernameInput || '').trim().toLowerCase();
    const password = (passwordInput || '').trim();
    const displayName = (displayNameInput || '').trim() || username;

    if (!username || !/^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,32}$/.test(username)) {
      throw new Error('用户名需为 2-32 位字符（支持字母、数字、中文、下划线与中划线）');
    }
    if (!password || password.length < 6) {
      throw new Error('密码长度不得少于 6 位');
    }
    if (this.users.has(username)) {
      throw new Error('该账号已被注册，请直接登录');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const now = new Date().toISOString();
    const user: UserAccount = {
      id: `usr_${crypto.randomBytes(6).toString('hex')}`,
      username,
      displayName,
      passwordHash,
      salt,
      createdAt: now
    };

    this.users.set(username, user);
    this.saveUsers();

    const token = this.createSession(user);
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        createdAt: user.createdAt
      },
      token
    };
  }

  public login(usernameInput: string, passwordInput: string): { user: AuthUser; token: string } {
    const username = (usernameInput || '').trim().toLowerCase();
    const password = (passwordInput || '').trim();

    if (!username || !password) {
      throw new Error('请输入用户名和密码');
    }

    const account = this.users.get(username);
    if (!account) {
      throw new Error('账号或密码错误');
    }

    const isValid = verifyPassword(password, account.salt, account.passwordHash);
    if (!isValid) {
      throw new Error('账号或密码错误');
    }

    const token = this.createSession(account);
    return {
      user: {
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        createdAt: account.createdAt
      },
      token
    };
  }

  public logout(token: string): boolean {
    if (this.sessions.has(token)) {
      this.sessions.delete(token);
      this.saveSessions();
      return true;
    }
    return false;
  }

  private createSession(user: UserAccount): string {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const session: UserSession = {
      token,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: now.toISOString(),
      expiresAt
    };

    this.sessions.set(token, session);
    this.saveSessions();
    return token;
  }

  public validateSession(token: string): AuthUser | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(token);
      this.saveSessions();
      return null;
    }

    return {
      id: session.userId,
      username: session.username,
      displayName: session.displayName,
      createdAt: session.createdAt
    };
  }

  public getCurrentUser(req: http.IncomingMessage): AuthUser | null {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const bearerToken = authHeader.slice(7).trim();
      const user = this.validateSession(bearerToken);
      if (user) return user;
    }

    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['museclaw_session'];
    if (sessionToken) {
      return this.validateSession(sessionToken);
    }

    return null;
  }

  public createSessionCookie(token: string, isHttps = false): string {
    const maxAge = 30 * 24 * 3600;
    return `museclaw_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps ? '; Secure' : ''}`;
  }

  public createClearCookie(): string {
    return 'museclaw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  }
}

export const authService = new AuthService();
