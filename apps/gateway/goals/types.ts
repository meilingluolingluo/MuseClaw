/**
 * 长周期自驱目标类型系统 (Long-Horizon Goals Types)
 */

export type GoalStatus = 'active' | 'paused' | 'done' | 'cancelled';
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped';

export type GoalCategory =
  | 'career'
  | 'learning'
  | 'engineering'
  | 'finance'
  | 'health'
  | 'relationships'
  | 'home'
  | 'travel'
  | 'creative'
  | 'other'
  | string;

export interface GoalStep {
  id: string; // e.g. "step_1"
  idx: number; // 1-based index
  title: string;
  description?: string;
  verificationCommand?: string; // 自动化验收命令（由沙箱确定性执行，exitCode 0 才放行）
  verificationOutput?: string;   // 验收命令执行输出
  status: StepStatus;
  result?: string;
  note?: string;
  blockedReason?: string;
  updatedAt: number;
}

export interface GoalProposal {
  proposalId: string;
  reason: string;
  proposedSteps: Array<string | GoalStep>;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
  decidedAt?: number;
}

export interface Goal {
  id: string; // "goal_..."
  title: string;
  description: string;
  botId: string;
  userId: string;
  category: string;
  status: GoalStatus;
  due?: string; // YYYY-MM-DD
  cadence: string; // e.g. "weekdays 09:30" | "daily 09:00" | "weekly mon 10:00" | "monthly 1 09:00" | ""
  cronExpr: string;
  nextCheckInAt: number;
  lastCheckInAt?: number;
  steps: GoalStep[];
  notes?: string;
  progress?: number;
  proposal?: GoalProposal;
  createdAt: number;
  updatedAt: number;
}

export interface GoalAdvanceResult {
  goalId: string;
  stepId?: string;
  stepTitle?: string;
  status: StepStatus;
  output?: string;
  blockedReason?: string;
  verificationOutput?: string;
  proposalRaised?: boolean;
  goalCompleted?: boolean;
}
