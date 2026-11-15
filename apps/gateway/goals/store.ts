import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Goal, GoalStep, GoalProposal, GoalStatus, StepStatus } from './types.ts';
import { cadenceToCron, computeNextCheckIn } from './cadence.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class GoalStore {
  private filePath: string;
  private goals = new Map<string, Goal>();

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(__dirname, '../data/goals.json');
    this.ensureDir();
    this.load();
  }

  private ensureDir() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load() {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const list: Goal[] = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      for (const g of list) {
        this.goals.set(g.id, g);
      }
    } catch (err: any) {
      console.warn(`[GoalStore] 加载 goals 异常: ${err.message}`);
    }
  }

  public save() {
    this.ensureDir();
    const list = Array.from(this.goals.values());
    const tmp = `${this.filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  public list(filter?: { botId?: string; status?: GoalStatus; userId?: string }): Goal[] {
    let list = Array.from(this.goals.values());
    if (filter?.botId) list = list.filter((g) => g.botId === filter.botId);
    if (filter?.status) list = list.filter((g) => g.status === filter.status);
    if (filter?.userId) list = list.filter((g) => g.userId === filter.userId);
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public get(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  public create(data: {
    title: string;
    description: string;
    botId: string;
    userId: string;
    category?: string;
    cadence?: string;
    steps?: Array<Omit<GoalStep, 'id' | 'status' | 'updatedAt'> & { id?: string; status?: StepStatus }>;
  }): Goal {
    const id = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const cadence = data.cadence || 'weekdays 09:30';
    const cronExpr = cadenceToCron(cadence);
    const nextCheckInAt = computeNextCheckIn(cadence);

    const steps: GoalStep[] = (data.steps || []).map((s, idx) => ({
      id: s.id || `step_${idx + 1}`,
      title: s.title,
      description: s.description || s.title,
      status: s.status || 'pending',
      updatedAt: now
    }));

    // 若未传入步骤，默认提供第一步规划
    if (steps.length === 0) {
      steps.push({
        id: 'step_1',
        title: '初始任务梳理与可行性预研',
        description: data.description || data.title,
        status: 'pending',
        updatedAt: now
      });
    }

    const goal: Goal = {
      id,
      title: data.title,
      description: data.description,
      botId: data.botId,
      userId: data.userId,
      category: data.category || 'engineering',
      status: 'active',
      cadence,
      cronExpr,
      nextCheckInAt,
      steps,
      createdAt: now,
      updatedAt: now
    };

    this.goals.set(id, goal);
    this.save();
    console.log(`[GoalStore] 创建新长周期目标: ${goal.title} (ID: ${id}, Cadence: ${cadence})`);
    return goal;
  }

  public update(id: string, updates: Partial<Goal>): Goal | undefined {
    const goal = this.goals.get(id);
    if (!goal) return undefined;

    if (updates.cadence && updates.cadence !== goal.cadence) {
      goal.cadence = updates.cadence;
      goal.cronExpr = cadenceToCron(updates.cadence);
      goal.nextCheckInAt = computeNextCheckIn(updates.cadence);
    }

    Object.assign(goal, updates, { updatedAt: Date.now() });
    this.save();
    return goal;
  }

  public delete(id: string): boolean {
    const res = this.goals.delete(id);
    if (res) this.save();
    return res;
  }

  /**
   * 更新目标下特定步骤状态
   */
  public advanceStep(
    goalId: string,
    stepId: string,
    status: StepStatus,
    options?: { result?: string; blockedReason?: string }
  ): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    const step = goal.steps.find((s) => s.id === stepId);
    if (!step) return undefined;

    step.status = status;
    step.updatedAt = Date.now();
    if (options?.result) step.result = options.result;
    if (options?.blockedReason) step.blockedReason = options.blockedReason;

    // 检查是否所有步骤都已完成
    const allDone = goal.steps.every((s) => s.status === 'done' || s.status === 'skipped');
    if (allDone) {
      goal.status = 'done';
      console.log(`[GoalStore] 目标所有阶段步骤已全部完成，目标达成: ${goal.title} (ID: ${goalId})`);
    }

    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  /**
   * 提交计划修订提案（Re-planning Proposal）
   * 严禁静默乱改原有规划：生成提案供用户决策
   */
  public proposeReplan(goalId: string, reason: string, proposedSteps: GoalStep[]): GoalProposal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const proposal: GoalProposal = {
      proposalId,
      reason,
      proposedSteps,
      status: 'pending',
      createdAt: Date.now()
    };

    goal.proposal = proposal;
    goal.updatedAt = Date.now();
    this.save();
    console.log(`[GoalStore] 为目标 ${goal.title} 提交新修订提案: ${reason} (Proposal ID: ${proposalId})`);
    return proposal;
  }

  /**
   * 用户审批重新规划提案 (Accept / Reject)
   */
  public resolveProposal(
    goalId: string,
    accept: boolean
  ): { success: boolean; goal?: Goal; message: string } {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, message: `未找到目标 ID: ${goalId}` };
    }
    if (!goal.proposal || goal.proposal.status !== 'pending') {
      return { success: false, message: '当前目标无等待审批的修订提案' };
    }

    const proposal = goal.proposal;
    proposal.status = accept ? 'accepted' : 'rejected';
    proposal.decidedAt = Date.now();

    if (accept) {
      // 接受提案：新规划步骤正式替换生效
      goal.steps = proposal.proposedSteps;
      goal.updatedAt = Date.now();
      this.save();
      console.log(`[GoalStore] 用户【批准】提案: 目标 ${goal.title} 步骤已更新为新修订方案`);
      return { success: true, goal, message: '已接受修订提案，新规划步骤已生效' };
    } else {
      // 拒绝提案：保留原规划，步骤不发生变更
      goal.updatedAt = Date.now();
      this.save();
      console.log(`[GoalStore] 用户【驳回】提案: 目标 ${goal.title} 保持原有规划不变`);
      return { success: true, goal, message: '已驳回修订提案，原计划步骤保持不变' };
    }
  }
}
