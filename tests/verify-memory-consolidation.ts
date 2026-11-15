import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseMemoryMarkdown,
  noNewEntities,
  planConsolidation,
  applyConsolidation,
  type MemoryItem
} from '../apps/gateway/bots/consolidate.ts';
import { BotMemoryManager } from '../apps/gateway/bots/memory.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = path.resolve(__dirname, './.tmp_test_consolidation');

console.log('🧪 开始测试 MuseClaw 受控长期记忆整理与去冗余 (Memory Consolidation)...\n');

if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true });
}
fs.mkdirSync(testDataDir, { recursive: true });

const memoryManager = new BotMemoryManager(testDataDir);

// =========================================================================
// 1. 记忆文本结构化解析与用户锚点识别 (Parsing & User Anchors)
// =========================================================================
console.log('1. 验证 MEMORY.md 结构化解析与 [user] 声明锚点识别...');

const rawMemory = `
# 员工数字助手长期记忆
- 偏好使用 React 18
- 项目已升级到 React 19
- [user] 个人手机号 13800138000
- 上周二安排帮我订下午两点的会议室
- 常用测试服务器 192.168.1.100
`;

const { items } = parseMemoryMarkdown(rawMemory);
assert.strictEqual(items.length, 5, '必须准确解析出 5 条有效记忆条目');
assert.strictEqual(items[0].content, '偏好使用 React 18');
assert.strictEqual(items[0].source, 'agent');
assert.strictEqual(items[2].content, '[user] 个人手机号 13800138000');
assert.strictEqual(items[2].source, 'user', '[user] 声明行必须识别为 source=user');

console.log('  ✅ 结构化提取 ID 与 [user] 声明锚点识别验证通过\n');

// =========================================================================
// 2. 确定性死线 1 验证：实体守恒防凭空捏造 (No New Entities / Hallucination Gate)
// =========================================================================
console.log('2. 验证死线 1：实体守恒防凭空捏造 (No New Entities)...');

const sourceA: MemoryItem = { id: 'm_1', content: '偏好使用 React 18', source: 'agent', rawLine: '', prefix: '- ' };
const sourceB: MemoryItem = { id: 'm_2', content: '项目已升级到 React 19', source: 'agent', rawLine: '', prefix: '- ' };

// 2.1 合法合并（只使用已有词汇与连接词）
const validMerge = '项目已升级到 React 19（原偏好使用 React 18）';
assert.strictEqual(noNewEntities(validMerge, [sourceA, sourceB]), true, '仅含源词汇与连接词的合并必须允许通过');

// 2.2 幻觉捏造（出现了未提及的新实体：Vue 3）
const invalidMerge = '项目已升级到 Vue 3（原偏好使用 React 18）';
assert.strictEqual(noNewEntities(invalidMerge, [sourceA, sourceB]), false, '包含未曾提及的新实体 (Vue 3) 必须被死线精准拦截！');

console.log('  ✅ 实体守恒判定有效，彻底杜绝 LLM 整理时无中生有捏造事实\n');

// =========================================================================
// 3. 确定性死线 2 & 3 验证：用户锚点保护与 20% 预算限制
// =========================================================================
console.log('3. 验证死线 2 & 3：用户声明绝对保护与 20% 预算限制...');

// 构造 10 条条目以严格测试 20% 预算 (最多精简 2 条)
const tenItems: MemoryItem[] = [
  { id: 'm_1', content: '偏好使用 React 18', source: 'agent', rawLine: '- 偏好使用 React 18', prefix: '- ' },
  { id: 'm_2', content: '项目已升级到 React 19', source: 'agent', rawLine: '- 项目已升级到 React 19', prefix: '- ' },
  { id: 'm_3', content: '[user] 个人手机号 13800138000', source: 'user', rawLine: '- [user] 个人手机号 13800138000', prefix: '- ' },
  { id: 'm_4', content: '上周二安排帮我订下午两点的会议室', source: 'agent', rawLine: '- 上周二安排帮我订下午两点的会议室', prefix: '- ' },
  { id: 'm_5', content: '常用测试服务器 192.168.1.100', source: 'agent', rawLine: '- 常用测试服务器 192.168.1.100', prefix: '- ' },
  { id: 'm_6', content: '负责日常巡检任务', source: 'agent', rawLine: '- 负责日常巡检任务', prefix: '- ' },
  { id: 'm_7', content: '关注 CPU 与内存告警', source: 'agent', rawLine: '- 关注 CPU 与内存告警', prefix: '- ' },
  { id: 'm_8', content: '熟悉 Docker 容器命令', source: 'agent', rawLine: '- 熟悉 Docker 容器命令', prefix: '- ' },
  { id: 'm_9', content: '了解 K8s 基础运维', source: 'agent', rawLine: '- 了解 K8s 基础运维', prefix: '- ' },
  { id: 'm_10', content: '熟练使用 Linux Shell', source: 'agent', rawLine: '- 熟练使用 Linux Shell', prefix: '- ' }
];

