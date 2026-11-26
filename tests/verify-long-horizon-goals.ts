import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GoalStore,
  GoalEngine,
  cadenceToCron,
  computeNextCheckIn,
  type Goal,
  type GoalStep
} from '../apps/gateway/goals/index.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';
import { SessionStore } from '../apps/gateway/bots/session-store.ts';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = path.resolve(__dirname, './.tmp_test_goals');

console.log('🧪 开始测试 MuseClaw 长周期目标 (Long-Horizon Goals) 与自主推进巡检...\n');

if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true });
}
fs.mkdirSync(testDataDir, { recursive: true });

const testGoalsFile = path.join(testDataDir, 'goals.json');
const store = new GoalStore(testGoalsFile);
const sentinel = new SentinelPolicyManager();
const tools = createDefaultTools();

// =========================================================================
// 1. 周期转换与自然语言 Check-in 调度计算 (Cadence to Cron)
// =========================================================================
console.log('1. 验证自然语言巡检周期转换 (Cadence parsing & Cron mapping)...');

assert.strictEqual(cadenceToCron('daily 09:00'), '0 9 * * *');
assert.strictEqual(cadenceToCron('weekdays 09:30'), '30 9 * * 1-5');
assert.strictEqual(cadenceToCron('weekly mon 10:00'), '0 10 * * 1');
assert.strictEqual(cadenceToCron('weekly fri 17:30'), '30 17 * * 5');
assert.strictEqual(cadenceToCron('*/15 * * * *'), '*/15 * * * *');

const now = new Date();
const nextDaily = computeNextCheckIn('daily 09:00', now);
assert(nextDaily > now.getTime(), '计算出的下次巡检时间必须在未来');

console.log('  ✅ daily / weekdays / weekly 与标准 Cron 周期计算转换验证通过\n');

// =========================================================================
// 2. 目标分级存储与步骤定义 (Goal & Step Hierarchy CRUD)
// =========================================================================
console.log('2. 验证长周期目标分级存储 (Goal & Steps Persistence)...');

const createdGoal = store.create({
  title: '企业前端核心库升级 React 19',
  description: '全链路升级 React 19 并迁移旧版 Context 与生命周期',
  botId: 'dev_bot',
  userId: 'leader_mike',
  cadence: 'weekdays 09:30',
  category: 'engineering',
  steps: [
    { id: 'step_1', title: '依赖版本兼容性调研与锁版本分析', description: '扫描三方库 peerDependencies' },
    { id: 'step_2', title: '升级核心组件库并修复 TypeScript 报错', description: '执行 pnpm up 并修复类型' },
    { id: 'step_3', title: '端到端测试覆盖与灰度发布', description: '运行全量测试用例并上线生产' }
  ]
});

assert(createdGoal.id.startsWith('goal_'), '目标 ID 必须带有 goal_ 前缀');
assert.strictEqual(createdGoal.status, 'active', '初始状态必须为 active');
assert.strictEqual(createdGoal.steps.length, 3, '步骤数量必须为 3');
assert.strictEqual(createdGoal.steps[0].status, 'pending');

// 校验文件持久化落盘
assert(fs.existsSync(testGoalsFile), 'goals.json 文件必须落盘');
const reloadedStore = new GoalStore(testGoalsFile);
const reloadedGoal = reloadedStore.get(createdGoal.id);
assert(reloadedGoal, '重新实例化 Store 必须能够加载出已存目标');
assert.strictEqual(reloadedGoal?.title, createdGoal.title);

console.log('  ✅ 长周期目标分级结构与持久化落盘验证通过\n');

// =========================================================================
// 3. 分阶段推进与自驱执行 (Step-by-Step Advance Lifecycle)
// =========================================================================
console.log('3. 验证步骤自驱推进与阶段结算 (Step-by-Step Execution)...');

const engine = new GoalEngine({
  store,
  sentinel,
  tools,
  callLLM: async () => ({ content: '默认执行完成' })
});

// 3.1 推进第 1 步 (顺利完成)
console.log('  -> 推进 Step 1: 依赖版本兼容性调研...');
const resStep1 = await engine.advanceGoal(createdGoal.id, {
  mockOutput: '✅ 已完成全量 48 个依赖兼容性分析，核心组件库均支持 React 19。'
});

assert.strictEqual(resStep1.stepId, 'step_1');
assert.strictEqual(resStep1.status, 'done');
assert.strictEqual(resStep1.goalCompleted, false);

