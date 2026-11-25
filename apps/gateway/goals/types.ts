/**
 * 目标与阶段推进类型系统
 */

export type GoalStatus = 'active' | 'paused' | 'done' | 'cancelled';
export type GoalMode = 'delivery' | 'watch' | 'portfolio';
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped';
export type StepOwner = 'agent' | 'human';

export type GoalCategory =
  | 'delivery'
  | 'engineering'
  | 'research'
  | 'operations'
  | 'growth'
  | 'career'
  | 'learning'
  | 'finance'
  | 'health'
  | 'relationships'
  | 'home'
  | 'travel'
  | 'creative'
  | 'other'
  | string;

export interface GoalMetric {
  label: string;
  current: string;
  target: string;
  unit?: string;
}

export interface GoalArtifact {
  id: string;
  title: string;
  kind: 'file' | 'doc' | 'link' | 'note' | 'report';
  ref?: string;
  summary?: string;
  stepId?: string;
  createdAt: number;
}

export interface GoalStep {
  id: string; // e.g. "step_1"
  idx: number; // 1-based index
  title: string;
  description?: string;
  owner?: StepOwner;
  assigneeBotId?: string;
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
  mode?: GoalMode;
  successCriteria?: string;
  metric?: GoalMetric;
  artifacts?: GoalArtifact[];
  linkedRoutineIds?: string[];
  sessionId?: string;
  botId: string;
  userId: string;
  category: string;
  status: GoalStatus;
  due?: string; // YYYY-MM-DD
  cadence: string; // e.g. "" | "weekdays 09:30" | "daily 09:00" | "weekly mon 10:00" | "monthly 1 09:00"
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
  awaitingHuman?: boolean;
  roundsExecuted?: number;
  stoppedReason?: string;
}
