import {
  deriveBotActivities,
  groupActivities,
  humanizeToolCall,
  stripMarkdown,
  formatTimeLabel,
} from '../apps/web/src/utils/activityHelper.ts';

console.log('--- 测试 1: stripMarkdown 与自然语言清洗 ---');
const rawMd = '## 结论：余票查询\n- 找到 **2 趟**车次，价格 `¥150`。\n| 序号 | 车次 |';
const cleaned = stripMarkdown(rawMd);
console.log('清洗结果:', cleaned);
if (cleaned.includes('##') || cleaned.includes('**')) {
  throw new Error('Markdown 标记清洗失败');
}

console.log('\n--- 测试 2: 工具调用自然语言意图映射 ---');
const t1 = humanizeToolCall('read_file', { path: '/workspace/MEMORY.md' });
console.log('MEMORY.md 工具映射:', t1);
if (t1.title !== '读取 MEMORY.md 文件' || t1.subtitle !== 'Read your memory file') {
  throw new Error('MEMORY.md 映射不符');
}

const t2 = humanizeToolCall('execute_shell', { command: 'git status -s' });
console.log('Git 巡检映射:', t2);
if (!t2.title.includes('Git')) {
  throw new Error('Git 状态检测映射不符');
}

console.log('\n--- 测试 3: 严格过滤审核/审批日志（不进入任务层级） ---');
const now = Date.now();
const mockFeed = [
  {
    kind: 'chat',
    title: '安排老板开工付款',
    text: 'Recorded 50,000 and 30,000 restart payments',
    ts: new Date(now - 1000 * 60 * 30).toISOString(),
    id: 'f1',
  },
  {
    kind: 'approval', // 审核审批事件，必须被严格过滤！
    title: '待审批: 工作区与 Git 代码未提交巡检',
    text: '例行任务触发敏感操作，等待授权审批',
    ts: new Date(now - 1000 * 60 * 45).toISOString(),
    id: 'f_appr',
  },
  {
    kind: 'routine',
    title: '例行任务: 工作区与 Git 代码未提交巡检',
    text: 'Checked repository working tree and status',
    ts: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
    id: 'f2',
  },
  {
    kind: 'chat',
    title: '搜索 AdsPower 登录记忆',
    text: 'Shared search results with no memories found',
    ts: new Date(now - 1000 * 60 * 60 * 26).toISOString(), // 昨天
    id: 'f3',
  },
];

const mockSessions = [
  {
    id: 's1',
    bot_id: 'haibara',
    updated_at: now - 1000 * 60 * 15,
    messages: [
      {
        role: 'assistant',
        toolCalls: [
          {
            tool: 'read_file',
            params: { path: 'MEMORY.md' },
            startedAt: now - 1000 * 60 * 15,
          },
        ],
      },
    ],
  },
];

const derived = deriveBotActivities(mockFeed, mockSessions, 'haibara');
console.log(`衍生得到 ${derived.length} 条活动流水`);

// 校验是否过滤了 approval
const hasApproval = derived.some((d) => d.id === 'f_appr' || d.title.includes('审批'));
if (hasApproval) {
  throw new Error('未能过滤审批审核记录，审批记录不应出现在任务层级！');
}

console.log('\n--- 测试 4: 日期分组与流水衍生 (今天 vs 昨天) ---');
const groups = groupActivities(derived);
console.log('分组结果:', groups.map((g) => `${g.label} (${g.items.length}条)`).join(', '));

const todayGroup = groups.find((g) => g.label === '今天');
const yesterdayGroup = groups.find((g) => g.label === '昨天');

if (!todayGroup || todayGroup.items.length === 0) {
  throw new Error('今天分组不能为空');
}
if (!yesterdayGroup || yesterdayGroup.items.length === 0) {
  throw new Error('昨天分组不能为空');
}

console.log('\n✅ 智能体任务轨迹纯净化过滤及预定任务解析模块所有测试通过！');
