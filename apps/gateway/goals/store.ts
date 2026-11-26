import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Goal,
  GoalStep,
  GoalProposal,
  GoalStatus,
  StepStatus,
  GoalMode,
  GoalMetric,
  GoalArtifact,
  StepOwner
} from './types.ts';
import { cadenceToCron, computeNextCheckIn } from './cadence.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function formatBeijingTimestamp(date: Date = new Date()): string {
  const d = new Date(date.getTime() + (8 * 60 + date.getTimezoneOffset()) * 60000);
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

export class GoalStore {
  private filePath: string;
  private artifactsDir: string;
  private goals = new Map<string, Goal>();

  constructor(filePath?: string, artifactsDir?: string) {
    this.filePath = filePath || path.resolve(__dirname, '../data/goals.json');
    this.artifactsDir = artifactsDir || path.resolve(path.dirname(this.filePath), 'artifacts');
    this.ensureDir();
    this.load();
  }

  public getArtifactsDir(): string {
    return this.artifactsDir;
  }

  private ensureDir() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private ensureArtifactsDir() {
    if (!fs.existsSync(this.artifactsDir)) {
      fs.mkdirSync(this.artifactsDir, { recursive: true });
    }
  }

  public computeProgress(goal: Goal): number {
    if (!goal.steps || goal.steps.length === 0) return 0;
    const doneCount = goal.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
    return Math.round((doneCount / goal.steps.length) * 100);
  }

