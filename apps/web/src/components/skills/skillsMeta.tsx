import React from 'react';
import {
  Terminal,
  FileText,
  Globe,
  Box,
  Code,
  Layers,
  FileCode
} from 'lucide-react';
import type { SkillCategory, SkillSource, TabType } from '../../types';

export interface SkillCategoryMeta {
  label: string;
  className: string;
  icon: React.ReactNode;
}

export const CATEGORY_META: Record<SkillCategory, SkillCategoryMeta> = {
  devops: { label: '系统运维', className: 'cat-devops', icon: <Terminal size={13} /> },
  productivity: { label: '办公协作', className: 'cat-productivity', icon: <FileText size={13} /> },
  research: { label: '深度研究', className: 'cat-research', icon: <Globe size={13} /> },
  integration: { label: '生态集成', className: 'cat-integration', icon: <Box size={13} /> },
  utility: { label: '实用工具', className: 'cat-utility', icon: <Code size={13} /> },
  custom: { label: '自建/工坊', className: 'cat-custom', icon: <Layers size={13} /> }
};

export const SOURCE_LABELS: Record<SkillSource, string> = {
  builtin: '内置基座',
  custom: '用户自建',
  imported: '外部导入',
  learned: '工坊自学'
};

export const LIFECYCLE_LABELS: Record<'active' | 'stale' | 'archived', string> = {
  active: '活跃',
  stale: '长期未用',
  archived: '已归档'
};

export interface SkillTemplatePreset {
  id: string;
  label: string;
  category: SkillCategory;
  name: string;
  description: string;
  requiresBins: string;
  requiresEnv: string;
  instructions: string;
}

export const SKILL_STARTER_TEMPLATES: SkillTemplatePreset[] = [
  {
    id: 'cli-inspector',
    label: '命令行巡检模板',
    category: 'devops',
    name: 'service-health-check',
    description: '检查指定服务进程、端口连通性与近期错误日志，产出简洁的排障结论。',
    requiresBins: 'bash, ss',
    requiresEnv: '',
    instructions: `# 服务健康巡检规程

## 何时使用
当需要排查本地或测试环境服务异常、端口未监听或日志报错时触发。

## 执行步骤
1. 先确认目标服务名称或监听端口，使用只读命令核查进程与端口状态。
2. 抽取最近 50 行错误日志进行归因，不擅自重启关键进程。
3. 汇总异常指标与修复建议，必要时提示风险操作审批。`
  },
  {
    id: 'api-connector',
    label: '外部接口集成模板',
    category: 'integration',
    name: 'weather-brief-api',
    description: '调用第三方 REST API 获取结构化数据并按用户偏好格式化输出。',
    requiresBins: '',
    requiresEnv: 'SERVICE_API_KEY',
    instructions: `# 外部 API 集成规程

## 何时使用
当用户查询需要通过外部服务接口拉取实时数据，且已配置对应密钥时触发。

## 执行步骤
1. 从受控环境变量读取认证凭据，严禁在响应中回显明文密钥。
2. 使用 web_fetch 请求目标端点并校验返回状态码与字段完整性。
3. 对核心字段做单位换算与摘要排版后返回给用户。`
  },
  {
    id: 'interactive-brief',
    label: '交互分析报告模板',
    category: 'research',
    name: 'structured-comparison',
    description: '针对多方案对比或参数测算需求，生成结构化结论与交互式分析组件。',
    requiresBins: '',
    requiresEnv: '',
    instructions: `# 多方案结构化对比规程

## 何时使用
当用户提出多选项对比、采购估算、架构拆解等需要交互式展示的问题时触发。

## 执行步骤
1. 识别关键对比维度（成本、复杂度、可维护性、时效性）并收集依据。
2. 若适合参数联动或可视化拆解，优先使用 show_widget 输出自包含交互组件。
3. 附加一段简明决策建议，突出关键取舍点。`
  }
];

export function renderSkillFileIcon(filePath: string, executable?: boolean) {
  if (filePath.startsWith('scripts/') || executable) {
    return <Terminal size={13} className="skill-file-icon is-script" />;
  }
  if (filePath.startsWith('assets/')) {
    return <FileCode size={13} className="skill-file-icon is-asset" />;
  }
  if (filePath.startsWith('references/')) {
    return <FileText size={13} className="skill-file-icon is-ref" />;
  }
  return <FileText size={13} className="skill-file-icon" />;
}

export function launchSkillInChat(skillName: string, setTab: (tab: TabType) => void) {
  const draft = `/${skillName} `;
  sessionStorage.setItem('museclaw_chat_draft', draft);
  window.dispatchEvent(new CustomEvent('museclaw:chat_draft', { detail: draft }));
  setTab('chat');
}
