/**
 * Skill Package ZIP Archive Engine
 * 支持将完整技能包（含 SKILL.md、scripts/ 脚本、references/ 参考资料、assets/ 模板）打包为 .zip
 * 并支持安全解压校验上传的 .zip 压缩包
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExtractedSkillPackage {
  success: boolean;
  skillName?: string;
  files: Array<{
    path: string;
    size: number;
    executable: boolean;
    isText: boolean;
  }>;
  skillMdContent?: string;
  error?: string;
}

/**
 * 将指定技能目录打包为 ZIP Buffer
 */
export async function createSkillZip(skillDir: string): Promise<Buffer> {
  if (!fs.existsSync(skillDir)) {
    throw new Error(`技能目录不存在: ${skillDir}`);
  }

  const tmpZipPath = path.join(os.tmpdir(), `skill-pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);

  try {
    // 使用 Linux 原生 zip 命令，保留文件执行权限与相对目录层级
    await execFileAsync('zip', ['-r', tmpZipPath, '.'], { cwd: skillDir });
    const buffer = fs.readFileSync(tmpZipPath);
    return buffer;
  } finally {
    if (fs.existsSync(tmpZipPath)) {
      try {
        fs.unlinkSync(tmpZipPath);
      } catch {}
    }
  }
}

/**
 * 安全解压并校验上传的技能 ZIP 压缩包
 */
export async function extractAndValidateSkillZip(
  zipBuffer: Buffer,
  targetSkillDir: string
): Promise<ExtractedSkillPackage> {
  const tmpId = `skill-extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpZipFile = path.join(os.tmpdir(), `${tmpId}.zip`);
  const stagingDir = path.join(os.tmpdir(), tmpId);

  try {
    fs.writeFileSync(tmpZipFile, zipBuffer);
    fs.mkdirSync(stagingDir, { recursive: true });

    // 解压到临时隔离工作区
    await execFileAsync('unzip', ['-q', tmpZipFile, '-d', stagingDir]);

    // 扫描临时隔离工作区的文件
    let entries = fs.readdirSync(stagingDir);
    let effectiveRoot = stagingDir;

    // 若 ZIP 内包裹了一层单级父文件夹 (如 my-skill/SKILL.md)，自动下钻到该目录
    if (entries.length === 1 && fs.statSync(path.join(stagingDir, entries[0])).isDirectory()) {
      effectiveRoot = path.join(stagingDir, entries[0]);
      entries = fs.readdirSync(effectiveRoot);
    }

    // 核心必要文件校验：必须包含 SKILL.md (不区分大小写查找，标准化为 SKILL.md)
    const skillMdName = entries.find((e) => e.toLowerCase() === 'skill.md');
    if (!skillMdName) {
      return {
        success: false,
        files: [],
        error: 'ZIP 压缩包中未找到核心元数据与规程文件 SKILL.md（必须位于根目录或一级子目录下）'
      };
    }

    const skillMdPath = path.join(effectiveRoot, skillMdName);
    const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');

    // 递归收集所有文件，进行路径安全检查 (防止 Zip Slip / 路径遍历)
    const collectedFiles: Array<{
      relPath: string;
      absPath: string;
      size: number;
      executable: boolean;
      isText: boolean;
    }> = [];

    const walk = (currentDir: string, relBase: string) => {
      const items = fs.readdirSync(currentDir);
      for (const item of items) {
        if (item === '.' || item === '..' || item === '__MACOSX' || item === '.DS_Store') continue;
        const absPath = path.join(currentDir, item);
        const relPath = relBase ? `${relBase}/${item}` : item;

        // 路径遍历防护
        if (relPath.includes('..') || relPath.startsWith('/') || relPath.includes('\\')) {
          throw new Error(`检测到非法路径遍历项: ${relPath}`);
        }

        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          walk(absPath, relPath);
        } else if (stat.isFile()) {
          const isExecutable = Boolean(stat.mode & 0o111) || /\.(sh|bash|py|js|mjs)$/i.test(item);
          collectedFiles.push({
            relPath: item.toLowerCase() === 'skill.md' ? 'SKILL.md' : relPath,
            absPath,
            size: stat.size,
            executable: isExecutable,
            isText: isTextFile(item)
          });
        }
      }
    };

    walk(effectiveRoot, '');

    // 确保目标技能目录存在并清空旧内容
    if (fs.existsSync(targetSkillDir)) {
      fs.rmSync(targetSkillDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetSkillDir, { recursive: true });

    // 复制所有文件到目标正式目录，并保持权限
    for (const f of collectedFiles) {
      const destPath = path.join(targetSkillDir, f.relPath);
      const destParent = path.dirname(destPath);
      if (!fs.existsSync(destParent)) {
        fs.mkdirSync(destParent, { recursive: true });
      }
      fs.copyFileSync(f.absPath, destPath);
      if (f.executable) {
        try {
          fs.chmodSync(destPath, 0o755);
        } catch {}
      }
    }

    return {
      success: true,
      files: collectedFiles.map((f) => ({
        path: f.relPath,
        size: f.size,
        executable: f.executable,
        isText: f.isText
      })),
      skillMdContent
    };
  } catch (err: any) {
    return {
      success: false,
      files: [],
      error: `ZIP 解压处理失败: ${err.message}`
    };
  } finally {
    // 清理临时文件
    if (fs.existsSync(tmpZipFile)) {
      try {
        fs.unlinkSync(tmpZipFile);
      } catch {}
    }
    if (fs.existsSync(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

/**
 * 判断是否属于纯文本类型文件
 */
export function isTextFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const textExts = new Set([
    '.md',
    '.markdown',
    '.txt',
    '.sh',
    '.bash',
    '.zsh',
    '.py',
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.html',
    '.htm',
    '.css',
    '.sql',
    '.csv',
    '.xml',
    '.env',
    '.conf',
    '.ini'
  ]);
  return textExts.has(ext);
}
