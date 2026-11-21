/**
 * Agent Skills Parser & Security Scanner
 * 遵循标准 Agent Skills 规范
 * 标准 SKILL.md 格式：
 * ---
 * name: <slug>
 * description: <one-line summary>
 * category: devops | productivity | research | integration | utility | custom
 * requires:
 *   bins: [bin1, bin2]
 *   env: [ENV_VAR]
 * allowed-tools: [tool1, tool2]
 * metadata:
 *   author: MuseClaw
 *   version: "1.0.0"
 * ---
 * # Markdown body...
 */

import { execSync } from 'node:child_process';
import type { SkillCategory, SkillDefinition, SkillRequirements, SkillReadiness, SkillSource, ExecutionChannel } from '@museclaw/protocol';

export const SKILL_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SKILL_NAME_LEN = 64;
export const MAX_DESCRIPTION_LEN = 1024;
export const MAX_SKILL_FILE_BYTES = 256 * 1024;

export interface ParsedSkillMd {
  name: string;
  description: string;
  category: SkillCategory;
  channel?: ExecutionChannel;
  tags: string[];
  allowedTools: string[];
  requires?: SkillRequirements;
  readiness?: SkillReadiness;
  metadata: Record<string, unknown>;
  license?: string;
  compatibility?: string;
  body: string;
  raw: string;
}

const binCheckCache = new Map<string, boolean>();

/**
 * 快速检查可执行文件是否存在于 PATH
 */
export function isBinaryAvailable(bin: string): boolean {
  if (!bin) return false;
  if (binCheckCache.has(bin)) return binCheckCache.get(bin)!;
  try {
    execSync(`command -v ${bin} 2>/dev/null`, { stdio: 'ignore' });
    binCheckCache.set(bin, true);
    return true;
  } catch {
    binCheckCache.set(bin, false);
    return false;
  }
}

/**
 * 校验技能运行环境就绪度 (命令工具与环境变量检测)
 */
export function checkSkillReadiness(requires?: SkillRequirements): SkillReadiness {
  if (!requires) {
    return { ready: true, details: '运行环境就绪' };
  }
  const missingBins: string[] = [];
  const missingEnv: string[] = [];

  if (Array.isArray(requires.bins)) {
    for (const bin of requires.bins) {
      if (!isBinaryAvailable(bin)) {
        missingBins.push(bin);
      }
    }
  }

  if (Array.isArray(requires.env)) {
    for (const envVar of requires.env) {
      if (!process.env[envVar]) {
        missingEnv.push(envVar);
      }
    }
  }

  const ready = missingBins.length === 0 && missingEnv.length === 0;
  const missingParts: string[] = [];
  if (missingBins.length > 0) missingParts.push(`缺少命令: ${missingBins.join(', ')}`);
  if (missingEnv.length > 0) missingParts.push(`未配置环境变量: ${missingEnv.join(', ')}`);

  return {
    ready,
    missingBins: missingBins.length > 0 ? missingBins : undefined,
    missingEnv: missingEnv.length > 0 ? missingEnv : undefined,
    details: ready ? '运行环境与依赖就绪' : missingParts.join('；')
  };
}

/**
 * 根据名称或描述智能推断业务分类
 */
export function inferSkillCategory(name: string, description: string = ''): SkillCategory {
  const text = `${name} ${description}`.toLowerCase();
  if (text.includes('ops') || text.includes('linux') || text.includes('bash') || text.includes('clean') || text.includes('disk') || text.includes('diagnos')) {
    return 'devops';
  }
  if (text.includes('meeting') || text.includes('review') || text.includes('inbox') || text.includes('triage') || text.includes('compare') || text.includes('plan') || text.includes('weekly')) {
    return 'productivity';
  }
  if (text.includes('research') || text.includes('web') || text.includes('fetch') || text.includes('scrape') || text.includes('browser') || text.includes('crawl')) {
    return 'research';
  }
  if (text.includes('amap') || text.includes('feishu') || text.includes('kuaidi') || text.includes('tencent') || text.includes('api') || text.includes('map') || text.includes('mcp')) {
    return 'integration';
  }
  return 'utility';
}