const gAfter1 = store.get(createdGoal.id)!;
assert.strictEqual(gAfter1.steps[0].status, 'done');
assert.strictEqual(gAfter1.steps[1].status, 'pending');
assert.strictEqual(gAfter1.status, 'active');
console.log('  ✅ Step 1 顺利完成，目标状态流转至 Step 2\n');

// =========================================================================
// 4. 步骤阻塞与计划修订提案（Re-planning Proposal 机制）
// =========================================================================
console.log('4. 验证执行受阻与计划修订提案机制 (Blocked & Re-planning Proposal)...');

// 4.1 推进第 2 步遇到客观阻碍（缺少构建镜像凭据）
console.log('  -> 推进 Step 2: 模拟遭遇客观阻碍 (输出 [BLOCKED])...');
const resStep2Blocked = await engine.advanceGoal(createdGoal.id, {
  mockOutput: '[BLOCKED] 缺少私有 npm 仓库发布 Token 与 Docker 镜像构建权限，无法继续构建'
});

assert.strictEqual(resStep2Blocked.status, 'blocked');
assert.strictEqual(resStep2Blocked.proposalRaised, true, '步骤阻塞后必须触发计划修订提案');

const gAfterBlocked = store.get(createdGoal.id)!;
assert.strictEqual(gAfterBlocked.steps[1].status, 'blocked');
assert(gAfterBlocked.proposal, '必须生成 GoalProposal 对象');
assert.strictEqual(gAfterBlocked.proposal?.status, 'pending');
assert(gAfterBlocked.proposal?.reason.includes('缺少私有 npm 仓库发布 Token'));

// 4.2 校验死线：有未决提案时坚决拒绝推进（防止未经审批乱改规划）
console.log('  -> 验证提案审批前死线拦截 (防止静默乱改规划)...');
const rejectAdvance = await engine.advanceGoal(createdGoal.id);
assert.strictEqual(rejectAdvance.status, 'blocked');
assert(rejectAdvance.blockedReason?.includes('存在等待用户审批的计划修订提案'));
console.log('  ✅ 提案未批前，引擎坚决拒绝擅自继续推进，守住计划确定性底线');

// 4.3 用户审批提案（批准 Accept Proposal）
console.log('  -> 模拟人类在企业 IM / Web 端审查并【批准】修订提案...');
const resolveRes = store.resolveProposal(createdGoal.id, true);
assert.strictEqual(resolveRes.success, true);
assert.strictEqual(resolveRes.goal?.proposal?.status, 'accepted');

const gAfterAccepted = store.get(createdGoal.id)!;
// 验证新步骤规划已生效（包含前置解阻步骤）
assert(gAfterAccepted.steps.some(s => s.id.includes('unblock')), '新规划必须包含解决依赖的前置步骤');
console.log('  ✅ 提案批准后，新修订步骤平滑替换生效\n');

// =========================================================================
// 5. 剩余步骤自驱推进直至全生命周期闭环 (Full Goal Completion)
// =========================================================================
console.log('5. 验证后续步骤推进直至目标彻底达成 (Goal Done)...');

// 完成解阻步骤
await engine.advanceGoal(createdGoal.id, { mockOutput: '✅ 管理员已授权 NPM Token 与 Docker 权限。' });
// 重试完成升级步骤
await engine.advanceGoal(createdGoal.id, { mockOutput: '✅ 核心组件库编译升级完毕，所有 TS 报错已修复。' });
// 完成最终测试与上线步骤
const finalRes = await engine.advanceGoal(createdGoal.id, {
  mockOutput: '✅ 全量 E2E 测试通过，React 19 灰度生产环境发布完成！'
});

assert.strictEqual(finalRes.goalCompleted, true, '最后一步完成后 goalCompleted 必须为 true');

const finalGoal = store.get(createdGoal.id)!;
assert.strictEqual(finalGoal.status, 'done', '全量步骤完成后目标状态必须跃迁为 done');
console.log('  ✅ 目标所有阶段步骤完成，长周期目标状态成功闭环为 done\n');

// =========================================================================
// 6. 周期到期自主巡检扫描验证 (checkInDueGoals)
// =========================================================================
console.log('6. 验证自驱巡检定时心跳推进 (checkInDueGoals)...');

const autoGoal = store.create({
  title: '每日基础设施巡检与容量预警',
  description: '持续推进主机健康状态监控',
  botId: 'ops_bot',
  userId: 'ops_lead',
  cadence: 'daily 09:00',
  steps: [
    { id: 'step_1', title: '拉取主机容量数据', status: 'pending' },
    { id: 'step_2', title: '分析内存泄漏指标', status: 'pending' }
  ]
});

