/**
 * MuseClaw Skill Quality Linter & Trust-Aware Security Auditor
 * 负责技能包的结构质量体检、上下文预算评估与按来源信任分级的静态安全扫描
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  SkillFileEntry,
  SkillLintFinding,
  SkillLintReport,
  SkillSecurityFinding,
  SkillSecurityReport,
  SkillSecurityVerdict,
  SkillTrustLevel
} from '@museclaw/protocol';

const DESCRIPTION_SOFT_LIMIT = 200;
const BODY_SOFT_LIMIT_CHARS = 20_000;
const BODY_MIN_CHARS = 40;
const SCAFFOLDING_FILES = new Set(['.env', '.env.example', '.gitignore', 'changelog.md', '.ds_store']);

/**
 * 对解析后的技能包执行结构与上下文质量体检
 */
export function lintSkillPackage(
  parsed: { name: string; description: string; body: string },
  files?: SkillFileEntry[]
): SkillLintReport {
  const findings: SkillLintFinding[] = [];
  const desc = (parsed.description || '').trim();
  const body = (parsed.body || '').trim();
  const estimatedTokens = Math.max(1, Math.ceil(body.length / 3.5));

  if (desc.length > DESCRIPTION_SOFT_LIMIT) {
    findings.push({
      severity: 'warning',
      rule: 'description-length',
      message: `一句话描述当前为 ${desc.length} 字符，建议控制在 ${DESCRIPTION_SOFT_LIMIT} 字符以内，避免系统提示词索引被截断导致路由失真。`
    });
  }

  if (body.length < BODY_MIN_CHARS) {
    findings.push({
      severity: 'error',
      rule: 'empty-body',
      message: `规程正文过短（仅 ${body.length} 字符），需补充清晰的操作步骤、工具调用规范或示例。`
    });
  } else if (body.length > BODY_SOFT_LIMIT_CHARS) {
    findings.push({
      severity: 'warning',
      rule: 'oversized-body',
      message: `规程正文共 ${body.length.toLocaleString()} 字符（约 ${estimatedTokens.toLocaleString()} tokens），建议精简核心步骤并将长篇资料拆入 references/ 目录按需读取。`
    });
  }

  if (body.length >= BODY_MIN_CHARS && !/^#+\s*(?:When to Use\b|何时使用|触发场景)/im.test(body)) {
    findings.push({
      severity: 'warning',
      rule: 'missing-trigger-section',
      message: '建议补充 "## 何时使用" 或 "## 触发场景" 小节，明确适用边界与非适用场景以提升触发准确率。'
    });
  }

  if (Array.isArray(files) && files.length > 0) {
    const noisy = files
      .map((f) => path.basename(f.path).toLowerCase())
      .filter((base) => SCAFFOLDING_FILES.has(base));
    if (noisy.length > 0) {
      findings.push({
        severity: 'warning',
        rule: 'scaffolding-noise',
        message: `包内包含无关工程脚手架文件 (${[...new Set(noisy)].join(', ')})，建议移除以保持技能包整洁。`
      });
    }
  }

  let score = 100;
  for (const item of findings) {
    score -= item.severity === 'error' ? 25 : 8;
  }
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    estimatedTokens,
    findings
  };
}

/**
 * 对单个文本文件执行静态安全规则检测
 */
