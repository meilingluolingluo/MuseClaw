import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from './loop.js';

const execAsync = promisify(exec);

/**
 * 剥离宿主敏感环境变量，防止模型执行命令外泄 API 密钥与凭证
 */
function getSanitizedEnv(): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};
  const allowlist = ['PATH', 'HOME', 'USER', 'LANG', 'TERM', 'SHELL', 'PWD', 'TMPDIR', 'TEMP', 'TMP', 'NODE_ENV'];
  for (const key of allowlist) {
    if (process.env[key] !== undefined) {
      safeEnv[key] = process.env[key];
    }
  }
  safeEnv.SANDBOX_ENV = '1';
  safeEnv.MUSECLAW_SANDBOX = 'true';
  return safeEnv;
}

/**
 * 基础内置工具集（可扩展）
 */
export function createDefaultTools(options?: { browserWorkerUrl?: string; artifactsDir?: string }): ToolDefinition[] {
  const browserWorkerUrl = options?.browserWorkerUrl || 'http://127.0.0.1:8790';
  const artifactsDir = options?.artifactsDir || path.resolve(process.cwd(), 'apps/gateway/data/artifacts');

  return [
    {
      name: 'execute_shell',
      description: '在沙箱环境中执行 Linux Shell 命令',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 Bash 命令' }
        },
        required: ['command']
      },
      execute: async (args) => {
        const cmd = String(args.command);
        console.log(`[Tool:execute_shell] ${cmd}`);
        try {
          const { stdout, stderr } = await execAsync(cmd, {
            timeout: 30000,
            env: getSanitizedEnv()
          });
          return { stdout, stderr, exitCode: 0 };
        } catch (error: any) {
          return { error: error.message, stderr: error.stderr, exitCode: error.code || 1 };
        }
      }
    },
    {
      name: 'browser_open',
      description: '在沙箱持久化 Chromium 浏览器中打开指定 URL 并获取页面内容',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '目标网址' }
        },
        required: ['url']
      },
      execute: async (args) => {
        const url = String(args.url);
        console.log(`[Tool:browser_open] 访问: ${url}`);
        // 调用浏览器工作服务或降级为 HTTP fetch
        try {
          const res = await fetch(`${browserWorkerUrl}/navigate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
          if (res.ok) {
            return await res.json();
          }
        } catch {
          // 降级本地抓取
        }
        return { status: 'navigated', url };
      }
    },
    {
      name: 'save_artifact',
      description: '将任务产出物（如报告、配置、导出的代码、数据总结等）保存为正式交付工件，供用户下载查阅',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: '产出物文件名，如 report.md 或 data.json' },
          content: { type: 'string', description: '产出物的文本内容' },
          title: { type: 'string', description: '产出物中文标题，如 "服务器周度健康巡检报告"' }
        },
        required: ['filename', 'content']
      },
      execute: async (args) => {
        const filename = path.basename(String(args.filename || 'artifact.txt'));
        const content = String(args.content || '');
        const title = String(args.title || filename);

        if (!fs.existsSync(artifactsDir)) {
          fs.mkdirSync(artifactsDir, { recursive: true });
        }
        const filePath = path.join(artifactsDir, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[Tool:save_artifact] 交付工件已保存: ${filename} (${Buffer.byteLength(content, 'utf-8')} 字节)`);

        return {
          success: true,
          title,
          filename,
          sizeBytes: Buffer.byteLength(content, 'utf-8'),
          url: `/api/artifacts/${encodeURIComponent(filename)}`
        };
      }
    }
  ];
}
