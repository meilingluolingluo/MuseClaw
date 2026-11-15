import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AuditEvent {
  ts: string;
  event: string;
  sessionId?: string;
  botId?: string;
  tool?: string;
  target?: string;
  decision?: string;
  operator?: string;
  details?: Record<string, unknown>;
}

export class AuditLog {
  private logPath: string;
  private ringBuffer: AuditEvent[] = [];
  private readonly maxBufferSize = 200;

  constructor(customPath?: string) {
    this.logPath = customPath || path.resolve(__dirname, '../../gateway/data/audit.jsonl');
    this.loadRecent();
  }

  private loadRecent(): void {
    try {
      if (fs.existsSync(this.logPath)) {
        const content = fs.readFileSync(this.logPath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        const recent = lines.slice(-this.maxBufferSize);
        for (const line of recent) {
          try {
            this.ringBuffer.push(JSON.parse(line));
          } catch {}
        }
      }
    } catch (err: any) {
      console.warn(`[AuditLog] 初始化审计缓存失败: ${err.message}`);
    }
  }

  public record(
    event: 'TOOL_CALL' | 'SENTINEL_INTERCEPT' | 'APPROVAL_DECISION' | 'TAINT_EVENT' | 'GRANT_USED' | string,
    fields: Partial<AuditEvent>
  ): AuditEvent {
    const entry: AuditEvent = {
      ts: new Date().toISOString(),
      event,
      ...fields
    };

    // 1. 存入内存 Ring Buffer
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.maxBufferSize) {
      this.ringBuffer.shift();
    }

    // 2. 追加落盘 JSONL
    try {
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err: any) {
      console.warn(`[AuditLog] 写入审计日志文件失败: ${err.message}`);
    }

    return entry;
  }

  public query(options?: { sessionId?: string; limit?: number }): AuditEvent[] {
    let result = [...this.ringBuffer];
    if (options?.sessionId) {
      result = result.filter((e) => e.sessionId === options.sessionId);
    }
    const limit = options?.limit || 50;
    return result.slice(-limit).reverse();
  }
}

export const defaultAuditLog = new AuditLog();
