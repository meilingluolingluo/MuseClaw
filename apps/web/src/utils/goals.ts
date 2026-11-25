import React, { type ReactNode } from 'react';
import {
  Briefcase,
  Terminal,
  BookOpen,
  Activity,
  FolderArchive,
  Tag,
  Rocket,
  Radar,
  Archive,
  FileText,
  FileCode2,
  Link2,
  StickyNote,
  BarChart3
} from 'lucide-react';
import type { GoalArtifact, GoalCategory, GoalMode } from '../types';

export interface GoalModeDef {
  id: GoalMode;
  label: string;
  tagline: string;
  description: string;
  criteriaPlaceholder: string;
  defaultCategory: GoalCategory;
  icon: (props: { size?: number; className?: string }) => ReactNode;
}

export const GOAL_MODES: GoalModeDef[] = [
  {
    id: 'delivery',
    label: '阶段交付',
    tagline: '跨天推进 · 有明确终局交付',
    description: '适用于需要多轮推进、跨周配合或等待外部确认的项目与专项，沉淀阶段产出直到验收达标。',
    criteriaPlaceholder: '例如：全量调用方迁移完成、通过回归测试并输出上线复盘报告',
    defaultCategory: 'delivery',
    icon: (p) => React.createElement(Rocket, p)
  },
  {
    id: 'watch',
    label: '追踪观察',
    tagline: '持续盯防 · 有变化再介入',
    description: '适用于缺陷复现观察、灰度稳定性验证、指标监控或外部动态追踪，可按需挂载例行任务静默巡检。',
    criteriaPlaceholder: '例如：连续观察 72 小时零异常告警，清理临时日志后输出根因复盘',
    defaultCategory: 'operations',
    icon: (p) => React.createElement(Radar, p)
  },
  {
    id: 'portfolio',
    label: '长期沉淀',
    tagline: '非连续攒料 · 资产随手归档',
    description: '适用于述职材料、复盘资产库、长期调研档案等非线性目标，平时随手收集证据，需要时一键汇总。',
    criteriaPlaceholder: '例如：积累 5 个核心项目的量化产出与复盘案例，形成结构化汇报大纲',
    defaultCategory: 'growth',
    icon: (p) => React.createElement(Archive, p)
  }
];

export function modeOf(mode?: GoalMode): GoalModeDef {
  return GOAL_MODES.find((m) => m.id === mode) || GOAL_MODES[0];
}

export const ARTIFACT_KINDS: {
  id: GoalArtifact['kind'];
  label: string;
  icon: (props: { size?: number; className?: string }) => ReactNode;
}[] = [
  { id: 'doc', label: '文档', icon: (p) => React.createElement(FileText, p) },
  { id: 'report', label: '报告', icon: (p) => React.createElement(BarChart3, p) },
  { id: 'file', label: '文件', icon: (p) => React.createElement(FileCode2, p) },
  { id: 'link', label: '链接', icon: (p) => React.createElement(Link2, p) },
  { id: 'note', label: '摘要', icon: (p) => React.createElement(StickyNote, p) }
];

export function artifactKindDef(kind: GoalArtifact['kind']) {
  return ARTIFACT_KINDS.find((k) => k.id === kind) || ARTIFACT_KINDS[0];
}

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
    id: 'delivery',
    label: '项目交付',
    tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
    badgeStyle: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    icon: (p) => React.createElement(Briefcase, p),
    description: '跨天推进的重点需求、专项改造与端到端交付'
  },
  {
    id: 'engineering',
    label: '研发技术',
    tone: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
    badgeStyle: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
    icon: (p) => React.createElement(Terminal, p),
    description: '架构治理、性能优化、缺陷追踪与工程质量提升'
  },
  {
    id: 'research',
    label: '调研分析',
    tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
    badgeStyle: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    icon: (p) => React.createElement(BookOpen, p),
    description: '技术选型、方案预研、PoC 验证与竞品深度拆解'
  },
  {
    id: 'operations',
    label: '业务运营',
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    badgeStyle: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    icon: (p) => React.createElement(Activity, p),
    description: '指标治理、SLA 稳定观察、成本优化与流程运营'
  },
  {
    id: 'growth',
    label: '成长沉淀',
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    badgeStyle: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    icon: (p) => React.createElement(FolderArchive, p),
    description: '晋升述职素材、季度战报、复盘案例与个人资产库'
  },
  {
    id: 'other',
    label: '通用目标',
    tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
    badgeStyle: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    icon: (p) => React.createElement(Tag, p),
    description: '自定义跨会话协作目标与产出管理'
  }
];

const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  career: '项目交付',
  learning: '调研分析',
  finance: '成本资产',
  health: '状态管理',
  relationships: '团队协作',
  home: '日常组织',
  travel: '差旅统筹',
  creative: '创意原型'
};