// LLM 提出了 3 个操作：
// 1) drop m_3 (用户声明，应被死线拦截)
// 2) drop m_4 (正常过时琐碎，应通过，消耗预算 1)
// 3) merge m_1 + m_2 (合并，应通过，消耗预算 2 - 1 = 1)
// 4) drop m_5 (第 4 个操作，此时累计减少 2 项，再减少 1 项将达到 3 > 2，应被预算拦截)
const aggressiveProposals = [
  { op: 'drop', id: 'm_3', reason: '删除联系方式' },
  { op: 'drop', id: 'm_4', reason: '一次性已结束琐事' },
  { op: 'merge', ids: ['m_1', 'm_2'], content: '项目已升级到 React 19（原偏好使用 React 18）' },
  { op: 'drop', id: 'm_5', reason: '测试服务器' }
];

const planResult = planConsolidation(tenItems, aggressiveProposals, 0.2);

assert.strictEqual(planResult.ops.length, 2, '只有合法且在预算内的 2 个操作被采纳');
assert(planResult.skipped.some(s => s.includes('严禁删除用户亲自录入的声明')), '必须包含拦截用户声明 drop 的记录');
assert(planResult.skipped.some(s => s.includes('超出单次 20% 精简预算限制')), '必须包含超出 20% 预算截断的记录');
assert.strictEqual(planResult.more, true, '超出预算后必须置 more=true 留待下个周期');

console.log('  ✅ 用户声明 [user] 被物理保护，单次精简严格锁定在 20% 预算红线内\n');

// =========================================================================
// 4. 端到端长期记忆自整理与一键撤销 (Consolidation & Undo Lifecycle)
// =========================================================================
console.log('4. 验证端到端长期记忆自整理与一键撤销 (Undo & Audit Trail)...');

const botId = 'assistant_bot';
const initialMemory = `# 个人备忘
- 偏好使用 React 18
- 项目已升级到 React 19
- [user] 个人工号 9527
- 帮我查询明天北京天气如何
- 关注生产环境 192.168.1.200
- 负责接口性能监控
- 熟悉 Linux 基本命令
- 了解 Docker 容器部署
- 掌握 Git 分支管理
- 关注周报生成提醒
`;

memoryManager.saveMemory(botId, initialMemory);

// 模拟带有合理提议的 LLM 回复
const fakeLLM = async (prompt: string): Promise<string> => {
  return JSON.stringify([
    { op: 'drop', id: 'm_4', reason: '一次性查天气已过时' },
    { op: 'merge', ids: ['m_1', 'm_2'], content: '项目已升级到 React 19（原使用 React 18）' }
  ]);
};

// 4.1 执行 Dry-Run 预检模式
const dryRunReport = await memoryManager.consolidateMemory(botId, fakeLLM, { dryRun: true });
assert.strictEqual(dryRunReport.dryRun, true);
assert.strictEqual(dryRunReport.planned.length, 2);
assert.strictEqual(memoryManager.getMemory(botId), initialMemory.trim(), 'Dry-Run 不得修改磁盘上的 MEMORY.md');
console.log('  ✅ Dry-Run 预检模式验证通过，不发生任何写操作');

// 4.2 执行正式整理落地
const realReport = await memoryManager.consolidateMemory(botId, fakeLLM, { dryRun: false });
assert.strictEqual(realReport.dryRun, false);
assert.strictEqual(realReport.changed, 2);

const updatedMemory = memoryManager.getMemory(botId);
assert(updatedMemory.includes('项目已升级到 React 19（原使用 React 18）'), '新记忆必须包含合并后的条目');
assert(!updatedMemory.includes('北京天气'), '过时查天气必须已被删除');
assert(updatedMemory.includes('[user] 个人工号 9527'), '用户声明必须完整保留');
console.log('  ✅ 正式记忆整理落地生效，过时碎屑被清除，相关事实平滑合并');

// 4.3 校验历史审计报告已持久化
const history = memoryManager.getConsolidationHistory(botId);
assert(history.length >= 1, '必须生成至少一条历史审计记录');
assert.strictEqual(history[0].changed, 2);
console.log('  ✅ 结构化 TidyReport 审计日志落盘留痕验证通过');

// 4.4 验证一键撤销 (Undo)
const undoResult = memoryManager.undoLastConsolidation(botId);
assert.strictEqual(undoResult.success, true);
const restoredMemory = memoryManager.getMemory(botId);
assert.strictEqual(restoredMemory, initialMemory.trim(), '撤销后记忆文本必须 100% 恢复为整理前的原始状态');
console.log('  ✅ 一键 Undo 撤销功能验证通过，记忆 100% 无损回滚');

// 清理测试目录
fs.rmSync(testDataDir, { recursive: true, force: true });

console.log('\n🎉 受控长期记忆整理与去冗余机制 (Memory Consolidation) 100% 验收通过！');