/**
 * 校验技能名称是否合法
 */
export function isValidSkillName(name: string): boolean {
  return typeof name === 'string' && name.length >= 1 && name.length <= MAX_SKILL_NAME_LEN && SKILL_NAME_REGEX.test(name);
}

/**
 * 去除标量引号
 */
function unquoteScalar(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }
  }
  return value;
}

/**
 * 解析列表字符串，如 [a, b, c] 或逗号分隔
 */
function parseListScalar(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => unquoteScalar(item).trim())
      .filter(Boolean);
  }
  return trimmed
    .split(',')
    .map((item) => unquoteScalar(item).trim())
    .filter(Boolean);
}

/**
 * 解析 SKILL.md 文本中的 YAML Frontmatter 与 Markdown 正文
 */
export function parseSkillMd(rawText: string): { success: true; skill: ParsedSkillMd } | { success: false; error: string } {
  let text = rawText;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去除 BOM

  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { success: false, error: 'SKILL.md 缺少顶部 YAML Frontmatter 区块 (必须以 --- 开头并闭合)' };
  }

  const frontmatterText = match[1];
  const body = match[2]?.trim() || '';

  const fields: Record<string, string> = {};
  const metadata: Record<string, unknown> = {};
  const requires: SkillRequirements = {};
  let currentParent: 'metadata' | 'requires' | null = null;

  for (const rawLine of frontmatterText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.trim().startsWith('#')) continue;

    // 子字段 (如 metadata.author)
    if (line.startsWith('  ') && currentParent === 'metadata') {
      const subMatch = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (subMatch) {
        metadata[subMatch[1]] = unquoteScalar(subMatch[2]);
      }
      continue;
    }

    // 依赖字段 (如 requires.bins, requires.env)
    if (line.startsWith('  ') && currentParent === 'requires') {
      const subMatch = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (subMatch) {
        const subKey = subMatch[1].toLowerCase();
        const subList = parseListScalar(subMatch[2]);
        if (subKey === 'bins') requires.bins = subList;
        if (subKey === 'env') requires.env = subList;
        if (subKey === 'os') requires.os = subList;
      }
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;

    const key = kv[1].toLowerCase();
    const val = kv[2].trim();

    if (key === 'metadata') {
      currentParent = 'metadata';
      continue;
    }
    if (key === 'requires' || key === 'requirements') {
      currentParent = 'requires';
      continue;
    }
    currentParent = null;
    fields[key] = val;
  }

  const name = unquoteScalar(fields.name || '').toLowerCase();
  const description = unquoteScalar(fields.description || '');

  if (!isValidSkillName(name)) {
    return {
      success: false,
      error: `技能名称 "${name}" 不符合规范：仅支持小写字母、数字与单连字符，长度 1~${MAX_SKILL_NAME_LEN}`
    };
  }

  if (!description) {
    return {
      success: false,
      error: '技能描述 (description) 为必填项，简要说明何时使用该技能'
    };
  }

  // 1. 业务分类解析
  const validCategories: SkillCategory[] = ['devops', 'productivity', 'research', 'integration', 'utility', 'custom'];
  let category: SkillCategory = inferSkillCategory(name, description);
  const rawCategory = fields.category ? unquoteScalar(fields.category).toLowerCase() as SkillCategory : null;
  if (rawCategory && validCategories.includes(rawCategory)) {
    category = rawCategory;
  }

  // 2. 依赖解析
  if (fields['requires-bins'] || fields['requires_bins']) {
    requires.bins = parseListScalar(fields['requires-bins'] || fields['requires_bins']);
  }
  if (fields['requires-env'] || fields['requires_env']) {
    requires.env = parseListScalar(fields['requires-env'] || fields['requires_env']);
  }

  const readiness = checkSkillReadiness(requires);

  const validChannels: ExecutionChannel[] = ['api', 'cli', 'web', 'browser', 'gui', 'mixed'];
  let channel = (unquoteScalar(fields.channel || 'api').toLowerCase() as ExecutionChannel);
  if (!validChannels.includes(channel)) {
    channel = 'api';
  }

  const tags = fields.tags ? parseListScalar(fields.tags) : [];
  const allowedTools = fields['allowed-tools'] || fields.allowed_tools ? parseListScalar(fields['allowed-tools'] || fields.allowed_tools) : [];

  return {
    success: true,
    skill: {
      name,
      description,
      category,
      channel,
      tags,
      allowedTools,
      requires: Object.keys(requires).length > 0 ? requires : undefined,
      readiness,
      metadata,
      license: fields.license ? unquoteScalar(fields.license) : undefined,
      compatibility: fields.compatibility ? unquoteScalar(fields.compatibility) : undefined,
      body,
      raw: text
    }
  };
}

