import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ExecutionChannel,
  SkillCategory,
  SkillDefinition,
  SkillEnvVarStatus,
  SkillFileEntry,
  SkillLifecycleState,
  SkillLintReport,
  SkillReadiness,
  SkillRequirements,
  SkillSecurityReport,
  SkillSource,
  SkillTrustLevel
} from '@museclaw/protocol';
import { BUILTIN_SKILLS } from './builtin.ts';
import {
  checkSkillReadiness,
  clearBinaryCheckCache,
  isValidSkillName,
  parseSkillMd,
  renderSkillMd
} from './parser.ts';
import { auditSkillPackage, lintSkillPackage } from './quality.ts';
import { SkillTelemetryAndEnvStore } from './usage.ts';
import { createSkillZip, extractAndValidateSkillZip, isTextFile } from './zip.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_REMOTE_SKILL_BYTES = 512 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 10_000;

interface SkillIndexRecord {
  enabled: boolean;
  everyBot: boolean;
  assignedBots: string[];
  source: SkillSource;
  updatedAt: number;
  warnings?: string[];
}

interface SkillIndexFile {
  [skillName: string]: SkillIndexRecord;
}

export interface ManagedSkillEnvItem extends SkillEnvVarStatus {
  usedBy: string[];
}

export interface SkillImportPreview {
  valid: boolean;
  error?: string;
  name?: string;
  description?: string;
  category?: SkillCategory;
  requires?: SkillRequirements;
  readiness?: SkillReadiness;
  lint?: SkillLintReport;
  security?: SkillSecurityReport;
  conflict?: 'builtin' | 'existing_custom' | null;
  content?: string;
}

function copyDirRecursive(srcDir: string, dstDir: string) {
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }
  for (const item of fs.readdirSync(srcDir)) {
    if (item === '.' || item === '..') continue;
    const src = path.join(srcDir, item);
    const dst = path.join(dstDir, item);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyDirRecursive(src, dst);
    } else if (stat.isFile()) {
      fs.copyFileSync(src, dst);
      if (stat.mode & 0o111) {
        try {
          fs.chmodSync(dst, 0o755);
        } catch {}
      }
    }
  }
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local')) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  if (/^(fc|fd|fe80):/i.test(host)) return true;
  return false;
}

function normalizeRemoteSkillUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim());
  if (parsed.hostname === 'github.com') {
    const blobMatch = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (blobMatch) {
      return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
    }
  }
  return parsed.toString();
}

export class SkillStore {
  private dataDir: string;
  private builtinSkillsDir: string;
  private overrideSkillsDir: string;
  private customSkillsDir: string;
  private indexFilePath: string;
  private telemetryStore: SkillTelemetryAndEnvStore;
  private builtinMap = new Map<string, SkillDefinition>();
  private customMap = new Map<string, SkillDefinition>();
  private indexData: SkillIndexFile = {};

  constructor(options?: { dataDir?: string }) {
    this.dataDir = options?.dataDir || path.resolve(__dirname, '../data/skills');
    this.builtinSkillsDir = path.join(this.dataDir, 'builtin');
    this.overrideSkillsDir = path.join(this.dataDir, 'overrides');
    this.customSkillsDir = path.join(this.dataDir, 'custom');
    this.indexFilePath = path.join(this.dataDir, 'index.json');
    this.telemetryStore = new SkillTelemetryAndEnvStore(this.dataDir);
    this.init();
  }

  private init() {
    for (const dir of [this.dataDir, this.builtinSkillsDir, this.overrideSkillsDir, this.customSkillsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // 1. 加载或初始化索引文件
    if (fs.existsSync(this.indexFilePath)) {
      try {
        const raw = fs.readFileSync(this.indexFilePath, 'utf-8');
        this.indexData = JSON.parse(raw);
      } catch (err) {
        console.warn('[SkillStore] 读取 index.json 失败，将重新初始化:', err);
        this.indexData = {};
      }
    }

    // 2. 部署与加载内置技能包（支持用户覆写层 overrides/ 持久化保存）
    for (const b of BUILTIN_SKILLS) {
      const builtinDir = path.join(this.builtinSkillsDir, b.name);
      if (!fs.existsSync(builtinDir)) {
        fs.mkdirSync(builtinDir, { recursive: true });
      }

      fs.writeFileSync(path.join(builtinDir, 'SKILL.md'), b.content, 'utf-8');
      if (b.files && b.files.length > 0) {
        for (const file of b.files) {
          const filePath = path.join(builtinDir, file.path);
          const fileDir = path.dirname(filePath);
          if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true });
          }
          fs.writeFileSync(filePath, file.content, 'utf-8');
          if (file.executable) {
            try {
              fs.chmodSync(filePath, 0o755);
            } catch {}
          }
        }
      }

      const overrideDir = path.join(this.overrideSkillsDir, b.name);
      const overrideMdPath = path.join(overrideDir, 'SKILL.md');
      let effectiveDir = builtinDir;
      let effectiveContent = b.content;
      let hasBuiltinOverride = false;

      if (fs.existsSync(overrideMdPath)) {
        try {
          const overrideText = fs.readFileSync(overrideMdPath, 'utf-8');
          if (parseSkillMd(overrideText).success) {
            effectiveDir = overrideDir;
            effectiveContent = overrideText;
            hasBuiltinOverride = true;
          }
        } catch {}
      }

      const parsed = parseSkillMd(effectiveContent);
      if (parsed.success) {
        const p = parsed.skill;
        const allFiles = this.scanDirFiles(effectiveDir);
        const record = this.indexData[p.name];

        const skill = this.enrichSkill({
          name: p.name,
          description: p.description,
          category: hasBuiltinOverride ? p.category : b.category || p.category,
          channel: hasBuiltinOverride ? p.channel : b.channel || p.channel,
          tags: p.tags,
          source: 'builtin',
          enabled: record ? record.enabled : true,
          everyBot: record ? record.everyBot : true,
          assignedBots: record?.assignedBots || [],
          content: effectiveContent,
          body: p.body,
          dirPath: effectiveDir,
          files: allFiles,
          filesCount: allFiles.length,
          scriptsCount: this.countScripts(allFiles),
          requires: p.requires || b.requires,
          metadata: p.metadata,
          allowedTools: p.allowedTools,
          warnings: [],
          hasBuiltinOverride,
          updatedAt: record?.updatedAt || Date.now(),
          createdAt: 1700000000000
        });
        this.builtinMap.set(p.name, skill);

        if (!this.indexData[p.name]) {
          this.indexData[p.name] = {
            enabled: true,
            everyBot: true,
            assignedBots: [],
            source: 'builtin',
            updatedAt: Date.now(),
            warnings: skill.warnings
          };
        }
      }
    }

