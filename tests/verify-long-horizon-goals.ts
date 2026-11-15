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

// 清理测试目录
fs.rmSync(testDataDir, { recursive: true, force: true });

console.log('🎉 长周期目标 (Long-Horizon Goals) 与自主推进巡检机制 100% 验收通过！');
