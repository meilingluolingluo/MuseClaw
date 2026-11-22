import React, { type ReactNode } from 'react';
import {
  Briefcase,
  GraduationCap,
  Terminal,
  PiggyBank,
  Heart,
  HeartHandshake,
  House,
  Compass,
  Palette,
  Tag
} from 'lucide-react';
import type { GoalCategory } from '../types';

export interface CategoryDef {
  id: GoalCategory;
  label: string;
  tone: string;
  badgeStyle: string;
  icon: (props: { size?: number; className?: string }) => ReactNode;
  description: string;
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'career',
    label: '事业工作',
    tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
    badgeStyle: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    icon: (p) => React.createElement(Briefcase, p),
    description: '核心项目交付、业务目标突破与职场进阶'
  },
  {
    id: 'learning',
    label: '学习技能',
    tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
    badgeStyle: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    icon: (p) => React.createElement(GraduationCap, p),
    description: '前沿技术钻研、论文研读与跨领域知识体系'
  },
  {
    id: 'engineering',
    label: '研发架构',
    tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
    badgeStyle: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
    icon: (p) => React.createElement(Terminal, p),
    description: '系统重构、自动化流水线与代码工程质量'
  },
  {
    id: 'finance',
    label: '财务资产',
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    badgeStyle: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    icon: (p) => React.createElement(PiggyBank, p),
    description: '预算管控、成本优化与中长期资产配置'
  },
  {
    id: 'health',
    label: '健康体能',
    tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
    badgeStyle: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    icon: (p) => React.createElement(Heart, p),
    description: '作息规律、耐力锻炼与身体状态监控'
  },
  {
    id: 'relationships',
    label: '团队协作',
    tone: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/30',
    badgeStyle: 'bg-pink-500/15 text-pink-600 dark:text-pink-300',
    icon: (p) => React.createElement(HeartHandshake, p),
    description: '跨部门协作、伙伴沟通与团队能力建设'
  },
  {
    id: 'home',
    label: '日常组织',
    tone: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
    badgeStyle: 'bg-orange-500/15 text-orange-600 dark:text-orange-300',
    icon: (p) => React.createElement(House, p),
    description: '个人生活事务、环境维护与日常习惯'
  },
  {
    id: 'travel',
    label: '差旅出行',
    tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
    badgeStyle: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300',
    icon: (p) => React.createElement(Compass, p),
    description: '商务差旅、长线旅行规划与路线清单'
  },
  {
    id: 'creative',
    label: '创作构想',
    tone: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30',
    badgeStyle: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300',
    icon: (p) => React.createElement(Palette, p),
    description: '灵感探索、独立产品原型与内容创作'
  },
  {
    id: 'other',
    label: '通用其他',
    tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
    badgeStyle: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    icon: (p) => React.createElement(Tag, p),
    description: '自由定义的长周期综合任务'
  }
];

export function categoryOf(id: string): CategoryDef {
  const found = CATEGORIES.find((c) => c.id.toLowerCase() === (id || '').toLowerCase());
  return (
    found || {
      id: 'other',
      label: id || '通用其他',
      tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
      badgeStyle: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
      icon: (p) => React.createElement(Tag, p),
      description: '通用任务'
    }
  );
}

export const CADENCES = [
  { id: '', label: '不设周期提醒' },
  { id: 'daily', label: '每天' },
  { id: 'weekdays', label: '每个工作日 (周一至周五)' },
  { id: 'weekly', label: '每周一次' },
  { id: 'monthly', label: '每月一次' }
];

export const WEEKDAYS = [
  { id: 'mon', label: '周一' },
  { id: 'tue', label: '周二' },
  { id: 'wed', label: '周三' },
  { id: 'thu', label: '周四' },
  { id: 'fri', label: '周五' },
  { id: 'sat', label: '周六' },
  { id: 'sun', label: '周日' }
];

export function splitCadence(spec: string): { cadence: string; anchor: string; time: string } {
  const trimmed = (spec || '').trim();
  if (!trimmed) return { cadence: '', anchor: '', time: '09:00' };

  const m = /^(daily|weekdays|weekly|monthly)(?:\s+(\S+?))?(?:\s+(\d{1,2}:\d{2}))?$/.exec(trimmed);
  if (!m) return { cadence: '', anchor: '', time: '09:00' };

  let anchor = m[2] ?? '';
  let time = m[3] ?? '09:00';
  if (anchor && /^\d{1,2}:\d{2}$/.test(anchor)) {
    time = anchor;
    anchor = '';
  }
  return { cadence: m[1], anchor, time: time.padStart(5, '0') };
}

export function joinCadence(cadence: string, anchor: string, time: string): string {
  if (!cadence) return '';
  return [cadence, anchor, time].filter(Boolean).join(' ');
}

export function weekdayName(short: string): string {
  const w = WEEKDAYS.find((item) => item.id === short);
  return w ? w.label : short;
}

export function describeCadence(spec: string): string {
  if (!spec) return '单次/手动推演';
  const { cadence, anchor, time } = splitCadence(spec);
  switch (cadence) {
    case 'daily':
      return `每天 ${time}`;
    case 'weekdays':
      return `工作日 ${time}`;
    case 'weekly':
      return anchor ? `每${weekdayName(anchor)} ${time}` : `每周 ${time}`;
    case 'monthly':
      return `每月 ${anchor || '1'} 日 ${time}`;
    default:
      return spec;
  }
}