  private load() {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const list: Goal[] = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      for (const g of list) {
        if (!g.mode) g.mode = 'delivery';
        if (!Array.isArray(g.artifacts)) g.artifacts = [];
        if (!Array.isArray(g.linkedRoutineIds)) g.linkedRoutineIds = [];
        if (!Array.isArray(g.steps)) g.steps = [];
        g.progress = this.computeProgress(g);
        g.steps.forEach((s, i) => {
          if (!s.idx) s.idx = i + 1;
          if (!s.owner) s.owner = 'agent';
        });
        this.goals.set(g.id, g);
      }
    } catch (err: any) {
      console.warn(`[GoalStore] 加载 goals 异常: ${err.message}`);
    }
  }

  public save() {
    this.ensureDir();
    const list = Array.from(this.goals.values()).map((g) => ({
      ...g,
      progress: this.computeProgress(g)
    }));
    const tmp = `${this.filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  public list(
    filter?: { botId?: string; status?: GoalStatus; category?: string; userId?: string; mode?: GoalMode } | GoalStatus
  ): Goal[] {
    const normalizedFilter = typeof filter === 'string' ? { status: filter } : filter;
    let list = Array.from(this.goals.values()).map((g) => {
      g.progress = this.computeProgress(g);
      return g;
    });
    if (normalizedFilter?.botId) list = list.filter((g) => g.botId === normalizedFilter.botId);
    if (normalizedFilter?.status) list = list.filter((g) => g.status === normalizedFilter.status);
    if (normalizedFilter?.mode) list = list.filter((g) => (g.mode || 'delivery') === normalizedFilter.mode);
    if (normalizedFilter?.category) {
      list = list.filter((g) => g.category?.toLowerCase() === normalizedFilter.category?.toLowerCase());
    }
    if (normalizedFilter?.userId) list = list.filter((g) => g.userId === normalizedFilter.userId);
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public get(id: string): Goal | undefined {
    const goal = this.goals.get(id);
    if (goal) {
      goal.progress = this.computeProgress(goal);
    }
    return goal;
  }

  public create(data: {
    id?: string;
    title: string;
    description?: string;
    mode?: GoalMode;
    successCriteria?: string;
    metric?: GoalMetric;
    artifacts?: GoalArtifact[];
    linkedRoutineIds?: string[];
    sessionId?: string;
    botId?: string;
    userId?: string;
    category?: string;
    due?: string;
    cadence?: string;
    steps?: Array<string | Partial<GoalStep>>;
    notes?: string;
  }): Goal {
    const id = data.id || `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const mode: GoalMode = data.mode || 'delivery';
    const cadence = data.cadence !== undefined ? data.cadence : '';
    const cronExpr = cadence ? cadenceToCron(cadence) : '';
    const nextCheckInAt = cadence ? computeNextCheckIn(cadence) : 0;

    const rawSteps = data.steps || [];
    const steps: GoalStep[] = rawSteps.map((s, idx) => {
      if (typeof s === 'string') {
        return {
          id: `step_${idx + 1}`,
          idx: idx + 1,
          title: s.trim(),
          description: s.trim(),
          owner: 'agent',
          status: 'pending',
          updatedAt: now
        };
      }
      return {
        id: s.id || `step_${idx + 1}`,
        idx: s.idx || idx + 1,
        title: s.title || `步骤 ${idx + 1}`,
        description: s.description || s.title || '',
        owner: s.owner || 'agent',
        assigneeBotId: s.assigneeBotId,
        verificationCommand: s.verificationCommand,
        status: s.status || 'pending',
        note: s.note,
        result: s.result,
        updatedAt: now
      };
    });

    if (steps.length === 0 && mode !== 'portfolio') {
      steps.push({
        id: 'step_1',
        idx: 1,
        title: mode === 'watch' ? '建立基线并确认观测条件' : '梳理上下文与交付验收方案',
        description: data.successCriteria || data.description || data.title,
        owner: 'agent',
        status: 'pending',
        updatedAt: now
      });
    }

    const goal: Goal = {
      id,
      title: data.title.trim(),
      description: (data.description || '').trim(),
      mode,
      successCriteria: data.successCriteria?.trim() || undefined,
      metric: data.metric,
      artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
      linkedRoutineIds: Array.isArray(data.linkedRoutineIds) ? data.linkedRoutineIds : [],
      sessionId: data.sessionId,
      botId: data.botId || 'muse',
      userId: data.userId || 'user_web',
      category: (data.category || 'other').trim().toLowerCase(),
      status: 'active',
      due: (data.due || '').trim(),
      cadence,
      cronExpr,
      nextCheckInAt,
      steps,
      notes: data.notes || '',
      progress: 0,
      createdAt: now,
      updatedAt: now
    };

    goal.progress = this.computeProgress(goal);
    this.goals.set(id, goal);
    this.save();
    console.log(`[GoalStore] 创建目标: ${goal.title} (ID: ${id}, Mode: ${mode}, Category: ${goal.category}, Cadence: "${cadence}")`);
    return goal;
  }

  public update(id: string, updates: Partial<Goal>): Goal | undefined {
    const goal = this.goals.get(id);
    if (!goal) return undefined;

    if (updates.cadence !== undefined && updates.cadence !== goal.cadence) {
      goal.cadence = updates.cadence;
      goal.cronExpr = updates.cadence ? cadenceToCron(updates.cadence) : '';
      goal.nextCheckInAt = updates.cadence ? computeNextCheckIn(updates.cadence) : 0;
    }

    Object.assign(goal, updates, { updatedAt: Date.now() });
    goal.progress = this.computeProgress(goal);
    this.save();
    return goal;
  }

  public setStatus(id: string, status: GoalStatus): Goal | undefined {
    return this.update(id, { status });
  }

  public appendNote(id: string, note: string): Goal | undefined {
    const goal = this.goals.get(id);
    if (!goal) return undefined;
    const timestamp = formatBeijingTimestamp();
    const line = `[${timestamp}] ${note.trim()}`;
    const nextNotes = goal.notes ? `${goal.notes}\n${line}` : line;
    return this.update(id, { notes: nextNotes });
  }

  public delete(id: string): boolean {
    const res = this.goals.delete(id);
    if (res) this.save();
    return res;
  }

  /**
   * 添加步骤
   */
  public addStep(
    goalId: string,
    title: string,
    description?: string,
    verificationCommand?: string,
    options?: { owner?: StepOwner; assigneeBotId?: string }
  ): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    const maxIdx = Math.max(0, ...(goal.steps || []).map((s) => s.idx || 0));
    const nextIdx = maxIdx + 1;
    const newStep: GoalStep = {
      id: `s_${nextIdx}`,
      idx: nextIdx,
      title: title.trim(),
      description: description?.trim() || title.trim(),
      owner: options?.owner || 'agent',
      assigneeBotId: options?.assigneeBotId?.trim() || undefined,
      verificationCommand: verificationCommand?.trim() || undefined,
      status: 'pending',
      updatedAt: Date.now()
    };

    goal.steps.push(newStep);
    goal.progress = this.computeProgress(goal);
    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  /**
   * 登记目标交付物或证据资产，并同步落盘到工件目录供工件页统一预览与下载
   */
  public addArtifact(
    goalId: string,
    artifact: Omit<GoalArtifact, 'id' | 'createdAt'>
  ): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;
    if (!Array.isArray(goal.artifacts)) goal.artifacts = [];

    const now = Date.now();
    const title = artifact.title.trim();
    const kind = artifact.kind || 'doc';
    const rawRef = artifact.ref?.trim() || undefined;
    const summary = artifact.summary?.trim() || undefined;
    const rawContent = artifact.content?.trim() || undefined;
    const shortGoalId = goal.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8) || 'goal';
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'artifact';

    let filename: string | undefined = artifact.filename?.trim() || undefined;
    let url: string | undefined = artifact.url?.trim() || undefined;
    let finalRef = rawRef;

    if (filename) {
      url = url || `/api/artifacts/${encodeURIComponent(path.basename(filename))}`;
    } else if (rawRef && rawRef.startsWith('/api/artifacts/')) {
      try {
        filename = path.basename(decodeURIComponent(rawRef.replace('/api/artifacts/', '')));
        url = `/api/artifacts/${encodeURIComponent(filename)}`;
      } catch {
        filename = path.basename(rawRef.replace('/api/artifacts/', ''));
        url = rawRef;
      }
    } else if (rawContent || (['doc', 'report', 'note'].includes(kind) && !(rawRef && /^https?:\/\//i.test(rawRef)))) {
      try {
        this.ensureArtifactsDir();
        const generatedName = `goal-${shortGoalId}-${slug}-${now.toString(36)}.md`;
        const filePath = path.join(this.artifactsDir, generatedName);
        const sections: string[] = [
          `# ${title}`,
          '',
          `- **所属目标**：${goal.title} (\`${goal.id}\`)`,
          `- **产出类型**：${kind}`,
          `- **归档时间**：${formatBeijingTimestamp(new Date(now))}`
        ];
        if (rawRef) {
          sections.push(`- **关联路径/链接**：${rawRef}`);
        }
        sections.push('');
        if (summary && summary !== rawContent) {
          sections.push('## 核心摘要', '', summary, '');
        }
        if (rawContent) {
          sections.push('## 详细内容', '', rawContent, '');
        } else if (!summary && rawRef) {
          sections.push(`参考位置：\`${rawRef}\``, '');
        }
        fs.writeFileSync(filePath, sections.join('\n'), 'utf-8');
        filename = generatedName;
        url = `/api/artifacts/${encodeURIComponent(generatedName)}`;
        finalRef = finalRef || url;
      } catch (err: any) {
        console.warn(`[GoalStore] 写入目标工件文件失败: ${err.message}`);
      }
    } else if (rawRef && !/^https?:\/\//i.test(rawRef)) {
      try {
        const resolved = path.isAbsolute(rawRef) ? rawRef : path.resolve(process.cwd(), rawRef);
        if (fs.existsSync(resolved)) {
          const stat = fs.statSync(resolved);
          if (stat.isFile() && stat.size <= 5 * 1024 * 1024) {
            this.ensureArtifactsDir();
            const base = path.basename(resolved).replace(/[^\w.\u4e00-\u9fa5-]/g, '_');
            const copiedName = `goal-${shortGoalId}-${now.toString(36)}-${base}`;
            fs.copyFileSync(resolved, path.join(this.artifactsDir, copiedName));
            filename = copiedName;
            url = `/api/artifacts/${encodeURIComponent(copiedName)}`;
          }
        }
      } catch (err: any) {
        console.warn(`[GoalStore] 同步本地工件文件失败: ${err.message}`);
      }
    }

    const entry: GoalArtifact = {
      id: `art_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      kind,
      ref: finalRef,
      filename,
      url,
      summary,
      stepId: artifact.stepId?.trim() || undefined,
      createdAt: now
    };

    goal.artifacts.push(entry);
    goal.updatedAt = now;
    this.save();
    return goal;
  }

  /**
   * 移除目标交付物，并清理自动落盘的专属工件文件
   */
  public removeArtifact(goalId: string, artifactId: string): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal || !Array.isArray(goal.artifacts)) return undefined;
    const target = goal.artifacts.find((a) => a.id === artifactId);
    if (!target) return undefined;

    const shortGoalId = goal.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8) || 'goal';
    if (target.filename && target.filename.startsWith(`goal-${shortGoalId}-`)) {
      const safeName = path.basename(target.filename);
      const fullPath = path.join(this.artifactsDir, safeName);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch (err: any) {
          console.warn(`[GoalStore] 清理工件文件失败: ${err.message}`);
        }
      }
    }

    goal.artifacts = goal.artifacts.filter((a) => a.id !== artifactId);
    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  /**
   * 关联例行自动化任务
   */
  public linkRoutine(goalId: string, routineId: string): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;
    if (!Array.isArray(goal.linkedRoutineIds)) goal.linkedRoutineIds = [];
    if (!goal.linkedRoutineIds.includes(routineId)) {
      goal.linkedRoutineIds.push(routineId);
      goal.updatedAt = Date.now();
      this.save();
    }
    return goal;
  }

  /**
   * 解除关联例行自动化任务
   */
  public unlinkRoutine(goalId: string, routineId: string): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;
    if (!Array.isArray(goal.linkedRoutineIds)) return goal;
    goal.linkedRoutineIds = goal.linkedRoutineIds.filter((id) => id !== routineId);
    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  /**
   * 绑定目标专属持久化会话 ID
   */
  public bindSession(goalId: string, sessionId: string): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;
    goal.sessionId = sessionId;
    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  /**
   * 按 stepId 更新步骤
   */
  public updateStep(
    goalId: string,
    stepId: string,
    status?: StepStatus,
    options?: {
      note?: string;
      result?: string;
      blockedReason?: string;
      verificationCommand?: string;
      verificationOutput?: string;
    }
  ): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    const step = goal.steps.find((s) => s.id === stepId);
    if (!step) return undefined;

    if (status) step.status = status;
    step.updatedAt = Date.now();
    if (options?.note !== undefined) step.note = options.note;
    if (options?.result !== undefined) step.result = options.result;
    if (options?.blockedReason !== undefined) step.blockedReason = options.blockedReason;
    if (options?.verificationCommand !== undefined) step.verificationCommand = options.verificationCommand;
    if (options?.verificationOutput !== undefined) step.verificationOutput = options.verificationOutput;

    // 当全部步骤完成或跳过时，自动标记目标达成
    const allDone = goal.steps.length > 0 && goal.steps.every((s) => s.status === 'done' || s.status === 'skipped');
    if (allDone && goal.status === 'active') {
      goal.status = 'done';
      console.log(`[GoalStore] 目标步骤已全部完成，目标状态流转为达成: ${goal.title}`);
    }

    goal.progress = this.computeProgress(goal);
    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  /**
   * 按 stepIndex (1-based) 更新步骤
   */
  public updateStepByIndex(
    goalId: string,
    stepIndex: number,
    status?: StepStatus,
    note?: string
  ): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;
    const step = goal.steps.find((s) => s.idx === stepIndex) || goal.steps[stepIndex - 1];
    if (!step) return undefined;
    return this.updateStep(goalId, step.id, status, { note });
  }

  /**
   * 提交修订提案
   */
  public proposeReplan(
    goalId: string,
    reason: string,
    proposedSteps: Array<string | GoalStep>
  ): GoalProposal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    const proposalId = `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const proposal: GoalProposal = {
      proposalId,
      reason: reason.trim(),
      proposedSteps,
      status: 'pending',
      createdAt: Date.now()
    };

    goal.proposal = proposal;
    goal.updatedAt = Date.now();
    this.save();
    console.log(`[GoalStore] 为目标 ${goal.title} 提出计划修订提案: ${reason}`);
    return proposal;
  }

  /**
   * 审批处理修订提案
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
      // 保留已完成或跳过的步骤
      const completedSteps = goal.steps.filter((s) => s.status === 'done' || s.status === 'skipped');
      const completedIds = new Set(completedSteps.map((s) => s.id));
      let nextIdx = completedSteps.length;
      const now = Date.now();

      // 仅引入未完成的新步骤（若 proposedSteps 中包含了旧完成步骤，则去重过滤）
      const incoming = proposal.proposedSteps.filter((item) => {
        if (typeof item === 'string') return true;
        return !completedIds.has(item.id);
      });

      const newSteps: GoalStep[] = incoming.map((item) => {
        nextIdx += 1;
        if (typeof item === 'string') {
          return {
            id: `step_${nextIdx}`,
            idx: nextIdx,
            title: item.trim(),
            description: item.trim(),
            status: 'pending',
            updatedAt: now
          };
        }
        return {
          id: item.id || `step_${nextIdx}`,
          idx: nextIdx,
          title: item.title,
          description: item.description || item.title,
          verificationCommand: item.verificationCommand,
          status: 'pending',
          updatedAt: now
        };
      });

      goal.steps = [...completedSteps, ...newSteps];
      goal.status = 'active';
      goal.progress = this.computeProgress(goal);
      this.appendNote(goalId, `计划调整已采纳生效: ${proposal.reason}`);
      this.save();
      return { success: true, goal, message: '已接受修订提案，新规划步骤已生效' };
    } else {
      this.appendNote(goalId, `用户保留原计划方案 (驳回修订: ${proposal.reason})`);
      this.save();
      return { success: true, goal, message: '已驳回修订提案，保持原规划步骤不变' };
    }
  }

  /**
   * 退回指定历史步骤返工
   */
  public rollbackStep(goalId: string, targetStepId: string, reason?: string): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    const targetIdx = goal.steps.findIndex((s) => s.id === targetStepId);
    if (targetIdx === -1) return undefined;

    for (let i = targetIdx; i < goal.steps.length; i++) {
      const step = goal.steps[i];
      step.status = 'pending';
      step.blockedReason = undefined;
      step.result = undefined;
      step.verificationOutput = undefined;
      step.updatedAt = Date.now();
    }

    if (goal.proposal && goal.proposal.status === 'pending') {
      goal.proposal.status = 'rejected';
      goal.proposal.decidedAt = Date.now();
    }

    goal.status = 'active';
    goal.progress = this.computeProgress(goal);
    this.appendNote(goalId, `退回步骤 [${goal.steps[targetIdx].title}] 返工: ${reason || '手动退回'}`);
    this.save();
    return goal;
  }

  /**
   * 现场补充指导并在当前步骤重试
   */
  public retryStep(goalId: string, stepId?: string): Goal | undefined {
    const goal = this.goals.get(goalId);
    if (!goal) return undefined;

    let targetStep = stepId ? goal.steps.find((s) => s.id === stepId) : undefined;
    if (!targetStep) {
      targetStep = goal.steps.find((s) => s.status === 'blocked') || goal.steps.find((s) => s.status === 'in_progress');
    }
    if (!targetStep) {
      targetStep = goal.steps.find((s) => s.status === 'pending');
    }
    if (!targetStep) return undefined;

    targetStep.status = 'in_progress';
    targetStep.blockedReason = undefined;
    targetStep.updatedAt = Date.now();

    if (goal.proposal && goal.proposal.status === 'pending') {
      goal.proposal.status = 'rejected';
      goal.proposal.decidedAt = Date.now();
    }

    goal.status = 'active';
    goal.progress = this.computeProgress(goal);
    goal.updatedAt = Date.now();
    this.save();
    return goal;
  }

  /**
   * 到期巡检目标列表
   */
  public dueCheckIns(now = Date.now()): Goal[] {
    return Array.from(this.goals.values()).filter(
      (g) => g.status === 'active' && g.nextCheckInAt > 0 && g.nextCheckInAt <= now
    );
  }

  /**
   * 格式化输出目标文本（供 Agent 文本交互或工具返回）
   */
  public render(goal: Goal, withNotes = true): string {
    const icons: Record<string, string> = {
      pending: '[ ]',
      in_progress: '[~]',
      done: '[x]',
      blocked: '[!]',
      skipped: '[-]'
    };
    const modeLabel = goal.mode === 'watch' ? '追踪观察' : goal.mode === 'portfolio' ? '长期沉淀' : '阶段交付';
    const meta = [`模式=${modeLabel}`, `状态=${goal.status}`, `进度=${goal.progress || 0}%`];
    if (goal.category) meta.push(`领域=${goal.category}`);
    if (goal.due) meta.push(`截止日期=${goal.due}`);
    if (goal.cadence) meta.push(`巡检周期="${goal.cadence}"`);
    if (goal.artifacts && goal.artifacts.length > 0) meta.push(`成果=${goal.artifacts.length}`);

    const lines = [`目标 ${goal.id}: ${goal.title} (${meta.join(', ')})`];
    if (goal.description) lines.push(`  描述: ${goal.description}`);
    if (goal.successCriteria) lines.push(`  验收标准: ${goal.successCriteria}`);
    if (goal.metric) {
      lines.push(`  量化指标: ${goal.metric.label} (${goal.metric.current} -> ${goal.metric.target}${goal.metric.unit ? ` ${goal.metric.unit}` : ''})`);
    }
    for (const s of goal.steps || []) {
      const ownerTag = s.owner === 'human' ? ' [人工]' : s.assigneeBotId ? ` [@${s.assigneeBotId}]` : '';
      const extra = s.note || s.result ? ` · ${s.note || s.result}` : '';
      lines.push(`  ${icons[s.status] || '[ ]'} ${s.idx}. ${s.title}${ownerTag}${extra}`);
    }
    if (goal.artifacts && goal.artifacts.length > 0) {
      lines.push(`  已沉淀成果: ${goal.artifacts.map((a) => `[${a.kind}] ${a.title}`).join('; ')}`);
    }
    if (goal.proposal && goal.proposal.status === 'pending') {
      const pSteps = goal.proposal.proposedSteps.map((x) => (typeof x === 'string' ? x : x.title)).join('; ');
      lines.push(`  等待用户审批的计划修订提案: ${goal.proposal.reason} -> ${pSteps}`);
    }
    if (withNotes && goal.notes) {
      lines.push(`  进展备忘:\n${goal.notes}`);
    }
    return lines.join('\n');
  }
}