/**
 * 将技能对象渲染为标准的 SKILL.md 纯文本
 */
export function renderSkillMd(data: {
  name: string;
  description: string;
  category?: SkillCategory;
  channel?: ExecutionChannel;
  tags?: string[];
  requires?: SkillRequirements;
  allowedTools?: string[];
  metadata?: Record<string, unknown>;
  license?: string;
  body: string;
}): string {
  const category = data.category || inferSkillCategory(data.name, data.description);
  const toolsStr = data.allowedTools && data.allowedTools.length > 0 ? `[${data.allowedTools.map((t) => JSON.stringify(t)).join(', ')}]` : '[]';

  let frontmatter = `---
name: ${data.name}
description: ${JSON.stringify(data.description)}
category: ${category}`;

  if (data.requires) {
    frontmatter += '\nrequires:';
    if (data.requires.bins && data.requires.bins.length > 0) {
      frontmatter += `\n  bins: [${data.requires.bins.map((b) => JSON.stringify(b)).join(', ')}]`;
    }
    if (data.requires.env && data.requires.env.length > 0) {
      frontmatter += `\n  env: [${data.requires.env.map((e) => JSON.stringify(e)).join(', ')}]`;
    }
  }

  if (data.channel) {
    frontmatter += `\nchannel: ${data.channel}`;
  }
  if (data.tags && data.tags.length > 0) {
    frontmatter += `\ntags: [${data.tags.map((t) => JSON.stringify(t)).join(', ')}]`;
  }
  frontmatter += `\nallowed-tools: ${toolsStr}`;

  if (data.license) {
    frontmatter += `\nlicense: ${JSON.stringify(data.license)}`;
  }

  if (data.metadata && Object.keys(data.metadata).length > 0) {
    frontmatter += '\nmetadata:';
    for (const [k, v] of Object.entries(data.metadata)) {
      frontmatter += `\n  ${k}: ${JSON.stringify(String(v))}`;
    }
  }

  frontmatter += '\n---';
  return `${frontmatter}\n\n${data.body.trim()}\n`;
}

/**
 * 技能代码静态安全审计
 * 检查可疑隐蔽载荷、反弹 Shell、无感 Unicode 字符等
 */
export function scanSkillSafety(rawText: string): string[] {
  const warnings: string[] = [];

  // 1. 检查是否存在超长 Base64 潜在二进制隐藏载荷
  if (/[A-Za-z0-9+/]{120,}={0,2}/.test(rawText)) {
    warnings.push('检测到异常长 Base64 编码数据段，疑似隐蔽脚本或二进制载荷');
  }

  // 2. 检查危险的 curl / wget 管道直灌 Shell 执行
  if (/\b(curl|wget)\b[^\n]{0,200}\|\s*(ba|z|da)?sh\b/i.test(rawText)) {
    warnings.push('检测到直接管道下载并执行脚本 (curl/wget | sh)，高危安全隐患');
  }

  // 3. 检查零宽字符与双向控制字符 (用于欺骗审核视觉盲区)
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/.test(rawText)) {
    warnings.push('检测到不可见的 Unicode 零宽字符或控制字符，可能存在隐藏提示词注入');
  }

  // 4. 检查危险的破坏性系统命令
  if (/\brm\s+-(?:r|rf|fr)\s+[/~]/i.test(rawText) || /\bmkfs\b/i.test(rawText) || />\s*\/dev\/sd[a-z]/i.test(rawText)) {
    warnings.push('包含可能破坏操作系统关键路径的命令 (如 rm -rf / 或磁盘格式化)');
  }

  return warnings;
}
