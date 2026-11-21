import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from './loop.js';
import { MicroSandbox, getSanitizedEnv } from './micro-sandbox.ts';

export { getSanitizedEnv };

export interface SkillsProvider {
  list: (botId?: string) => Array<{ name: string; description: string; source: string; channel: string; enabled: boolean }>;
  get: (name: string) => { name: string; description: string; content: string; body: string; channel: string; enabled: boolean } | null;
  save: (data: { name: string; description: string; channel?: string; body?: string }) => { success: boolean; skill?: unknown; error?: string };
  remove: (name: string) => { success: boolean; error?: string };
}

/**
 * 基础内置工具集（含 MicroSandbox 隔离与技能阶梯工具）
 */
export function createDefaultTools(options?: {
  browserWorkerUrl?: string;
  artifactsDir?: string;
  workspaceDir?: string;
  microSandbox?: MicroSandbox;
  skillsProvider?: SkillsProvider;
}): ToolDefinition[] {
  const browserWorkerUrl = options?.browserWorkerUrl || 'http://127.0.0.1:8790';
  const artifactsDir = options?.artifactsDir || path.resolve(process.cwd(), 'apps/gateway/data/artifacts');
  const workspaceDir = options?.workspaceDir || process.cwd();
  const skillsProvider = options?.skillsProvider;

  // 初始化微沙箱引擎（若外部未传入，则根据工作区自动创建）
  const sandbox = options?.microSandbox || new MicroSandbox({ workspaceDir });

  return [
    // Agent Skills 规程库加载、执行与自学习沉淀
    {
      name: 'skills',
      description: 'Agent Skills (规程与能力包)：标准化任务指南与操作手册。action="use" 获取指导与配套脚本，action="list" 列出技能与运行就绪状态，action="save" 新建技能，action="learn" 自主学习沉淀工坊技能，action="remove" 移除自建技能。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['use', 'list', 'save', 'learn', 'remove'], description: '操作类型' },
          name: { type: 'string', description: '技能英文名称（如 amap, trip-plan 等）' },
          category: { type: 'string', enum: ['devops', 'productivity', 'research', 'integration', 'utility', 'custom'], description: '技能业务分类（save/learn 时使用）' },
          description: { type: 'string', description: '技能简短说明（仅在 save/learn 时使用）' },
          instructions: { type: 'string', description: '技能 Markdown 指导正文（仅在 save/learn 时使用）' }
        },
        required: ['action']
      },
      execute: async (args) => {
        const action = String(args.action || '');
        const name = String(args.name || '').trim().toLowerCase();
        console.log(`[Tool:skills] action=${action} name=${name}`);

        if (!skillsProvider) {
          return { error: 'Skills provider is not configured in this sandbox environment.' };
        }

        try {
          if (action === 'list') {
            const list = skillsProvider.list().filter((s: any) => s.enabled);
            if (list.length === 0) {
              return { message: '当前没有已启用的技能。' };
            }
            return {
              total: list.length,
              skills: list.map((s: any) => ({
                name: s.name,
                category: s.category || 'utility',
                source: s.source,
                readiness: s.readiness?.ready ? 'ready' : (s.readiness?.details || 'needs_setup'),
                description: s.description
              }))
            };
          }

          if (action === 'use') {
            if (!name) return { error: '参数 name 不能为空' };
            const skill = skillsProvider.get(name);
            if (!skill || !skill.enabled) {
              const available = skillsProvider.list().filter((s: any) => s.enabled).map((s: any) => s.name).join(', ');
              return { error: `未找到或已禁用的技能 "${name}"。当前可用技能: ${available || '无'}` };
            }
            return {
              name: skill.name,
              category: skill.category || 'utility',
              readiness: skill.readiness,
              dirPath: skill.dirPath,
              files: (skill.files || []).map((f: any) => f.path),
              description: skill.description,
              instructions: skill.body || skill.content
            };
          }

          if (action === 'save' || action === 'learn') {
            if (!name) return { error: '参数 name 不能为空' };
            const desc = String(args.description || '').trim();
            const inst = String(args.instructions || '').trim();
            const cat = (args.category || 'custom') as any;
            if (!desc) return { error: '沉淀技能时必须提供 description 说明何时使用' };
            if (!inst) return { error: '沉淀技能时必须提供 instructions 指令步骤' };

            const source = action === 'learn' ? 'learned' : 'custom';
            const res = skillsProvider.save({
              name,
              description: desc,
              category: cat,
              source,
              body: inst
            });
            if (!res.success) {
              return { error: res.error || '保存技能失败' };
            }
            const label = action === 'learn' ? '工坊自学技能' : '自定义技能';
            return {
              success: true,
              message: `已成功保存${label} "${name}" [${cat}]，后续对话或通过 /${name} 命令可直接调用。`
            };
          }

          if (action === 'remove') {
            if (!name) return { error: '参数 name 不能为空' };
            const res = skillsProvider.remove(name);
            if (!res.success) return { error: res.error || '删除技能失败' };
            return { success: true, message: `技能 "${name}" 已成功删除。` };
          }

          return { error: `未知操作 action: ${action}` };
        } catch (err: any) {
          return { error: err.message || String(err) };
        }
      }
    },
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
          const rawHeaders = (args.headers as Record<string, unknown>) || {};
          const safeHeaders: Record<string, string> = { 'User-Agent': 'MuseClaw-WebFetch/1.0' };
          for (const [k, v] of Object.entries(rawHeaders)) {
            const cleanKey = String(k).replace(/[^\x00-\x7F]/g, '');
            if (cleanKey) {
              safeHeaders[cleanKey] = encodeURI(String(v ?? ''));
            }
          }
          const res = await fetch(url, {
            headers: safeHeaders
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
      description: '在沙箱持久化 Chromium 浏览器中打开指定 URL 并获取渲染内容（若浏览器 Worker 未启动则降级轻量 HTTP 抓取）',
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
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(`${browserWorkerUrl}/navigate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal: controller.signal
          }).finally(() => clearTimeout(timer));
          if (res.ok) {
            return await res.json();
          }
        } catch {
          // Worker 未就绪时，降级使用轻量 HTTP 获取文本，绝不伪造虚假渲染成功
        }

        try {
          const fetchRes = await fetch(url, { headers: { 'User-Agent': 'MuseClaw-LiteBrowser/1.0' } });
          if (fetchRes.ok) {
            const text = await fetchRes.text();
            return {
              status: 'fetched_via_http_fallback',
              notice: 'Headless browser worker (8790) is offline; retrieved static content via HTTP fallback.',
              url,
              content: text.slice(0, 3000)
            };
          }
          return {
            success: false,
            error: `Browser worker offline and HTTP fallback returned status ${fetchRes.status}`
          };
        } catch (err: any) {
          return {
            success: false,
            error: `Browser worker (8790) offline and direct fetch failed: ${err?.message || err}`
          };
        }
      }
    },

    // 阶梯 5 (GUI): 屏幕感知 (严格校验真机 Bridge 连接)
    {
      name: 'phone_screen',
      description: '捕获桌面/手机当前屏幕画面，供多模态视觉模型感知（阶梯 5: 最高开销与延迟，仅在真机 Bridge 在线时可用）',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: '目标设备标识，如 "phone_1" 或 "desktop"' }
        }
      },
      execute: async (args) => {
        const target = String(args.target || 'phone_1');
        console.log(`[Tool:phone_screen] 获取屏幕: ${target}`);
        const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
        if (!bridgeUrl) {
          return {
            success: false,
            error: 'GUI device offline: no active mobile/desktop device connected (set DEVICE_BRIDGE_URL or connect via ADB bridge)'
          };
        }
        try {
          const res = await fetch(`${bridgeUrl}/screen?device=${encodeURIComponent(target)}`);
          if (res.ok) return await res.json();
          return { success: false, error: `Device bridge returned HTTP ${res.status}` };
        } catch (err: any) {
          return { success: false, error: `Failed to connect to device bridge: ${err?.message || err}` };
        }
      }
    },

    // 阶梯 5 (GUI): 模拟触控点击/滑动 (严格校验真机 Bridge 连接)
    {
      name: 'phone_act',
      description: '在手机/桌面屏幕上模拟触控点击或滑动操作（阶梯 5: 最高成本动作，需真机在线）',
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
        const bridgeUrl = process.env.DEVICE_BRIDGE_URL;
        if (!bridgeUrl) {
          return {
            success: false,
            error: 'GUI device offline: cannot perform touch/input without active device bridge (set DEVICE_BRIDGE_URL)'
          };
        }
        try {
          const res = await fetch(`${bridgeUrl}/act`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args)
          });
          if (res.ok) return await res.json();
          return { success: false, error: `Device bridge action failed with status ${res.status}` };
        } catch (err: any) {
          return { success: false, error: `Device bridge unreachable: ${err?.message || err}` };
        }
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

    // 阶梯 1/3 (Egress Action): 外发邮件 (严格要求配置发信凭据，拒绝虚假成功)
    {
      name: 'send_external_email',
      description: '向指定外部邮箱发送邮件或数据报告（需配置 SMTP 或 Resend 凭据）',
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
        const body = String(args.body || '');
        console.log(`[Tool:send_external_email] 发送邮件给 ${to}: ${subject}`);

        const smtpHost = process.env.SMTP_HOST;
        const resendKey = process.env.RESEND_API_KEY;

        if (!smtpHost && !resendKey) {
          return {
            success: false,
            error: 'Email service unconfigured: missing SMTP_HOST or RESEND_API_KEY credentials. Email was NOT sent to prevent false-success hallucinations.'
          };
        }

        // 真实集成 Resend 发信服务
        if (resendKey) {
          try {
            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: process.env.SMTP_FROM || 'museclaw@resend.dev',
                to: [to],
                subject,
                text: body
              })
            });
            if (res.ok) {
              const data = await res.json();
              return { success: true, messageId: (data as any)?.id, to };
            }
            return { success: false, error: `Resend API rejected request: ${res.statusText}` };
          } catch (err: any) {
            return { success: false, error: `Resend email dispatch error: ${err?.message || err}` };
          }
        }

        return {
          success: false,
          error: 'SMTP host configured but native socket delivery requires SMTP_USER and SMTP_PASS credentials'
        };
      }
    }
  ];
}