    // 3. 加载用户自建、导入与工坊自学习技能包
    try {
      const items = fs.readdirSync(this.customSkillsDir);
      for (const item of items) {
        const fullItemPath = path.join(this.customSkillsDir, item);
        const stat = fs.statSync(fullItemPath);

        if (stat.isDirectory()) {
          const skillDir = fullItemPath;
          const skillMdPath = path.join(skillDir, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            try {
              const content = fs.readFileSync(skillMdPath, 'utf-8');
              const parsed = parseSkillMd(content);
              if (parsed.success) {
                const p = parsed.skill;
                const allFiles = this.scanDirFiles(skillDir);
                const record = this.indexData[p.name];
                const source: SkillSource =
                  record?.source === 'imported'
                    ? 'imported'
                    : record?.source === 'learned'
                    ? 'learned'
                    : 'custom';

                const skill = this.enrichSkill({
                  name: p.name,
                  description: p.description,
                  category: p.category,
                  channel: p.channel,
                  tags: p.tags,
                  source,
                  enabled: record ? record.enabled : true,
                  everyBot: record ? record.everyBot : true,
                  assignedBots: record?.assignedBots || [],
                  content,
                  body: p.body,
                  dirPath: skillDir,
                  files: allFiles,
                  filesCount: allFiles.length,
                  scriptsCount: this.countScripts(allFiles),
                  requires: p.requires,
                  metadata: p.metadata,
                  allowedTools: p.allowedTools,
                  license: p.license,
                  compatibility: p.compatibility,
                  warnings: [],
                  updatedAt: record?.updatedAt || stat.mtimeMs,
                  createdAt: stat.birthtimeMs || Date.now()
                });
                this.customMap.set(p.name, skill);

                if (!this.indexData[p.name]) {
                  this.indexData[p.name] = {
                    enabled: true,
                    everyBot: true,
                    assignedBots: [],
                    source,
                    updatedAt: Date.now(),
                    warnings: skill.warnings
                  };
                }
              }
            } catch (readErr) {
              console.error(`[SkillStore] 解析技能包目录 ${item} 失败:`, readErr);
            }
          }
        } else if (stat.isFile() && item.endsWith('.md')) {
          const skillName = path.basename(item, '.md');
          const targetDir = path.join(this.customSkillsDir, skillName);
          try {
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
              const content = fs.readFileSync(fullItemPath, 'utf-8');
              fs.writeFileSync(path.join(targetDir, 'SKILL.md'), content, 'utf-8');
              fs.unlinkSync(fullItemPath);

              const parsed = parseSkillMd(content);
              if (parsed.success) {
                const p = parsed.skill;
                const allFiles = this.scanDirFiles(targetDir);
                const record = this.indexData[p.name];
                const source: SkillSource =
                  record?.source === 'imported'
                    ? 'imported'
                    : record?.source === 'learned'
                    ? 'learned'
                    : 'custom';

                const skill = this.enrichSkill({
                  name: p.name,
                  description: p.description,
                  category: p.category,
                  channel: p.channel,
                  tags: p.tags,
                  source,
                  enabled: record ? record.enabled : true,
                  everyBot: record ? record.everyBot : true,
                  assignedBots: record?.assignedBots || [],
                  content,
                  body: p.body,
                  dirPath: targetDir,
                  files: allFiles,
                  filesCount: allFiles.length,
                  scriptsCount: this.countScripts(allFiles),
                  requires: p.requires,
                  metadata: p.metadata,
                  allowedTools: p.allowedTools,
                  license: p.license,
                  compatibility: p.compatibility,
                  warnings: [],
                  updatedAt: Date.now(),
                  createdAt: Date.now()
                });
                this.customMap.set(p.name, skill);
              }
            }
          } catch (migrateErr) {
            console.error(`[SkillStore] 自动升级单文件技能 ${item} 为技能包目录失败:`, migrateErr);
          }
        }
      }
    } catch (e) {
      console.warn('[SkillStore] 扫描 customSkillsDir 失败:', e);
    }

    this.saveIndex();
  }

  private countScripts(files: SkillFileEntry[]): number {
    return files.filter((f) => f.executable || /\.(sh|bash|py|js|mjs)$/i.test(f.path)).length;
  }

  private computeReadiness(requires?: SkillRequirements): SkillReadiness {
    return checkSkillReadiness(requires, (key) => this.telemetryStore.resolveEnv(key));
  }

  private enrichSkill(skill: SkillDefinition): SkillDefinition {
    const files = skill.files || [];
    skill.readiness = this.computeReadiness(skill.requires);
    skill.usage = this.telemetryStore.getUsage(skill.name, skill.source);
    skill.lint = lintSkillPackage(
      { name: skill.name, description: skill.description, body: skill.body },
      files
    );
    skill.security = auditSkillPackage(skill.dirPath, files, skill.content, skill.source);
    skill.warnings = skill.security.findings.map((f) =>
      f.file !== 'SKILL.md' ? `[${f.file}] ${f.message}` : f.message
    );
    return skill;
  }

  /**
   * 递归扫描技能包目录下所有文件
   */
  private scanDirFiles(skillDir: string): SkillFileEntry[] {
    const list: SkillFileEntry[] = [];
    const walk = (current: string, relBase: string) => {
      if (!fs.existsSync(current)) return;
      const items = fs.readdirSync(current);
      for (const item of items) {
        if (item === '.' || item === '..' || item === '.DS_Store' || item === '__MACOSX') continue;
        const absPath = path.join(current, item);
        const relPath = relBase ? `${relBase}/${item}` : item;
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          walk(absPath, relPath);
        } else if (stat.isFile()) {
          const isExec = Boolean(stat.mode & 0o111) || /\.(sh|bash|py|js|mjs)$/i.test(item);
          list.push({
            path: relPath,
            size: stat.size,
            executable: isExec,
            isText: isTextFile(item),
            updatedAt: stat.mtimeMs
          });
        }
      }
    };

    walk(skillDir, '');
    return list.sort((a, b) => {
      if (a.path === 'SKILL.md') return -1;
      if (b.path === 'SKILL.md') return 1;
      return a.path.localeCompare(b.path);
    });
  }

  private saveIndex() {
    try {
      fs.writeFileSync(this.indexFilePath, JSON.stringify(this.indexData, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SkillStore] 保存 index.json 失败:', err);
    }
  }

  /**
   * 列出所有技能（支持按 Bot、关键字、业务分类、来源、生命周期与运行就绪状态过滤）
   */
  public list(filter?: {
    botId?: string;
    query?: string;
    category?: string;
    channel?: string;
    tag?: string;
    source?: string;
    readiness?: string;
    lifecycle?: SkillLifecycleState;
    includeArchived?: boolean;
    enabledOnly?: boolean;
  }): SkillDefinition[] {
    const all = [...this.builtinMap.values(), ...this.customMap.values()];
    const q = filter?.query?.trim().toLowerCase();
    const category = filter?.category?.trim().toLowerCase();
    const channel = filter?.channel?.trim().toLowerCase();
    const tag = filter?.tag?.trim().toLowerCase();
    const source = filter?.source?.trim().toLowerCase();
    const readiness = filter?.readiness?.trim().toLowerCase();
    const botId = filter?.botId?.trim();
    const lifecycle = filter?.lifecycle;
    const includeArchived = Boolean(filter?.includeArchived) || lifecycle === 'archived';
    const enabledOnly = Boolean(filter?.enabledOnly);

    return all
      .map((s) => {
        s.readiness = this.computeReadiness(s.requires);
        s.usage = this.telemetryStore.getUsage(s.name, s.source);
        return s;
      })
      .filter((s) => {
        const state = s.usage?.lifecycleState || 'active';
        if (!includeArchived && state === 'archived') return false;
        if (lifecycle && state !== lifecycle) return false;
        if (enabledOnly && !s.enabled) return false;

        if (botId) {
          const matchesBot = s.everyBot || (s.assignedBots || []).includes(botId);
          if (!matchesBot) return false;
        }

        if (category && category !== 'all' && s.category !== category) {
          return false;
        }

        if (readiness && readiness !== 'all') {
          if (readiness === 'ready' && !s.readiness?.ready) return false;
          if (readiness === 'missing_deps' && s.readiness?.ready) return false;
        }

        if (source && source !== 'all' && s.source !== source) {
          return false;
        }

        if (channel && channel !== 'all' && s.channel !== channel) {
          return false;
        }

        if (tag && tag !== 'all') {
          const hasTag = (s.tags || []).some((t) => t.toLowerCase() === tag);
          if (!hasTag) return false;
        }

        if (q) {
          const inName = s.name.toLowerCase().includes(q);
          const inDesc = s.description.toLowerCase().includes(q);
          const inCat = (s.category || '').toLowerCase().includes(q);
          const inBins = (s.requires?.bins || []).some((b) => b.toLowerCase().includes(q));
          const inEnv = (s.requires?.env || []).some((e) => e.toLowerCase().includes(q));
          const inBody = (s.body || '').toLowerCase().includes(q);
          if (!inName && !inDesc && !inCat && !inBins && !inEnv && !inBody) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const pinDiff = (b.usage?.pinned ? 1 : 0) - (a.usage?.pinned ? 1 : 0);
        if (pinDiff !== 0) return pinDiff;

        const enabledDiff = (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0);
        if (enabledDiff !== 0) return enabledDiff;

        const useDiff = (b.usage?.useCount || 0) - (a.usage?.useCount || 0);
        if (useDiff !== 0) return useDiff;

        if (a.source !== 'builtin' && b.source === 'builtin') return -1;
        if (a.source === 'builtin' && b.source !== 'builtin') return 1;
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * 获取单个技能详情
   */
  public get(name: string): SkillDefinition | null {
    const cleanName = name.trim().toLowerCase();
    const skill = this.customMap.get(cleanName) || this.builtinMap.get(cleanName) || null;
    if (skill) {
      skill.readiness = this.computeReadiness(skill.requires);
      skill.usage = this.telemetryStore.getUsage(skill.name, skill.source);
    }
    return skill;
  }

  /**
   * 获取技能在 Agent 执行时注入的完整说明（含脚本与资源清单）
   */
  public getSkillInstructions(name: string): string | null {
    const skill = this.get(name);
    if (!skill) return null;

    let text = `# Skill: ${skill.name} [${(skill.category || 'utility').toUpperCase()}]\n${skill.description}\n\n${skill.body.trim()}`;
    if (skill.allowedTools && skill.allowedTools.length > 0) {
      text += `\n\n## 推荐优先工具集 (allowed-tools)\n${skill.allowedTools.join(', ')}`;
    }
    const files = skill.files?.filter((f) => f.path !== 'SKILL.md') || [];
    if (files.length > 0 && skill.dirPath) {
      const fileList = files
        .map((f) => {
          const fullPath = path.join(skill.dirPath!, f.path);
          const execHint = f.executable ? ' (可直接在微沙箱中执行)' : '';
          return `- ${f.path}${execHint}: ${fullPath}`;
        })
        .join('\n');
      text += `\n\n## 本技能包含的配套脚本与参考文件 (可在微沙箱中调用):\n${fileList}`;
    }
    return text;
  }

  /**
   * 清理命令探测缓存并重算全部技能的就绪状态
   */
  public refreshReadiness(): SkillDefinition[] {
    clearBinaryCheckCache();
    for (const s of [...this.builtinMap.values(), ...this.customMap.values()]) {
      this.enrichSkill(s);
    }
    return this.list();
  }

  /**
   * 获取全部技能声明的环境变量及当前配置/脱敏状态
   */
  public getEnvOverview(): ManagedSkillEnvItem[] {
    const usageByVar = new Map<
      string,
      {
        status: SkillEnvVarStatus;
        usedBy: Set<string>;
      }
    >();

    for (const s of [...this.builtinMap.values(), ...this.customMap.values()]) {
      const readiness = this.computeReadiness(s.requires);
      for (const item of readiness.envStatus || []) {
        if (!usageByVar.has(item.name)) {
          usageByVar.set(item.name, { status: item, usedBy: new Set() });
        }
        usageByVar.get(item.name)!.usedBy.add(s.name);
      }
    }

    const managed = this.telemetryStore.getManagedEnvKeys();
    for (const [key, info] of Object.entries(managed)) {
      if (!usageByVar.has(key)) {
        usageByVar.set(key, {
          status: {
            name: key,
            configured: info.configured,
            source: info.source,
            maskedValue: info.maskedValue
          },
          usedBy: new Set()
        });
      }
    }

    return Array.from(usageByVar.values())
      .map((entry) => ({
        ...entry.status,
        usedBy: Array.from(entry.usedBy).sort()
      }))
      .sort((a, b) => Number(a.configured) - Number(b.configured) || a.name.localeCompare(b.name));
  }

  /**
   * 更新托管环境变量并立即刷新技能就绪状态
   */
  public updateEnvVars(vars: Record<string, string | null>): {
    env: ManagedSkillEnvItem[];
    skills: SkillDefinition[];
  } {
    this.telemetryStore.setManagedEnv(vars);
    const skills = this.refreshReadiness();
    return {
      env: this.getEnvOverview(),
      skills
    };
  }

  /**
   * 记录技能使用/查看/修补遥测
   */
  public recordUsage(name: string, kind: 'use' | 'view' | 'patch'): void {
    const skill = this.get(name);
    if (!skill) return;
    if (kind === 'use') this.telemetryStore.recordUse(skill.name);
    else if (kind === 'view') this.telemetryStore.recordView(skill.name);
    else if (kind === 'patch') this.telemetryStore.recordPatch(skill.name);
    skill.usage = this.telemetryStore.getUsage(skill.name, skill.source);
  }

  /**
   * 设置或取消技能置顶
   */
  public setPinned(name: string, pinned: boolean): { success: boolean; skill?: SkillDefinition; error?: string } {
    const skill = this.get(name);
    if (!skill) return { success: false, error: `未找到技能 "${name}"` };
    this.telemetryStore.setPinned(skill.name, pinned);
    skill.usage = this.telemetryStore.getUsage(skill.name, skill.source);
    return { success: true, skill };
  }

  /**
   * 更新技能生命周期状态 (active / archived)
   */
  public setLifecycle(
    name: string,
    state: SkillLifecycleState
  ): { success: boolean; skill?: SkillDefinition; error?: string } {
    const skill = this.get(name);
    if (!skill) return { success: false, error: `未找到技能 "${name}"` };
    if (skill.source === 'builtin' && state === 'archived') {
      return { success: false, error: `内置基座技能 "${skill.name}" 不可归档，可通过开关禁用` };
    }
    this.telemetryStore.setLifecycleState(skill.name, state);
    skill.usage = this.telemetryStore.getUsage(skill.name, skill.source);
    return { success: true, skill };
  }

  /**
   * 创建或保存自定义技能包
   */
  public save(data: {
    name: string;
    description: string;
    category?: SkillCategory;
    channel?: ExecutionChannel;
    tags?: string[];
    requires?: SkillRequirements;
    source?: SkillSource;
    allowedTools?: string[];
    body?: string;
    content?: string;
    everyBot?: boolean;
    assignedBots?: string[];
  }): { success: true; skill: SkillDefinition } | { success: false; error: string } {
    const name = data.name.trim().toLowerCase();
    if (!isValidSkillName(name)) {
      return { success: false, error: `技能名 "${name}" 不合法：仅限小写英文、数字与单横线，1~64位字符` };
    }

    if (this.builtinMap.has(name)) {
      return { success: false, error: `无法覆盖系统核心内置技能 "${name}"` };
    }

    let fullContent = data.content?.trim();
    let body = data.body?.trim() || '';
    let description = data.description.trim();
    let category: SkillCategory = data.category || 'utility';
    let channel = data.channel || 'api';
    let tags = data.tags || [];
    let allowedTools = data.allowedTools || [];
    let requires = data.requires;
    const source: SkillSource = data.source || 'custom';

    if (fullContent) {
      const parsed = parseSkillMd(fullContent);
      if (!parsed.success) {
        return { success: false, error: parsed.error };
      }
      body = parsed.skill.body;
      description = parsed.skill.description;
      category = parsed.skill.category;
      channel = parsed.skill.channel || 'api';
      tags = parsed.skill.tags;
      allowedTools = parsed.skill.allowedTools;
      requires = parsed.skill.requires;
    } else {
      if (!body) {
        body = `# ${name}\n\n${description}\n\n## 何时使用\n当需要执行与 ${name} 相关的标准流程时触发。\n\n## 步骤与指导\n1. 仔细阅读上下文并规划步骤。\n2. 使用指定工具完成用户目标。`;
      }
      fullContent = renderSkillMd({
        name,
        description,
        category,
        channel,
        tags,
        requires,
        allowedTools,
        body
      });
    }

    const targetSkillDir = path.join(this.customSkillsDir, name);
    if (!fs.existsSync(targetSkillDir)) {
      fs.mkdirSync(targetSkillDir, { recursive: true });
    }

    const skillMdPath = path.join(targetSkillDir, 'SKILL.md');
    try {
      fs.writeFileSync(skillMdPath, fullContent, 'utf-8');
    } catch (err: any) {
      return { success: false, error: `写入技能文件失败: ${err.message}` };
    }

    const allFiles = this.scanDirFiles(targetSkillDir);
    const prev = this.customMap.get(name);
    const prevRecord = this.indexData[name];

    const everyBot = data.everyBot !== undefined ? data.everyBot : prevRecord ? prevRecord.everyBot : true;
    const assignedBots = data.assignedBots !== undefined ? data.assignedBots : prevRecord ? prevRecord.assignedBots : [];

    const skill = this.enrichSkill({
      name,
      description,
      category,
      channel,
      tags,
      source,
      enabled: prev ? prev.enabled : true,
      everyBot,
      assignedBots,
      content: fullContent,
      body,
      dirPath: targetSkillDir,
      files: allFiles,
      filesCount: allFiles.length,
      scriptsCount: this.countScripts(allFiles),
      requires,
      allowedTools,
      warnings: [],
      updatedAt: Date.now(),
      createdAt: prev?.createdAt || Date.now()
    });

    this.customMap.set(name, skill);
    this.indexData[name] = {
      enabled: skill.enabled,
      everyBot,
      assignedBots,
      source,
      updatedAt: Date.now(),
      warnings: skill.warnings
    };
    this.saveIndex();

    return { success: true, skill };
  }

  /**
   * 对已有技能的 SKILL.md 执行增量修补，避免重写整份规程
   */
  public patchSkillBody(
    name: string,
    oldText: string,
    newText: string
  ): { success: boolean; skill?: SkillDefinition; error?: string } {
    const skill = this.get(name);
    if (!skill) return { success: false, error: `未找到技能 "${name}"` };
    if (!oldText) return { success: false, error: '参数 oldText 不能为空' };
    if (!skill.content.includes(oldText)) {
      return { success: false, error: `未在 "${skill.name}/SKILL.md" 中找到匹配的目标片段` };
    }

    const nextContent = skill.content.replace(oldText, newText);
    const parsed = parseSkillMd(nextContent);
    if (!parsed.success) {
      return { success: false, error: `修补后的 SKILL.md 校验失败: ${parsed.error}` };
    }

    const res = this.saveFile(skill.name, 'SKILL.md', nextContent);
    if (!res.success) return { success: false, error: res.error };

    this.recordUsage(skill.name, 'patch');
    return { success: true, skill: this.get(skill.name) || undefined };
  }

  /**
   * 预检待导入的 SKILL.md 文本（不写入磁盘）
   */
  public previewImportFromText(text: string, trustLevel: SkillTrustLevel = 'imported'): SkillImportPreview {
    const parsed = parseSkillMd(text);
    if (!parsed.success) {
      return { valid: false, error: parsed.error };
    }
    const p = parsed.skill;
    const conflict: SkillImportPreview['conflict'] = this.builtinMap.has(p.name)
      ? 'builtin'
      : this.customMap.has(p.name)
      ? 'existing_custom'
      : null;

    return {
      valid: true,
      name: p.name,
      description: p.description,
      category: p.category,
      requires: p.requires,
      readiness: this.computeReadiness(p.requires),
      lint: lintSkillPackage({ name: p.name, description: p.description, body: p.body }),
      security: auditSkillPackage(undefined, [], text, trustLevel),
      conflict,
      content: text
    };
  }

  /**
   * 安全拉取远程 SKILL.md 文本（含 SSRF 校验与大小限制）
   */
  public async fetchSkillTextFromUrl(rawUrl: string): Promise<{ success: true; text: string; url: string } | { success: false; error: string }> {
    let normalizedUrl: string;
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { success: false, error: '仅支持 http 或 https 协议的技能链接' };
      }
      if (isPrivateOrLoopbackHost(parsed.hostname)) {
        return { success: false, error: '安全拦截：禁止拉取回环地址或私网域名资源' };
      }
      normalizedUrl = normalizeRemoteSkillUrl(rawUrl);
    } catch {
      return { success: false, error: 'URL 格式无效，请检查后重试' };
    }

    try {
      const res = await fetch(normalizedUrl, {
        headers: { Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.8' },
        signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS)
      });
      if (!res.ok) {
        return { success: false, error: `远程拉取失败 (HTTP ${res.status})` };
      }
      const text = await res.text();
      if (Buffer.byteLength(text, 'utf-8') > MAX_REMOTE_SKILL_BYTES) {
        return { success: false, error: '远程技能文本超过 512KB 上限' };
      }
      return { success: true, text, url: normalizedUrl };
    } catch (err: any) {
      return { success: false, error: `远程请求异常: ${err?.message || String(err)}` };
    }
  }

  /**
   * 从远程 URL 导入技能包
   */
  public async importFromUrl(
    rawUrl: string,
    options?: { force?: boolean }
  ): Promise<{ success: true; skill: SkillDefinition } | { success: false; error: string; preview?: SkillImportPreview }> {
    const fetched = await this.fetchSkillTextFromUrl(rawUrl);
    if (!fetched.success) return { success: false, error: fetched.error };

    const preview = this.previewImportFromText(fetched.text, 'imported');
    if (!preview.valid) {
      return { success: false, error: preview.error || '远程文件不是合法的 SKILL.md', preview };
    }
    if (preview.conflict === 'builtin') {
      return { success: false, error: `已存在同名内置技能 "${preview.name}"，导入被安全拦截`, preview };
    }
    if (preview.security?.policyAction === 'block' && !options?.force) {
      return {
        success: false,
        error: `安全扫描检测到高风险内容 (${preview.security.findings.map((f) => f.message).join('；')})，已拦截导入`,
        preview
      };
    }

    return this.importFromText(fetched.text, { source: 'imported', force: options?.force });
  }

  /**
   * 从纯文本 SKILL.md 导入单体技能包
   */
  public importFromText(
    text: string,
    options?: { source?: SkillSource; force?: boolean }
  ): { success: true; skill: SkillDefinition } | { success: false; error: string; security?: SkillSecurityReport } {
    const parsed = parseSkillMd(text);
    if (!parsed.success) {
      return { success: false, error: parsed.error };
    }

    const p = parsed.skill;
    const name = p.name;
    if (this.builtinMap.has(name)) {
      return { success: false, error: `已存在同名内置技能 "${name}"，导入被安全拦截` };
    }

    const source: SkillSource = options?.source || 'imported';
    const preAudit = auditSkillPackage(undefined, [], text, source);
    if (preAudit.policyAction === 'block' && !options?.force) {
      return {
        success: false,
        error: `安全门禁拦截：${preAudit.findings.map((f) => f.message).join('；')}`,
        security: preAudit
      };
    }

    const targetSkillDir = path.join(this.customSkillsDir, name);
    if (!fs.existsSync(targetSkillDir)) {
      fs.mkdirSync(targetSkillDir, { recursive: true });
    }

    const filePath = path.join(targetSkillDir, 'SKILL.md');
    try {
      fs.writeFileSync(filePath, text, 'utf-8');
    } catch (err: any) {
      return { success: false, error: `保存导入技能失败: ${err.message}` };
    }

    const allFiles = this.scanDirFiles(targetSkillDir);
    const prev = this.customMap.get(name);
    const prevRecord = this.indexData[name];

    const skill = this.enrichSkill({
      name,
      description: p.description,
      category: p.category,
      channel: p.channel,
      tags: p.tags,
      source,
      enabled: prev ? prev.enabled : true,
      everyBot: prevRecord ? prevRecord.everyBot : true,
      assignedBots: prevRecord?.assignedBots || [],
      content: text,
      body: p.body,
      dirPath: targetSkillDir,
      files: allFiles,
      filesCount: allFiles.length,
      scriptsCount: this.countScripts(allFiles),
      requires: p.requires,
      allowedTools: p.allowedTools,
      metadata: p.metadata,
      license: p.license,
      compatibility: p.compatibility,
      warnings: [],
      updatedAt: Date.now(),
      createdAt: prev?.createdAt || Date.now()
    });

    this.customMap.set(name, skill);
    this.indexData[name] = {
      enabled: skill.enabled,
      everyBot: skill.everyBot ?? true,
      assignedBots: skill.assignedBots,
      source,
      updatedAt: Date.now(),
      warnings: skill.warnings
    };
    this.saveIndex();

    return { success: true, skill };
  }

  /**
   * 从 .zip 压缩包导入完整技能包（含 scripts/, references/, assets/ 等）
   */
  public async importFromZip(
    zipBuffer: Buffer,
    options?: { source?: SkillSource; force?: boolean }
  ): Promise<{ success: true; skill: SkillDefinition } | { success: false; error: string }> {
    const tmpStaging = path.join(this.customSkillsDir, `_temp_${Date.now()}`);
    const extractRes = await extractAndValidateSkillZip(zipBuffer, tmpStaging);
    if (!extractRes.success || !extractRes.skillMdContent) {
      if (fs.existsSync(tmpStaging)) {
        try {
          fs.rmSync(tmpStaging, { recursive: true, force: true });
        } catch {}
      }
      return { success: false, error: extractRes.error || '解压技能包失败' };
    }

    const parsed = parseSkillMd(extractRes.skillMdContent);
    if (!parsed.success) {
      if (fs.existsSync(tmpStaging)) {
        try {
          fs.rmSync(tmpStaging, { recursive: true, force: true });
        } catch {}
      }
      return { success: false, error: `SKILL.md 校验失败: ${parsed.error}` };
    }

    const name = parsed.skill.name;
    if (this.builtinMap.has(name)) {
      if (fs.existsSync(tmpStaging)) {
        try {
          fs.rmSync(tmpStaging, { recursive: true, force: true });
        } catch {}
      }
      return { success: false, error: `已存在同名内置基座技能 "${name}"，导入被安全拦截` };
    }

    const source: SkillSource = options?.source || 'imported';
    const stagedFiles = this.scanDirFiles(tmpStaging);
    const preAudit = auditSkillPackage(tmpStaging, stagedFiles, extractRes.skillMdContent, source);
    if (preAudit.policyAction === 'block' && !options?.force) {
      if (fs.existsSync(tmpStaging)) {
        try {
          fs.rmSync(tmpStaging, { recursive: true, force: true });
        } catch {}
      }
      return {
        success: false,
        error: `ZIP 技能包未通过安全门禁：${preAudit.findings.map((f) => f.message).join('；')}`
      };
    }

    const finalSkillDir = path.join(this.customSkillsDir, name);
    if (fs.existsSync(finalSkillDir)) {
      fs.rmSync(finalSkillDir, { recursive: true, force: true });
    }
    fs.renameSync(tmpStaging, finalSkillDir);

    const allFiles = this.scanDirFiles(finalSkillDir);

    const skill = this.enrichSkill({
      name,
      description: parsed.skill.description,
      category: parsed.skill.category,
      channel: parsed.skill.channel,
      tags: parsed.skill.tags,
      source,
      enabled: true,
      everyBot: true,
      assignedBots: [],
      content: extractRes.skillMdContent,
      body: parsed.skill.body,
      dirPath: finalSkillDir,
      files: allFiles,
      filesCount: allFiles.length,
      scriptsCount: this.countScripts(allFiles),
      requires: parsed.skill.requires,
      allowedTools: parsed.skill.allowedTools,
      metadata: parsed.skill.metadata,
      license: parsed.skill.license,
      compatibility: parsed.skill.compatibility,
      warnings: [],
      updatedAt: Date.now(),
      createdAt: Date.now()
    });

    this.customMap.set(name, skill);
    this.indexData[name] = {
      enabled: true,
      everyBot: true,
      assignedBots: [],
      source,
      updatedAt: Date.now(),
      warnings: skill.warnings
    };
    this.saveIndex();

    return { success: true, skill };
  }

  /**
   * 将技能包整体导出为 ZIP Buffer
   */
  public async exportAsZip(name: string): Promise<Buffer | null> {
    const skill = this.get(name);
    if (!skill || !skill.dirPath || !fs.existsSync(skill.dirPath)) return null;
    return await createSkillZip(skill.dirPath);
  }

  /**
   * 读取技能包内的指定文件内容
   */
  public getFileContent(name: string, subPath: string): { success: boolean; content?: string; isText?: boolean; size?: number; error?: string } {
    const skill = this.get(name);
    if (!skill || !skill.dirPath) return { success: false, error: `未找到技能 "${name}"` };

    const safeSubPath = path.normalize(subPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absPath = path.join(skill.dirPath, safeSubPath);

    if (!absPath.startsWith(skill.dirPath) || !fs.existsSync(absPath)) {
      return { success: false, error: `文件未找到: ${subPath}` };
    }

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      return { success: false, error: `${subPath} 是目录不是文件` };
    }

    const isText = isTextFile(absPath);
    if (!isText) {
      return { success: true, isText: false, size: stat.size };
    }

    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      return { success: true, content, isText: true, size: stat.size };
    } catch (err: any) {
      return { success: false, error: `读取文件失败: ${err.message}` };
    }
  }

  private ensureEditableSkillDir(skill: SkillDefinition): string | null {
    if (skill.source !== 'builtin') {
      return skill.dirPath || null;
    }
    const overrideDir = path.join(this.overrideSkillsDir, skill.name);
    if (!skill.hasBuiltinOverride || !fs.existsSync(path.join(overrideDir, 'SKILL.md'))) {
      const builtinDir = path.join(this.builtinSkillsDir, skill.name);
      if (fs.existsSync(builtinDir)) {
        copyDirRecursive(builtinDir, overrideDir);
      } else {
        fs.mkdirSync(overrideDir, { recursive: true });
        fs.writeFileSync(path.join(overrideDir, 'SKILL.md'), skill.content, 'utf-8');
      }
      skill.dirPath = overrideDir;
      skill.hasBuiltinOverride = true;
    }
    return overrideDir;
  }

  /**
   * 在技能包内创建或更新文件（内置技能自动写入覆写层 overrides/ 以防止重启丢失）
   */
  public saveFile(name: string, subPath: string, content: string): { success: boolean; skill?: SkillDefinition; error?: string } {
    const cleanName = name.trim().toLowerCase();
    const skill = this.customMap.get(cleanName) || this.builtinMap.get(cleanName);
    if (!skill) return { success: false, error: `未找到技能 "${name}"` };

    const targetDir = this.ensureEditableSkillDir(skill);
    if (!targetDir) return { success: false, error: `技能 "${name}" 没有可写目录` };

    const safeSubPath = path.normalize(subPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absPath = path.join(targetDir, safeSubPath);

    if (!absPath.startsWith(targetDir)) {
      return { success: false, error: '非法路径，禁止越界' };
    }

    try {
      const parentDir = path.dirname(absPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      if (safeSubPath === 'SKILL.md') {
        const parsed = parseSkillMd(content);
        if (!parsed.success) {
          return { success: false, error: parsed.error };
        }
        skill.description = parsed.skill.description;
        skill.category = parsed.skill.category;
        skill.channel = parsed.skill.channel;
        skill.tags = parsed.skill.tags;
        skill.requires = parsed.skill.requires;
        skill.allowedTools = parsed.skill.allowedTools;
        skill.content = content;
        skill.body = parsed.skill.body;
      }

      fs.writeFileSync(absPath, content, 'utf-8');

      const allFiles = this.scanDirFiles(targetDir);
      skill.files = allFiles;
      skill.filesCount = allFiles.length;
      skill.scriptsCount = this.countScripts(allFiles);
      skill.updatedAt = Date.now();
      this.enrichSkill(skill);

      if (this.indexData[skill.name]) {
        this.indexData[skill.name].updatedAt = skill.updatedAt;
        this.indexData[skill.name].warnings = skill.warnings;
      }
      this.saveIndex();
      return { success: true, skill };
    } catch (err: any) {
      return { success: false, error: `保存文件失败: ${err.message}` };
    }
  }

  /**
   * 删除技能包内的指定文件 (禁止删除根目录 SKILL.md)
   */
  public deleteFile(name: string, subPath: string): { success: boolean; skill?: SkillDefinition; error?: string } {
    const cleanName = name.trim().toLowerCase();
    const skill = this.customMap.get(cleanName) || this.builtinMap.get(cleanName);
    if (!skill) return { success: false, error: `未找到技能 "${name}"` };

    const safeSubPath = path.normalize(subPath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (safeSubPath === 'SKILL.md') {
      return { success: false, error: 'SKILL.md 是技能核心元数据文件，禁止删除' };
    }

    const targetDir = this.ensureEditableSkillDir(skill);
    if (!targetDir) return { success: false, error: `技能 "${name}" 没有可写目录` };

    const absPath = path.join(targetDir, safeSubPath);
    if (!absPath.startsWith(targetDir) || !fs.existsSync(absPath)) {
      return { success: false, error: `文件不存在: ${subPath}` };
    }

    try {
      fs.unlinkSync(absPath);
      const allFiles = this.scanDirFiles(targetDir);
      skill.files = allFiles;
      skill.filesCount = allFiles.length;
      skill.scriptsCount = this.countScripts(allFiles);
      skill.updatedAt = Date.now();
      this.enrichSkill(skill);
      this.saveIndex();
      return { success: true, skill };
    } catch (err: any) {
      return { success: false, error: `删除文件失败: ${err.message}` };
    }
  }

  /**
   * 将被用户修改过的内置技能恢复为系统内置默认版本
   */
  public resetBuiltinOverride(name: string): { success: boolean; skill?: SkillDefinition; error?: string } {
    const cleanName = name.trim().toLowerCase();
    const entry = BUILTIN_SKILLS.find((b) => b.name === cleanName);
    const existing = this.builtinMap.get(cleanName);
    if (!entry || !existing) {
      return { success: false, error: `未找到内置技能 "${name}"` };
    }

    const overrideDir = path.join(this.overrideSkillsDir, cleanName);
    if (fs.existsSync(overrideDir)) {
      fs.rmSync(overrideDir, { recursive: true, force: true });
    }

    const builtinDir = path.join(this.builtinSkillsDir, cleanName);
    const parsed = parseSkillMd(entry.content);
    if (parsed.success) {
      const p = parsed.skill;
      const allFiles = this.scanDirFiles(builtinDir);
      existing.description = p.description;
      existing.category = entry.category || p.category;
      existing.channel = entry.channel || p.channel;
      existing.tags = p.tags;
      existing.content = entry.content;
      existing.body = p.body;
      existing.dirPath = builtinDir;
      existing.files = allFiles;
      existing.filesCount = allFiles.length;
      existing.scriptsCount = this.countScripts(allFiles);
      existing.requires = entry.requires || p.requires;
      existing.allowedTools = p.allowedTools;
      existing.hasBuiltinOverride = false;
      existing.updatedAt = Date.now();
      this.enrichSkill(existing);
    }

    if (this.indexData[cleanName]) {
      this.indexData[cleanName].updatedAt = existing.updatedAt || Date.now();
      this.indexData[cleanName].warnings = existing.warnings;
      this.saveIndex();
    }

    return { success: true, skill: existing };
  }

  /**
   * 删除整个自定义技能包 (内置技能禁止删除)
   */
  public remove(name: string): { success: boolean; error?: string } {
    const cleanName = name.trim().toLowerCase();
    if (this.builtinMap.has(cleanName)) {
      return { success: false, error: `内置基座技能 "${cleanName}" 是系统核心能力，不可删除 (可通过开关禁用)` };
    }

    const skill = this.customMap.get(cleanName);
    if (!skill) {
      return { success: false, error: `未找到技能 "${cleanName}"` };
    }

    if (skill.dirPath && fs.existsSync(skill.dirPath)) {
      try {
        fs.rmSync(skill.dirPath, { recursive: true, force: true });
      } catch (err: any) {
        return { success: false, error: `删除技能包目录失败: ${err.message}` };
      }
    }

    this.customMap.delete(cleanName);
    delete this.indexData[cleanName];
    this.telemetryStore.removeUsage(cleanName);
    this.saveIndex();

    return { success: true };
  }

  /**
   * 切换技能开关状态
   */
  public toggle(name: string, enabled?: boolean): { success: boolean; skill?: SkillDefinition; error?: string } {
    const skill = this.get(name);
    if (!skill) return { success: false, error: `未找到技能 "${name}"` };

    const nextState = enabled !== undefined ? enabled : !skill.enabled;
    skill.enabled = nextState;
    skill.updatedAt = Date.now();

    if (!this.indexData[skill.name]) {
      this.indexData[skill.name] = {
        enabled: nextState,
        everyBot: skill.everyBot ?? true,
        assignedBots: skill.assignedBots ?? [],
        source: skill.source,
        updatedAt: Date.now(),
        warnings: skill.warnings
      };
    } else {
      this.indexData[skill.name].enabled = nextState;
      this.indexData[skill.name].updatedAt = Date.now();
    }

    this.saveIndex();
    return { success: true, skill };
  }

  /**
   * 设置是否对全部 Bot 启用 (everyBot)
   */
  public setEveryBot(name: string, everyBot: boolean): { success: boolean; skill?: SkillDefinition; error?: string } {
    const skill = this.get(name);
    if (!skill) return { success: false, error: `未找到技能 "${name}"` };

    skill.everyBot = everyBot;
    skill.updatedAt = Date.now();

    if (!this.indexData[skill.name]) {
      this.indexData[skill.name] = {
        enabled: skill.enabled,
        everyBot,
        assignedBots: skill.assignedBots,
        source: skill.source,
        updatedAt: Date.now()
      };
    } else {
      this.indexData[skill.name].everyBot = everyBot;
      this.indexData[skill.name].updatedAt = Date.now();
    }

    this.saveIndex();
    return { success: true, skill };
  }

  /**
   * 分配到具体指定的 Bot 列表
   */
  public assignBots(name: string, botIds: string[]): { success: boolean; skill?: SkillDefinition; error?: string } {
    const skill = this.get(name);
    if (!skill) return { success: false, error: `未找到技能 "${name}"` };

    const uniqueBots = [...new Set(botIds.filter(Boolean))];
    skill.assignedBots = uniqueBots;
    skill.updatedAt = Date.now();

    if (!this.indexData[skill.name]) {
      this.indexData[skill.name] = {
        enabled: skill.enabled,
        everyBot: skill.everyBot ?? false,
        assignedBots: uniqueBots,
        source: skill.source,
        updatedAt: Date.now()
      };
    } else {
      this.indexData[skill.name].assignedBots = uniqueBots;
      this.indexData[skill.name].updatedAt = Date.now();
    }

    this.saveIndex();
    return { success: true, skill };
  }

  /**
   * 导出技能 SKILL.md 纯文本
   */
  public exportSkill(name: string): string | null {
    const skill = this.get(name);
    return skill ? skill.content : null;
  }
}

export const globalSkillStore = new SkillStore();
