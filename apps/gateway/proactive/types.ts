/**
 * MuseClaw Proactive Automation Types (例行任务与自动化调度类型系统)
 */

export type ScheduleKind = 'cron' | 'every' | 'at';
export type DeliverTarget = 'silent' | 'feed' | 'im_webhook' | 'all';
export type OverlapPolicy = 'skip' | 'queue';
export type MisfirePolicy = 'skip' | 'run_once';
export type RoutineRunStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'timeout' | 'interrupted';

export interface RoutineStats {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  avgDurationMs: number;
}

export interface Routine {
  id: string;
  name: string;
  agentId: string;                // e.g. "ops_bot" | "data_bot" | "muse"
  scheduleKind: ScheduleKind;     // 'cron' | 'every' | 'at'
  cronExpr: string;               // e.g. "0 9 * * 1-5" 或 "@every 15m" 或 "@at 2026-11-22T10:00:00Z"
  scheduleHumanZh?: string;       // 中文自然语言可读描述
  timezone?: string;              // e.g. "Asia/Shanghai"
  instructions: string;           // 任务核心指引与执行目标
  enabled: boolean;
  status: 'idle' | 'running' | 'paused';
  lastRunAt?: number;
  lastStatus?: RoutineRunStatus;
  recentOutcomes?: RoutineRunStatus[];
  nextRunAt?: number;
  nextRunTimes?: number[];        // 未来接下来的 3 次触发时间预览
  overlap?: OverlapPolicy;        // 'skip' (默认跳过) | 'queue'
  misfirePolicy?: MisfirePolicy;  // 'skip' (默认跳过过期窗口) | 'run_once'
  jitterSeconds?: number;         // 随机抖动偏移上限 (秒)
  maxRetries?: number;            // 瞬时异常自动重试次数
  circuitBreakerThreshold?: number; // 连续失败熔断阈值
  consecutiveFailures?: number;   // 当前连续失败次数
  circuitBrokenAt?: number;       // 触发连续失败熔断的时间戳
  timeoutSeconds?: number;        // 超时限制 (默认 300 秒)
  feedPublish?: boolean;          // 是否在执行完成后发布至动态 Feed
  deliverTo?: DeliverTarget;      // 'silent' | 'feed' | 'im_webhook' | 'all'
  webhookUrl?: string;            // 外部 Webhook 通知投递地址
  modelOverride?: string;         // 可选任务专属模型覆盖
  hasQueuedRun?: boolean;         // 是否有排队的待执行槽位
  deleteAfterRun?: boolean;       // 单次执行完毕后是否自动归档
  webhookSecret?: string;         // 专属 Webhook 鉴权密钥 (用于外部系统触发)
  stats?: RoutineStats;           // 运行时执行统计
  createdAt?: number;
  updatedAt?: number;
}

export interface RoutineToolCall {
  tool: string;
  args: Record<string, unknown>;
  output?: string;
  error?: string;
  timestamp?: number;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  agentId?: string;
  triggerSource: 'schedule' | 'webhook' | 'manual';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: RoutineRunStatus;
  attempt?: number;
  maxAttempts?: number;
  cancelledBy?: 'user' | 'timeout' | 'restart';
  error?: string;
  summary?: string;
  output?: string;
  toolCalls?: RoutineToolCall[];
  approvalRequired: boolean;
  quiet?: boolean;                // 静默标记 (NOTHING NEW: 正常运行无异常，抑制外部 IM 骚扰推送)
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
