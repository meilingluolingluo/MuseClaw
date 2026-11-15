/**
 * MuseClaw Proactive Automation Types (例行任务与 Webhook 触发类型定义)
 */

export interface Routine {
  id: string;
  name: string;
  agentId: string;                // e.g. "ops_bot" | "data_bot" | "crawler_bot"
  cronExpr: string;               // e.g. "0 9 * * 1-5" 或 "*/15 * * * *" 或 "@every 5m"
  timezone?: string;              // e.g. "Asia/Shanghai"
  instructions: string;           // 预配置的任务指引（非用户临时输入）
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  status: 'idle' | 'running' | 'paused';
}

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  triggerSource: 'schedule' | 'webhook' | 'manual';
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'success' | 'failed';
  error?: string;
  summary?: string;
  output?: string;
  approvalRequired: boolean;
  sessionId?: string;
}

export interface WebhookHook {
  id: string;
  name: string;
  agentId: string;
  instructionsTemplate: string;   // 固定业务处理模板
  secret: string;                 // Bearer Token 鉴权密钥
  enabled: boolean;
  maxPending: number;             // 允许并发挂起的最大上限（超限返回 429）
  createdAt: number;
}
