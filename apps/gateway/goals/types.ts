/**
 * MuseClaw Long-Horizon Goals Types
 * 对标 nanoMuse: nanomuse/goals/store.py
 */

export type GoalStatus = 'active' | 'paused' | 'done' | 'cancelled';
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped';

export interface GoalStep {
  id: string; // e.g. "step_1"
  title: string;
  description?: string;
  status: StepStatus;
  result?: string;
  blockedReason?: string;
  updatedAt: number;
}

export interface GoalProposal {
  proposalId: string;
  reason: string;
  proposedSteps: GoalStep[];
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
  category?: string;
  status: GoalStatus;
  cadence: string; // e.g. "weekdays 09:30" | "daily 09:00" | "weekly mon 10:00" | "*/30 * * * *"
  cronExpr: string;
  nextCheckInAt: number;
  lastCheckInAt?: number;
  steps: GoalStep[];
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
  proposalRaised?: boolean;
  goalCompleted?: boolean;
}