export function categoryOf(id: string): CategoryDef {
  const key = (id || '').toLowerCase();
  const found = CATEGORIES.find((c) => c.id.toLowerCase() === key);
  if (found) return found;
  return {
    id: key || 'other',
    label: LEGACY_CATEGORY_LABELS[key] || id || '通用目标',
    tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
    badgeStyle: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    icon: (p) => React.createElement(Tag, p),
    description: '跨会话工作目标'
  };
}

export const CADENCES = [
  { id: '', label: '不设周期提醒（按需推进）' },
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
  if (!spec) return '按需推进';
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

export interface GoalStarterPreset {
  mode: GoalMode;
  category: GoalCategory;
  title: string;
  description: string;
  successCriteria: string;
  steps: string[];
  metric?: { label: string; current: string; target: string; unit?: string };
}

export const MODE_STARTERS: GoalStarterPreset[] = [
  {
    mode: 'delivery',
    category: 'delivery',
    title: '核心模块架构迁移与跨方上线交付',
    description: '分批迁移上下游调用方并清理历史兼容开关，避免跨周推进时遗漏依赖。',
    successCriteria: '所有调用方切流完成、灰度零报错并沉淀架构结项报告',
    steps: [
      '扫描全量依赖与调用方清单并排定分批计划',
      '完成第一批核心链路改造与回归验证',
      '推动上下游团队确认切流窗口（人工确认）',
      '清理历史兜底开关并汇总结项复盘报告'
    ]
  },
  {
    mode: 'watch',
    category: 'operations',
    title: '线上偶发异常修复后 72 小时稳定性观察',
    description: '跨时间窗口追踪异常是否复现，平时保持静默，满足观察条件后提醒清理临时代码与复盘。',
    successCriteria: '连续 72 小时零复现告警，清理临时埋点并生成 Postmortem 复盘',
    metric: { label: '稳定观察时长', current: '0', target: '72', unit: '小时' },
    steps: [
      '记录本次修复变更与已排除假设',
      '持续静默观测异常指标与日志样本',
      '达到观察窗口后人工确认清理临时埋点并结案'
    ]
  },
  {
    mode: 'portfolio',
    category: 'growth',
    title: '年度 / 季度述职成果与核心产出档案',
    description: '非连续收集跨项目代表性交付、量化收益与故障复盘证据，需要汇报时一键组织成稿。',
    successCriteria: '沉淀 5+ 份带量化数据的核心证据，随时可导出结构化述职大纲',
    steps: []
  }
];

export const CATEGORY_PRESETS: Record<
  string,
  { title: string; description: string; successCriteria?: string; steps: string[] }
> = {
  delivery: {
    title: '跨团队重点专项端到端交付',
    description: '对齐上下游排期、隐性依赖与上线前检查清单，确保按期平稳交付',
    successCriteria: '上线前检查项 100% 通过且灰度首周稳定运行',
    steps: [
      '梳理需求边界、上下游依赖与风险台账',
      '完成核心开发、联调与回归测试验证',
      '确认灰度发布窗口与回滚预案',
      '上线后观察稳定性并沉淀交付总结'
    ]
  },
  engineering: {
    title: '接口 P99 性能优化与容量治理',
    description: '通过基线测量、多轮瓶颈定位与压测验证达成量化性能目标',
    successCriteria: '核心接口 P99 耗时达标且无内存或稳定性回退',
    steps: [
      '采集当前性能基线与热点火焰图',
      '实施第一轮核心路径优化并跑通压测对比',
      '完成防劣化校验并固化基准报告'
    ]
  },
  research: {
    title: '技术选型预研与最小可行验证 (PoC)',
    description: '围绕真实业务约束对比候选方案，产出可运行 PoC 与量化评估报告',
    successCriteria: '产出含实测数据对比的可拍板选型结论文档',
    steps: [
      '明确场景硬约束与评估维度',
      '跑通候选方案最小 PoC 并记录实测数据',
      '输出《方案对比与落地建议报告》'
    ]
  },
  operations: {
    title: '线上告警追踪与稳定性长效观察',
    description: '关联历史排查线索，在观察窗口内静默追踪异常复现情况',
    successCriteria: '观察窗口零异常且完成复盘归档',
    steps: [
      '整理现象、已排除假设与当前观察窗口',
      '持续巡检日志与核心指标变化',
      '确认根治后输出复盘文档'
    ]
  },
  growth: {
    title: '阶段性工作成果与能力证据沉淀库',
    description: '持续归档代表性项目、技术攻坚与量化结果，避免考前翻找记录',
    successCriteria: '形成覆盖技术深度、业务价值与协作影响力的完整证据库',
    steps: []
  },
  other: {
    title: '跨会话持久目标与成果工作区',
    description: '围绕明确终局标准推进任务并持续沉淀相关产出',
    successCriteria: '达成约定验收标准并归档最终产出物',
    steps: [
      '明确目标范围与验收标准',
      '分阶段推进关键任务',
      '汇总最终产出物并确认达成'
    ]
  }
};
