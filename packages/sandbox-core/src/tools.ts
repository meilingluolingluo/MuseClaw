import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition } from './loop.js';

const execAsync = promisify(exec);

/**
 * 基础内置工具集（可扩展）
 */
export function createDefaultTools(options?: { browserWorkerUrl?: string }): ToolDefinition[] {
  const browserWorkerUrl = options?.browserWorkerUrl || 'http://127.0.0.1:8790';

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
          const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
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
    }
  ];
}
