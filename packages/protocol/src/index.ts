/**
 * @museclaw/protocol
 * Core event and data contracts for MuseClaw.
 */

// 1. Agent Roster (通讯录 Bot 实体定义)
export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  systemPrompt: string;
  defaultTools: string[];
  sandboxConfig: {
    requiresBrowser: boolean;
    persistentProfile: boolean;
    resourceLimit: {
      memoryMb: number;
      cpuShares: number;
    };
  };
}

// 2. Sentinel Security & Approval (哨兵门禁与审批模型)
export type ActionRiskLevel = 'read_only' | 'low_risk' | 'high_risk' | 'irreversible';

export interface ApprovalRequest {
  approvalId: string;
  sessionId: string;
  botId: string;
  userId: string;
  riskLevel: ActionRiskLevel;
  actionSummary: string;
  targetDetails: {
    command?: string;
    endpoint?: string;
    method?: string;
    parameters?: Record<string, unknown>;
  };
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  requestedAt: number;
  decidedAt?: number;
}

// 3. AG-UI & Streaming Event Types (流式交互事件规范)
export type MuseEvent =
  | { type: 'agent:state'; botId: string; state: 'idle' | 'running' | 'paused' | 'error' }
  | { type: 'stream:text-delta'; text: string }
  | { type: 'task:plan'; steps: Array<{ id: string; description: string; status: 'pending' | 'in_progress' | 'done' | 'failed' }> }
  | { type: 'tool:call_start'; toolName: string; input: Record<string, unknown> }
  | { type: 'tool:call_end'; toolName: string; output: unknown; durationMs: number }
  | { type: 'sentinel:approval_needed'; request: ApprovalRequest }
  | { type: 'artifact:created'; artifactType: 'file' | 'report' | 'screenshot'; title: string; url: string };

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