// 人工将 nextCheckInAt 拨到过去以模拟到期
autoGoal.nextCheckInAt = Date.now() - 1000;
store.save();

const dueResults = await engine.checkInDueGoals();
assert(dueResults.some(r => r.goalId === autoGoal.id), '到期目标必须被调度器自动捕获推进');

const updatedAutoGoal = store.get(autoGoal.id)!;
assert.strictEqual(updatedAutoGoal.steps[0].status, 'done', '到期目标的第 1 步已自动执行完毕');
assert(updatedAutoGoal.nextCheckInAt > Date.now(), '巡检完成后必须自动计算并排期下一次 Check-in 时间');

console.log('  ✅ 定时调度器成功捕获到期目标并自主向前推进一步\n');

// =========================================================================
// 7. 验证 verificationCommand 确定性自动化验收与三向流转
// =========================================================================
console.log('7. 验证 verificationCommand 确定性脚本验收与退回/重试机制 (Deterministic Verification & Rollback)...');

const verifyGoal = store.create({
  title: '支付核心模块重构与确定性测试',
  description: '重构并验证支付网关',
  botId: 'muse',
  userId: 'user_web',
  cadence: 'weekdays 09:30',
  steps: [
    { id: 'step_1', title: '代码重构实现', status: 'pending' },
    {
      id: 'step_2',
      title: '执行确定性回归测试',
      status: 'pending',
      verificationCommand: 'echo "TEST_FAILED_FOR_NOW" && exit 1' // 模拟测试失败
    },
    { id: 'step_3', title: '交付汇总与上线', status: 'pending' }
  ]
});

// 推进第 1 步
await engine.advanceGoal(verifyGoal.id, { mockOutput: '第 1 步重构完成' });
const gAfterStep1 = store.get(verifyGoal.id)!;
assert.strictEqual(gAfterStep1.steps[0].status, 'done');
assert.strictEqual(gAfterStep1.progress, 33);

// 推进第 2 步，触发 verificationCommand 失败阻断
const vRes = await engine.advanceGoal(verifyGoal.id, { mockOutput: 'Agent 自行认为测试完成' });
assert.strictEqual(vRes.status, 'blocked', '当验证命令退出码非 0 时，必须硬阻断步骤推进');
assert(vRes.blockedReason?.includes('自动化验收命令执行未通过'), '阻断原因中必须准确标明验收命令失败');

const gAfterBlock = store.get(verifyGoal.id)!;
assert.strictEqual(gAfterBlock.steps[1].status, 'blocked');
assert(gAfterBlock.proposal !== undefined, '步骤受阻后必须自动生成修订提案');

// 模拟现场将 verificationCommand 改为通过命令
const gBeforePass = store.get(verifyGoal.id)!;
gBeforePass.steps[1].verificationCommand = 'echo "ALL_TESTS_PASSED" && exit 0';
store.save();

const passRes = await engine.retryGoal(verifyGoal.id, {
  stepId: 'step_2',
  mockOutput: '已修正并重新测试'
} as any);
assert.strictEqual(passRes.status, 'done', '验收命令返回 0 时，步骤必须顺利达成');
const gAfterPass = store.get(verifyGoal.id)!;
assert.strictEqual(gAfterPass.steps[1].status, 'done');
assert.strictEqual(gAfterPass.progress, 67);

// 验证退回指定历史步骤返工 (Rollback to Step)
await engine.rollbackGoal(verifyGoal.id, 'step_1', '发现底层架构需要微调，打回到第 1 步返工');
const gAfterRollback = store.get(verifyGoal.id)!;
assert.strictEqual(gAfterRollback.steps[0].status, 'pending', '退回后目标第 1 步必须重置为 pending');
assert.strictEqual(gAfterRollback.steps[1].status, 'pending', '退回后目标第 2 步也必须重置为 pending');
assert.strictEqual(gAfterRollback.progress, 0, '打回后进度自动归零');

console.log('  ✅ verificationCommand 确定性自动化验收、补充重试与步骤打回返工验证 100% 通过\n');

// =========================================================================
// 8. 验证目标形态(delivery/watch/portfolio)、默认无闹钟、成果沉淀、人工卡点与连续推进
// =========================================================================
console.log('8. 验证目标工作区新特性 (Modes, Default No-Cadence, Artifacts, Human Step & runGoal)...');

