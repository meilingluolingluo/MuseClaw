import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentLoop, type LLMMessage, type LLMCaller, type SentinelHook } from '../../../packages/sandbox-core/src/loop.ts';
import { createDefaultTools } from '../../../packages/sandbox-core/src/tools.ts';
import { createDeepSeekCaller } from '../../../packages/sandbox-core/src/llm.ts';
import { globalModelStore } from '../bots/provider-store.ts';
import { globalImageModelStore } from '../avatar/image-provider-store.ts';
import {
  MicroSandbox,
  CHANNEL_RANK,
  CHANNEL_DETAILS,
  probeLocalAgents,
  globalRunnerMesh,
  globalMulticaBridge,
  Attachment,
  formatAttachmentNote,
  modelTakesImages,
  buildMultimodalContent
} from '../../../packages/sandbox-core/src/index.ts';
import { SentinelPolicyManager } from '../../../apps/sentinel/src/guard.ts';
import { createInfoflowChannel } from '../channels/infoflow/index.ts';
import { createFeishuChannel } from '../channels/feishu/index.ts';
import { ProactiveManager } from '../proactive/index.ts';
import {
  BotRegistry,
  SessionStore,
  SessionRouter,
  BotMemoryManager,
  MemoryPipeline,
  FeedStore,
  ProactiveBriefEngine,
  type FeedSearchHit
} from '../bots/index.ts';
import { GoalStore, GoalEngine } from '../goals/index.ts';
import { McpClientManager } from '../mcp/client.ts';
import { ConnectorManager } from './connectors.ts';
import { globalSkillStore } from '../skills/index.ts';
import { authService, parseCookies, type AuthUser } from '../auth/auth-service.ts';
import { AvatarStudio, parseAvatarRequest, parseAvatarChoice } from '../avatar/index.ts';
import type { RouteResult, Session, ApprovalRequest, AgentProfile, WidgetPayload } from '@museclaw/protocol';

function formatWidgetFallbackText(widget: WidgetPayload): string {
  return widget.fallbackText
    ? `\n\n${widget.fallbackText}`
    : `\n\n[交互组件：${widget.title}，请在 Web 工作台查看完整交互视图]`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 自动加载本地环境变量文件 (.env.local 与 .env)
function loadEnv() {
  const envFiles = [
    path.resolve(__dirname, '../../../.env.local'),
    path.resolve(__dirname, '../../../.env')
  ];

  for (const envPath of envFiles) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8').trim();
      if (content.startsWith('sk-') && !content.includes('=')) {
        if (!process.env.DEEPSEEK_API_KEY) {
          process.env.DEEPSEEK_API_KEY = content;
        }
        continue;
      }

      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          let val = trimmed.slice(idx + 1).trim();
          const commentIdx = val.indexOf('#');
          if (commentIdx !== -1 && !val.startsWith('"') && !val.startsWith("'")) {
            val = val.slice(0, commentIdx).trim();
          }
          if (!process.env[key]) {
            process.env[key] = val.replace(/^["']|["']$/g, '');
          }
        }
      }
    }
  }
}
loadEnv();

// 全局未捕获异常与 Promise 拒绝防御，防止网关因偶发网络波动或第三方 SDK 异常崩溃
process.on('uncaughtException', (err) => {
  console.error('💥 [Server:UncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 [Server:UnhandledRejection]', reason);
});

const sentinel = new SentinelPolicyManager();
const botMemory = new BotMemoryManager();
const memoryPipeline = new MemoryPipeline(botMemory);
const proactiveBrief = new ProactiveBriefEngine();
const goalStore = new GoalStore();
const reflectionTurnCounter = new Map<string, number>();

async function searchWebForFeed(query: string, count = 4): Promise<FeedSearchHit[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || !query.trim()) return [];
  try {
    const res = await fetch('https://api.deepseek.com/v1/tools/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.replace(/[^\x00-\x7F]/g, '').trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: query.trim(), count, need_content: false })
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const list = Array.isArray(data?.results) ? data.results : [];
    return list
      .map((r: any) => ({
        title: String(r?.title || '').trim(),
        url: String(r?.url || '').trim(),
        snippet: String(r?.snippet || r?.content || '').trim().slice(0, 300),
        source: String(r?.site || r?.source || '').trim() || undefined,
        image: typeof r?.image === 'string' ? r.image : undefined
      }))
      .filter((r: FeedSearchHit) => r.title && /^https?:\/\//i.test(r.url));
  } catch {
    return [];
  }
}

function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let cur = path.resolve(startDir);
  while (cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(cur, '.git'))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return path.resolve(startDir);
}
const workspaceRoot = findWorkspaceRoot(__dirname);

const baseTools = createDefaultTools({
  workspaceDir: workspaceRoot,
  skillsProvider: globalSkillStore,
  memoryProvider: {
    getMemory: (botId, userId) => botMemory.getMemory(botId, userId || 'user_web'),
    addItem: (botId, content, category, isUser, userId, options) =>
      botMemory.addMemoryItem(botId, content, category as any, isUser ?? true, userId || 'user_web', options),
    search: (botId, query, userId, options) => botMemory.searchMemory(botId, query, userId || 'user_web', options),
    deleteItem: (botId, itemId, userId) => botMemory.deleteMemoryItem(botId, itemId, userId || 'user_web', false),
    listTopics: (botId, userId) => botMemory.listTopics(botId, userId || 'user_web'),
    getTopic: (botId, slug, userId) => botMemory.getTopic(botId, slug, userId || 'user_web'),
    upsertTopic: (botId, topic, entry, meta, userId) =>
      botMemory.upsertTopicEntry(botId, topic, entry, meta, userId || 'user_web'),
    createIntent: (botId, input, userId) => botMemory.createIntent(botId, input, userId || 'user_web'),
    listIntents: (botId, userId) => botMemory.listIntents(botId, userId || 'user_web'),
    cancelIntent: (botId, intentId, userId) => botMemory.cancelIntent(botId, intentId, userId || 'user_web')
  },
  goalProvider: {
    create: (data) => goalStore.create(data),
    list: (filter) => goalStore.list(filter),
    get: (id) => goalStore.get(id),
    update: (id, updates) => goalStore.update(id, updates),
    updateStep: (id, stepIdOrIndex, status, options) => {
      if (typeof stepIdOrIndex === 'number') {
        return goalStore.updateStepByIndex(id, stepIdOrIndex, status, options?.note);
      }
      return goalStore.updateStep(id, stepIdOrIndex, status, options);
    },
    addStep: (id, title, desc) => goalStore.addStep(id, title, desc),
    propose: (id, reason, steps) => goalStore.proposeReplan(id, reason, steps),
    setStatus: (id, status) => goalStore.setStatus(id, status),
    appendNote: (id, note) => goalStore.appendNote(id, note),
    render: (goal) => goalStore.render(goal)
  },
  feishuProvider: {
    sendMessage: async (opts) => {
      return await feishuChannel.sender.sendMessage(
        opts.receiveId,
        opts.content,
        opts.msgType || 'text',
        opts.receiveIdType,
        opts.title
      );
    }
  }
});
const mcpManager = new McpClientManager();
const connectorManager = new ConnectorManager(undefined, mcpManager);
let tools = [...baseTools];

function refreshTools() {
  const allTools = [
    ...baseTools,
    ...mcpManager.getToolDefinitions(),
    ...connectorManager.getToolDefinitions()
  ];
  tools = allTools.filter(t => connectorManager.isToolEnabled(t.name));
  return tools;
}

function resolveSkillPrompt(userText: string): string {
  const slashMatch = userText.match(/^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
  if (slashMatch) {
    const targetSkill = globalSkillStore.get(slashMatch[1]);
    if (targetSkill && targetSkill.enabled && targetSkill.usage?.lifecycleState !== 'archived') {
      globalSkillStore.recordUsage(targetSkill.name, 'use');
      const userQuery = slashMatch[2]?.trim() || '请根据此技能规程执行任务。';
      const instructions = globalSkillStore.getSkillInstructions(targetSkill.name) || targetSkill.body || targetSkill.content;
      const toolHint =
        targetSkill.allowedTools && targetSkill.allowedTools.length > 0
          ? `\n[推荐优先工具]: ${targetSkill.allowedTools.join(', ')}`
          : '';
      return `[已激活技能规程: ${targetSkill.name} (${targetSkill.category || 'utility'})]${toolHint}\n${instructions}\n\n[用户具体诉求]:\n${userQuery}`;
    }
  }
  return userText;
}

function getBotSkills(botId?: string) {
  return globalSkillStore
    .list({ botId, enabledOnly: true })
    .filter((s) => s.readiness?.ready !== false)
    .map((s) => ({
      name: s.name,
      description: s.description,
      category: s.category || 'utility',
      channel: s.channel
    }));
}

const callLLM: LLMCaller = async (messages, tools, onChunk) => {
  const caller = globalModelStore.getActiveCaller();
  return caller(messages, tools, onChunk);
};

// 1. 多 Bot 注册中心与会话存储 (BotRegistry, SessionStore, SessionRouter, BotMemoryManager)
const botRegistry = new BotRegistry();
const sessionStore = new SessionStore();
const sessionRouter = new SessionRouter(botRegistry, sessionStore);
const feedStore = new FeedStore();
const avatarStudio = new AvatarStudio(botRegistry);

function safeJsonParse<T = any>(str: string, fallback: T = {} as T): T {
  try {
    return JSON.parse(str || '{}');
  } catch {
    return fallback;
  }
}

function getOrCreateSession(sessionId?: string, botId?: string, userId = 'system'): Session {
  const targetUserId = userId || 'system';
  if (sessionId) {
    let session = sessionStore.get(sessionId, targetUserId);
    if (!session) {
      const defaultBot = botRegistry.getCoordinator() || botRegistry.list()[0];
      const targetBotId = botId || (defaultBot ? defaultBot.id : 'muse');
      const kind = sessionId.endsWith('_main') || sessionId === 'main' ? 'main' : 'side';
      session = sessionStore.create(sessionId, targetBotId, kind === 'main' ? '主要聊天' : '新对话', targetUserId, kind);
    }
    return session;
  }
  const defaultBot = botRegistry.getCoordinator() || botRegistry.list()[0];
  const targetBotId = botId || (defaultBot ? defaultBot.id : 'muse');
  return sessionStore.getMainSession(targetBotId, targetUserId);
}

// 2. 初始化如流 (Infoflow) 通道配置 (未配置安全凭据时关闭通道)
const infoflowToken = process.env.INFOFLOW_TOKEN || '';
const infoflowAesKey = process.env.INFOFLOW_AES_KEY || '';
const infoflowAppId = process.env.INFOFLOW_APP_ID;
const infoflowAppSecret = process.env.INFOFLOW_APP_SECRET;
const infoflowApiBase = process.env.INFOFLOW_API_BASE;
const infoflowWebhookUrl = process.env.INFOFLOW_WEBHOOK_URL;

const infoflowChannel = createInfoflowChannel(
  {
    token: infoflowToken,
    encodingAesKey: infoflowAesKey,
    appId: infoflowAppId,
    appSecret: infoflowAppSecret,
    apiBase: infoflowApiBase,
    webhookUrl: infoflowWebhookUrl
  },
  sentinel,
  async (userId, prompt) => {
    // 路由解析支持 @Mention 与 Bot 专属记忆/策略注入
    const routeResult = sessionRouter.route({
      text: prompt,
      session_id: `infoflow_user_${userId}`,
      user_id: userId
    });
    const { bot, session_id: finalSessionId } = routeResult;
    const botWithMemory: AgentProfile = {
      ...bot,
      memory: botMemory.getMemory(bot.id, userId)
    };

    const session = getOrCreateSession(finalSessionId, bot.id, userId);
    const historyMessages = (session.messages || [])
      .slice(-20)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content || '' }))
      .filter((m) => m.content && m.content.trim().length > 0);

    const loop = runAgentLoop(
      bot.system_prompt || '你是一个企业内部严谨、高效的自动化数字员工。请按步骤执行。',
      resolveSkillPrompt(prompt),
      refreshTools(),
      sentinel,
      callLLM,
      { sessionId: finalSessionId, userId, botId: bot.id, profile: botWithMemory, maxSteps: 15, skills: getBotSkills(bot.id), historyMessages }
    );

    let output = '';
    for await (const event of loop) {
      if (event.type === 'stream:text-delta') {
        output += event.text;
      }
      if (event.type === 'ui:widget') {
        output += formatWidgetFallbackText(event.widget);
      }
      if (event.type === 'sentinel:approval_needed') {
        // 自动将审批指令卡片推送给如流用户
        await infoflowChannel.approvalBridge.pushApprovalNotice(userId, event.request);
      }
    }
    if (!session.messages) session.messages = [];
    session.messages.push({ role: 'user', content: prompt });
    session.messages.push({ role: 'assistant', content: output || '任务已顺利完成。' });
    sessionStore.save(session, userId);
    return output || '任务已顺利完成。';
  }
);

// 3. 初始化飞书 (Feishu) 通道配置
const feishuAppId = process.env.FEISHU_APP_ID;
const feishuAppSecret = process.env.FEISHU_APP_SECRET;
const feishuEncryptKey = process.env.FEISHU_ENCRYPT_KEY;
const feishuVerificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
const feishuWebhookUrl = process.env.FEISHU_WEBHOOK_URL;

const feishuChannel = createFeishuChannel(
  {
    appId: feishuAppId,
    appSecret: feishuAppSecret,
    encryptKey: feishuEncryptKey,
    verificationToken: feishuVerificationToken,
    webhookUrl: feishuWebhookUrl
  },
  sentinel,
  async (userId, prompt) => {
    // 路由解析支持 @Mention 与 Bot 专属记忆/策略注入
    const routeResult = sessionRouter.route({
      text: prompt,
      session_id: `feishu_user_${userId}`,
      user_id: userId
    });
    const { bot, session_id: finalSessionId } = routeResult;
    const botWithMemory: AgentProfile = {
      ...bot,
      memory: botMemory.getMemory(bot.id, userId)
    };

    const session = getOrCreateSession(finalSessionId, bot.id, userId);
    const historyMessages = (session.messages || [])
      .slice(-20)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content || '' }))
      .filter((m) => m.content && m.content.trim().length > 0);

    const loop = runAgentLoop(
      bot.system_prompt || '你是一个企业内部严谨、高效的自动化数字员工。请按步骤执行。',
      resolveSkillPrompt(prompt),
      refreshTools(),
      sentinel,
      callLLM,
      { sessionId: finalSessionId, userId, botId: bot.id, profile: botWithMemory, maxSteps: 15, skills: getBotSkills(bot.id), historyMessages }
    );

    let output = '';
    for await (const event of loop) {
      if (event.type === 'stream:text-delta') {
        output += event.text;
      }
      if (event.type === 'ui:widget') {
        output += formatWidgetFallbackText(event.widget);
      }
      if (event.type === 'sentinel:approval_needed') {
        // 推送飞书原生互动卡片（带允许/拒绝按钮）
        await feishuChannel.approvalBridge.pushApprovalCard(userId, event.request);
      }
    }
    if (!session.messages) session.messages = [];
    session.messages.push({ role: 'user', content: prompt });
    session.messages.push({ role: 'assistant', content: output || '任务已顺利完成。' });
    sessionStore.save(session, userId);
    return output || '任务已顺利完成。';
  }
);