export function dueLabel(due?: string): { label: string; isOverdue: boolean } {
  if (!due) return { label: '', isOverdue: false };
  const targetDate = new Date(`${due}T00:00:00`);
  if (Number.isNaN(targetDate.getTime())) return { label: due, isOverdue: false };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round((targetDate.getTime() - today.getTime()) / 86400000);
  const formatted = `${targetDate.getMonth() + 1}月${targetDate.getDate()}日`;

  if (diffDays < 0) {
    return { label: `已逾期 (原定 ${formatted})`, isOverdue: true };
  }
  if (diffDays === 0) {
    return { label: '今天截止', isOverdue: false };
  }
  if (diffDays === 1) {
    return { label: '明天截止', isOverdue: false };
  }
  if (diffDays <= 7) {
    return { label: `还剩 ${diffDays} 天 (${formatted})`, isOverdue: false };
  }
  return { label: `截止于 ${formatted}`, isOverdue: false };
}

/**
 * 经典目标模板预置 (按领域)
 */
export const CATEGORY_PRESETS: Record<
  string,
  { title: string; description: string; steps: string[] }
> = {
  engineering: {
    title: '构建高质量微沙箱与自动化测试套件',
    description: '通过隔离容器与完备测试门禁，保障系统长期可维护性与稳定性',
    steps: [
      '梳理核心模块边界与依赖输入输出',
      '编写关键链路单元测试与边缘用例',
      '配置 MicroSandbox 沙箱环境与执行脚本',
      '形成测试验收清单与指标自动化沉淀'
    ]
  },
  learning: {
    title: '深入掌握 Agent 核心原理与自主规划架构',
    description: '精读经典论文与开源实现，完成多步骤推理与自驱推演实践',
    steps: [
      '研读 ReAct、Plan-and-Solve 与自驱决策机制',
      '复刻极简 Agent 执行循环与工具调用层',
      '接入受控长期记忆与历史反思机制',
      '完成综合能力测试用例并总结架构实践笔记'
    ]
  },
  career: {
    title: '推进 Q4 重点业务系统交付与上线复盘',
    description: '跨部门协作拉通，攻克技术卡点，确保按期高质量交付',
    steps: [
      '锁定关键交付范围与里程碑时间表',
      '完成核心链路联调测试与性能压测',
      '组织灰度上线并排查首期线上监控反馈',
      '撰写上线成果总结与下阶段规划提案'
    ]
  },
  finance: {
    title: '云上基础设施与开发资源成本优化',
    description: '盘点计算、存储与第三方 API 费用，实现闲置资源精简与降本 20%',
    steps: [
      '导出近 3 个月云服务账单并归类成本构成',
      '排查闲置沙箱实例、未挂载存储盘与冗余 API 调用',
      '落地资源按需启停策略与规格缩容方案',
      '复盘降本成效并输出月度成本看板'
    ]
  },
  health: {
    title: '建立每周规律运动与作息正反馈循环',
    description: '保障精力充沛，维持工作与健康平衡',
    steps: [
      '设定每周 3 次、每次 30 分钟有氧运动日程',
      '睡前 1 小时远离屏幕并维持 23:00 入睡习惯',
      '记录每日饮水与精力状态打卡',
      '每周日晚汇总运动数据并微调下周计划'
    ]
  },
  relationships: {
    title: '搭建敏捷跨团队技术协作与周度对齐机制',
    description: '理顺跨组协作流程，减少沟通摩擦，提升跨组需求端到端交付效率',
    steps: [
      '梳理现有跨团队沟通堵点与上下游依赖瓶颈',
      '制定周度轻量对齐会规范与任务跟踪模板',
      '建立阻碍项（Blocker）24小时升级与响应闭环',
      '完成首月运行复盘并收集组内协同满意度'
    ]
  },
  home: {
    title: '构建数字化个人知识库与日常秩序管理',
    description: '整合碎片化信息与事务待办，打造有序整洁的个人工作与生活环境',
    steps: [
      '全面整理本地磁盘、下载目录与云端历史文档',
      '建立模块化分类标签与文件归档命名规范',
      '梳理日常固定待办与周期性事务清单',
      '固化周末 15 分钟数字空间维护与盘点习惯'
    ]
  },
  travel: {
    title: '统筹制定季度关键差旅与商务出行方案',
    description: '提前规划行程路线、会晤准备与应急预案，保障差旅高效顺畅',
    steps: [
      '确认出行目的、拜访对象与核心时间节点',
      '预订交通票务与住宿并完成行程单归档',
      '准备随行会议材料、离线文档与技术设备清单',
      '差旅结束后及时完成费用报销与拜访备忘整理'
    ]
  },
  creative: {
    title: '完成新产品创意原型设计与最小可用验证',
    description: '将灵感系统化落地为可交互原型，完成核心闭环与用户价值验证',
    steps: [
      '梳理创意核心价值主张与目标用户使用场景',
      '绘制关键用户交互旅程与高保真原型界面',
      '快速搭建端到端最小可用版本 (MVP) 原型',
      '面向目标用户开展小范围体验并收集迭代建议'
    ]
  },
  other: {
    title: '制定跨周期核心突破目标与阶段性里程碑',
    description: '聚焦关键战略事项，拆解量化落地路径，建立定期推演与复盘机制',
    steps: [
      '明确长周期最终验收标准与量化关键结果',
      '拆解各执行阶段的关键里程碑与前置依赖',
      '设定定期巡检节奏与风险自适应修订策略',
      '按计划开展阶段性成果检视并沉淀实践总结'
    ]
  }
};