// 8.1 默认不设周期闹钟
const deliveryGoal = store.create({
  title: '核心模块迁移与上线交付',
  description: '跨团队逐步切流迁移',
  mode: 'delivery',
  successCriteria: '全量调用方切流完成且输出复盘报告',
  metric: { label: '已迁移调用方', current: '8', target: '20', unit: '个' },
  category: 'delivery',
  steps: [
    { id: 'd_1', title: '扫描依赖并完成首波迁移', owner: 'agent' },
    { id: 'd_2', title: '推动上下游确认切流窗口', owner: 'human' },
    { id: 'd_3', title: '清理兼容开关并沉淀结项报告', owner: 'agent' }
  ]
});

assert.strictEqual(deliveryGoal.cadence, '', '新建目标默认不应强制绑定周期闹钟');
assert.strictEqual(deliveryGoal.nextCheckInAt, 0, '无周期闹钟时 nextCheckInAt 应为 0');
assert.strictEqual(deliveryGoal.mode, 'delivery');
assert.strictEqual(deliveryGoal.successCriteria, '全量调用方切流完成且输出复盘报告');

// 8.2 连续推进：自动完成 AI 步骤 d_1，并在人工步骤 d_2 处安全停机等待人工确认
const runRes1 = await engine.runGoal(deliveryGoal.id, {
  maxRounds: 4,
  mockOutputs: ['✅ 已完成依赖扫描与首波迁移']
});
assert.strictEqual(runRes1.roundsExecuted, 2, '第 1 轮完成 d_1，第 2 轮遇到 human 步骤 d_2 停机');
assert.strictEqual(runRes1.stoppedReason, 'awaiting_human');
assert.strictEqual(runRes1.awaitingHuman, true);
assert.strictEqual(store.get(deliveryGoal.id)!.steps[0].status, 'done');
assert.strictEqual(store.get(deliveryGoal.id)!.steps[1].status, 'in_progress');

// 8.3 人工补充确认后继续连续推进直到全部达成
const runRes2 = await engine.runGoal(deliveryGoal.id, {
  maxRounds: 4,
  guidance: '上下游已确认周四晚切流',
  mockOutputs: ['✅ 切流窗口已确认', '✅ 开关已清理并生成结项报告']
});
assert.strictEqual(runRes2.goalCompleted, true);
assert.strictEqual(runRes2.stoppedReason, 'goal_completed');
assert.strictEqual(store.get(deliveryGoal.id)!.status, 'done');

// 8.4 长期沉淀模式 (portfolio) 允许无步骤且支持成果归档、Routine 挂载与专属会话绑定
const portfolioGoal = store.create({
  title: '核心交付与架构成果沉淀库',
  mode: 'portfolio',
  category: 'growth',
  successCriteria: '沉淀 5+ 份量化交付证据'
});
assert.strictEqual(portfolioGoal.steps.length, 0, 'portfolio 模式不应强制塞入默认步骤');

store.addArtifact(portfolioGoal.id, {
  title: '核心模块架构迁移结项报告',
  kind: 'report',
  ref: 'docs/migration-postmortem.md',
  summary: '零故障完成 20 个调用方迁移，P99 降低 35%'
});
store.linkRoutine(portfolioGoal.id, 'routine_biweekly_review');
store.bindSession(portfolioGoal.id, 'sess_goal_portfolio_1');

const reloadedPortfolio = new GoalStore(testGoalsFile).get(portfolioGoal.id)!;
assert.strictEqual(reloadedPortfolio.artifacts?.length, 1);
assert.strictEqual(reloadedPortfolio.artifacts?.[0].title, '核心模块架构迁移结项报告');
assert.deepStrictEqual(reloadedPortfolio.linkedRoutineIds, ['routine_biweekly_review']);
assert.strictEqual(reloadedPortfolio.sessionId, 'sess_goal_portfolio_1');

store.removeArtifact(portfolioGoal.id, reloadedPortfolio.artifacts![0].id);
store.unlinkRoutine(portfolioGoal.id, 'routine_biweekly_review');
assert.strictEqual(store.get(portfolioGoal.id)!.artifacts?.length, 0);
assert.strictEqual(store.get(portfolioGoal.id)!.linkedRoutineIds?.length, 0);

console.log('  ✅ 目标形态、默认无闹钟、成果沉淀、人工卡点与连续推进验证 100% 通过\n');

// =========================================================================
// 9. 验证目标产出物落盘至工件目录 & 执行过程自动绑定旁聊会话
// =========================================================================
console.log('9. 验证目标产出物落盘工件页与执行自动绑定旁聊会话...');

