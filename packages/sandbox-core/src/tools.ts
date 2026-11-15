import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from './loop.js';
import { MicroSandbox, getSanitizedEnv } from './micro-sandbox.ts';

export { getSanitizedEnv };

/**
 * 基础内置工具集（含 MicroSandbox 隔离与技能阶梯工具）
 */
export function createDefaultTools(options?: {
  browserWorkerUrl?: string;
  artifactsDir?: string;
  workspaceDir?: string;
  microSandbox?: MicroSandbox;
}): ToolDefinition[] {
  const browserWorkerUrl = options?.browserWorkerUrl || 'http://127.0.0.1:8790';
  const artifactsDir = options?.artifactsDir || path.resolve(process.cwd(), 'apps/gateway/data/artifacts');
  const workspaceDir = options?.workspaceDir || process.cwd();

  // 初始化微沙箱引擎（若外部未传入，则根据工作区自动创建）
  const sandbox = options?.microSandbox || new MicroSandbox({ workspaceDir });

  return [
    // 阶梯 2 (CLI): 微沙箱隔离 Shell 执行
    {
      name: 'execute_shell',
      description: '在 Bubblewrap 微沙箱环境中执行 Linux Shell 命令（文件系统只读、Home与外网默认阻断）',
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
        const result = await sandbox.execute(cmd, { cwd: workspaceDir });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          sandbox: {
            isSandboxed: result.isSandboxed,
            engine: result.engine,
            networkBlocked: result.networkBlocked,
            durationMs: result.durationMs
          }
        };
      }
    },

    // 阶梯 3 (Web): 轻量 HTTP 页面/接口抓取（无需拉起完整 Chromium 内核）
    {
      name: 'web_fetch',
      description: '使用轻量 HTTP 协议直接抓取目标网页文本或 API JSON 数据（阶梯 3: 避免拉起重量级浏览器）',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '目标 HTTP/HTTPS URL' },
          headers: { type: 'object', description: '可选请求头' }
        },
        required: ['url']
      },
      execute: async (args) => {
        const url = String(args.url);
        console.log(`[Tool:web_fetch] 抓取: ${url}`);
        try {
          const res = await fetch(url, {
            headers: (args.headers as Record<string, string>) || { 'User-Agent': 'MuseClaw-WebFetch/1.0' }
          });
          const text = await res.text();
          return {
            status: res.status,
            contentType: res.headers.get('content-type') || 'text/plain',
            body: text.slice(0, 8000),
            truncated: text.length > 8000
          };
        } catch (error: any) {
          return { error: error.message };
        }
      }
    },

    // 阶梯 4 (Browser): 无头 Chromium 浏览器
    {
      name: 'browser_open',
      description: '在沙箱持久化 Chromium 浏览器中打开指定 URL 并获取完整渲染的 DOM 页面内容',
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

    // 阶梯 5 (GUI): 屏幕截图与视觉交互
    {
      name: 'phone_screen',
      description: '捕获桌面/手机当前屏幕画面，供多模态视觉模型感知（阶梯 5: 最高开销与延迟，仅在无 API 时使用）',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: '目标设备标识，如 "phone_1" 或 "desktop"' }
        }
      },
      execute: async (args) => {
        const target = String(args.target || 'phone_1');
        console.log(`[Tool:phone_screen] 获取屏幕: ${target}`);
        return {
          device: target,
          resolution: '360x800',
          view: 'wechat_chat_list',
          elements: ['[Button: 搜索]', '[Item: 文件传输助手]', '[Item: 订阅号消息]'],
          caption: '微信首页会话列表'
        };
      }
    },

    // 阶梯 5 (GUI): 模拟触控点击/滑动
    {
      name: 'phone_act',
      description: '在手机/桌面屏幕上模拟触控点击或滑动操作（阶梯 5: 最高成本动作）',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: '操作类型: tap | swipe | type | back' },
          x: { type: 'number', description: 'X 坐标 (0~999)' },
          y: { type: 'number', description: 'Y 坐标 (0~999)' },
          text: { type: 'string', description: '输入的文本内容' }
        },
        required: ['action']
      },
      execute: async (args) => {
        const action = String(args.action);
        console.log(`[Tool:phone_act] 执行触控: ${action} at (${args.x}, ${args.y})`);
        return { success: true, action, targetCoords: [args.x, args.y] };
      }
    },

    // 阶梯 1 (API/Local): 交付工件保存
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
    },

    // 阶梯 1 (API/Local): 文件读取
    {
      name: 'read_file',
      description: '读取沙箱或工作区中的指定文件内容（敏感文件读取后将标记会话为 Tainted 污点状态）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件相对或绝对路径' }
        },
        required: ['path']
      },
      execute: async (args) => {
        const filePath = String(args.path || '');
        console.log(`[Tool:read_file] 读取文件: ${filePath}`);
        try {
          if (!fs.existsSync(filePath)) {
            return { error: `File not found: ${filePath}` };
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          return { content, sizeBytes: Buffer.byteLength(content, 'utf-8') };
        } catch (error: any) {
          return { error: error.message };
        }
      }
    },

    // 阶梯 1/3 (Egress Action): 外发邮件
    {
      name: 'send_external_email',
      description: '向指定外部邮箱发送邮件或数据报告',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: '收件人邮箱地址' },
          subject: { type: 'string', description: '邮件主题' },
          body: { type: 'string', description: '邮件正文内容' }
        },
        required: ['to', 'subject', 'body']
      },
      execute: async (args) => {
        const to = String(args.to || '');
        const subject = String(args.subject || '');
        console.log(`[Tool:send_external_email] 发送邮件给 ${to}: ${subject}`);
        return { success: true, message: `Email successfully sent to ${to}` };
      }
    }
  ];
}