export function scanTextSecurityFindings(rawText: string, file: string): SkillSecurityFinding[] {
  const findings: SkillSecurityFinding[] = [];
  if (!rawText) return findings;

  // 1. 超长 Base64 隐蔽载荷
  if (/[A-Za-z0-9+/]{120,}={0,2}/.test(rawText)) {
    findings.push({
      id: 'long-base64',
      severity: 'high',
      category: 'obfuscation',
      file,
      message: '检测到超长 Base64 编码段，疑似隐蔽脚本或二进制载荷。'
    });
  }

  // 2. 管道远程下载执行
  if (/\b(curl|wget)\b[^\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i.test(rawText)) {
    findings.push({
      id: 'curl-pipe-sh',
      severity: 'critical',
      category: 'remote-exec',
      file,
      message: '检测到直接管道下载并执行脚本 (curl/wget | sh)，存在高危远程执行风险。'
    });
  }

  // 3. 零宽及双向控制字符
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/.test(rawText)) {
    findings.push({
      id: 'hidden-unicode',
      severity: 'high',
      category: 'injection',
      file,
      message: '检测到不可见的 Unicode 零宽字符或双向控制字符，可能存在隐藏提示词注入。'
    });
  }

  // 4. 破坏性系统命令
  if (/\brm\s+-(?:r|rf|fr)\s+[/~]/i.test(rawText) || /\bmkfs\b/i.test(rawText) || />\s*\/dev\/sd[a-z]/i.test(rawText)) {
    findings.push({
      id: 'destructive-fs',
      severity: 'critical',
      category: 'destructive',
      file,
      message: '包含可能破坏操作系统关键路径或磁盘设备的危险命令。'
    });
  }

  // 5. 敏感凭据读取并尝试外发
  const readsSecrets = /(?:\.env\b|\.ssh\/id_rsa|\.ssh\/id_ed25519|\.aws\/credentials|process\.env\b)/i.test(rawText);
  const sendsOutbound = /(?:\bcurl\b|\bwget\b|\bfetch\s*\(|\bnc\s+|\bncat\b|requests\.post)/i.test(rawText);
  if (readsSecrets && sendsOutbound && /(?:\.env\b|\.ssh\/id_|aws\/credentials)/i.test(rawText)) {
    findings.push({
      id: 'credential-exfiltration',
      severity: 'critical',
      category: 'exfiltration',
      file,
      message: '检测到同时涉及本地敏感凭据文件 (.env / SSH 私钥 / 云凭据) 与网络外发指令，存在凭据外泄风险。'
    });
  }

  // 6. 篡改 Agent 核心配置或持久化指令文件
  if (
    /(?:>>|>|\btee\b|\bsed\s+-i|\bwriteFile(?:Sync)?\b|\bopen\([^)]*['"]w)/i.test(rawText) &&
    /(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|SOUL\.md|config\.json)/i.test(rawText)
  ) {
    findings.push({
      id: 'agent-config-tamper',
      severity: 'high',
      category: 'persistence',
      file,
      message: '检测到试图写入或修改 Agent 持久化配置文件的指令。'
    });
  }

  // 7. 显式提示词劫持或安全门禁绕过语义
  if (
    /(?:ignore\s+(?:all\s+)?previous\s+instructions|bypass\s+approval|disable\s+sentinel|override\s+system\s+prompt)/i.test(
      rawText
    )
  ) {
    findings.push({
      id: 'prompt-hijack',
      severity: 'medium',
      category: 'injection',
      file,
      message: '检测到疑似覆盖系统约束或绕过审批门禁的指令措辞。'
    });
  }

  return findings;
}

/**
 * 结合来源信任等级策略，对整个技能包输出结构化安全报告
 */
export function auditSkillPackage(
  skillDir: string | undefined,
  files: SkillFileEntry[],
  skillMdContent: string,
  source: SkillTrustLevel
): SkillSecurityReport {
  const findings: SkillSecurityFinding[] = [];
  const seen = new Set<string>();

  const pushUnique = (list: SkillSecurityFinding[]) => {
    for (const f of list) {
      const key = `${f.file}:${f.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push(f);
      }
    }
  };

  pushUnique(scanTextSecurityFindings(skillMdContent, 'SKILL.md'));

  if (skillDir && fs.existsSync(skillDir)) {
    for (const entry of files) {
      if (entry.path === 'SKILL.md' || !entry.isText || entry.size > 512 * 1024) continue;
      try {
        const abs = path.join(skillDir, entry.path);
        if (abs.startsWith(skillDir) && fs.existsSync(abs)) {
          const text = fs.readFileSync(abs, 'utf-8');
          pushUnique(scanTextSecurityFindings(text, entry.path));
        }
      } catch {
        // 单文件读取异常不阻塞整体扫描
      }
    }
  }

  let verdict: SkillSecurityVerdict = 'safe';
  if (findings.some((f) => f.severity === 'critical' || f.severity === 'high')) {
    verdict = 'dangerous';
  } else if (findings.some((f) => f.severity === 'medium')) {
    verdict = 'caution';
  }

  let policyAction: 'allow' | 'ask' | 'block' = 'allow';
  if (source === 'builtin') {
    policyAction = 'allow';
  } else if (source === 'imported') {
    if (verdict === 'dangerous') policyAction = 'block';
    else if (verdict === 'caution') policyAction = 'ask';
  } else {
    if (verdict === 'dangerous') policyAction = 'ask';
  }

  return {
    trustLevel: source,
    verdict,
    policyAction,
    findings
  };
}