const testUsersDir = path.join(testDataDir, 'users');
const testArtifactsDir = path.join(testDataDir, 'artifacts');
const testSessionStore = new SessionStore(testUsersDir);
const boundGoalStore = new GoalStore(path.join(testDataDir, 'bound_goals.json'), testArtifactsDir);
const boundEngine = new GoalEngine({
  store: boundGoalStore,
  sentinel,
  tools,
  sessionStore: testSessionStore,
  callLLM: async () => ({ content: '默认执行完成' })
});

const linkedGoal = boundGoalStore.create({
  title: '线上延迟排查与报告交付',
  mode: 'delivery',
  botId: 'muse',
  userId: 'dev_alice',
  steps: [
    { id: 'lg_1', title: '定位慢查询与采样分析' },
    { id: 'lg_2', title: '输出最终压测与修复报告' }
  ]
});
assert.strictEqual(linkedGoal.sessionId, undefined, '创建阶段尚未执行时可未绑定旁聊');

const step1Exec = await boundEngine.advanceGoal(linkedGoal.id, {
  mockOutput: '## 慢查询分析结论\n已定位订单表缺少联合索引，P99 预计下降 45%。'
});

const afterExecGoal = boundGoalStore.get(linkedGoal.id)!;
assert.strictEqual(afterExecGoal.sessionId, `sess_goal_${linkedGoal.id}`, '执行时必须自动新建并绑定专属旁聊 ID');
assert.strictEqual(step1Exec.sessionId, afterExecGoal.sessionId);

const boundSession = testSessionStore.get(afterExecGoal.sessionId!, 'dev_alice');
assert(boundSession, '绑定的旁聊会话必须存在于 SessionStore 中');
assert.strictEqual(boundSession?.kind, 'side', '目标执行绑定的会话类型必须为 side 旁聊');
assert(boundSession!.messages.length >= 2, '旁聊必须记录本轮 user 触发与 assistant 执行结果');
assert(boundSession!.messages[0].content.includes('定位慢查询与采样分析'));
assert(boundSession!.messages[1].content.includes('已归档交付工件'), '旁聊回复应附带已落盘的工件链接');

// 验证阶段成果已真实落盘至工件目录
assert.strictEqual(afterExecGoal.artifacts?.length, 1, '步骤完成后阶段成果应自动登记到目标 artifacts');
const autoArt = afterExecGoal.artifacts![0];
assert(autoArt.filename && autoArt.url?.startsWith('/api/artifacts/'), '自动成果必须具备 filename 与 /api/artifacts/ URL');
const autoArtPath = path.join(testArtifactsDir, autoArt.filename!);
assert(fs.existsSync(autoArtPath), '目标产出工件文件必须真实写入工件目录');
const autoArtContent = fs.readFileSync(autoArtPath, 'utf-8');
assert(autoArtContent.includes('已定位订单表缺少联合索引'), '落盘工件文件必须包含执行产出的正文');

// 验证手动登记带 content 的成果同样落盘，并在删除时清理文件
boundGoalStore.addArtifact(linkedGoal.id, {
  title: '人工补充复盘结论',
  kind: 'doc',
  summary: '验证上线后观察 24 小时无异常',
  content: '索引上线后接口 P99 稳定在 42ms。'
});
const withManualArt = boundGoalStore.get(linkedGoal.id)!;
assert.strictEqual(withManualArt.artifacts?.length, 2);
const manualArt = withManualArt.artifacts![1];
const manualArtPath = path.join(testArtifactsDir, manualArt.filename!);
assert(fs.existsSync(manualArtPath), '手动登记的带正文成果也必须真实落盘到工件目录');

boundGoalStore.removeArtifact(linkedGoal.id, manualArt.id);
assert(!fs.existsSync(manualArtPath), '移除目标成果时应清理对应自动生成的工件文件');

await testSessionStore.flush('dev_alice');
const reloadedSessions = new SessionStore(testUsersDir);
assert(
  reloadedSessions.get(afterExecGoal.sessionId!, 'dev_alice')?.messages.length === boundSession!.messages.length,
  '旁聊会话记录必须可靠持久化落盘'
);

console.log('  ✅ 目标产出物落盘工件页与执行自动绑定旁聊会话验证 100% 通过\n');

// 清理测试目录
fs.rmSync(testDataDir, { recursive: true, force: true });

console.log('🎉 目标工作区 (Goals) 全链路验收通过！');