// 4. 初始化例行自动化与主动任务调度器 (Proactive Automation Manager)
const proactive = new ProactiveManager({
  sentinel,
  tools: refreshTools,
  callLLM,
  botRegistry,
  sessionStore,
  botMemory,
  onApprovalNeeded: async (request, routine) => {
    console.log(`⚠️ [Proactive] 例行任务触发审批需求: ${routine.name} (${request.approvalId})`);
    feedStore.recordActivity('user_web', {
      kind: 'approval',
      title: `待审批: ${routine.name}`,
      text: request.reason || '例行任务触发敏感操作，等待授权审批'
    });
    // 若配置了飞书通知目标，自动推送原生审批卡片
    const alertTarget = process.env.FEISHU_NOTIFY_USER_ID;
    if (alertTarget) {
      await feishuChannel.approvalBridge.pushApprovalCard(alertTarget, request);
    }
  },
  onRunCompleted: async (run, output) => {
    // 写入会话历史以便 Web 前端同步显示（归属到该巡检真正的执行 Bot）
    const routine = proactive.getRoutine(run.routineId);
    const session = getOrCreateSession(run.sessionId, routine?.agentId || 'muse');
    session.title = `[主动巡检] ${run.routineName}`;
    session.messages.push({ role: 'user', content: `[触发源: ${run.triggerSource}] 执行例行任务: ${run.routineName}` });
    session.messages.push({ role: 'assistant', content: output });

    feedStore.recordActivity('user_web', {
      kind: 'routine',
      title: `例行任务: ${run.routineName}`,
      text: run.quiet ? '未发现新异常 (NOTHING NEW)' : output.slice(0, 300),
      sessionId: run.sessionId,
      sessionTitle: session.title,
      quiet: run.quiet
    });

    // 定时任务执行产出精简展示到动态 (Feed)，并挂接直通完整执行会话的链接
    const shouldPublishToFeed = (routine?.feedPublish !== false) && !run.quiet && output && output.trim().length > 0;
    if (shouldPublishToFeed) {
      const cleanOutput = output.trim();
      let conciseBody = cleanOutput;
      if (conciseBody.length > 280) {
        conciseBody = conciseBody.slice(0, 260).trim() + '...\n\n*(内容较长，已自动精简展示，点击下方链接可查看完整会话过程与日志)*';
      }
      feedStore.appendPost('user_web', {
        title: `[定时播报] ${run.routineName}`,
        body: conciseBody,
        area: 'research',
        prompt: `针对本次【${run.routineName}】的执行结论进行深入分析`,
        sessionId: run.sessionId,
        routineId: run.routineId,
        routineName: run.routineName
      });
    }

    // 静默抑制 (Quiet When Green)：正常无异常时静默沉淀历史，不向飞书/如流骚扰推送
    if (run.quiet) {
      console.log(`[Proactive] 任务 [${run.routineName}] 运行正常 (NOTHING NEW)，静默沉淀，已抑制外部通知。`);
      return;
    }

    // 推送巡检简报到飞书
    const alertTarget = process.env.FEISHU_NOTIFY_USER_ID;
    if (alertTarget) {
      const summaryText = `📋 【MuseClaw 自动化巡检简报】${run.routineName}\n状态: ${run.status === 'success' ? '✅ 顺利完成' : '❌ 存在异常'}\n\n${output.slice(0, 450)}`;
      feishuChannel.sender.sendMessage(alertTarget, summaryText, 'text').catch(() => {});
    }
  }
});

// 5. 初始化长周期目标自驱推进引擎 (Long-Horizon Goals Engine)
const goalEngine = new GoalEngine({
  store: goalStore,
  sentinel,
  tools: refreshTools(),
  callLLM,
  botRegistry,
  botMemory,
  onGoalCheckInCompleted: async (result, goal) => {
    console.log(`[Goals:CheckIn] 目标 "${goal.title}" 阶段推进完成: 步骤 [${result.stepTitle || result.stepId}] -> ${result.status}`);
    feedStore.recordActivity('user_web', {
      kind: 'goal',
      title: `自驱目标推进: ${goal.title}`,
      text: `步骤 [${result.stepTitle || result.stepId}] 状态: ${result.status}`
    });
  }
});

/**
 * MuseClaw Gateway & Relay HTTP Server
 */
/**
 * React 前端的唯一托管目录：apps/web/dist（Vite 产物）。
 * 源码目录与旧静态页面不再作为回退，避免把未打包的 index.html 当成应用发出去。
 */
function resolveWebDist(): string | null {
  const dir = path.resolve(__dirname, '../../web/dist');
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}

/** 工具输出可能很长，落库前截断，避免会话文件膨胀 */
function clipToolOutput(value: unknown, max = 2000): unknown {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return value;
  if (text.length <= max) return value;
  return `${text.slice(0, max)}\n…（输出过长，已截断，共 ${text.length} 字符）`;
}

