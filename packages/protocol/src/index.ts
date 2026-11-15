/**
 * @museclaw/protocol
 * Core event and data contracts for MuseClaw.
 */

// 0. Channel Ladder (技能执行通道阶梯)
export type ExecutionChannel = 'api' | 'cli' | 'web' | 'browser' | 'gui' | 'mixed';

export interface ChannelLadderStep {
  toolName: string;
  channel: ExecutionChannel;
  rung: number;
  timestamp: number;
}

// 1. Agent Profile (多 Bot 实体与配置定义)
export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  system_prompt: string;
  systemPrompt?: string;          // 兼容别名
  model?: string;
  tool_allowlist: string[];
  defaultTools?: string[];        // 兼容别名
  memory_ns: string;              // 独立记忆命名空间，如 "bots/<id>"
  memory?: string;                // 本地 MEMORY.md 静态记忆文本
  approval_level?: 'ask' | 'auto_edits' | 'full'; // 差异化审批级别: ask (严格审批) | auto_edits (免批编辑) | full (仅拦截破坏底线)
  is_coordinator?: boolean;       // 全局协调者（默认最多一个）
  enabled: boolean;
  created_at: number;
  updated_at: number;
  role?: string;
  avatar?: string;
  sandboxConfig?: {
    requiresBrowser: boolean;
    persistentProfile: boolean;
    resourceLimit: {
      memoryMb: number;
      cpuShares: number;
    };
  };
}

// 1.1 Session 数据模型 (会话强从属于单一 Bot)
export interface Session {
  id: string;
  bot_id: string;                 // 会话归属的 Bot ID，创建后不可换绑
  botId?: string;                 // 兼容别名
  title?: string;
  created_at?: number;
  updated_at: number;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
}

// 1.2 入站消息与路由结果类型
export interface InboundMessage {
  text: string;
  session_id?: string;
  bot_id?: string;
  user_id?: string;
}

export interface RouteResult {
  bot: AgentProfile;
  session_id: string;
  mention_name?: string;
}

// 2. Sentinel Security & Approval (哨兵门禁与审批模型)
export type ActionRiskLevel = 'read_only' | 'low_risk' | 'high_risk' | 'irreversible';

export interface ApprovalRequest {
  approvalId: string;
  approval_id?: string;
  sessionId: string;
  session_id?: string;
  botId: string;
  bot_id?: string;
  userId: string;
  user_id?: string;
  riskLevel: ActionRiskLevel;
  actionSummary: string;
  targetDetails: {
    command?: string;
    endpoint?: string;
    method?: string;
    parameters?: Record<string, unknown>;
  };
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  isTainted?: boolean;
  channelLadder?: {
    channel: ExecutionChannel;
    rung: number;
    reason?: string;
  };
  requestedAt: number;
  decidedAt?: number;
}

// 3. AG-UI & Streaming Event Types (流式交互事件规范)
export type MuseEvent =
  | { type: 'agent:state'; botId: string; bot_id?: string; session_id?: string; state: 'idle' | 'running' | 'paused' | 'error' }
  | { type: 'stream:text-delta'; text: string; bot_id?: string; session_id?: string }
  | { type: 'task:plan'; steps: Array<{ id: string; description: string; status: 'pending' | 'in_progress' | 'done' | 'failed' }>; bot_id?: string; session_id?: string }
  | { type: 'tool:call_start'; toolName: string; input: Record<string, unknown>; bot_id?: string; session_id?: string }
  | { type: 'tool:call_end'; toolName: string; output: unknown; durationMs: number; bot_id?: string; session_id?: string }
  | { type: 'sentinel:approval_needed'; request: ApprovalRequest; bot_id?: string; session_id?: string }
  | { type: 'sentinel:taint_updated'; sessionId: string; isTainted: boolean; reason: string; bot_id?: string; session_id?: string }
  | { type: 'ladder:escalation'; sessionId: string; toolName: string; fromRung?: number; toRung: number; channel: ExecutionChannel; bot_id?: string; session_id?: string }
  | { type: 'sandbox:execution'; command: string; engine: 'bwrap' | 'env_scrubbed'; networkBlocked: boolean; bot_id?: string; session_id?: string }
  | { type: 'artifact:created'; artifactType: 'file' | 'report' | 'screenshot'; title: string; url: string; bot_id?: string; session_id?: string };

// 4. Trajectory Export Format (执行轨迹导出格式，供模型微调与对齐使用)
export interface TrajectoryStep {
  stepIndex: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  thought?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
  observation?: unknown;
}

export interface SessionTrajectory {
  sessionId: string;
  userId: string;
  botId: string;
  taskGoal: string;
  isSuccessful: boolean;
  steps: TrajectoryStep[];
  timestamp: number;
}
