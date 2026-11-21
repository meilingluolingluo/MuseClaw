import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SkillDefinition, SkillSource, SkillCategory, SkillRequirements, SkillReadiness, ExecutionChannel, SkillFileEntry } from '@museclaw/protocol';
import { parseSkillMd, renderSkillMd, scanSkillSafety, isValidSkillName, checkSkillReadiness } from './parser.ts';
import { BUILTIN_SKILLS } from './builtin.ts';
import { createSkillZip, extractAndValidateSkillZip, isTextFile } from './zip.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export class SkillStore {
  private dataDir: string;
  private builtinSkillsDir: string;
  private customSkillsDir: string;
  private indexFilePath: string;
  private builtinMap = new Map<string, SkillDefinition>();
  private customMap = new Map<string, SkillDefinition>();
  private indexData: SkillIndexFile = {};

  constructor(options?: { dataDir?: string }) {
    this.dataDir = options?.dataDir || path.resolve(__dirname, '../data/skills');
    this.builtinSkillsDir = path.join(this.dataDir, 'builtin');
    this.customSkillsDir = path.join(this.dataDir, 'custom');
    this.indexFilePath = path.join(this.dataDir, 'index.json');
    this.init();
  }

  private init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.builtinSkillsDir)) {
      fs.mkdirSync(this.builtinSkillsDir, { recursive: true });
    }
    if (!fs.existsSync(this.customSkillsDir)) {
      fs.mkdirSync(this.customSkillsDir, { recursive: true });
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

    // 2. 部署与加载内置技能包 (每个内置技能落盘为标准包目录)
    for (const b of BUILTIN_SKILLS) {
      const skillDir = path.join(this.builtinSkillsDir, b.name);
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }

      // 部署 SKILL.md
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(skillMdPath, b.content, 'utf-8');

      // 部署配套 scripts/, references/, assets/ 等文件
      if (b.files && b.files.length > 0) {
        for (const file of b.files) {
          const filePath = path.join(skillDir, file.path);
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

      const parsed = parseSkillMd(b.content);
      if (parsed.success) {
        const p = parsed.skill;
        const allFiles = this.scanDirFiles(skillDir);
        const warnings = this.scanAllSkillFiles(skillDir, allFiles, b.content);
        const record = this.indexData[p.name];

        const skill: SkillDefinition = {
          name: p.name,
          description: p.description,
          category: b.category || p.category,
          channel: b.channel || p.channel,
          tags: p.tags,
          source: 'builtin',
          enabled: record ? record.enabled : true,
          everyBot: record ? record.everyBot : true,
          assignedBots: record?.assignedBots || [],
          content: b.content,
          body: p.body,
          dirPath: skillDir,
          files: allFiles,
          filesCount: allFiles.length,
          scriptsCount: allFiles.filter((f) => f.executable || /\.(sh|bash|py|js|mjs)$/i.test(f.path)).length,
          requires: b.requires || p.requires,
          readiness: checkSkillReadiness(b.requires || p.requires),
          metadata: p.metadata,
          allowedTools: p.allowedTools,
          warnings: record?.warnings || warnings,
          updatedAt: record?.updatedAt || Date.now(),
          createdAt: 1700000000000
        };
        this.builtinMap.set(p.name, skill);

        if (!this.indexData[p.name]) {
          this.indexData[p.name] = {
            enabled: true,
            everyBot: true,
            assignedBots: [],
            source: 'builtin',
            updatedAt: Date.now(),
            warnings
          };
        }
      }
    }

    // 3. 加载用户自建与导入的技能包 (每个技能一个目录)
    try {
      const items = fs.readdirSync(this.customSkillsDir);
      for (const item of items) {
        const fullItemPath = path.join(this.customSkillsDir, item);
        const stat = fs.statSync(fullItemPath);

        // A. 规范的技能包目录形式
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
                const warnings = this.scanAllSkillFiles(skillDir, allFiles, content);
                const record = this.indexData[p.name];
                const source: SkillSource = record?.source === 'imported' ? 'imported' : 'custom';

                const skill: SkillDefinition = {
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
                  scriptsCount: allFiles.filter((f) => f.executable || /\.(sh|bash|py|js|mjs)$/i.test(f.path)).length,
                  requires: p.requires,
                  readiness: checkSkillReadiness(p.requires),
                  metadata: p.metadata,
                  allowedTools: p.allowedTools,
                  license: p.license,
                  compatibility: p.compatibility,
                  warnings: record?.warnings || warnings,
                  updatedAt: record?.updatedAt || stat.mtimeMs,
                  createdAt: stat.birthtimeMs || Date.now()
                };
                this.customMap.set(p.name, skill);

                if (!this.indexData[p.name]) {
                  this.indexData[p.name] = {
                    enabled: true,
                    everyBot: true,
                    assignedBots: [],
                    source,
                    updatedAt: Date.now(),
                    warnings
                  };
                }
              }
            } catch (readErr) {
              console.error(`[SkillStore] 解析技能包目录 ${item} 失败:`, readErr);
            }
          }
        }
        // B. 平滑迁移旧版单个 .md 文件形式
        else if (stat.isFile() && item.endsWith('.md')) {
          const skillName = path.basename(item, '.md');
          const targetDir = path.join(this.customSkillsDir, skillName);
          try {
            if (!fs.existsSync(targetDir)) {
              fs.mkdirSync(targetDir, { recursive: true });
              const content = fs.readFileSync(fullItemPath, 'utf-8');
              fs.writeFileSync(path.join(targetDir, 'SKILL.md'), content, 'utf-8');
              fs.unlinkSync(fullItemPath); // 清理旧单文件

              const parsed = parseSkillMd(content);
              if (parsed.success) {
                const p = parsed.skill;
                const allFiles = this.scanDirFiles(targetDir);
                const warnings = scanSkillSafety(content);
                const record = this.indexData[p.name];
                const source: SkillSource = record?.source === 'imported' ? 'imported' : 'custom';

                const skill: SkillDefinition = {
                  name: p.name,
                  description: p.description,
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
                  scriptsCount: 0,
                  metadata: p.metadata,
                  allowedTools: p.allowedTools,
                  license: p.license,
                  compatibility: p.compatibility,
                  warnings: record?.warnings || warnings,
                  updatedAt: Date.now(),
                  createdAt: Date.now()
                };
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

  /**
   * 静态安全扫描：包含 SKILL.md 及所有 scripts/ 下的脚本与文本文件
   */
  private scanAllSkillFiles(skillDir: string, files: SkillFileEntry[], skillMdContent: string): string[] {
    const warnings = [...scanSkillSafety(skillMdContent)];
    for (const f of files) {
      if (f.path !== 'SKILL.md' && f.isText && f.size < 512 * 1024) {
        try {
          const text = fs.readFileSync(path.join(skillDir, f.path), 'utf-8');
          const fileWarnings = scanSkillSafety(text);
          for (const w of fileWarnings) {
            warnings.push(`[${f.path}] ${w}`);
          }
        } catch {}
      }
    }
    return [...new Set(warnings)];
  }

  private saveIndex() {
    try {
      fs.writeFileSync(this.indexFilePath, JSON.stringify(this.indexData, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SkillStore] 保存 index.json 失败:', err);
    }
  }

  /**
   * 列出所有技能（支持按 Bot、关键字、业务分类、来源与运行就绪状态过滤）
   */
  public list(filter?: {
    botId?: string;
    query?: string;
    category?: string;
    channel?: string;
    tag?: string;
    source?: string;
    readiness?: string;
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
    const enabledOnly = Boolean(filter?.enabledOnly);

    return all.map((s) => {
      // 实时复查依赖就绪度
      s.readiness = checkSkillReadiness(s.requires);
      return s;
    }).filter((s) => {
      if (enabledOnly && !s.enabled) return false;

      // Bot 过滤
      if (botId) {
        const matchesBot = s.everyBot || (s.assignedBots || []).includes(botId);
        if (!matchesBot) return false;
      }

      // 业务分类过滤
      if (category && category !== 'all' && s.category !== category) {
        return false;
      }

      // 运行依赖就绪度过滤
      if (readiness && readiness !== 'all') {
        if (readiness === 'ready' && !s.readiness?.ready) return false;
        if (readiness === 'missing_deps' && s.readiness?.ready) return false;
      }

      // 来源过滤 (builtin, custom, imported, learned)
      if (source && source !== 'all' && s.source !== source) {
        return false;
      }

      // 兼容性保留通道过滤
      if (channel && channel !== 'all' && s.channel !== channel) {
        return false;
      }

      // 兼容性保留标签过滤
      if (tag && tag !== 'all') {
        const hasTag = (s.tags || []).some((t) => t.toLowerCase() === tag);
        if (!hasTag) return false;
      }

      // 关键字搜索
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
    }).sort((a, b) => {
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
      skill.readiness = checkSkillReadiness(skill.requires);
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
    const files = skill.files?.filter((f) => f.path !== 'SKILL.md') || [];
    if (files.length > 0 && skill.dirPath) {
      const fileList = files.map((f) => {
        const fullPath = path.join(skill.dirPath!, f.path);
        const execHint = f.executable ? ' (可直接在微沙箱中执行)' : '';
        return `- ${f.path}${execHint}: ${fullPath}`;
      }).join('\n');
      text += `\n\n## 本技能包含的配套脚本与参考文件 (可在微沙箱中调用):\n${fileList}`;
    }
    return text;
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
        body = `# ${name}\n\n${description}\n\n## 步骤与指导\n1. 仔细阅读上下文并规划步骤。\n2. 使用指定工具完成用户目标。`;
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

    // 写入 SKILL.md
    const skillMdPath = path.join(targetSkillDir, 'SKILL.md');
    try {
      fs.writeFileSync(skillMdPath, fullContent, 'utf-8');
    } catch (err: any) {
      return { success: false, error: `写入技能文件失败: ${err.message}` };
    }

    const allFiles = this.scanDirFiles(targetSkillDir);
    const warnings = this.scanAllSkillFiles(targetSkillDir, allFiles, fullContent);

    const prev = this.customMap.get(name);
    const prevRecord = this.indexData[name];

    const everyBot = data.everyBot !== undefined ? data.everyBot : prevRecord ? prevRecord.everyBot : true;
    const assignedBots = data.assignedBots !== undefined ? data.assignedBots : prevRecord ? prevRecord.assignedBots : [];

    const skill: SkillDefinition = {
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
      scriptsCount: allFiles.filter((f) => f.executable || /\.(sh|bash|py|js|mjs)$/i.test(f.path)).length,
      requires,
      readiness: checkSkillReadiness(requires),
      allowedTools,
      warnings,
      updatedAt: Date.now(),
      createdAt: prev?.createdAt || Date.now()
    };

    this.customMap.set(name, skill);
    this.indexData[name] = {
      enabled: skill.enabled,
      everyBot,
      assignedBots,
      source,
      updatedAt: Date.now(),
      warnings
    };
    this.saveIndex();

    return { success: true, skill };
  }

  /**
   * 从纯文本 SKILL.md 导入单体技能包
   */
  public importFromText(text: string, options?: { source?: SkillSource }): { success: true; skill: SkillDefinition } | { success: false; error: string } {
    const parsed = parseSkillMd(text);
    if (!parsed.success) {
      return { success: false, error: parsed.error };
    }

    const p = parsed.skill;
    const name = p.name;
    if (this.builtinMap.has(name)) {
      return { success: false, error: `已存在同名内置技能 "${name}"，导入被安全拦截` };
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
    const warnings = this.scanAllSkillFiles(targetSkillDir, allFiles, text);
    const source: SkillSource = options?.source || 'imported';

    const skill: SkillDefinition = {
      name,
      description: p.description,
      category: p.category,
      channel: p.channel,
      tags: p.tags,
      source,
      enabled: true,
      everyBot: true,
      assignedBots: [],
      content: text,
      body: p.body,
      dirPath: targetSkillDir,
      files: allFiles,
      filesCount: allFiles.length,
      scriptsCount: 0,
      requires: p.requires,
      readiness: checkSkillReadiness(p.requires),
      allowedTools: p.allowedTools,
      metadata: p.metadata,
      license: p.license,
      compatibility: p.compatibility,
      warnings,
      updatedAt: Date.now(),
      createdAt: Date.now()
    };

    this.customMap.set(name, skill);
    this.indexData[name] = {
      enabled: true,
      everyBot: true,
      assignedBots: [],
      source,
      updatedAt: Date.now(),
      warnings
    };
    this.saveIndex();

    return { success: true, skill };
  }

  /**
   * 从 .zip 压缩包导入完整技能包（含 scripts/, references/, assets/ 等）
   */
  public async importFromZip(
    zipBuffer: Buffer,
    options?: { source?: SkillSource }
  ): Promise<{ success: true; skill: SkillDefinition } | { success: false; error: string }> {
    // 预解析：解压到临时目录并提取 SKILL.md
    const tmpStaging = path.join(this.customSkillsDir, `_temp_${Date.now()}`);
    const extractRes = await extractAndValidateSkillZip(zipBuffer, tmpStaging);
    if (!extractRes.success || !extractRes.skillMdContent) {
      if (fs.existsSync(tmpStaging)) {
        try { fs.rmSync(tmpStaging, { recursive: true, force: true }); } catch {}
      }
      return { success: false, error: extractRes.error || '解压技能包失败' };
    }

    const parsed = parseSkillMd(extractRes.skillMdContent);
    if (!parsed.success) {
      if (fs.existsSync(tmpStaging)) {
        try { fs.rmSync(tmpStaging, { recursive: true, force: true }); } catch {}
      }
      return { success: false, error: `SKILL.md 校验失败: ${parsed.error}` };
    }

    const name = parsed.skill.name;
    if (this.builtinMap.has(name)) {
      if (fs.existsSync(tmpStaging)) {
        try { fs.rmSync(tmpStaging, { recursive: true, force: true }); } catch {}
      }
      return { success: false, error: `已存在同名内置基座技能 "${name}"，导入被安全拦截` };
    }

    const finalSkillDir = path.join(this.customSkillsDir, name);
    if (fs.existsSync(finalSkillDir)) {
      fs.rmSync(finalSkillDir, { recursive: true, force: true });
    }
    fs.renameSync(tmpStaging, finalSkillDir);

    const allFiles = this.scanDirFiles(finalSkillDir);
    const warnings = this.scanAllSkillFiles(finalSkillDir, allFiles, extractRes.skillMdContent);
    const source: SkillSource = options?.source || 'imported';

    const skill: SkillDefinition = {
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
      scriptsCount: allFiles.filter((f) => f.executable || /\.(sh|bash|py|js|mjs)$/i.test(f.path)).length,
      requires: parsed.skill.requires,
      readiness: checkSkillReadiness(parsed.skill.requires),
      allowedTools: parsed.skill.allowedTools,
      metadata: parsed.skill.metadata,
      license: parsed.skill.license,
      compatibility: parsed.skill.compatibility,
      warnings,
      updatedAt: Date.now(),
      createdAt: Date.now()
    };

    this.customMap.set(name, skill);
    this.indexData[name] = {
      enabled: true,
      everyBot: true,
      assignedBots: [],
      source,
      updatedAt: Date.now(),
      warnings
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

  /**
   * 在自建技能包内创建或更新文件
   */
  public saveFile(name: string, subPath: string, content: string): { success: boolean; error?: string } {
    const skill = this.customMap.get(name);
    if (!skill || !skill.dirPath) return { success: false, error: `未找到或不可编辑的技能 "${name}"` };

    const safeSubPath = path.normalize(subPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absPath = path.join(skill.dirPath, safeSubPath);

    if (!absPath.startsWith(skill.dirPath)) {
      return { success: false, error: '非法路径，禁止越界' };
    }

    try {
      const parentDir = path.dirname(absPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(absPath, content, 'utf-8');

      // 若修改的是 SKILL.md，同步更新技能元数据
      if (safeSubPath === 'SKILL.md') {
        const parsed = parseSkillMd(content);
        if (parsed.success) {
          skill.description = parsed.skill.description;
          skill.channel = parsed.skill.channel;
          skill.tags = parsed.skill.tags;
          skill.content = content;
          skill.body = parsed.skill.body;
        }
      }

      // 刷新文件列表
      const allFiles = this.scanDirFiles(skill.dirPath);
      skill.files = allFiles;
      skill.filesCount = allFiles.length;
      skill.scriptsCount = allFiles.filter((f) => f.executable || /\.(sh|bash|py|js|mjs)$/i.test(f.path)).length;
      skill.warnings = this.scanAllSkillFiles(skill.dirPath, allFiles, skill.content);
      skill.updatedAt = Date.now();

      this.saveIndex();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: `保存文件失败: ${err.message}` };
    }
  }

  /**
   * 删除技能包内的指定文件 (禁止删除根目录 SKILL.md)
   */
  public deleteFile(name: string, subPath: string): { success: boolean; error?: string } {
    const skill = this.customMap.get(name);
    if (!skill || !skill.dirPath) return { success: false, error: `未找到或不可编辑的技能 "${name}"` };

    const safeSubPath = path.normalize(subPath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (safeSubPath === 'SKILL.md') {
      return { success: false, error: 'SKILL.md 是技能核心元数据文件，禁止删除' };
    }

    const absPath = path.join(skill.dirPath, safeSubPath);
    if (!absPath.startsWith(skill.dirPath) || !fs.existsSync(absPath)) {
      return { success: false, error: `文件不存在: ${subPath}` };
    }

    try {
      fs.unlinkSync(absPath);
      const allFiles = this.scanDirFiles(skill.dirPath);
      skill.files = allFiles;
      skill.filesCount = allFiles.length;
      skill.scriptsCount = allFiles.filter((f) => f.executable || /\.(sh|bash|py|js|mjs)$/i.test(f.path)).length;
      skill.updatedAt = Date.now();
      this.saveIndex();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: `删除文件失败: ${err.message}` };
    }
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

// 全局单例导出
export const globalSkillStore = new SkillStore();