const WEB_NOT_BUILT_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>MuseClaw 前端尚未构建</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>body{font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#111;max-width:620px;margin:12vh auto;padding:0 24px}
code{font-family:ui-monospace,Menlo,Consolas,monospace;background:#f2f2f4;padding:2px 6px;border-radius:4px}
h1{font-size:20px;margin:0 0 8px}p{color:#555}</style></head>
<body><h1>前端还没有构建</h1>
<p>这个工作台由 React + Vite 构建，仓库里不带 dist 产物。在项目根目录运行：</p>
<p><code>pnpm --filter @museclaw/web build</code></p>
<p>然后刷新本页。</p></body></html>`;

const webhookRateLimit = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string, maxRequests = 60, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = webhookRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    webhookRateLimit.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count++;
  return true;
}

export function startGatewayServer(defaultPort = 8799) {
  const port = Number(process.env.PORT) || defaultPort;
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || `localhost:${port}`;
      const url = new URL(req.url || '/', `http://${host}`);

    // 对企业 IM Webhook 入口加限流保护
    if (url.pathname.startsWith('/api/channels/')) {
      const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
      if (!checkRateLimit(clientIp, 60, 60000)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Too Many Requests', code: 429 }));
      }
    }

    // A. 优先处理如流 Webhook (GET 校验 / POST 消息)
    const handledByInfoflow = await infoflowChannel.handleHttpRequest(req, res);
    if (handledByInfoflow) return;

    // A2. 优先处理飞书 Webhook (Challenge / 交互卡片按钮 / 消息事件)
    const handledByFeishu = await feishuChannel.handleHttpRequest(req, res);
    if (handledByFeishu) return;

    // A3. 解析当前请求的用户登录身份 (支持 Cookie 与 Authorization Bearer Token)
    const currentUser = authService.getCurrentUser(req);

    // A4. 账号认证相关接口 (注册 / 登录 / 退出 / 获取当前登录信息)
    if (req.method === 'GET' && (url.pathname === '/api/auth/me' || url.pathname === '/api/v1/loginUser')) {
      if (!currentUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, code: 401, error: 'Unauthorized' }));
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      });
      return res.end(JSON.stringify({
        ok: true,
        code: 200,
        data: currentUser,
        user: currentUser
      }));
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || '{}');
        const result = authService.register(data.username, data.password, data.displayName);
        const isHttps = req.headers['x-forwarded-proto']?.toString().includes('https') || (req.socket as any).encrypted;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': authService.createSessionCookie(result.token, Boolean(isHttps))
        });
        return res.end(JSON.stringify({
          ok: true,
          code: 200,
          data: result.user,
          user: result.user
        }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, code: 400, error: err.message || '注册失败' }));
      }
    }

    if (req.method === 'POST' && (url.pathname === '/api/auth/login' || url.pathname === '/api/v1/login')) {
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || '{}');
        const result = authService.login(data.username, data.password);
        const isHttps = req.headers['x-forwarded-proto']?.toString().includes('https') || (req.socket as any).encrypted;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': authService.createSessionCookie(result.token, Boolean(isHttps))
        });
        return res.end(JSON.stringify({
          ok: true,
          code: 200,
          data: result.user,
          user: result.user
        }));
      } catch (err: any) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, code: 401, error: err.message || '用户名或密码错误' }));
      }
    }

    if ((req.method === 'POST' || req.method === 'GET') && (url.pathname === '/api/auth/logout' || url.pathname === '/api/v1/logout')) {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies['museclaw_session']) {
        authService.logout(cookies['museclaw_session']);
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': authService.createClearCookie()
      });
      return res.end(JSON.stringify({ ok: true, message: 'Logged out successfully' }));
    }

    // A5. 业务 API 鉴权拦截保护
    const isPublicPath = [
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/v1/loginUser',
      '/api/v1/login',
      '/api/v1/logout',
      '/runner/client.js',
      '/runner/install.sh',
      '/api/runner/register',
      '/api/runner/poll',
      '/api/runner/machines'
    ].includes(url.pathname) ||
    url.pathname.startsWith('/runner') ||
    url.pathname === '/api/avatar' ||
    url.pathname.startsWith('/api/avatar/') ||
    url.pathname.startsWith('/api/files/avatar/') ||
    url.pathname.startsWith('/avatar-presets/') ||
    url.pathname === '/api/tasks' ||
    url.pathname === '/api/chat' ||
    url.pathname === '/api/channels/feishu/webhook' ||
    url.pathname === '/api/channels/infoflow/webhook' ||
    url.pathname.startsWith('/api/bots') ||
    (req.method === 'GET' && url.pathname === '/api/models/config') ||
    (req.method === 'GET' && url.pathname === '/api/models/local-agents');

    if (!currentUser && url.pathname.startsWith('/api/') && !isPublicPath) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized', code: 401 }));
    }

    // A5.1 飞书消息统一发送接口 (仅已登录用户可调用)
    if (req.method === 'POST' && (url.pathname === '/api/channels/feishu/send' || url.pathname === '/api/feishu/send')) {
      if (!currentUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        const content = payload.content;
        if (!content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: '消息内容 content 不能为空' }));
        }
        const result = await feishuChannel.sender.sendMessage(
          payload.receive_id,
          content,
          payload.msg_type || 'text',
          payload.receive_id_type,
          payload.title
        );
        res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message || String(err) }));
      }
    }

    // B. 静态主页：React 工作台（仅托管构建产物）
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      const webDist = resolveWebDist();
      if (!webDist) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(WEB_NOT_BUILT_PAGE);
      }
      try {
        const html = fs.readFileSync(path.join(webDist, 'index.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(html);
      } catch {
        res.writeHead(500);
        return res.end('Web UI not found');
      }
    }

    // B1. 通用图片与文件上传接口 (General File / Image Upload)
    if (req.method === 'POST' && (url.pathname === '/api/upload' || url.pathname === '/api/upload/image')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const { image, file, name, type: declaredType, ext: customExt } = JSON.parse(body || '{}');
        const rawData = image || file;
        if (!rawData || typeof rawData !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'File data is required' }));
        }

        let buffer: Buffer;
        let ext = customExt || '.bin';
        if (typeof declaredType === 'string' && declaredType.includes('/')) {
          const sub = declaredType.split('/')[1]?.split('+')[0];
          if (sub) ext = `.${sub === 'jpeg' ? 'jpg' : sub}`;
        }
        if (rawData.startsWith('data:')) {
          const matches = rawData.match(/^data:([a-zA-Z0-9+.\/-]+);base64,(.+)$/);
          if (matches) {
            const mime = matches[1].toLowerCase();
            if (mime.includes('png')) ext = '.png';
            else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
            else if (mime.includes('webp')) ext = '.webp';
            else if (mime.includes('gif')) ext = '.gif';
            else if (mime.includes('svg')) ext = '.svg';
            buffer = Buffer.from(matches[2], 'base64');
          } else {
            throw new Error('Invalid base64 data');
          }
        } else {
          buffer = Buffer.from(rawData, 'utf-8');
          ext = customExt || '.txt';
        }

        const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
        if (buffer.length > MAX_UPLOAD_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: '文件超过 12 MB，请压缩后再上传' }));
        }

        const safeName = (name || `upload_${Date.now()}`).replace(/[^\w.-]/g, '_');
        const finalExt = (path.extname(safeName) || ext).toLowerCase();
        // SVG 可内嵌脚本，作为独立页面打开时会执行，直接拒绝上传
        if (finalExt === '.svg') {
          res.writeHead(415, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: '出于安全考虑暂不支持 SVG，请导出为 PNG 后上传' }));
        }
        const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${finalExt}`;
        const uploadDir = path.resolve(__dirname, '../data/uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), buffer);

        const fileUrl = `/uploads/${filename}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, url: fileUrl, filename }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // B1.1 虚拟形象图片上传接口 (Avatar Upload)
    if (req.method === 'POST' && url.pathname === '/api/upload/avatar') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const { image } = JSON.parse(body || '{}');
        if (!image) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Image data is required' }));
        }

        let buffer: Buffer;
        let ext = '.png';
        if (image.startsWith('data:image/')) {
          const matches = image.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
          if (matches) {
            ext = `.${matches[1] === 'jpeg' ? 'jpg' : matches[1]}`;
            buffer = Buffer.from(matches[2], 'base64');
          } else {
            throw new Error('Invalid base64 image data');
          }
        } else {
          throw new Error('Unsupported image format');
        }

        const filename = `avatar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
        const uploadDir = path.resolve(__dirname, '../data/avatars/uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), buffer);

        const avatarUrl = `/avatars/uploads/${filename}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, url: avatarUrl }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // B1.2 形象工坊接口 (Avatar Studio)
    if (req.method === 'GET' && (url.pathname === '/api/avatar' || url.pathname === '/api/avatar/status' || url.pathname === '/api/avatar/view')) {
      const botId = url.searchParams.get('botId') || undefined;
      const ep = avatarStudio.getImageEndpointConfig();
      const face = avatarStudio.getFaceInfo(botId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        available: ep.available,
        unavailable: ep.available ? '' : '当前未配置图像生成模型服务商',
        unavailable_zh: ep.available ? '' : '当前未配置图像生成模型服务商',
        provider: ep.provider,
        image_model: ep.model,
        imageModel: ep.model,
        video_model: ep.videoModel,
        videoModel: ep.videoModel,
        cloud: ep.provider !== 'builtin-procedural',
        host: ep.provider,
        current: avatarStudio.getCurrentSession(),
        face: face,
        presets: avatarStudio.getPresets(),
        customFaces: avatarStudio.getCustomFaces()
      }));
    }

    if (req.method === 'GET' && url.pathname === '/api/avatar/presets') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(avatarStudio.getPresets()));
    }

    if (req.method === 'GET' && (url.pathname === '/api/avatar/custom' || url.pathname === '/api/avatar/history')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(avatarStudio.getCustomFaces()));
    }

    if (req.method === 'DELETE' && (url.pathname.startsWith('/api/avatar/custom/') || url.pathname.startsWith('/api/avatar/'))) {
      const faceId = url.pathname.replace(/^\/api\/avatar\/(custom\/)?/, '');
      const success = avatarStudio.deleteCustomFace(faceId);
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success, id: faceId }));
    }

    // B1.3 独立生图大模型配置接口 (Image Generation Model Providers API)
    if (req.method === 'GET' && url.pathname === '/api/avatar/models/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(globalImageModelStore.getPublicConfig()));
    }

    if (req.method === 'POST' && url.pathname === '/api/avatar/models/config') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        const result = globalImageModelStore.updateConfig(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/avatar/models/test') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        const result = await globalImageModelStore.testProvider(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/avatar/begin') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        const session = await avatarStudio.begin({
          description: payload.description || '',
          style: payload.style,
          thread: payload.thread,
          botId: payload.botId,
          reference: payload.reference
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(session));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/avatar/start') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        const sid = payload.session || payload.sessionId;
        const session = await avatarStudio.start(sid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(session));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/avatar/choose') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        if (payload.index === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'index is required' }));
        }
        const sid = payload.session || payload.sessionId;
        const session = await avatarStudio.choose(sid, payload.index, payload.botId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(session));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/avatar/cancel') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        const sid = payload.session || payload.sessionId;
        const session = avatarStudio.cancel(sid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(session));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/avatar/moods') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        const session = await avatarStudio.redrawMoods(payload.botId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(session));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // B2. 多 Bot 管理接口 (BotRegistry)
    if (req.method === 'GET' && url.pathname === '/api/bots') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(botRegistry.list()));
    }

    if (req.method === 'GET' && url.pathname.match(/^\/api\/bots\/[^/]+$/) && !url.pathname.endsWith('/sessions') && !url.pathname.endsWith('/memory')) {
      const id = url.pathname.replace('/api/bots/', '');
      const bot = botRegistry.get(id);
      if (!bot) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Bot [${id}] 不存在` }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(bot));
    }

    if (req.method === 'POST' && url.pathname === '/api/bots') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = safeJsonParse(body, {});
      if (!data.name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Bot name is required' }));
      }
      const created = botRegistry.create(data);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(created));
    }

    if ((req.method === 'PATCH' || req.method === 'PUT') && url.pathname.match(/^\/api\/bots\/[^/]+$/) && !url.pathname.endsWith('/sessions') && !url.pathname.endsWith('/memory')) {
      const id = url.pathname.replace('/api/bots/', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const patch = safeJsonParse(body, {});
      // 兼容前端 camelCase，落库统一用 snake_case
      if (patch.systemPrompt !== undefined && patch.system_prompt === undefined) {
        patch.system_prompt = patch.systemPrompt;
      }
      if (patch.role !== undefined && patch.description === undefined) {
        patch.description = patch.role;
      }
      if (patch.approvalMode !== undefined && patch.approval_level === undefined) {
        const map: Record<string, string> = { ASK: 'ask', AUTO_EDITS: 'auto_edits', FULL: 'full' };
        patch.approval_level = map[String(patch.approvalMode).toUpperCase()] || 'ask';
      }
      delete patch.systemPrompt;
      delete patch.approvalMode;
      delete patch.role;
      try {
        const updated = botRegistry.update(id, patch);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(updated));
      } catch (err: any) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/bots/') && url.pathname.endsWith('/sessions')) {
      const id = url.pathname.replace('/api/bots/', '').replace('/sessions', '');
      const sessions = sessionStore.list(id, currentUser?.username);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sessions));
    }

    if (req.method === 'POST' && (url.pathname.match(/^\/api\/bots\/[^/]+\/sessions$/) || url.pathname === '/api/sessions')) {
      let botId = '';
      if (url.pathname.startsWith('/api/bots/')) {
        botId = url.pathname.replace('/api/bots/', '').replace('/sessions', '');
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      let parsed: any = {};
      try { parsed = JSON.parse(body || '{}'); } catch {}
      botId = botId || parsed.botId || parsed.bot_id || 'muse';
      const isMain =
        parsed.kind === 'main' ||
        parsed.id?.endsWith('_main') ||
        parsed.id === 'main' ||
        parsed.title === '主要聊天';
      const targetUserId = currentUser ? currentUser.username : 'user_web';

      let session: Session;
      if (isMain) {
        // 主聊严格保持单例，不新增重复会话，直接获取或就绪唯一的常驻主聊
        session = sessionStore.getMainSession(botId, targetUserId);
      } else {
        const sessionId = parsed.id || `sess_${botId}_${Date.now()}`;
        const title = parsed.title && parsed.title !== '主要聊天' ? parsed.title : '新旁聊';
        session = sessionStore.create(sessionId, botId, title, targetUserId, 'side');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(session));
    }

    // 完整分层记忆视图 (GET /api/bots/:id/memory/full)
    if (req.method === 'GET' && url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/full$/)) {
      const id = url.pathname.split('/')[3] || 'muse';
      const targetUserId = currentUser?.username || 'user_web';
      botMemory.pruneExpiredMemories(id, targetUserId);
      const data = botMemory.getMemoryData(id, targetUserId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        bot_id: id,
        userId: targetUserId,
        memory: data.content,
        content: data.content,
        items: data.items,
        stats: data.stats,
        reports: data.reports,
        userProfile: {
          content: botMemory.getUserProfile(targetUserId),
          items: botMemory.getUserProfileItems(targetUserId)
        },
        topics: botMemory.listTopics(id, targetUserId),
        intents: botMemory.listIntents(id, targetUserId),
        ideas: memoryPipeline.getReflectionIdeas(id, targetUserId)
      }));
    }

    // 获取单个主题记忆详情 (GET /api/bots/:id/memory/topics/:slug)
    if (req.method === 'GET' && url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/topics\/[^/]+$/)) {
      const parts = url.pathname.split('/');
      const id = parts[3] || 'muse';
      const slug = decodeURIComponent(parts[6] || '');
      const targetUserId = currentUser?.username || 'user_web';
      const detail = botMemory.getTopic(id, slug, targetUserId);
      res.writeHead(detail ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(detail || { error: 'Topic not found' }));
    }

    // 跨会话反思 (POST /api/bots/:id/memory/reflect)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/reflect$/)) {
      const id = url.pathname.split('/')[3] || 'muse';
      const targetUserId = currentUser?.username || 'user_web';
      const bot = botRegistry.get(id);
      const caller = globalModelStore.getActiveCaller({ userId: targetUserId });
      const sessions = sessionStore.list(id, targetUserId, false);
      const result = await memoryPipeline.reflectAcrossSessions({
        botId: id,
        botName: bot?.name || id,
        userId: targetUserId,
        sessions,
        caller
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        bot_id: id,
        userId: targetUserId,
        ...result,
        ideas: memoryPipeline.getReflectionIdeas(id, targetUserId)
      }));
    }

    // 前瞻性事件意图管理 (POST / DELETE /api/bots/:id/memory/intents)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/intents$/)) {
      const id = url.pathname.split('/')[3] || 'muse';
      const targetUserId = currentUser?.username || 'user_web';
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = safeJsonParse(body, {});
      const result = botMemory.createIntent(
        id,
        {
          description: String(parsed.description || ''),
          triggers: Array.isArray(parsed.triggers)
            ? parsed.triggers
            : String(parsed.triggers || '').split(/[,，\s]+/).filter(Boolean),
          cooldownSeconds: typeof parsed.cooldownSeconds === 'number' ? parsed.cooldownSeconds : undefined,
          maxFires: typeof parsed.maxFires === 'number' ? parsed.maxFires : undefined
        },
        targetUserId
      );
      res.writeHead(result.success ? 201 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...result, intents: botMemory.listIntents(id, targetUserId) }));
    }

    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/intents\/[^/]+$/)) {
      const parts = url.pathname.split('/');
      const id = parts[3] || 'muse';
      const intentId = decodeURIComponent(parts[6] || '');
      const targetUserId = currentUser?.username || 'user_web';
      const result = botMemory.cancelIntent(id, intentId, targetUserId);
      res.writeHead(result.success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...result, intents: botMemory.listIntents(id, targetUserId) }));
    }

    // 反思建议状态更新 (POST /api/bots/:id/memory/ideas/:ideaId)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/ideas\/[^/]+$/)) {
      const parts = url.pathname.split('/');
      const id = parts[3] || 'muse';
      const ideaId = decodeURIComponent(parts[6] || '');
      const targetUserId = currentUser?.username || 'user_web';
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = safeJsonParse(body, {});
      const status = parsed.status === 'accepted' ? 'accepted' : 'dismissed';
      const result = memoryPipeline.updateReflectionIdeaStatus(id, targetUserId, ideaId, status);
      res.writeHead(result.success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // 获取指定 Bot 长期记忆、结构化事实与配额健康指标
    if (req.method === 'GET' && (
      (url.pathname.startsWith('/api/bots/') && url.pathname.endsWith('/memory')) ||
      (url.pathname.startsWith('/api/memory/') &&
        !url.pathname.includes('/items') &&
        !url.pathname.includes('/consolidate') &&
        !url.pathname.includes('/undo') &&
        !url.pathname.includes('/reports'))
    )) {
      let id = '';
      if (url.pathname.startsWith('/api/bots/')) {
        id = url.pathname.replace('/api/bots/', '').replace('/memory', '');
      } else {
        id = url.pathname.replace('/api/memory/', '').split('/')[0];
      }
      id = id || 'muse';
      const targetUserId = currentUser?.username || 'user_web';
      const data = botMemory.getMemoryData(id, targetUserId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        bot_id: id,
        userId: targetUserId,
        memory: data.content,
        content: data.content,
        items: data.items,
        stats: data.stats,
        reports: data.reports
      }));
    }

    // 全量更新指定 Bot 长期记忆 Markdown 文本
    if (req.method === 'PUT' && (
      (url.pathname.startsWith('/api/bots/') && url.pathname.endsWith('/memory')) ||
      (url.pathname.startsWith('/api/memory/') && !url.pathname.includes('/items'))
    )) {
      let id = '';
      if (url.pathname.startsWith('/api/bots/')) {
        id = url.pathname.replace('/api/bots/', '').replace('/memory', '');
      } else {
        id = url.pathname.replace('/api/memory/', '').split('/')[0];
      }
      id = id || 'muse';
      const targetUserId = currentUser?.username || 'user_web';
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = safeJsonParse(body, {});
        const memory = typeof parsed.memory === 'string' ? parsed.memory : (typeof parsed.content === 'string' ? parsed.content : '');
        botMemory.saveMemory(id, memory, targetUserId);
        const data = botMemory.getMemoryData(id, targetUserId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          bot_id: id,
          userId: targetUserId,
          memory: data.content,
          content: data.content,
          items: data.items,
          stats: data.stats
        }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 新增单条记忆事实 (POST /api/memory/:id/items 或 /api/bots/:id/memory/items)
    if (req.method === 'POST' && (
      url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/items$/) ||
      url.pathname.match(/^\/api\/memory\/[^/]+\/items$/)
    )) {
      const parts = url.pathname.split('/');
      const id = parts[2] === 'memory' ? parts[3] : parts[3];
      const targetUserId = currentUser?.username || 'user_web';
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = safeJsonParse(body, {});
        const content = typeof parsed.content === 'string' ? parsed.content : '';
        const category = parsed.category;
        const isUser = parsed.isUser;

        if (!content.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Field "content" is required and cannot be empty' }));
        }

        const result = botMemory.addMemoryItem(
          id,
          content,
          category,
          typeof isUser === 'boolean' ? isUser : true,
          targetUserId
        );

        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ bot_id: id, userId: targetUserId, ...result }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 编辑单条记忆事实 (PUT /api/memory/:id/items/:itemId 或 /api/bots/:id/memory/items/:itemId)
    if (req.method === 'PUT' && (
      url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/items\/[^/]+$/) ||
      url.pathname.match(/^\/api\/memory\/[^/]+\/items\/[^/]+$/)
    )) {
      const parts = url.pathname.split('/');
      const isBotsPath = parts[2] === 'bots';
      const id = parts[3];
      const itemId = isBotsPath ? parts[6] : parts[5];
      const targetUserId = currentUser?.username || 'user_web';
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { content, category } = safeJsonParse(body, {});

        const result = botMemory.updateMemoryItem(id, itemId, content, category, targetUserId);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ bot_id: id, userId: targetUserId, ...result }));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 删除单条记忆事实 (DELETE /api/memory/:id/items/:itemId 或 /api/bots/:id/memory/items/:itemId)
    if (req.method === 'DELETE' && (
      url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/items\/[^/]+$/) ||
      url.pathname.match(/^\/api\/memory\/[^/]+\/items\/[^/]+$/)
    )) {
      const parts = url.pathname.split('/');
      const isBotsPath = parts[2] === 'bots';
      const id = parts[3];
      const itemId = isBotsPath ? parts[6] : parts[5];
      const targetUserId = currentUser?.username || 'user_web';

      const result = botMemory.deleteMemoryItem(id, itemId, targetUserId, true);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ bot_id: id, userId: targetUserId, ...result }));
    }

    // 记忆受控自整理 (Memory Consolidation)
    if (req.method === 'POST' && (
      url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/consolidate$/) ||
      url.pathname.match(/^\/api\/memory\/[^/]+\/consolidate$/)
    )) {
      const parts = url.pathname.split('/');
      const id = parts[2] === 'memory' ? parts[3] : parts[3];
      const targetUserId = currentUser?.username || 'user_web';
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { dry_run, budget_share, dryRun } = safeJsonParse(body, {});

        const report = await botMemory.consolidateMemory(
          id,
          async (prompt) => {
            const resp = await callLLM([{ role: 'user', content: prompt }], []);
            return resp.content || '';
          },
          { dryRun: Boolean(dry_run || dryRun), budgetShare: typeof budget_share === 'number' ? budget_share : 0.2 },
          targetUserId
        );
        const data = botMemory.getMemoryData(id, targetUserId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          bot_id: id,
          userId: targetUserId,
          report,
          summary: report.summary,
          stats: data.stats
        }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 记忆整理一键撤销 (Memory Consolidation Undo)
    if (req.method === 'POST' && (
      url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/undo$/) ||
      url.pathname.match(/^\/api\/memory\/[^/]+\/undo$/)
    )) {
      const parts = url.pathname.split('/');
      const id = parts[2] === 'memory' ? parts[3] : parts[3];
      const targetUserId = currentUser?.username || 'user_web';
      const result = botMemory.undoLastConsolidation(id, targetUserId);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ bot_id: id, userId: targetUserId, ...result }));
    }

    // 获取记忆整理历史审计报告
    if (req.method === 'GET' && (
      url.pathname.match(/^\/api\/bots\/[^/]+\/memory\/reports$/) ||
      url.pathname.match(/^\/api\/memory\/[^/]+\/reports$/)
    )) {
      const parts = url.pathname.split('/');
      const id = parts[2] === 'memory' ? parts[3] : parts[3];
      const targetUserId = currentUser?.username || 'user_web';
      const reports = botMemory.getConsolidationHistory(id, targetUserId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ bot_id: id, userId: targetUserId, reports }));
    }

    // B3. 对外独立 Bot API (Headless Bot API: POST /api/bots/:id/chat)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/bots\/[^/]+\/chat$/)) {
      const botId = url.pathname.split('/')[3];
      const bot = botRegistry.get(botId);
      if (!bot || !bot.enabled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Bot [${botId}] not found or disabled` }));
      }

      let body = '';
      for await (const chunk of req) body += chunk;
      const { message, session_id } = JSON.parse(body || '{}');
      if (!message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Field "message" is required' }));
      }

      const targetSessionId = session_id || `api_${botId}_${Date.now()}`;
      const apiUserId = currentUser?.username || 'external_api';
      const session = sessionStore.create(targetSessionId, bot.id, `[API] ${message.slice(0, 16)}`, apiUserId);

      const botWithMemory: AgentProfile = {
        ...bot,
        memory: botMemory.getMemory(bot.id, apiUserId)
      };

      const loop = runAgentLoop(
        bot.system_prompt || '你是一个企业内部严谨、高效的自动化数字员工。',
        resolveSkillPrompt(message),
        refreshTools(),
        sentinel,
        callLLM,
        { sessionId: session.id, userId: apiUserId, botId: bot.id, profile: botWithMemory, maxSteps: 15, skills: getBotSkills(bot.id) }
      );

      let output = '';
      let needsApproval = false;
      let pendingApprovalReq: ApprovalRequest | null = null;
      const toolCalls: Array<Record<string, unknown>> = [];

      for await (const event of loop) {
        if (event.type === 'stream:text-delta') {
          output += event.text;
        }
        if (event.type === 'tool:call_start') {
          toolCalls.push({
            tool: event.toolName,
            params: event.input,
            status: 'running',
            startedAt: Date.now()
          });
        }
        if (event.type === 'tool:call_end') {
          const running = [...toolCalls]
            .reverse()
            .find((t) => t.tool === event.toolName && t.status === 'running');
          if (running) {
            const rejected = String(event.output || '').includes('拒绝');
            let isError = rejected;
            if (typeof event.output === 'object' && event.output !== null) {
              const outObj = event.output as any;
              if (outObj.error || (outObj.exitCode !== undefined && outObj.exitCode !== 0)) {
                isError = true;
              }
            }
            running.status = isError ? (rejected ? 'rejected' : 'failed') : 'done';
            running.ok = !isError;
            running.durationMs = event.durationMs || 0;
            running.result = clipToolOutput(event.output);
          }
        }
        if (event.type === 'sentinel:approval_needed') {
          needsApproval = true;
          pendingApprovalReq = event.request;
          const alertTarget = process.env.FEISHU_NOTIFY_USER_ID;
          if (alertTarget) {
            feishuChannel.approvalBridge.pushApprovalCard(alertTarget, event.request).catch(() => {});
          }
        }
      }

      if (session.messages) {
        session.messages.push({ role: 'user', content: message });
        if (output || toolCalls.length > 0) {
          for (const tc of toolCalls) {
            if (tc.status === 'running') {
              tc.status = 'done';
              tc.durationMs = tc.durationMs || (Date.now() - (Number(tc.startedAt) || Date.now()));
            }
          }
          session.messages.push({
            role: 'assistant',
            content: output,
            ...(toolCalls.length ? { toolCalls } : {})
          });
        }
        sessionStore.save(session, apiUserId);
      }

      if (needsApproval && pendingApprovalReq) {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: 'needs_approval',
          approval_id: pendingApprovalReq.approvalId,
          action_summary: pendingApprovalReq.actionSummary,
          session_id: session.id,
          bot_id: bot.id,
          message: '操作涉及高危动作，已被 Sentinel 拦截并推送到管理员审批通道'
        }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'completed',
        reply: output || '任务已顺利执行完毕。',
        session_id: session.id,
        bot_id: bot.id
      }));
    }

    // B4. 交付工件与产出物接口 (Artifacts Delivery)
    const artifactsDir = path.resolve(__dirname, '../data/artifacts');
    if (req.method === 'GET' && url.pathname === '/api/artifacts') {
      if (!fs.existsSync(artifactsDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([]));
      }
      const files = fs.readdirSync(artifactsDir).map((file) => {
        const stat = fs.statSync(path.join(artifactsDir, file));
        return {
          id: file,
          title: file,
          name: file,
          filename: file,
          path: `/api/artifacts/${file}`,
          sizeBytes: stat.size,
          size: stat.size,
          createdAt: stat.birthtimeMs || stat.mtimeMs,
          updatedAt: stat.mtimeMs,
          url: `/api/artifacts/${encodeURIComponent(file)}`,
          previewUrl: `/api/artifacts/${encodeURIComponent(file)}`
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(files));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/artifacts/')) {
      const filename = path.basename(decodeURIComponent(url.pathname.replace('/api/artifacts/', '')));
      const filePath = path.join(artifactsDir, filename);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Artifact not found' }));
      }
      const content = fs.readFileSync(filePath);
      const lower = filename.toLowerCase();
      const isText =
        lower.endsWith('.txt') ||
        lower.endsWith('.md') ||
        lower.endsWith('.json') ||
        lower.endsWith('.csv') ||
        lower.endsWith('.html') ||
        lower.endsWith('.htm') ||
        lower.endsWith('.svg');
      res.writeHead(200, {
        'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/octet-stream',
        'Content-Disposition': `inline; filename="${filename}"`,
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(content);
    }

    // B5. 标准 MCP 工具生态管理接口 (Model Context Protocol)
    if (req.method === 'GET' && url.pathname === '/api/mcp/servers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        servers: mcpManager.listServers(),
        totalTools: mcpManager.getToolDefinitions().length
      }));
    }

    if (req.method === 'POST' && url.pathname === '/api/mcp/servers') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { name, command, args, env } = JSON.parse(body || '{}');
      if (!name || !command) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Fields "name" and "command" are required' }));
      }
      try {
        await mcpManager.addServer(name, { command, args, env });
        refreshTools();
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          name,
          servers: mcpManager.listServers()
        }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/mcp/servers/')) {
      const name = url.pathname.replace('/api/mcp/servers/', '');
      const success = await mcpManager.removeServer(name);
      refreshTools();
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success }));
    }

    // ==========================================
    // B5.1 连接器管理体系 (Connectors Hub)
    // ==========================================
    if (req.method === 'GET' && url.pathname === '/api/connectors') {
      const all = connectorManager.listAll();
      const connectedCount = all.filter((c) => c.status === 'connected').length;
      const totalTools = all.reduce((sum, c) => sum + (c.tools?.length || 0), 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        connectors: all,
        total: all.length,
        connectedCount,
        totalTools
      }));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/connectors/')) {
      const id = url.pathname.replace('/api/connectors/', '');
      const item = connectorManager.get(id);
      if (!item) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `连接器 [${id}] 未找到` }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ connector: item }));
    }

    if (req.method === 'POST' && url.pathname === '/api/connectors/connect') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || '{}');
      if (!payload.id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '字段 "id" 必填' }));
      }
      try {
        const connectedItem = await connectorManager.connect(payload.id, payload);
        refreshTools();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, connector: connectedItem }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/connectors/disconnect') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { id } = JSON.parse(body || '{}');
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '字段 "id" 必填' }));
      }
      const success = await connectorManager.disconnect(id);
      refreshTools();
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success }));
    }

    if (req.method === 'POST' && url.pathname === '/api/connectors/test') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { id } = JSON.parse(body || '{}');
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '字段 "id" 必填' }));
      }
      const result = await connectorManager.test(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    if (req.method === 'POST' && url.pathname === '/api/connectors/tools/toggle') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { id, toolName, enabled } = JSON.parse(body || '{}');
      if (!id || !toolName || enabled === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '字段 "id", "toolName" 与 "enabled" 必填' }));
      }
      const success = connectorManager.toggleTool(id, toolName, Boolean(enabled));
      refreshTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success }));
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/connectors/')) {
      const id = url.pathname.replace('/api/connectors/', '');
      const success = await connectorManager.remove(id);
      refreshTools();
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success }));
    }

    // ==========================================
    // B6. Agent Skills 技能生态与规程库接口 (Skills Ecosystem)
    // ==========================================
    if (req.method === 'GET' && url.pathname === '/api/skills') {
      const botId = url.searchParams.get('botId') || url.searchParams.get('bot_id') || undefined;
      const query = url.searchParams.get('q') || url.searchParams.get('query') || undefined;
      const category = url.searchParams.get('category') || undefined;
      const channel = url.searchParams.get('channel') || undefined;
      const tag = url.searchParams.get('tag') || undefined;
      const source = url.searchParams.get('source') || undefined;
      const readiness = url.searchParams.get('readiness') || undefined;
      const lifecycle = (url.searchParams.get('lifecycle') || undefined) as any;
      const includeArchived = url.searchParams.get('includeArchived') === 'true';
      const enabledOnly = url.searchParams.get('enabled') === 'true';

      const skills = globalSkillStore.list({
        botId,
        query,
        category,
        channel,
        tag,
        source,
        readiness,
        lifecycle,
        includeArchived,
        enabledOnly
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ skills, total: skills.length }));
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/refresh-readiness') {
      const skills = globalSkillStore.refreshReadiness();
      refreshTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ skills, total: skills.length }));
    }

    if (req.method === 'GET' && url.pathname === '/api/skills/env') {
      const env = globalSkillStore.getEnvOverview();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ env }));
    }

    if (req.method === 'PUT' && url.pathname === '/api/skills/env') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || '{}');
      const vars = payload?.vars && typeof payload.vars === 'object' ? payload.vars : payload;
      const result = globalSkillStore.updateEnvVars(vars || {});
      refreshTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, ...result }));
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/preview-import') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { text, url: targetUrl } = JSON.parse(body || '{}');

      let skillText = typeof text === 'string' ? text : '';
      if (!skillText && typeof targetUrl === 'string' && targetUrl.trim()) {
        const fetched = await globalSkillStore.fetchSkillTextFromUrl(targetUrl.trim());
        if (!fetched.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ valid: false, error: fetched.error }));
        }
        skillText = fetched.text;
      }

      if (!skillText.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ valid: false, error: '请提供 SKILL.md 文本内容或有效的 URL' }));
      }

      const preview = globalSkillStore.previewImportFromText(skillText, 'imported');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(preview));
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/import-url') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { url: targetUrl, force } = JSON.parse(body || '{}');
      if (!targetUrl || typeof targetUrl !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '请提供有效的技能 URL' }));
      }
      const result = await globalSkillStore.importFromUrl(targetUrl, { force: Boolean(force) });
      if (!result.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: result.error, preview: result.preview }));
      }
      refreshTools();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, skill: result.skill }));
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/import') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { text, force } = JSON.parse(body || '{}');
      if (!text || typeof text !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '字段 text 不能为空 (必须包含标准的 SKILL.md 格式文本)' }));
      }
      const result = globalSkillStore.importFromText(text, { source: 'imported', force: Boolean(force) });
      if (!result.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: result.error, security: result.security }));
      }
      refreshTools();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, skill: result.skill }));
    }

    if (req.method === 'POST' && url.pathname === '/api/skills/upload-zip') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      let rawBuffer = Buffer.concat(chunks);

      const contentType = req.headers['content-type'] || '';
      let force = url.searchParams.get('force') === 'true';
      if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(rawBuffer.toString('utf-8'));
          if (json.base64) {
            rawBuffer = Buffer.from(json.base64.replace(/^data:.*?;base64,/, ''), 'base64');
          }
          if (json.force !== undefined) force = Boolean(json.force);
        } catch {}
      }

      if (!rawBuffer || rawBuffer.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '上传的 ZIP 压缩包数据为空' }));
      }

      const result = await globalSkillStore.importFromZip(rawBuffer, { source: 'imported', force });
      if (!result.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: result.error }));
      }
      refreshTools();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, skill: result.skill }));
    }

    if (req.method === 'POST' && url.pathname === '/api/skills') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      if (!data.name || !data.description) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '技能名称 (name) 与描述 (description) 为必填项' }));
      }
      const result = globalSkillStore.save(data);
      if (!result.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: result.error }));
      }
      refreshTools();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, skill: result.skill }));
    }

    if (req.method === 'POST' && url.pathname.match(/^\/api\/skills\/[^/]+\/reset-builtin$/)) {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const result = globalSkillStore.resetBuiltinOverride(name);
      if (!result.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: result.error }));
      }
      refreshTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, skill: result.skill }));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/skills/')) {
      const subPath = decodeURIComponent(url.pathname.replace('/api/skills/', ''));

      // 导出下载 ZIP 完整压缩包 (包含 SKILL.md, scripts/, references/, assets/ 等)
      if (subPath.endsWith('/export-zip')) {
        const name = subPath.replace(/\/export-zip$/, '');
        const zipBuffer = await globalSkillStore.exportAsZip(name);
        if (!zipBuffer) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `未找到技能 "${name}"` }));
        }
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${name}.zip"`
        });
        return res.end(zipBuffer);
      }

      // 导出下载单个 SKILL.md
      if (subPath.endsWith('/export')) {
        const name = subPath.replace(/\/export$/, '');
        const content = globalSkillStore.exportSkill(name);
        if (!content) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `未找到技能 "${name}"` }));
        }
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}.skill.md"`
        });
        return res.end(content);
      }

      // 获取技能包内全部文件清单
      if (subPath.endsWith('/files')) {
        const name = subPath.replace(/\/files$/, '');
        const skill = globalSkillStore.get(name);
        if (!skill) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `未找到技能 "${name}"` }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ files: skill.files || [] }));
      }

      // 获取技能包内具体文件的内容
      if (subPath.endsWith('/file')) {
        const name = subPath.replace(/\/file$/, '');
        const filePath = url.searchParams.get('path');
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: '缺少 path 参数' }));
        }
        const resData = globalSkillStore.getFileContent(name, filePath);
        res.writeHead(resData.success ? 200 : 404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(resData));
      }

      const name = subPath;
      const skill = globalSkillStore.get(name);
      if (!skill) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `未找到技能 "${name}"` }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ skill }));
    }

    // 技能包内部文件写与删接口

    if (req.method === 'POST' && url.pathname.match(/^\/api\/skills\/[^/]+\/file$/)) {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      let body = '';
      for await (const chunk of req) body += chunk;
      const { path: filePath, content } = JSON.parse(body || '{}');
      if (!filePath || content === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '参数 path 与 content 不能为空' }));
      }
      const resData = globalSkillStore.saveFile(name, filePath, content);
      refreshTools();
      res.writeHead(resData.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(resData));
    }

    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/skills\/[^/]+\/file$/)) {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '缺少 path 参数' }));
      }
      const resData = globalSkillStore.deleteFile(name, filePath);
      refreshTools();
      res.writeHead(resData.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(resData));
    }

    if (req.method === 'PUT' && url.pathname.startsWith('/api/skills/')) {
      const name = decodeURIComponent(url.pathname.replace('/api/skills/', ''));
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      const result = globalSkillStore.save({ ...data, name });
      if (!result.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: result.error }));
      }
      refreshTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, skill: result.skill }));
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/skills/')) {
      const name = decodeURIComponent(url.pathname.replace('/api/skills/', ''));
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');

      const existing = globalSkillStore.get(name);
      if (!existing) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `未找到技能 "${name}"` }));
      }

      if (data.enabled !== undefined) {
        globalSkillStore.toggle(name, Boolean(data.enabled));
      }
      if (data.everyBot !== undefined) {
        globalSkillStore.setEveryBot(name, Boolean(data.everyBot));
      }
      if (Array.isArray(data.assignedBots)) {
        globalSkillStore.assignBots(name, data.assignedBots);
      }
      if (data.pinned !== undefined) {
        globalSkillStore.setPinned(name, Boolean(data.pinned));
      }
      if (data.lifecycleState === 'active' || data.lifecycleState === 'archived') {
        const lcRes = globalSkillStore.setLifecycle(name, data.lifecycleState);
        if (!lcRes.success) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: lcRes.error }));
        }
      }

      const updated = globalSkillStore.get(name);
      refreshTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, skill: updated }));
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/skills/')) {
      const name = decodeURIComponent(url.pathname.replace('/api/skills/', ''));
      const result = globalSkillStore.remove(name);
      if (!result.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: result.error }));
      }
      refreshTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, name }));
    }

    if (req.method === 'POST' && url.pathname.match(/^\/api\/skills\/[^/]+\/test$/)) {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const skill = globalSkillStore.get(name);
      if (!skill) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `未找到技能 "${name}"` }));
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const { input, botId } = JSON.parse(body || '{}');
      const testInput = String(input || '').trim() || '请按本技能规程执行一次基础自检或演示核心流程，并给出结果摘要。';

      try {
        globalSkillStore.recordUsage(skill.name, 'view');
        const targetBot = (botId ? botRegistry.get(botId) : null) || botRegistry.getCoordinator() || botRegistry.list()[0];
        const effectiveBotId = targetBot?.id || 'skill_sandbox';
        const effectiveUserId = currentUser?.username || 'skill_tester';
        const testSessionId = `skill_test_${skill.name}_${Date.now()}`;
        const instructions = globalSkillStore.getSkillInstructions(skill.name) || skill.body || skill.content;

        const scopedCaller: LLMCaller = async (msgs, tls, onChunk) => {
          const active = globalModelStore.getActiveCaller({ userId: effectiveUserId });
          return active(msgs, tls, onChunk);
        };

        // 试运行哨兵：复用正常风控规则，遇到需人工审批的高危动作直接返回拒绝以避免 HTTP 请求挂死
        const testSentinel: SentinelHook = {
          evaluateToolCall: (tName, args, ctx) => sentinel.evaluateToolCall(tName, args, ctx as any),
          waitForApproval: async () => false,
          isSessionTainted: (sid) => sentinel.isSessionTainted(sid),
          taintSession: (sid, reason) => sentinel.taintSession(sid, reason),
          untaintSession: (sid) => sentinel.untaintSession(sid),
          isTaintSource: (tName, args, out) => sentinel.isTaintSource(tName, args, out),
          isEgressAction: (tName, args) => sentinel.isEgressAction(tName, args)
        };

        const goalPrompt = `[技能沙箱试运行模式]\n[已激活技能规程: ${skill.name}]\n${instructions}\n\n[测试任务指令]:\n${testInput}\n\n请严格依据上述规程真实调用必要工具完成任务（如遇受阻或缺失依赖请如实说明），并输出清晰的执行结果。`;
        const startedAt = Date.now();
        const loop = runAgentLoop(
          targetBot?.system_prompt || '你是一个严谨的数字员工技能评测执行器。请按规程真实执行并报告结果。',
          goalPrompt,
          refreshTools(),
          testSentinel,
          scopedCaller,
          {
            sessionId: testSessionId,
            userId: effectiveUserId,
            botId: effectiveBotId,
            profile: targetBot || undefined,
            maxSteps: 6,
            skills: getBotSkills(effectiveBotId)
          }
        );

        let output = '';
        let steps = 0;
        const toolCalls: Array<Record<string, unknown>> = [];

        for await (const event of loop) {
          if (event.type === 'stream:text-delta') {
            output += event.text;
          } else if (event.type === 'ui:widget') {
            output += formatWidgetFallbackText(event.widget);
          } else if (event.type === 'tool:call_start') {
            steps++;
            toolCalls.push({
              tool: event.toolName,
              params: event.input,
              status: 'running',
              startedAt: Date.now()
            });
          } else if (event.type === 'tool:call_end') {
            const running = [...toolCalls]
              .reverse()
              .find((t) => t.tool === event.toolName && t.status === 'running');
            if (running) {
              const rejected = String(event.output || '').includes('拒绝');
              let isError = rejected;
              if (typeof event.output === 'object' && event.output !== null) {
                const outObj = event.output as any;
                if (outObj.error || (outObj.exitCode !== undefined && outObj.exitCode !== 0)) {
                  isError = true;
                }
              }
              running.status = isError ? (rejected ? 'rejected' : 'failed') : 'done';
              running.ok = !isError;
              running.durationMs = event.durationMs || 0;
              running.result = clipToolOutput(event.output);
            }
          }
        }

        for (const tc of toolCalls) {
          if (tc.status === 'running') {
            tc.status = 'done';
            tc.ok = true;
          }
        }

        const durationMs = Date.now() - startedAt;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: true,
            skill: skill.name,
            input: testInput,
            output: output.trim() || '规程试运行完成，未产生额外文本输出。',
            toolCalls,
            steps,
            durationMs,
            readiness: skill.readiness
          })
        );
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `技能试运行失败: ${err.message}` }));
      }
    }

    // C. 会话列表接口 (按当前登录员工隔离，支持主聊置顶与旁聊管理)
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const botIdParam = url.searchParams.get('bot_id') || url.searchParams.get('botId') || undefined;
      const includeEmpty = url.searchParams.get('include_empty') !== 'false';
      const targetUserId = currentUser ? currentUser.username : 'user_web';

      // 当为前端工作台查询特定 Bot 且允许空会话时，自动就绪该 Bot 的常驻主聊单例
      if (botIdParam && includeEmpty) {
        sessionStore.getMainSession(botIdParam, targetUserId);
      }

      const list = sessionStore.list(botIdParam, targetUserId, includeEmpty).map((s) => {
        const isCanonicalMain =
          s.id === `sess_${s.bot_id || s.botId}_main` ||
          s.id.endsWith('_main') ||
          s.id === 'main';

        return {
          id: s.id,
          title: isCanonicalMain ? '主要聊天' : (s.title === '主要聊天' ? '历史旁聊' : s.title),
          kind: isCanonicalMain ? 'main' : 'side',
          botId: s.bot_id || s.botId,
          bot_id: s.bot_id || s.botId,
          userId: s.userId,
          createdAt: s.created_at || (s as any).createdAt,
          updatedAt: s.updated_at || (s as any).updatedAt,
          messageCount: s.messages ? s.messages.length : 0,
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(list));
    }

    // 会话内容清空接口 (针对常驻主聊清空或普通会话重置)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/sessions\/[^/]+\/clear$/)) {
      const id = url.pathname.replace('/api/sessions/', '').replace('/clear', '');
      const targetUserId = currentUser ? currentUser.username : 'user_web';
      const success = sessionStore.clear(id, targetUserId);
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success, id, cleared: true }));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
      let id = url.pathname.replace('/api/sessions/', '');
      const isMessagesRequest = id.endsWith('/messages');
      if (isMessagesRequest) {
        id = id.replace(/\/messages$/, '');
      }
      const targetUserId = currentUser ? currentUser.username : 'user_web';
      let s = sessionStore.get(id, targetUserId);
      const isMain = id.endsWith('_main') || id === 'main';
      const botId = id.startsWith('sess_') ? (id.split('_')[1] || 'muse') : 'muse';

      if (!s && isMain) {
        s = sessionStore.getMainSession(botId, targetUserId);
      }

      if (!s) {
        if (isMessagesRequest) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify([]));
        }
        const fallbackSession = {
          id,
          title: isMain ? '主要聊天' : '新任务对话',
          kind: isMain ? 'main' : 'side',
          botId,
          bot_id: botId,
          userId: targetUserId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: []
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(fallbackSession));
      }
      const output = {
        ...s,
        kind: isMain || s.kind === 'main' ? 'main' : 'side',
        title: isMain ? '主要聊天' : s.title
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(isMessagesRequest ? (s.messages || []) : output));
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
      const id = url.pathname.replace('/api/sessions/', '');
      const targetUserId = currentUser ? currentUser.username : 'user_web';
      const existing = sessionStore.get(id, targetUserId);
      const isMain = Boolean(existing && (existing.kind === 'main' || existing.id.endsWith('_main') || existing.id === 'main'));
      const success = sessionStore.delete(id, targetUserId);
      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success,
        id,
        cleared: isMain,
        isMain,
        message: isMain ? '主聊为常驻核心会话，已重置清空历史消息' : '旁聊已删除'
      }));
    }

    // C2. 沙箱与技能阶梯状态接口 (Sandbox & Channel Ladder Status)
    if (req.method === 'GET' && url.pathname === '/api/sandbox/status') {
      const msb = new MicroSandbox();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        microSandbox: msb.getStatus(),
        channelLadder: {
          channels: CHANNEL_RANK,
          details: CHANNEL_DETAILS
        }
      }));
    }

    if (req.method === 'GET' && url.pathname.match(/^\/api\/sessions\/[^/]+\/ladder$/)) {
      const targetSessionId = url.pathname.split('/')[2]; // /api/sessions/:id/ladder -> index 3
      const actualSessionId = url.pathname.replace('/api/sessions/', '').replace('/ladder', '');
      const stats = sentinel.getChannelLadder().getSessionStats(actualSessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stats));
    }

    // D. 审批结果回调接口 (供 Web 交互卡片或外部 Webhook 点击调用，支持 scope: once | session | 24h | always)
    if (req.method === 'POST' && url.pathname.startsWith('/api/approvals/')) {
      if (!currentUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Unauthorized', code: 401 }));
      }
      const approvalId = url.pathname.replace('/api/approvals/', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const { approved, scope } = JSON.parse(body || '{}');

      // 操作人严格绑定当前已登录用户
      const operator = currentUser.username;
      const success = sentinel.resolveApproval(approvalId, Boolean(approved), scope || 'once', operator);

      // 持久化审批决策到对应会话消息
      if (success) {
        try {
          const sessions = sessionStore.list(undefined, currentUser.username, true);
          for (const s of sessions) {
            let matched = false;
            for (const m of (s.messages || [])) {
              if (m.approvalRequest && m.approvalRequest.actionId === approvalId) {
                m.approvalRequest.status = approved ? 'approved' : 'rejected';
                m.approvalRequest.decidedBy = operator;
                m.approvalRequest.decidedAt = Date.now();
                matched = true;
              }
            }
            if (matched) {
              sessionStore.save(s, currentUser.username);
              break;
            }
          }
        } catch (e) {
          console.warn('[Approval] Failed to persist approval state in session:', e);
        }
      }

      res.writeHead(success ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success, approvalId, approved, scope: scope || 'once', operator }));
    }

    // D1. 结构化审计日志接口 (Audit Trail)
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      const sessionId = url.searchParams.get('sessionId') || undefined;
      const limit = Number(url.searchParams.get('limit')) || 50;
      const logs = sentinel.getAuditLog().query({ sessionId, limit });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(logs));
    }

    // D1.2 复用授权管理接口 (Grants)
    if (req.method === 'GET' && url.pathname === '/api/grants') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sentinel.getGrantStore().list()));
    }

    if ((req.method === 'DELETE' || (req.method === 'POST' && url.pathname.endsWith('/revoke'))) && url.pathname.startsWith('/api/grants/')) {
      const grantId = url.pathname.replace('/api/grants/', '').replace('/revoke', '');
      const revoked = sentinel.getGrantStore().revoke(grantId);
      res.writeHead(revoked ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: revoked, grantId }));
    }

    // D1.3 声明式外部安全策略接口 (Policy)
    if (req.method === 'GET' && url.pathname === '/api/policy') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sentinel.getPolicyConfig()));
    }

    if (req.method === 'POST' && url.pathname === '/api/policy/reload') {
      sentinel.loadPolicy();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, policy: sentinel.getPolicyConfig() }));
    }

    // D1.4 AI 大模型提供商与服务接入接口 (AI Model Providers API)
    if (req.method === 'GET' && url.pathname === '/api/models/config') {
      const config = await globalModelStore.getPublicConfig(currentUser?.username);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(config));
    }

    if (req.method === 'GET' && url.pathname === '/api/models/local-agents') {
      const agents = await probeLocalAgents();
      const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents(currentUser?.username);
      const allAgents = Array.from(new Set([...agents, ...remoteAgents]));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, agents: allAgents }));
    }

    if (req.method === 'POST' && url.pathname === '/api/models/config') {
      if (!currentUser) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Unauthorized', code: 401 }));
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      const result = globalModelStore.updateConfig(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    if (req.method === 'POST' && url.pathname === '/api/models/test') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      if (currentUser?.username && !data.userId) {
        data.userId = currentUser.username;
      }
      const result = await globalModelStore.testProvider(data);
      const isSuccess = Boolean(result.ok);
      const responsePayload = {
        ok: isSuccess,
        success: isSuccess,
        latencyMs: result.latencyMs,
        latency: result.latencyMs,
        model: result.model,
        error: result.error,
        message: result.error || (isSuccess ? '连通性测试通过' : '连接超时或未响应')
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(responsePayload));
    }

    if (req.method === 'GET' && url.pathname === '/api/models/ollama/probe') {
      const probeUrl = url.searchParams.get('url') || undefined;
      const result = await globalModelStore.probeOllama(probeUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    if (req.method === 'POST' && url.pathname === '/api/models/fetch-models') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      const result = await globalModelStore.fetchModelsForProvider(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // D1.5 远程计算节点 Mesh 伴侣接口 (Remote Runner Mesh API)
    if (req.method === 'GET' && url.pathname === '/api/runner/machines') {
      const targetUserId = currentUser ? currentUser.username : undefined;
      const machines = globalRunnerMesh.listMachines(targetUserId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, machines }));
    }

    if (req.method === 'GET' && url.pathname === '/api/multica/status') {
      const status = globalMulticaBridge.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, multica: status }));
    }

    if (req.method === 'POST' && url.pathname === '/api/runner/register') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
      const result = globalRunnerMesh.registerMachine({ ...data, ip });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    if (req.method === 'POST' && url.pathname === '/api/runner/poll') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      const machineId = data.machineId || req.headers['x-runner-machine-id']?.toString();
      if (!machineId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing machineId' }));
      }
      const existing = globalRunnerMesh.getMachine(machineId);
      if (!existing) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ needRegister: true }));
      }
      if (data.token && (!existing.userId || existing.userId === 'default-mesh-token')) {
        existing.userId = data.token.trim();
        existing.token = data.token.trim();
      }
      const task = await globalRunnerMesh.pollTask(machineId, 25000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(task || { hasTask: false }));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/runner/tasks/') && url.pathname.endsWith('/stream')) {
      const taskId = url.pathname.replace('/api/runner/tasks/', '').replace('/stream', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      globalRunnerMesh.streamTaskChunk(taskId, data.chunk || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/runner/tasks/') && url.pathname.endsWith('/complete')) {
      const taskId = url.pathname.replace('/api/runner/tasks/', '').replace('/complete', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');
      globalRunnerMesh.completeTask(taskId, data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'GET' && url.pathname === '/runner/install.sh') {
      const host = req.headers.host || 'localhost:8799';
      const defaultToken = url.searchParams.get('token') || currentUser?.username || '';
      const proto = req.headers['x-forwarded-proto']?.toString().split(',')[0].trim() || 'http';
      const script = `#!/usr/bin/env bash
set -e
# MuseClaw Remote Mesh Runner 一键接入守护脚本
SERVER_URL="\${MUSECLAW_SERVER_URL:-${proto}://${host}}"
TOKEN="\${MUSECLAW_TOKEN:-${defaultToken}}"
INSTALL_DAEMON=1

while [[ \$# -gt 0 ]]; do
  case \$1 in
    --server) SERVER_URL="\$2"; shift 2 ;;
    --token) TOKEN="\$2"; shift 2 ;;
    --foreground) INSTALL_DAEMON=0; shift ;;
    --daemon) INSTALL_DAEMON=1; shift ;;
    *) shift ;;
  esac
done

echo "==========================================================="
echo "🐾 正在配置 MuseClaw 远程计算节点 (Mesh Runner)..."
echo "🌐 接入网关: \$SERVER_URL"
echo "🔑 认证令牌: \$TOKEN"
echo "==========================================================="

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 错误: 未检测到 Node.js，请先安装 Node.js (推荐 v18+)"
  exit 1
fi

MUSECLAW_DIR="\$HOME/.museclaw"
mkdir -p "\$MUSECLAW_DIR"
CLIENT_JS="\$MUSECLAW_DIR/client.js"

echo "📥 正在同步最新的 Runner 伴侣核心脚本..."
curl -fsSL "\$SERVER_URL/runner/client.js" -o "\$CLIENT_JS"

export MUSECLAW_SERVER_URL="\$SERVER_URL"
if [ -n "\$TOKEN" ]; then export MUSECLAW_TOKEN="\$TOKEN"; fi

if [ "\$INSTALL_DAEMON" -eq 1 ]; then
  echo "⚙️  正在安装为系统开机自启常驻后台服务..."
  node "\$CLIENT_JS" --install-service --server "\$SERVER_URL" --token "\$TOKEN"
else
  echo "🚀 正在以前台交互模式启动 Runner (按 Ctrl+C 可停止)..."
  node "\$CLIENT_JS" --server "\$SERVER_URL" --token "\$TOKEN"
fi
`;
      res.writeHead(200, {
        'Content-Type': 'application/x-sh; charset=utf-8',
        'Content-Disposition': 'inline'
      });
      return res.end(script);
    }

    if (req.method === 'GET' && url.pathname === '/runner/client.js') {
      const candidates = [
        path.resolve(__dirname, '../../apps/runner/client.js'),
        path.resolve(__dirname, '../../apps/runner/dist/client.js'),
        path.resolve(process.cwd(), 'apps/runner/client.js'),
        path.resolve(process.cwd(), 'apps/runner/dist/client.js'),
        path.resolve(__dirname, '../../runner/client.js'),
        path.resolve(__dirname, '../../runner/dist/client.js'),
      ];
      const clientPath = candidates.find((p) => fs.existsSync(p));
      if (clientPath) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return res.end(fs.readFileSync(clientPath, 'utf8'));
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Client script not found');
    }

    // D2. 例行自动化任务管理接口 (Routines)
    if (req.method === 'GET' && url.pathname === '/api/routines') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(proactive.listRoutines()));
    }

    if (req.method === 'POST' && url.pathname === '/api/routines') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        if (!payload.name || !payload.instructions) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: '任务名称与执行指令为必填项' }));
        }
        const created = proactive.createRoutine(payload);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, routine: created }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'GET' && url.pathname.match(/^\/api\/routines\/[^/]+$/) && !url.pathname.endsWith('/runs')) {
      const id = url.pathname.split('/')[3];
      const r = proactive.getRoutine(id);
      if (!r) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Routine not found' }));
      }
      const runs = proactive.listRunsByRoutineId(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ routine: r, runs }));
    }

    if ((req.method === 'PUT' || req.method === 'PATCH') && url.pathname.match(/^\/api\/routines\/[^/]+$/)) {
      const id = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const payload = JSON.parse(body || '{}');
        const updated = proactive.updateRoutine(id, payload);
        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Routine not found' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, routine: updated }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/routines/') && url.pathname.endsWith('/trigger')) {
      const id = url.pathname.replace('/api/routines/', '').replace('/trigger', '');
      let body = '';
      for await (const chunk of req) body += chunk;
      let parsedBody: Record<string, unknown> = {};
      try {
        if (body.trim()) parsedBody = JSON.parse(body);
      } catch {
        parsedBody = { raw: body };
      }

      const authHeader = req.headers['authorization'];
      const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim() || url.searchParams.get('token') || undefined;

      const result = await proactive.handleRoutineWebhookTrigger(id, token, parsedBody);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result.body));
    }

    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/routines\/[^/]+$/)) {
      const id = url.pathname.split('/')[3];
      const deleted = proactive.deleteRoutine(id);
      res.writeHead(deleted ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: deleted }));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/routines/') && url.pathname.endsWith('/run')) {
      const id = url.pathname.replace('/api/routines/', '').replace('/run', '');
      const r = proactive.getRoutine(id);
      if (!r) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Routine not found' }));
      }
      proactive.executeRoutine(r, 'manual').catch(err => {
        console.error(`[Proactive:Manual] 执行异常:`, err.message);
      });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: `任务 [${r.name}] 已手动触发` }));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/routines/') && url.pathname.endsWith('/toggle')) {
      const id = url.pathname.replace('/api/routines/', '').replace('/toggle', '');
      const enabled = proactive.toggleRoutine(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, enabled }));
    }

    if (req.method === 'GET' && (url.pathname === '/api/routines/runs' || (url.pathname.startsWith('/api/routines/') && url.pathname.endsWith('/runs')))) {
      const routineId = url.pathname.startsWith('/api/routines/') && url.pathname.endsWith('/runs')
        ? url.pathname.replace('/api/routines/', '').replace('/runs', '')
        : undefined;
      const allRuns = proactive.listRuns();
      const filtered = routineId ? allRuns.filter(r => r.routineId === routineId) : allRuns;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(filtered));
    }

    // D3. 外部 Webhook 触发入口 (带 Bearer 鉴权与限流)
    if (req.method === 'GET' && url.pathname === '/api/hooks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(proactive.listHooks()));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/hooks/')) {
      const hookId = url.pathname.replace('/api/hooks/', '');
      let bodyStr = '';
      for await (const chunk of req) bodyStr += chunk;
      let bodyJson = {};
      try { bodyJson = JSON.parse(bodyStr || '{}'); } catch {}

      const authHeader = req.headers.authorization;
      const result = await proactive.handleWebhookTrigger(hookId, authHeader, bodyJson);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result.body));
    }

    // ==========================================
    // D2. 长周期目标与自主推进 API (Long-Horizon Goals API)
    // ==========================================
    const safeParse = (str: string, fallback: any = {}) => {
      if (!str || !str.trim()) return fallback;
      try {
        return JSON.parse(str);
      } catch {
        try {
          return JSON.parse(str.replace(/\\"/g, '"'));
        } catch {
          try {
            const withQuotes = str.replace(/([{\s,])(\w+)\s*:/g, '$1"$2":');
            return JSON.parse(withQuotes);
          } catch {
            return fallback;
          }
        }
      }
    };

    // 获取目标列表 (GET /api/goals)
    if (req.method === 'GET' && url.pathname === '/api/goals') {
      const botId = url.searchParams.get('bot_id') || undefined;
      const status = (url.searchParams.get('status') as any) || undefined;
      const category = url.searchParams.get('category') || undefined;
      const targetUserId = currentUser ? currentUser.username : undefined;
      const goals = goalStore.list({ botId, status, category, userId: targetUserId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(goals));
    }

    // 创建新长周期目标 (POST /api/goals)
    if (req.method === 'POST' && url.pathname === '/api/goals') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = safeParse(body, {});
      if (!data.title) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Field "title" is required' }));
      }
      const goal = goalStore.create({
        title: data.title,
        description: data.description || data.title,
        botId: data.botId || data.bot_id || 'muse',
        userId: currentUser?.username || data.userId || data.user_id || 'user_web',
        category: data.category,
        due: data.due,
        cadence: data.cadence,
        steps: data.steps,
        notes: data.notes
      });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(goal));
    }

    // 获取特定目标详情 (GET /api/goals/:id)
    if (req.method === 'GET' && url.pathname.match(/^\/api\/goals\/[^/]+$/)) {
      const goalId = url.pathname.split('/')[3];
      const goal = goalStore.get(goalId);
      if (!goal) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Goal not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(goal));
    }

    // 添加新步骤 (POST /api/goals/:id/steps)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/steps$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const { title, description, verificationCommand } = safeParse(body, {});
      if (!title) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Field "title" is required' }));
      }
      const updated = goalStore.addStep(goalId, title, description, verificationCommand);
      if (!updated) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Goal not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(updated));
    }

    // 更新单个步骤 (PATCH /api/goals/:id/steps/:stepId)
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/goals\/[^/]+\/steps\/[^/]+$/)) {
      const parts = url.pathname.split('/');
      const goalId = parts[3];
      const stepId = parts[5];
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = safeParse(body, {});
      const updated = goalStore.updateStep(goalId, stepId, data.status, {
        note: data.note,
        result: data.result,
        verificationCommand: data.verificationCommand
      });
      if (!updated) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Goal or step not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(updated));
    }

    // 触发 Check-in 推进 (POST /api/goals/:id/checkin)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/checkin$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const { note } = safeParse(body, {});
      if (note) {
        goalStore.appendNote(goalId, note);
      }
      try {
        const result = await goalEngine.advanceGoal(goalId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 自主推进当前步骤 (POST /api/goals/:id/advance)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/advance$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const override = safeParse(body, {});
      try {
        const result = await goalEngine.advanceGoal(goalId, override);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 补充指导重试当前步骤 (POST /api/goals/:id/retry)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/retry$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const { stepId, step_id, guidance } = safeParse(body, {});
      try {
        const result = await goalEngine.retryGoal(goalId, { stepId: stepId || step_id, guidance });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 退回指定历史步骤返工 (POST /api/goals/:id/rollback)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/rollback$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const { targetStepId, target_step_id, reason } = safeParse(body, {});
      const stepId = targetStepId || target_step_id;
      if (!stepId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Field "targetStepId" is required' }));
      }
      try {
        const result = await goalEngine.rollbackGoal(goalId, stepId, reason);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 提交计划修订提案 (POST /api/goals/:id/proposal)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/proposal$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const { reason, proposed_steps, proposedSteps } = safeParse(body, {});
      const steps = proposed_steps || proposedSteps;
      if (!reason || !Array.isArray(steps)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({ error: 'Fields "reason" and "proposed_steps" (array) are required' })
        );
      }
      const proposal = goalStore.proposeReplan(goalId, reason, steps);
      if (!proposal) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Goal not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, proposal }));
    }

    // 审批重新规划提案 (POST /api/goals/:id/proposal/resolve)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/goals\/[^/]+\/proposal\/resolve$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = safeParse(body, {});
      const accept = data.accept;
      if (typeof accept !== 'boolean' && accept !== 'true' && accept !== 'false') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Field "accept" (boolean) is required' }));
      }
      const isAccepted = accept === true || accept === 'true';
      const result = goalStore.resolveProposal(goalId, isAccepted);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // 更新目标（暂停/恢复、编辑标题与进度）
    if (req.method === 'PATCH' && url.pathname.match(/^\/api\/goals\/[^/]+$/)) {
      const goalId = url.pathname.split('/')[3];
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const patch = safeParse(body, {});
        const allowed: Record<string, unknown> = {};
        for (const key of ['title', 'description', 'status', 'progress', 'cadence', 'due', 'category', 'notes', 'steps', 'botId']) {
          if (patch[key] !== undefined) allowed[key] = patch[key];
        }

        // 支持通过 PATCH 直接修改步骤状态
        if (patch.step_index !== undefined || patch.step_id !== undefined) {
          if (patch.step_index !== undefined) {
            goalStore.updateStepByIndex(
              goalId,
              Number(patch.step_index),
              patch.step_status || patch.status,
              patch.step_note || patch.note
            );
          } else {
            goalStore.updateStep(
              goalId,
              String(patch.step_id),
              patch.step_status || patch.status,
              { note: patch.step_note || patch.note }
            );
          }
        }

        const updated = goalStore.update(goalId, allowed as any);
        if (!updated) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Goal not found' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(updated));
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // 删除目标 (DELETE /api/goals/:id)
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/goals\/[^/]+$/)) {
      const goalId = url.pathname.split('/')[3];
      const deleted = goalStore.delete(goalId);
      res.writeHead(deleted ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: deleted }));
    }

    // 智能体动态列表 (GET /api/feed 或 GET /api/feed/posts)
    if (req.method === 'GET' && (url.pathname === '/api/feed' || url.pathname === '/api/feed/posts')) {
      const userId = currentUser?.username || 'user_web';
      const data = feedStore.getFeedPosts(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(url.pathname === '/api/feed' ? { posts: data.posts || [], settings: { daily: data.daily, time: data.time, instructions: data.instructions } } : data));
    }

    // 动态配置读取与更新 (GET/POST /api/feed/settings, PUT /api/feed/instructions)
    if (req.method === 'GET' && url.pathname === '/api/feed/settings') {
      const userId = currentUser?.username || 'user_web';
      const data = feedStore.getFeedPosts(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ daily: data.daily, time: data.time, instructions: data.instructions }));
    }

    if ((req.method === 'PUT' || req.method === 'POST') && (url.pathname === '/api/feed/settings' || url.pathname === '/api/feed/instructions')) {
      const userId = currentUser?.username || 'user_web';
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || '{}');
      const data = feedStore.setFeedInstructions(userId, parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(data));
    }

    // 动态交互反馈闭环：点赞 / 不感兴趣 / 讨论 (POST /api/feed/posts/:id/like|dismiss|discuss)
    if (req.method === 'POST' && url.pathname.match(/^\/api\/feed\/posts\/[^/]+\/(like|dismiss|discuss)$/)) {
      const parts = url.pathname.split('/');
      const postId = decodeURIComponent(parts[4] || '');
      const action = parts[5] as 'like' | 'dismiss' | 'discuss';
      const userId = currentUser?.username || 'user_web';

      if (action === 'like') {
        const resLike = feedStore.toggleLikePost(userId, postId);
        if (resLike.success && resLike.post?.liked) {
          memoryPipeline.recordFeedFeedback(userId, 'muse', {
            action: 'like',
            title: resLike.post.title,
            tags: resLike.post.tags,
            area: resLike.post.area
          });
        }
        res.writeHead(resLike.success ? 200 : 404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(resLike));
      }

      if (action === 'dismiss') {
        const resDismiss = feedStore.dismissPost(userId, postId);
        if (resDismiss.success && resDismiss.post) {
          memoryPipeline.recordFeedFeedback(userId, 'muse', {
            action: 'dismiss',
            title: resDismiss.post.title,
            tags: resDismiss.post.tags,
            area: resDismiss.post.area
          });
        }
        res.writeHead(resDismiss.success ? 200 : 404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(resDismiss));
      }

      const post = feedStore.getFeedPosts(userId).posts.find((p) => p.id === postId);
      if (post) {
        memoryPipeline.recordFeedFeedback(userId, 'muse', {
          action: 'discuss',
          title: post.title,
          tags: post.tags,
          area: post.area
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, post }));
    }

    // 主动聊天与简报设置与触发 (/api/proactive/status|settings|check)
    if (req.method === 'GET' && url.pathname === '/api/proactive/status') {
      const userId = currentUser?.username || 'user_web';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(proactiveBrief.getSettings(userId)));
    }

    if (req.method === 'POST' && url.pathname === '/api/proactive/settings') {
      const userId = currentUser?.username || 'user_web';
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = safeJsonParse(body, {});
      const settings = proactiveBrief.updateSettings(userId, parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(settings));
    }

    if (req.method === 'POST' && url.pathname === '/api/proactive/check') {
      const userId = currentUser?.username || 'user_web';
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = safeJsonParse(body, {});
      const result = proactiveBrief.evaluateAndEmitBrief({
        userId,
        botId: parsed.botId || 'muse',
        force: parsed.force !== false,
        botMemory,
        memoryPipeline,
        feedStore,
        goalStore,
        sessionStore
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // 立即撰写并生成动态 (POST /api/feed 或 POST /api/feed/posts/refresh)
    if (req.method === 'POST' && (url.pathname === '/api/feed' || url.pathname === '/api/feed/posts/refresh')) {
      const userId = currentUser?.username || 'user_web';
      const caller = globalModelStore.getActiveCaller({ userId });

      const contextLines: string[] = [];
      contextLines.push(`- 当前用户名: ${currentUser?.displayName || currentUser?.username || '员工'}`);

      const userProfileItems = botMemory.getUserProfileItems(userId);
      if (userProfileItems.length > 0) {
        contextLines.push(
          `- 共享用户画像与偏好:\n${userProfileItems.slice(0, 12).map((i) => `  * ${i.content}`).join('\n')}`
        );
      }

      const memory = botMemory.getMemory('muse', userId);
      if (memory) {
        const memoryLines = memory
          .split('\n')
          .filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'))
          .slice(0, 15);
        if (memoryLines.length > 0) {
          contextLines.push(`- 用户记忆与准则偏好:\n${memoryLines.join('\n')}`);
        }
      }

      const activeGoals = goalStore.list('active');
      if (activeGoals.length > 0) {
        contextLines.push('- 当前活跃的长周期自驱目标:');
        for (const g of activeGoals.slice(0, 5)) {
          const currentStep = g.steps.find((s) => s.status === 'in_progress') || g.steps.find((s) => s.status === 'pending');
          contextLines.push(`  * 目标: ${g.title} (进度: ${g.progress}%${currentStep ? `, 下一步: ${currentStep.title}` : ''})`);
        }
      }

      const recentSessions = sessionStore.list('muse', userId).slice(0, 4);
      if (recentSessions.length > 0) {
        contextLines.push('- 近期工作焦点:');
        for (const s of recentSessions) {
          if (s.title) contextLines.push(`  * 会话: ${s.title}`);
        }
      }

      const recentRoutineRuns = proactive.listRuns(5);
      if (recentRoutineRuns.length > 0) {
        const summaries = recentRoutineRuns.map(r => `  * [定时任务: ${r.routineName}] 状态: ${r.status}, 简报: ${r.summary || r.output?.slice(0, 100) || '顺利完成'}`);
        contextLines.push(`- 近期定时任务巡检与执行情况:\n${summaries.join('\n')}`);
      }

      contextLines.push(`- 当前系统时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

      const interests = botMemory.getUserInterests(userId, 'muse');
      const feedback = memoryPipeline.getFeedbackProfile(userId);
      const result = await feedStore.writeFeedPosts(userId, caller, contextLines, 3, {
        searchWeb: searchWebForFeed,
        interests,
        likedTopics: feedback.likedTopics,
        dismissedTopics: feedback.dismissedTopics
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // 删除单条动态 (DELETE /api/feed/posts/:id)
    if (req.method === 'DELETE' && url.pathname.match(/^\/api\/feed\/posts\/[^/]+$/)) {
      const userId = currentUser?.username || 'user_web';
      const postId = url.pathname.split('/')[4];
      const deleted = feedStore.deleteFeedPost(userId, postId);
      res.writeHead(deleted ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: deleted }));
    }

    // 获取离线工作动态流水 (GET /api/feed/activity)
    if (req.method === 'GET' && url.pathname === '/api/feed/activity') {
      const userId = currentUser?.username || 'user_web';
      const items = feedStore.getActivity(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(items));
    }

    // E. Web 任务执行流式接口（多 Bot 路由、@Mention 支持与 /api/chat 双兼容）
    if (req.method === 'POST' && (url.pathname === '/api/tasks' || url.pathname === '/api/chat')) {
      let parsed: any = {};
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        parsed = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
      const text = parsed.prompt || parsed.text || parsed.message || '';
      const isHiddenTurn = Boolean(parsed.hidden);
      const userId = currentUser ? currentUser.username : 'user_web';
      const requestedSessionId = parsed.sessionId || parsed.session_id;
      const requestedBotId = parsed.botId || parsed.bot_id;
      const attachments: Array<{ name?: string; type?: string; url?: string; mime?: string }> = Array.isArray(
        parsed.attachments
      )
        ? parsed.attachments.filter((a: any) => a && typeof a.url === 'string')
        : [];
      const images: string[] = Array.isArray(parsed.images)
        ? parsed.images
        : parsed.image
          ? [parsed.image]
          : attachments
              .filter((a) => a.type === 'image' || String(a.mime || '').startsWith('image/'))
              .map((a) => a.url as string);

      let promptWithImages = text;
      if (images.length > 0) {
        const imageMarkdown = images.map((img: string, i: number) => `![用户附图 ${i + 1}](${img})`).join('\n');
        promptWithImages = promptWithImages ? `${promptWithImages}\n\n${imageMarkdown}` : imageMarkdown;
      }

      // 非图片附件以链接形式交给 Agent，避免“上传了但模型看不到”
      const otherFiles = attachments.filter((a) => !images.includes(a.url as string));
      if (otherFiles.length > 0) {
        const fileLines = otherFiles
          .map((a) => `- [${a.name || '附件'}](${a.url})`)
          .join('\n');
        promptWithImages = `${promptWithImages}\n\n用户上传的附件：\n${fileLines}`.trim();
      }

      // 1. 先进行多 Bot 路由解析 (@Mention 优先，再考虑 session_id 与 bot_id)
      let routeResult: RouteResult;
      try {
        routeResult = sessionRouter.route({
          text,
          session_id: requestedSessionId,
          bot_id: requestedBotId,
          user_id: userId
        });
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }

      const { bot, session_id: finalSessionId, mention_name } = routeResult;
      const session = getOrCreateSession(finalSessionId, bot.id, userId);
      if (!session.messages) session.messages = [];
      if (session.messages.length === 0) {
        session.title = text.slice(0, 16) || '新任务';
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      (res as any).flushHeaders?.();

      // 发送 session 初始化事件，包含 bot_id 与 session_id
      res.write(`data: ${JSON.stringify({
        type: 'session:init',
        sessionId: session.id,
        session_id: session.id,
        botId: bot.id,
        bot_id: bot.id,
        botName: bot.name,
        title: session.title,
        mentionName: mention_name
      })}\n\n`);

      // 形象工坊对话拦截：若存在处于 choose 状态的会话，且用户输入属于选项/重新生成/取消
      const curStudioSession = avatarStudio.getCurrentSession();
      if (
        curStudioSession &&
        curStudioSession.stage === 'choose' &&
        (curStudioSession.thread === session.id || curStudioSession.thread === 'main' || !curStudioSession.thread)
      ) {
        const choice = parseAvatarChoice(text);
        if (choice !== null) {
          session.messages.push({
            role: 'user',
            content: text,
            attachments: attachments.length ? (attachments as any) : undefined
          });
          sessionStore.save(session, userId);

          if (choice === 'regenerate') {
            await avatarStudio.regenerate(curStudioSession.id);
          } else if (choice === 'cancel') {
            avatarStudio.cancel(curStudioSession.id);
          } else if (typeof choice === 'number') {
            await avatarStudio.choose(curStudioSession.id, choice, bot.id);
          }

          res.write(`data: ${JSON.stringify({
            type: 'avatar',
            event: curStudioSession,
            bot_id: bot.id,
            session_id: session.id
          })}\n\n`);
          res.end();
          return;
        }
      }

      // 形象工坊对话拦截：自然语言意图创建或更换虚拟形象
      const avatarReqDesc = parseAvatarRequest(text);
      if (avatarReqDesc && images.length <= 1) {
        const avatarSession = await avatarStudio.begin({
          description: avatarReqDesc,
          thread: session.id,
          botId: bot.id,
          reference: images[0] || ''
        });

        session.messages.push({
          role: 'user',
          content: text,
          attachments: attachments.length ? (attachments as any) : undefined
        });
        sessionStore.save(session, userId);

        res.write(`data: ${JSON.stringify({
          type: 'avatar',
          event: avatarSession,
          bot_id: bot.id,
          session_id: session.id
        })}\n\n`);
        res.end();
        return;
      }

      // 记录用户活跃在场时间（用于主动聊天分寸感门禁）
      proactiveBrief.touchPresence(userId);

      // 启动 Agent Loop，注入冻结记忆快照（L0 用户档案 + Bot 核心记忆 + L1 主题索引）并匹配前瞻事件意图
      const botWithMemory: AgentProfile = {
        ...bot,
        memory: botMemory.getFrozenMemoryContext(session.id, bot.id, userId)
      };
      const triggeredIntents = botMemory.matchAndFireIntents(bot.id, text, userId);

      const userScopedCaller: LLMCaller = async (messages, tools, onChunk) => {
        const caller = globalModelStore.getActiveCaller({ userId });
        return caller(messages, tools, onChunk);
      };

      // 提取本会话近期的多轮上下文历史，确保 Agent 具备持续记忆能力，避免转眼丢失对话上下文
      const historyMessages = (session.messages || [])
        .slice(-20)
        .map((m) => {
          let msgText = m.content || '';
          if (Array.isArray(m.widgets) && m.widgets.length > 0) {
            const widgetNotes = m.widgets
              .map((w) => `[已展示交互组件: ${w.title}]${w.fallbackText ? ` ${w.fallbackText}` : ''}`)
              .join('\n');
            msgText = msgText ? `${msgText}\n${widgetNotes}` : widgetNotes;
          }
          if (msgText.length > 4000) {
            msgText = msgText.slice(0, 2000) + '\n...[已省略部分过长历史]...\n' + msgText.slice(-2000);
          }
          return {
            role: m.role as 'user' | 'assistant',
            content: msgText
          };
        })
        .filter((m) => m.content && m.content.trim().length > 0);

      // 智能解析附件并判定多模态视觉通道
      const uploadDir = path.resolve(__dirname, '../data/uploads');
      const attachmentObjects: Attachment[] = [];

      for (const a of attachments) {
        let absPath = '';
        if (a.url?.startsWith('/uploads/')) {
          absPath = path.join(uploadDir, a.url.replace(/^\/?uploads\//, ''));
        } else if (a.url) {
          absPath = path.resolve(process.cwd(), a.url.replace(/^\//, ''));
        }
        if (absPath) {
          attachmentObjects.push(Attachment.fromFile(absPath, a.name));
        }
      }

      const activeProvider = globalModelStore.getActiveProvider();
      const currentModelName = bot.model || activeProvider?.model || 'deepseek-flash';
      const isVisionModel = modelTakesImages(currentModelName) === true;

      const imagePaths = attachmentObjects
        .filter((a) => a.kind === 'image')
        .map((a) => a.path);

      const attachmentNote = formatAttachmentNote(attachmentObjects, isVisionModel);
      const userTextWithNote = attachmentNote
        ? `${text || (attachmentObjects.length > 0 ? '请查看附件' : '')}\n\n${attachmentNote}`.trim()
        : (promptWithImages || text || '新任务');

      const userGoal = isVisionModel && imagePaths.length > 0
        ? buildMultimodalContent(userTextWithNote, imagePaths, true)
        : userTextWithNote;

      const loop = runAgentLoop(
        bot.system_prompt || '你是一个企业内部严谨、高效的自动化数字员工。',
        typeof userGoal === 'string' ? resolveSkillPrompt(userGoal) : userGoal,
        refreshTools(),
        sentinel,
        userScopedCaller,
        {
          sessionId: session.id,
          userId,
          botId: bot.id,
          profile: botWithMemory,
          maxSteps: 15,
          skills: getBotSkills(bot.id),
          historyMessages,
          triggeredIntents
        }
      );

      let fullAssistantText = '';
      let reasoningText = '';
      const toolCalls: Array<Record<string, unknown>> = [];
      const widgets: WidgetPayload[] = [];
      let clientGone = false;
      let finished = false;

      // 用户点「停止」或关掉页面：终结这一轮，并自动失效待处理的审批项
      res.on('close', () => {
        if (finished) return;
        clientGone = true;
        sentinel.cancelPendingForSession(session.id);
        if (session.messages) {
          let updated = false;
          for (const m of session.messages) {
            if (m.approvalRequest && m.approvalRequest.status === 'pending') {
              m.approvalRequest.status = 'rejected';
              m.approvalRequest.decidedBy = 'system_cancelled';
              m.approvalRequest.decidedAt = Date.now();
              updated = true;
            }
          }
          if (updated) {
            sessionStore.save(session, userId);
          }
        }
      });

      try {
        for await (const event of loop) {
          if (clientGone) break;
          if (event.type === 'stream:text-delta') {
            fullAssistantText += event.text;
          }
          if (event.type === 'stream:reasoning-delta') {
            reasoningText += event.text;
          }
          if (event.type === 'ui:widget' && event.widget) {
            const existingIdx = widgets.findIndex((w) => w.id === event.widget.id);
            if (existingIdx >= 0) {
              widgets[existingIdx] = event.widget;
            } else {
              widgets.push(event.widget);
            }
          }
          if (event.type === 'sentinel:approval_needed') {
            session.messages.push({
              role: 'assistant',
              content: '触发安全门禁审批：请审核以下操作是否批准执行。',
              approvalRequest: {
                actionId: event.request?.approvalId,
                description: event.request?.actionSummary,
                command: event.request?.targetDetails?.command,
                status: 'pending'
              }
            });
            sessionStore.save(session, userId);
          }
          if (event.type === 'tool:call_start') {
            toolCalls.push({
              tool: event.toolName,
              params: event.input,
              status: 'running',
              startedAt: Date.now()
            });
          }
          if (event.type === 'tool:call_end') {
            // 同名工具可能连续调用多次：更新最后一条仍在运行的那次
            const running = [...toolCalls]
              .reverse()
              .find((t) => t.tool === event.toolName && t.status === 'running');
            if (running) {
              const rejected = String(event.output || '').includes('拒绝');
              let isError = rejected;
              if (typeof event.output === 'object' && event.output !== null) {
                const outObj = event.output as any;
                if (outObj.error || (outObj.exitCode !== undefined && outObj.exitCode !== 0)) {
                  isError = true;
                }
              }
              running.status = isError ? (rejected ? 'rejected' : 'failed') : 'done';
              running.ok = !isError;
              running.durationMs = event.durationMs || 0;
              running.result =
                event.toolName === 'show_widget' &&
                typeof event.output === 'object' &&
                event.output !== null &&
                (event.output as any).__widget
                  ? {
                      success: true,
                      widget_id: (event.output as any).widget_id,
                      title: (event.output as any).title
                    }
                  : clipToolOutput(event.output);
            }
          }
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          (res as any).flush?.();
        }

        session.messages.push({
          role: 'user',
          content: text || (attachments.length ? '（已上传附件）' : ''),
          ...(attachments.length ? { attachments } : {}),
          ...(isHiddenTurn ? { hidden: true } : {})
        });
        if (fullAssistantText || clientGone || toolCalls.length > 0 || reasoningText.trim() || widgets.length > 0) {
          const content = clientGone
            ? `${fullAssistantText ? `${fullAssistantText}\n\n` : ''}（已停止）`
            : fullAssistantText;
          for (const tc of toolCalls) {
            if (tc.status === 'running') {
              tc.status = clientGone ? 'stopped' : 'done';
              tc.durationMs = tc.durationMs || (Date.now() - (Number(tc.startedAt) || Date.now()));
            }
          }
          session.messages.push({
            role: 'assistant',
            content,
            ...(reasoningText.trim() ? { reasoning: reasoningText.trim() } : {}),
            ...(toolCalls.length ? { toolCalls } : {}),
            ...(widgets.length ? { widgets } : {})
          });
        }
        sessionStore.save(session, userId);
        if (!clientGone) {
          feedStore.recordActivity(userId, {
            kind: 'chat',
            title: session.title || '任务会话',
            text: fullAssistantText.slice(0, 150) || widgets.map((w) => `[交互组件] ${w.title}`).join('、'),
            sessionId: session.id,
            sessionTitle: session.title
          });

          // 异步后台运行认知记忆提取与周期性跨会话反思（不阻塞流式输出响应）
          const turnIsTainted = sentinel.isSessionTainted(session.id);
          void (async () => {
            try {
              const capRes = await memoryPipeline.captureTurnMemory({
                botId: bot.id,
                botName: bot.name,
                userId,
                sessionId: session.id,
                userText: text,
                assistantText: fullAssistantText,
                caller: userScopedCaller,
                isTainted: turnIsTainted,
                sessionKind: 'interactive',
                isHidden: isHiddenTurn
              });
              if (capRes.capturedCount > 0) {
                console.log(`[MemoryPipeline] 会话 ${session.id} 静默沉淀 ${capRes.capturedCount} 条记忆`);
              }

              const counterKey = `${userId}::${bot.id}`;
              const nextTurns = (reflectionTurnCounter.get(counterKey) || 0) + 1;
              reflectionTurnCounter.set(counterKey, nextTurns);
              if (nextTurns % 5 === 0) {
                const recentSessions = sessionStore.list(bot.id, userId, false);
                const refRes = await memoryPipeline.reflectAcrossSessions({
                  botId: bot.id,
                  botName: bot.name,
                  userId,
                  sessions: recentSessions,
                  caller: userScopedCaller
                });
                if (!refRes.skipped) {
                  console.log(
                    `[MemoryPipeline] 自动跨会话反思完成 (bot=${bot.id}): +${refRes.learnedCount} 模式, ~${refRes.outdatedCount} 纠偏, +${refRes.ideasCount} 建议`
                  );
                }
              }
            } catch (memErr: any) {
              console.warn(`[MemoryPipeline] 异步记忆处理异常: ${memErr?.message || memErr}`);
            }
          })();
        } else {
          console.log(`[Chat] 客户端已断开，本轮终止: session=${session.id}`);
        }
      } catch (err: any) {
        if (!clientGone) {
          try {
            res.write(`data: ${JSON.stringify({
              type: 'agent:error',
              error: err.message,
              text: `\n[执行出错: ${err.message}]`,
              bot_id: bot.id,
              session_id: session.id
            })}\n\n`);
          } catch {
            /* 浏览器可能已经断开 */
          }
        }
      } finally {
        finished = true;
      }

      try {
        return res.end();
      } catch {
        return undefined;
      }
    }

    // B4. 运行时上传文件（工件、聊天图片、自定义头像）不在构建产物里，单独托管
    const uploadRoots: Array<[string, string]> = [
      ['/api/files/avatar/', path.resolve(__dirname, '../data/avatars/custom')],
      ['/avatar-presets/', path.resolve(__dirname, '../../web/public/avatars/presets')],
      ['/avatars/uploads/', path.resolve(__dirname, '../data/avatars/uploads')],
      ['/avatars/custom/', path.resolve(__dirname, '../data/avatars/custom')],
      ['/avatars/sessions/', path.resolve(__dirname, '../data/avatars/sessions')],
      ['/avatars/presets/', path.resolve(__dirname, '../../web/public/avatars/presets')],
      ['/avatars/', path.resolve(__dirname, '../../web/public/avatars')],
      ['/uploads/', path.resolve(__dirname, '../data/uploads')]
    ];
    if (req.method === 'GET' || req.method === 'HEAD') {
      for (const [prefix, dir] of uploadRoots) {
        if (!url.pathname.startsWith(prefix)) continue;
        const rel = path.normalize(decodeURIComponent(url.pathname.slice(prefix.length)));
        let target = path.join(dir, rel);
        if (!fs.existsSync(target)) {
          if (target.endsWith('.webp')) {
            const altSvg = target.slice(0, -5) + '.svg';
            if (fs.existsSync(altSvg)) target = altSvg;
          } else if (target.endsWith('.svg')) {
            const altWebp = target.slice(0, -4) + '.webp';
            if (fs.existsSync(altWebp)) target = altWebp;
          }
        }
        if (!target.startsWith(dir) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
          if (prefix.includes('avatar') && url.pathname.endsWith('.mp4')) {
            res.writeHead(204);
            return res.end();
          }
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Upload not found' }));
        }
        const ext = path.extname(target).toLowerCase();
        const types: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.mp4': 'video/mp4',
          '.txt': 'text/plain; charset=utf-8'
        };
        let contentType = types[ext] || 'application/octet-stream';

        // 动态嗅探文件头 Magic Bytes，如果真实内容是 SVG，则返回 image/svg+xml
        try {
          const fd = fs.openSync(target, 'r');
          const buf = Buffer.alloc(128);
          const bytesRead = fs.readSync(fd, buf, 0, 128, 0);
          fs.closeSync(fd);
          if (bytesRead > 0) {
            const headerStr = buf.subarray(0, bytesRead).toString('utf-8').trimStart();
            if (headerStr.startsWith('<svg') || headerStr.startsWith('<?xml') || headerStr.startsWith('<!DOCTYPE svg')) {
              contentType = 'image/svg+xml; charset=utf-8';
            } else if (bytesRead >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
              contentType = 'image/webp';
            } else if (bytesRead >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
              contentType = 'image/png';
            } else if (bytesRead >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
              contentType = 'image/jpeg';
            } else if (bytesRead >= 6 && buf.subarray(0, 3).toString('ascii') === 'GIF') {
              contentType = 'image/gif';
            }
          }
        } catch {
          // ignore read error
        }

        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, must-revalidate'
        });
        return fs.createReadStream(target).pipe(res);
      }
    }

    // 静态前端资源托管 (SPA 模式: 只读 apps/web/dist)
    const webDir = resolveWebDist();
    if (!webDir && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(WEB_NOT_BUILT_PAGE);
    }
    if (webDir && (req.method === 'GET' || req.method === 'HEAD')) {
      // 路径遍历攻击防御
      if (req.url && (req.url.includes('..') || req.url.includes('%2e%2e') || req.url.includes('%2E%2E'))) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Forbidden: path traversal blocked' }));
      }

      let reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
      let filePath = path.join(webDir, reqPath);
      if (!filePath.startsWith(webDir)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Forbidden' }));
      }

      // 如果请求带扩展名且文件不存在，返回 404
      const ext = path.extname(filePath).toLowerCase();
      if (ext && !fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Static asset not found' }));
      }

      // 如果属于已声明的前端 SPA 路由，或非 API、非静态资源请求，fallback 到 index.html (SPA History 模式)
      const isSpaRoute = [
        '/',
        '/index.html',
        '/chat',
        '/feed',
        '/goals',
        '/routines',
        '/memory',
        '/skills',
        '/audit',
        '/artifacts',
        '/sessions',
        '/bots'
      ].some((r) => url.pathname === r || url.pathname.startsWith(`${r}/`));

      if (isSpaRoute || (!ext && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/runner/'))) {
        filePath = path.join(webDir, 'index.html');
      } else if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not found' }));
      }

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.mjs': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff2': 'font/woff2',
          '.webp': 'image/webp',
          '.mp4': 'video/mp4'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        // Vite 的 assets 带内容哈希，可以长期缓存；其余一律回源校验
        const immutable = url.pathname.startsWith('/assets/');
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
        });
        const stream = fs.createReadStream(filePath);
        return stream.pipe(res);
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Route not found' }));
  } catch (unhandledErr: any) {
    console.error('[Gateway] 未捕获请求处理异常:', unhandledErr);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, code: 500, error: unhandledErr?.message || 'Internal Server Error' }));
    }
  }
});

  server.listen(port, async () => {
    console.log(`🐾 MuseClaw Gateway & Web UI 运行在: http://localhost:${port}`);
    console.log(`📡 如流 (Infoflow) Webhook 接收端点: http://localhost:${port}/api/channels/infoflow/webhook`);
    console.log(`📡 飞书 (Feishu) Webhook 接收端点: http://localhost:${port}/api/channels/feishu/webhook`);
    console.log(`⏰ 主动任务管理端点: http://localhost:${port}/api/routines | 外部 Webhook: http://localhost:${port}/api/hooks/:id`);
    console.log(`📦 交付工件存储端点: http://localhost:${port}/api/artifacts`);
    console.log(`🔌 MCP 工具生态端点: http://localhost:${port}/api/mcp/servers`);
    console.log(`⚡ Agent Skills 规程库端点: http://localhost:${port}/api/skills`);

    // 初始化已配置的 MCP 服务器工具生态
    try {
      await mcpManager.init();
      refreshTools();
    } catch (err: any) {
      console.warn(`[MCP] 初始化提示: ${err.message}`);
    }

    // 启动 Proactive 自动化例行调度器 (每 30 秒心跳)
    proactive.start(30000);

    // 启动长周期目标 Check-in 自驱推进调度器 (每 60 秒心跳)
    goalEngine.startScheduler(60000);

    // 启动每日定时动态与信号驱动主动简报调度器 (每 10 分钟检查一次)
    let cognitiveTickRunning = false;
    const cognitiveTimer = setInterval(async () => {
      if (cognitiveTickRunning) return;
      cognitiveTickRunning = true;
      try {
        const usersRoot = path.resolve(__dirname, '../data/users');
        if (!fs.existsSync(usersRoot)) return;
        const userDirs = fs.readdirSync(usersRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const d of userDirs) {
          const uid = d.name;
          if (feedStore.isDailyFeedDue(uid)) {
            const caller = globalModelStore.getActiveCaller({ userId: uid });
            const interests = botMemory.getUserInterests(uid, 'muse');
            const feedback = memoryPipeline.getFeedbackProfile(uid);
            const ctx: string[] = [];
            const activeGoals = goalStore.list('active').filter((g) => !g.userId || g.userId === uid);
            for (const g of activeGoals.slice(0, 4)) {
              ctx.push(`- 活跃目标: ${g.title} (${g.progress}%)`);
            }
            await feedStore.writeFeedPosts(uid, caller, ctx, 3, {
              searchWeb: searchWebForFeed,
              interests,
              likedTopics: feedback.likedTopics,
              dismissedTopics: feedback.dismissedTopics
            });
          }

          proactiveBrief.evaluateAndEmitBrief({
            userId: uid,
            botId: 'muse',
            botMemory,
            memoryPipeline,
            feedStore,
            goalStore,
            sessionStore
          });
        }
      } catch (tickErr: any) {
        console.warn(`[CognitiveScheduler] 周期调度异常: ${tickErr?.message || tickErr}`);
      } finally {
        cognitiveTickRunning = false;
      }
    }, 10 * 60_000);
    cognitiveTimer.unref?.();

    // 尝试启动飞书 WebSocket 长连接 (若已在后台开启长连接订阅)
    if (feishuAppId && feishuAppSecret) {
      feishuChannel.startWebSocket().catch((err) => {
        console.warn(`[FeishuWS] 长连接未启动: ${err.message}`);
      });
    }
  });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startGatewayServer();
}
