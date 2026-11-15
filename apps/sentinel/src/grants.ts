import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type GrantScope = 'once' | 'session' | '24h' | 'always';

export interface Grant {
  id: string;
  tool: string;
  target?: string;
  scope: GrantScope;
  sessionId?: string;
  grantedAt: number;
  expiresAt?: number;
}

export class GrantStore {
  private grants = new Map<string, Grant>();
  private storePath: string;

  constructor(customPath?: string) {
    this.storePath = customPath || path.resolve(__dirname, '../../gateway/data/grants.json');
    this.loadPersisted();
  }

  private loadPersisted(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const now = Date.now();
          for (const item of parsed) {
            // 过滤已过期的 24h 授权
            if (item.expiresAt && item.expiresAt <= now) continue;
            this.grants.set(item.id, item);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[GrantStore] 加载持久化授权失败: ${err.message}`);
    }
  }

  private savePersisted(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // 仅持久化 24h 和 always 类型的授权
      const persisted = Array.from(this.grants.values()).filter(
        (g) => g.scope === '24h' || g.scope === 'always'
      );
      fs.writeFileSync(this.storePath, JSON.stringify(persisted, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn(`[GrantStore] 保存授权到磁盘失败: ${err.message}`);
    }
  }

  /**
   * 生成授权主键 (如 execute_shell:git 或 web_fetch:api.internal)
   */
  private makeKey(tool: string, target?: string): string {
    const cleanTool = tool.toLowerCase().trim();
    const cleanTarget = target ? target.trim() : '*';
    return `${cleanTool}:${cleanTarget}`;
  }

  /**
   * 发放一个授权 (Grant)
   */
  public addGrant(params: {
    tool: string;
    target?: string;
    scope?: GrantScope;
    sessionId?: string;
  }): Grant {
    const scope: GrantScope = params.scope || 'once';
    const now = Date.now();
    let expiresAt: number | undefined;

    if (scope === '24h') {
      expiresAt = now + 24 * 3600 * 1000;
    }

    const id = `grant_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const grant: Grant = {
      id,
      tool: params.tool,
      target: params.target,
      scope,
      sessionId: params.sessionId,
      grantedAt: now,
      expiresAt
    };

    if (scope !== 'once') {
      this.grants.set(id, grant);
      if (scope === '24h' || scope === 'always') {
        this.savePersisted();
      }
      console.log(`[GrantStore] 已记录授权 [${id}] ${grant.tool} (${grant.target || '*'}) Scope: ${scope}`);
    }

    return grant;
  }

  /**
   * 检查针对特定 tool 和 target 是否存在依然有效的授权
   */
  public check(tool: string, target?: string, sessionId?: string): { hasGrant: boolean; grant?: Grant } {
    const now = Date.now();
    const cleanTool = tool.toLowerCase().trim();

    for (const [id, grant] of this.grants.entries()) {
      // 1. 检查工具名是否匹配
      if (grant.tool.toLowerCase().trim() !== cleanTool && grant.tool !== '*') {
        continue;
      }

      // 2. 检查过期时间
      if (grant.expiresAt && grant.expiresAt <= now) {
        this.grants.delete(id);
        continue;
      }

      // 3. 检查会话作用域
      if (grant.scope === 'session') {
        if (!grant.sessionId || grant.sessionId !== sessionId) {
          continue;
        }
      }

      // 4. 检查目标匹配 (精确匹配或前缀匹配或通配)
      if (grant.target && grant.target !== '*' && target) {
        const matchesTarget = target === grant.target || target.startsWith(grant.target) || grant.target.startsWith(target);
        if (!matchesTarget) continue;
      }

      return { hasGrant: true, grant };
    }

    return { hasGrant: false };
  }

  public revoke(id: string): boolean {
    const deleted = this.grants.delete(id);
    if (deleted) this.savePersisted();
    return deleted;
  }

  public list(): Grant[] {
    const now = Date.now();
    return Array.from(this.grants.values()).filter((g) => !g.expiresAt || g.expiresAt > now);
  }
}
