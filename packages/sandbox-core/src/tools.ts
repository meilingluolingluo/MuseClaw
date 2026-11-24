import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import type { WidgetPayload } from '@museclaw/protocol';
import type { ToolDefinition } from './loop.js';
import { BaseEnvironment, MicroSandbox, getSanitizedEnv } from './micro-sandbox.ts';
import { validateWidgetInput } from './widget-validator.ts';

export { getSanitizedEnv };

export interface SkillsProvider {
  list: (filter?: any) => Array<any>;
  get: (name: string) => any | null;
  save: (data: any) => { success: boolean; skill?: unknown; error?: string };
  remove: (name: string) => { success: boolean; error?: string };
  recordUsage?: (name: string, kind: 'use' | 'view' | 'patch') => void;
  patchSkillBody?: (name: string, oldText: string, newText: string) => { success: boolean; skill?: unknown; error?: string };
  getSkillInstructions?: (name: string) => string | null;
}

export interface MemoryProvider {
  getMemory?: (botId: string, userId?: string) => string;
  addItem?: (
    botId: string,
    content: string,
    category?: string,
    isUser?: boolean,
    userId?: string,
    options?: { until?: string; origin?: 'owner' | 'agent' | 'feedback'; weight?: number }
  ) => { success: boolean; item?: any; warning?: string; error?: string };
  search?: (botId: string, query: string, userId?: string, options?: { category?: string; userId?: string }) => Array<{ item: any; score: number }>;
  deleteItem?: (botId: string, itemId: string, userId?: string) => { success: boolean; error?: string };
  listTopics?: (botId: string, userId?: string) => Array<{ slug: string; name: string; description: string; aliases: string[]; entryCount: number }>;
  getTopic?: (botId: string, slug: string, userId?: string) => { slug: string; name: string; description: string; aliases: string[]; content: string; items: any[] } | null;
  upsertTopic?: (
    botId: string,
    topic: string,
    entry: string,
    meta?: { description?: string; aliases?: string[]; until?: string; origin?: 'owner' | 'agent' | 'feedback' },
    userId?: string
  ) => { success: boolean; topic?: any; error?: string };
  createIntent?: (
    botId: string,
    input: { description: string; triggers: string[]; cooldownSeconds?: number; maxFires?: number },
    userId?: string
  ) => { success: boolean; intent?: any; error?: string };
  listIntents?: (botId: string, userId?: string) => Array<any>;
  cancelIntent?: (botId: string, intentId: string, userId?: string) => { success: boolean; error?: string };
}

export interface GoalProvider {
  create?: (data: {
    title: string;
    description?: string;
    steps?: string[];
    category?: string;
    due?: string;
    cadence?: string;
    botId?: string;
    userId?: string;
    notes?: string;
  }) => any;
  list?: (filter?: { botId?: string; status?: any; category?: string; userId?: string }) => any[];
  get?: (id: string) => any;
  update?: (id: string, updates: any) => any;
  updateStep?: (id: string, stepIdOrIndex: string | number, status?: any, options?: any) => any;
  addStep?: (id: string, title: string, description?: string) => any;
  propose?: (id: string, reason: string, steps: string[]) => any;
  setStatus?: (id: string, status: any) => any;
  appendNote?: (id: string, note: string) => any;
  render?: (goal: any) => string;
}

export interface FeishuProvider {
  sendMessage: (options: {
    receiveId?: string;
    content: string | Record<string, unknown>;
    msgType?: 'text' | 'interactive';
    receiveIdType?: 'open_id' | 'user_id' | 'chat_id' | 'email';
    title?: string;
  }) => Promise<{ success: boolean; messageId?: string; error?: string; raw?: unknown }>;
}

/**
 * 基础内置工具集（含 MicroSandbox 隔离与技能阶梯工具）
 */
export function createDefaultTools(options?: {
  browserWorkerUrl?: string;
  artifactsDir?: string;
  workspaceDir?: string;
  environment?: BaseEnvironment;
  microSandbox?: MicroSandbox;
  skillsProvider?: SkillsProvider;
  memoryProvider?: MemoryProvider;
  goalProvider?: GoalProvider;
  feishuProvider?: FeishuProvider;
}): ToolDefinition[] {
  const browserWorkerUrl = options?.browserWorkerUrl || 'http://127.0.0.1:8790';
  const artifactsDir = options?.artifactsDir || path.resolve(process.cwd(), 'apps/gateway/data/artifacts');
  const workspaceDir = options?.workspaceDir || process.cwd();
  const skillsProvider = options?.skillsProvider;
  const goalProvider = options?.goalProvider;
  const feishuProvider = options?.feishuProvider;

  // 初始化统一执行环境（若外部未传入，则根据工作区自动创建）
  const environment: BaseEnvironment = options?.environment || options?.microSandbox || new MicroSandbox({ workspaceDir });
  const sandbox = environment;

  const resolveUploadOrWorkspacePath = (rawPath: string): string => {
    const cleanPath = String(rawPath || '').trim();
    if (cleanPath.startsWith('/uploads/') || cleanPath.startsWith('uploads/')) {
      const filename = cleanPath.replace(/^\/?uploads\//, '');
      const candidate1 = path.resolve(workspaceDir, 'apps/gateway/data/uploads', filename);
      if (fs.existsSync(candidate1)) return candidate1;
      const candidate2 = path.resolve(workspaceDir, 'data/uploads', filename);
      if (fs.existsSync(candidate2)) return candidate2;
      const candidate3 = path.resolve(workspaceDir, cleanPath.replace(/^\//, ''));
      if (fs.existsSync(candidate3)) return candidate3;
    }
    if (path.isAbsolute(cleanPath) && fs.existsSync(cleanPath)) {
      return cleanPath;
    }
    const inWorkspace = path.resolve(workspaceDir, cleanPath);
    if (fs.existsSync(inWorkspace)) return inWorkspace;
    return cleanPath;
  };

  return [
    // Agent Skills 规程库加载、执行、修补与自学习沉淀
    {
      name: 'skills',
      description: 'Agent Skills (规程与能力包)：标准化任务指南与操作手册。action="use" 获取完整指导与配套脚本，action="list" 列出技能与运行就绪状态，action="save" 新建技能，action="learn" 自主学习沉淀工坊技能，action="patch" 对已有技能增量打补丁优化，action="remove" 移除自建技能。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['use', 'list', 'save', 'learn', 'patch', 'remove'], description: '操作类型' },
          name: { type: 'string', description: '技能英文名称（如 amap, trip-plan 等）' },
          category: { type: 'string', enum: ['devops', 'productivity', 'research', 'integration', 'utility', 'custom'], description: '技能业务分类（save/learn 时使用）' },
          description: { type: 'string', description: '技能简短说明（仅在 save/learn 时使用）' },
          instructions: { type: 'string', description: '技能 Markdown 指导正文（仅在 save/learn 时使用）' },
          oldText: { type: 'string', description: 'action="patch" 时用于精准匹配的原文本片段' },
          newText: { type: 'string', description: 'action="patch" 时替换后的新文本片段' }
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
            const list = skillsProvider
              .list()
              .filter((s: any) => s.enabled && s.usage?.lifecycleState !== 'archived');
            if (list.length === 0) {
              return { message: '当前没有已启用的技能。' };
            }
            return {
              total: list.length,
              skills: list.map((s: any) => ({
                name: s.name,
                category: s.category || 'utility',
                source: s.source,
                readiness: s.readiness ? (s.readiness.ready ? 'ready' : s.readiness.details || 'needs_setup') : 'ready',
                useCount: s.usage?.useCount || 0,
                description: s.description
              }))
            };
          }

          if (action === 'use') {
            if (!name) return { error: '参数 name 不能为空' };
            const skill = skillsProvider.get(name);
            if (!skill || !skill.enabled || skill.usage?.lifecycleState === 'archived') {
              const available = skillsProvider
                .list()
                .filter((s: any) => s.enabled && s.usage?.lifecycleState !== 'archived')
                .map((s: any) => s.name)
                .join(', ');
              return { error: `未找到或已禁用的技能 "${name}"。当前可用技能: ${available || '无'}` };
            }
            skillsProvider.recordUsage?.(skill.name, 'use');
            return {
              name: skill.name,
              category: skill.category || 'utility',
              readiness: skill.readiness,
              allowedTools: skill.allowedTools || [],
              dirPath: skill.dirPath,
              files: (skill.files || []).map((f: any) => f.path),
              description: skill.description,
              instructions: skillsProvider.getSkillInstructions?.(skill.name) || skill.body || skill.content
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

          if (action === 'patch') {
            if (!name) return { error: '参数 name 不能为空' };
            const oldText = String(args.oldText || '');
            const newText = String(args.newText ?? '');
            if (!oldText) return { error: '参数 oldText 不能为空' };
            if (!skillsProvider.patchSkillBody) {
              return { error: '当前运行环境不支持增量修补技能规程。' };
            }
            const res = skillsProvider.patchSkillBody(name, oldText, newText);
            if (!res.success) {
              return { error: res.error || '修补技能失败' };
            }
            return {
              success: true,
              message: `已成功增量更新技能 "${name}" 的 SKILL.md 规程并记录修订次数。`
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
    // 长期受控记忆检索、主题知识按需展开与事件意图管理
    {
      name: 'memory',
      description: '数字员工分层认知记忆与前瞻事件管理工具。action="recall" 检索记忆；action="remember" 沉淀事实/偏好/兴趣（支持 until 过期日期或 topic 主题归档）；action="forget" 遗忘条目；action="list_topics" 列出主题目录；action="open_topic" 按需展开指定主题细节；action="add_intent" 登记“当提到某事件时提醒我”的触发意图；action="list_intents" / "cancel_intent" 查看或取消事件意图。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['recall', 'remember', 'forget', 'list_topics', 'open_topic', 'add_intent', 'list_intents', 'cancel_intent'],
            description: '操作类型'
          },
          content: { type: 'string', description: '要沉淀的事实文本或事件意图描述（remember / add_intent 时必填）' },
          category: {
            type: 'string',
            enum: ['profile', 'preference', 'interest', 'people', 'routine', 'constraint', 'general'],
            description: '记忆分类：profile(身份画像), preference(偏好习惯), interest(兴趣与关注), people(关键人物), routine(例行约定), constraint(业务红线), general(通用知识)'
          },
          query: {
            type: 'string',
            description: '检索查询词或待遗忘的条目 ID/关键词。recall 时选填（留空或传 "*" / "all" / "全部" 可检索当前员工名下的全部受控记忆条目）'
          },
          topic: { type: 'string', description: '主题名称或 slug（remember 按主题归档，或 open_topic 按需展开主题时使用）' },
          until: { type: 'string', description: '可选时效截止日期 YYYY-MM-DD（过期后自动清理，适用于短期安排）' },
          triggers: { type: 'array', items: { type: 'string' }, description: 'add_intent 时的触发关键词列表' },
          intent_id: { type: 'string', description: 'cancel_intent 时指定的意图 ID' },
          botId: { type: 'string', description: '目标员工标识，默认为当前员工' }
        },
        required: ['action']
      },
      execute: async (args, execContext?: any) => {
        const memoryProvider = options?.memoryProvider;
        if (!memoryProvider) {
          return { error: '当前沙箱运行环境未挂载长期记忆管理器 (MemoryProvider 未配置)' };
        }
        const action = String(args.action || '');
        const targetBot = String(args.botId || execContext?.botId || execContext?.profile?.id || 'muse');
        const targetUser = String(execContext?.userId || 'user_web');

        try {
          if (action === 'recall') {
            const q = String(args.query || '').trim();
            const targetCategory = args.category ? (String(args.category).trim() as any) : undefined;
            const raw = memoryProvider.getMemory ? memoryProvider.getMemory(targetBot, targetUser) : '';

            if (memoryProvider.search) {
              const results = memoryProvider.search(targetBot, q, targetUser, {
                category: targetCategory,
                userId: targetUser
              });
              return {
                botId: targetBot,
                userId: targetUser,
                query: q || 'all',
                category: targetCategory,
                matchedCount: results.length,
                memory: raw,
                facts: results.slice(0, 15).map((r) => ({
                  id: r.item.id,
                  category: r.item.category,
                  source: r.item.source,
                  content: r.item.content,
                  until: r.item.until,
                  protected: r.item.protected,
                  score: Math.round(r.score * 100) / 100
                }))
              };
            }
            return { botId: targetBot, userId: targetUser, memory: raw };
          }

          if (action === 'remember') {
            const text = String(args.content || '').trim();
            if (!text) return { error: '沉淀记忆事实时 content 不能为空' };
            const until = typeof args.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.until.trim()) ? args.until.trim() : undefined;
            const topic = typeof args.topic === 'string' ? args.topic.trim() : '';
            if (topic && memoryProvider.upsertTopic) {
              const res = memoryProvider.upsertTopic(targetBot, topic, text, { until, origin: 'owner' }, targetUser);
              return {
                success: res.success,
                botId: targetBot,
                userId: targetUser,
                topic: res.topic?.slug || topic,
                recorded: text,
                until,
                error: res.error
              };
            }
            const cat = (args.category || 'general') as any;
            const isUser = typeof args.isUser === 'boolean' ? args.isUser : true;
            if (memoryProvider.addItem) {
              const res = memoryProvider.addItem(targetBot, text, cat, isUser, targetUser, {
                until,
                origin: isUser ? 'owner' : 'agent'
              });
              return {
                success: res.success,
                botId: targetBot,
                userId: targetUser,
                recorded: text,
                category: cat,
                until,
                item: res.item,
                warning: res.warning,
                error: res.error
              };
            }
            return { error: '当前记忆管理器不支持 addItem 方法' };
          }

          if (action === 'forget') {
            const target = String(args.query || args.content || '').trim();
            if (!target) return { error: '遗忘记忆时必须提供 query 指定待删除的条目 ID 或关键事实' };
            if (memoryProvider.deleteItem) {
              const res = memoryProvider.deleteItem(targetBot, target, targetUser);
              return {
                success: res.success,
                botId: targetBot,
                userId: targetUser,
                target,
                error: res.error
              };
            }
            return { error: '当前记忆管理器不支持 deleteItem 方法' };
          }

          if (action === 'list_topics') {
            if (!memoryProvider.listTopics) {
              return { error: '当前记忆管理器未启用主题知识库' };
            }
            const topics = memoryProvider.listTopics(targetBot, targetUser);
            return { success: true, count: topics.length, topics };
          }

          if (action === 'open_topic') {
            const topicName = String(args.topic || args.query || '').trim();
            if (!topicName) return { error: 'open_topic 需要提供 topic 参数' };
            if (!memoryProvider.getTopic) {
              return { error: '当前记忆管理器未启用主题知识库' };
            }
            const detail = memoryProvider.getTopic(targetBot, topicName, targetUser);
            if (!detail) {
              const available = (memoryProvider.listTopics?.(targetBot, targetUser) || []).map((t) => t.slug);
              return { error: `未找到主题 "${topicName}"`, availableTopics: available };
            }
            return { success: true, topic: detail };
          }

          if (action === 'add_intent') {
            if (!memoryProvider.createIntent) {
              return { error: '当前记忆管理器未启用前瞻事件意图' };
            }
            const description = String(args.content || '').trim();
            const triggers = Array.isArray(args.triggers) ? args.triggers.map(String) : [];
            const res = memoryProvider.createIntent(targetBot, { description, triggers }, targetUser);
            return { success: res.success, intent: res.intent, error: res.error };
          }

          if (action === 'list_intents') {
            if (!memoryProvider.listIntents) {
              return { error: '当前记忆管理器未启用前瞻事件意图' };
            }
            const intents = memoryProvider.listIntents(targetBot, targetUser);
            return { success: true, count: intents.length, intents };
          }

          if (action === 'cancel_intent') {
            if (!memoryProvider.cancelIntent) {
              return { error: '当前记忆管理器未启用前瞻事件意图' };
            }
            const intentId = String(args.intent_id || args.query || '').trim();
            if (!intentId) return { error: 'cancel_intent 需要提供 intent_id' };
            return memoryProvider.cancelIntent(targetBot, intentId, targetUser);
          }

          return { error: `未知操作 action: ${action}` };
        } catch (err: any) {
          return { error: err.message || String(err) };
        }
      }
    },
    // 长周期跨会话目标与计划推进管理
    {
      name: 'goals',
      description: '管理用户的长周期跨会话目标与分步推进计划。操作: `create` (title, description, steps[], category, due, cadence), `list` (status, category), `get` (goal_id), `update` (goal_id, title, description, category, due, cadence), `update_step` (goal_id, step_index, status, note), `add_step` (goal_id, title), `propose` (goal_id, reason, steps: 建议修订的新后续步骤), `set_status` (goal_id, status: active|paused|done|cancelled), `note` (goal_id, note)。当用户提出多步骤、中长周期目标或项目时，创建或更新目标；并随着推进及时标记步骤状态与成果。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'list', 'get', 'update', 'update_step', 'add_step', 'propose', 'set_status', 'note'],
            description: '操作动作'
          },
          goal_id: { type: 'string', description: '目标 ID' },
          title: { type: 'string', description: '目标名称' },
          description: { type: 'string', description: '目标描述与背景说明' },
          steps: { type: 'array', items: { type: 'string' }, description: '步骤标题列表' },
          category: {
            type: 'string',
            description: '领域分类: career(职业), learning(学习), engineering(研发), finance(财务), health(健康), relationships(协作), home(日常), travel(差旅), creative(创意), other(其他)'
          },
          due: { type: 'string', description: '目标截止日期 (YYYY-MM-DD)' },
          cadence: {
            type: 'string',
            description: '提醒与巡检周期，如 "daily 09:00", "weekdays 09:30", "weekly mon 10:00", "monthly 1 09:00" 或 ""(不提醒)'
          },
          step_index: { type: 'integer', description: '步骤序号 (1-based)' },
          step_id: { type: 'string', description: '步骤 ID (如 s_1)' },
          status: { type: 'string', description: '目标状态 (active|paused|done|cancelled) 或步骤状态 (pending|in_progress|done|blocked|skipped)' },
          reason: { type: 'string', description: '修订计划的充分理由 (propose 时使用)' },
          note: { type: 'string', description: '备忘或阶段性进展记录' }
        },
        required: ['action']
      },
      execute: async (args, context) => {
        if (!goalProvider) {
          return { error: '长周期目标服务提供者未初始化' };
        }
        const action = String(args.action || '');
        const targetBot = context?.botId || 'muse';
        const targetUser = context?.userId || 'user_web';

        try {
          if (action === 'create') {
            if (!args.title) return { error: '创建目标缺少 title 参数' };
            const goal = goalProvider.create?.({
              title: String(args.title),
              description: args.description ? String(args.description) : '',
              steps: Array.isArray(args.steps) ? args.steps.map(String) : [],
              category: args.category ? String(args.category) : 'other',
              due: args.due ? String(args.due) : '',
              cadence: args.cadence !== undefined ? String(args.cadence) : 'weekdays 09:30',
              botId: targetBot,
              userId: targetUser,
              notes: args.note ? String(args.note) : ''
            });
            return {
              success: true,
              message: `已创建目标 "${goal.title}" (ID: ${goal.id})`,
              goal: goalProvider.render ? goalProvider.render(goal) : goal
            };
          }

          if (action === 'list') {
            const list = goalProvider.list?.({
              status: args.status ? (String(args.status) as any) : undefined,
              category: args.category ? String(args.category) : undefined,
              botId: targetBot,
              userId: targetUser
            }) || [];
            if (list.length === 0) {
              return { success: true, message: '暂无符合条件的目标', count: 0, goals: [] };
            }
            const rendered = goalProvider.render
              ? list.map((g) => goalProvider.render!(g)).join('\n\n')
              : list;
            return { success: true, count: list.length, output: rendered };
          }

          const goalId = String(args.goal_id || '');
          if (!goalId) {
            return { error: '该操作必须提供 goal_id 参数' };
          }

          if (action === 'get') {
            const goal = goalProvider.get?.(goalId);
            if (!goal) return { error: `未找到目标 ${goalId}` };
            return { success: true, output: goalProvider.render ? goalProvider.render(goal) : goal };
          }

          if (action === 'update') {
            const updates: Record<string, any> = {};
            if (args.title !== undefined) updates.title = String(args.title);
            if (args.description !== undefined) updates.description = String(args.description);
            if (args.category !== undefined) updates.category = String(args.category);
            if (args.due !== undefined) updates.due = String(args.due);
            if (args.cadence !== undefined) updates.cadence = String(args.cadence);
            const goal = goalProvider.update?.(goalId, updates);
            if (!goal) return { error: `更新目标 ${goalId} 失败` };
            return { success: true, message: `目标已更新`, output: goalProvider.render ? goalProvider.render(goal) : goal };
          }

          if (action === 'update_step') {
            let stepIdx = args.step_index ? Number(args.step_index) : undefined;
            const stepId = args.step_id ? String(args.step_id) : undefined;
            const status = args.status ? (String(args.status) as any) : undefined;
            const note = args.note ? String(args.note) : undefined;

            const goal = goalProvider.updateStep?.(goalId, stepId || stepIdx || 1, status, { note });
            if (!goal) return { error: `步骤更新失败` };
            return { success: true, message: `步骤状态已更新`, output: goalProvider.render ? goalProvider.render(goal) : goal };
          }

          if (action === 'add_step') {
            const stepsToAdd = Array.isArray(args.steps)
              ? args.steps.map(String)
              : args.title
                ? [String(args.title)]
                : [];
            if (stepsToAdd.length === 0) return { error: 'add_step 需要提供 title 或 steps 数组' };
            let updatedGoal: any;
            for (const stepTitle of stepsToAdd) {
              updatedGoal = goalProvider.addStep?.(goalId, stepTitle, args.description ? String(args.description) : undefined);
            }
            if (!updatedGoal) return { error: `增加步骤失败` };
            return {
              success: true,
              message: `已增加 ${stepsToAdd.length} 个步骤`,
              output: goalProvider.render ? goalProvider.render(updatedGoal) : updatedGoal
            };
          }

          if (action === 'propose') {
            if (!args.reason || !Array.isArray(args.steps) || args.steps.length === 0) {
              return { error: 'propose 需要提供 reason 和至少一个后续步骤 steps 数组' };
            }
            const proposal = goalProvider.propose?.(goalId, String(args.reason), args.steps.map(String));
            return {
              success: true,
              message: `已提交计划修订提案，等待用户在应用内审批 (理由: ${args.reason})`,
              proposal
            };
          }

          if (action === 'set_status') {
            if (!args.status) return { error: 'set_status 需要提供 status 参数' };
            const goal = goalProvider.setStatus?.(goalId, String(args.status) as any);
            return { success: true, message: `目标状态已变更为 ${args.status}`, goal };
          }

          if (action === 'note') {
            if (!args.note) return { error: 'note 操作需要提供 note 参数' };
            const goal = goalProvider.appendNote?.(goalId, String(args.note));
            return { success: true, message: `已追加备忘记录`, goal };
          }

          return { error: `不支持的 action: ${action}` };
        } catch (err: any) {
          return { error: err.message || String(err) };
        }
      }
    },
    // 阶梯 2 (CLI): 微沙箱隔离 Shell 执行
    {
      name: 'execute_shell',
      description: '在受保护的微沙箱中执行 Linux Shell 与脚本命令（具备真实网络与 DNS 联通能力，支持 curl、python、node、git 等研发与数据抓取工具，保护系统目录与用户私密文件）',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 Bash 命令' },
          allow_network: { type: 'boolean', description: '是否允许网络访问，默认为 true' },
          timeout_ms: { type: 'number', description: '执行超时时间（毫秒），默认为 60000ms' }
        },
        required: ['command']
      },
      execute: async (args, context) => {
        const cmd = String(args.command);
        console.log(`[Tool:execute_shell] ${cmd}`);
        const allowNetwork = typeof args.allow_network === 'boolean' ? args.allow_network : true;
        const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : 60000;
        const result = await sandbox.execute(cmd, { cwd: workspaceDir, allowNetwork, timeoutMs });
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

    // 阶梯 2 (CLI): 离线代码执行 (强制 allow_network=false 阻断外网出逃)
    {
      name: 'execute_code',
      description: '在严格离线微沙箱环境中执行 Python、Node.js 或 Bash 脚本代码（按能力分级隔离网络，保障代码执行安全）',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '待执行的代码文本' },
          language: { type: 'string', enum: ['python', 'node', 'bash', 'sh'], description: '代码运行环境，默认为 python' },
          timeout_ms: { type: 'number', description: '执行超时时间（毫秒），默认为 30000ms' }
        },
        required: ['code']
      },
      execute: async (args) => {
        const code = String(args.code || '');
        const lang = String(args.language || 'python').toLowerCase();
        const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : 30000;
        console.log(`[Tool:execute_code] 离线沙箱执行 ${lang} 代码 (${code.length} 字符)`);

        let cmd = '';
        if (lang === 'python' || lang === 'py') {
          cmd = `python3 -c ${JSON.stringify(code)}`;
        } else if (lang === 'node' || lang === 'javascript' || lang === 'js') {
          cmd = `node -e ${JSON.stringify(code)}`;
        } else {
          cmd = code;
        }

        const result = await sandbox.execute(cmd, { cwd: workspaceDir, allowNetwork: false, timeoutMs });
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

    // 阶梯 3 (Web): 轻量 HTTP 页面/接口抓取（支持官方 Markdown 正文提取接口与直接 HTTP）
    {
      name: 'web_fetch',
      description: '抓取目标网页文本与内容（优先通过云端 Fetch 接口提取纯净 Markdown 正文，亦支持普通 HTTP/HTTPS 网页与 API JSON 响应）',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '目标 HTTP/HTTPS URL' },
          headers: { type: 'object', description: '可选请求头' }
        },
        required: ['url']
      },
      execute: async (args) => {
        const url = String(args.url || '').trim();
        console.log(`[Tool:web_fetch] 抓取: ${url}`);
        const apiKey = process.env.DEEPSEEK_API_KEY;

        // 若配置了 API Key，优先尝试官方高保真 Markdown 正文提取接口
        if (apiKey && (url.startsWith('http://') || url.startsWith('https://'))) {
          try {
            const res = await fetch('https://api.deepseek.com/v1/tools/fetch', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey.replace(/[^\x00-\x7F]/g, '').trim()}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ url })
            });
            if (res.ok) {
              const data: any = await res.json();
              return {
                title: data.title || '',
                content: data.content || '',
                engine: 'deepseek-fetch'
              };
            }
          } catch {
            // 降级使用基础 HTTP 抓取
          }
        }

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

    // 阶梯 3 (Web): 搜索引擎网页实时检索
    {
      name: 'web_search',
      description: '基于自研搜索引擎实时搜索互联网最新网页与结构化结果，支持高级搜索语法 (site:, -, "精确短语", lang:zh,en)',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索词（1～128 个字符，支持 site:, lang: 等操作符）' },
          count: { type: 'number', description: '返回条数（1～50，默认为 5）' },
          need_content: { type: 'boolean', description: '是否抓取并在正文中返回网页 Markdown 文本，默认为 true' },
          ori_question: { type: 'string', description: '触发搜索的用户原始问题，有助于精准理解意图' }
        },
        required: ['query']
      },
      execute: async (args) => {
        const query = String(args.query || '').trim();
        if (!query) return { error: '搜索词 query 不能为空' };

        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
          return { error: '未配置 DEEPSEEK_API_KEY，无法使用网页搜索接口。' };
        }

        const count = typeof args.count === 'number' ? Math.min(Math.max(1, args.count), 50) : 5;
        const needContent = typeof args.need_content === 'boolean' ? args.need_content : true;

        try {
          const bodyPayload: Record<string, unknown> = {
            query,
            count,
            need_content: needContent
          };
          if (args.ori_question) {
            bodyPayload.ori_question = String(args.ori_question);
          }

          const res = await fetch('https://api.deepseek.com/v1/tools/search', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey.replace(/[^\x00-\x7F]/g, '').trim()}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyPayload)
          });

          if (!res.ok) {
            const errText = await res.text();
            return { error: `搜索服务异常 (HTTP ${res.status}): ${errText}` };
          }

          const data: any = await res.json();
          return {
            query,
            count: data.results?.length || 0,
            results: data.results || []
          };
        } catch (err: any) {
          return { error: `搜索服务调用失败: ${err.message || String(err)}` };
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

    // 阶梯 1 (API/Local): 对话内联交互组件 (HTML / SVG Widget)
    {
      name: 'show_widget',
      description:
        '在对话流内直接渲染可交互的 HTML/SVG 智能界面组件（如逐层展开的结构图、参数联动计算器、动态图表、对比卡片等）。组件运行在透明无边框的隔离沙箱中，优先使用宿主 CSS 变量（--om-bg, --om-surface, --om-surface-2, --om-border, --om-fg, --om-muted, --om-accent, --om-accent-soft, --accent-green, --accent-amber, --accent-red）以自动适配明暗模式，也可通过 window.museclaw.send(prompt, { hidden?: boolean }) 或 data-muse-send="..." 按钮将交互结果回传给对话。传入 widget_id 可原位替换更新已有组件；请尽量填写 fallback_text 供非网页通道降级展示。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '交互组件标题（最多 120 字符）' },
          html: {
            type: 'string',
            description: '自包含的 HTML 片段或完整文档，或以 <svg 开头的 SVG 代码'
          },
          fallback_text: {
            type: 'string',
            description: '可选降级纯文本摘要，用于在飞书/如流或历史回放中展示'
          },
          widget_id: {
            type: 'string',
            description: '可选，传入已有组件 ID 可原位更新该交互组件'
          },
          height: {
            type: 'number',
            description: '可选初始高度（像素，自动钳制在 120~1200，渲染后会自动随内容自适应）'
          }
        },
        required: ['title', 'html']
      },
      execute: async (args) => {
        const validation = validateWidgetInput({
          title: args.title,
          html: args.html,
          height: args.height,
          fallback_text: args.fallback_text,
          fallbackText: args.fallbackText
        });
        if (!validation.ok) {
          return {
            success: false,
            error: validation.error
          };
        }

        const now = Date.now();
        const existingId = typeof args.widget_id === 'string' && args.widget_id.trim() ? args.widget_id.trim() : '';
        const widgetId = existingId || `wgt_${now}_${Math.random().toString(36).slice(2, 6)}`;
        const widget: WidgetPayload = {
          id: widgetId,
          title: validation.value.title,
          html: validation.value.html,
          kind: validation.value.kind,
          ...(validation.value.height !== undefined ? { height: validation.value.height } : {}),
          ...(validation.value.fallbackText !== undefined ? { fallbackText: validation.value.fallbackText } : {}),
          createdAt: now,
          updatedAt: now
        };

        console.log(`[Tool:show_widget] 渲染交互组件: ${widget.title} (${widget.id}, ${widget.kind})`);
        return {
          success: true,
          exitCode: 0,
          widget_id: widget.id,
          title: widget.title,
          message: `交互组件「${widget.title}」已渲染展示 (id: ${widget.id})`,
          __widget: widget
        };
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

    // 阶梯 1 (API/Local): 文件安全读取（支持路径自动解析与图片/二进制安全提示）
    {
      name: 'read_file',
      description: '读取沙箱或工作区中的指定文件内容（具备安全路径保护与图片格式防误读提示）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件相对路径、绝对路径或 /uploads/ 地址' }
        },
        required: ['path']
      },
      execute: async (args) => {
        const rawPath = String(args.path || '');
        console.log(`[Tool:read_file] 读取文件: ${rawPath}`);
        const resolvedPath = resolveUploadOrWorkspacePath(rawPath);
        const ext = path.extname(resolvedPath).toLowerCase();
        const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff']);

        if (imageExts.has(ext)) {
          let size = 0;
          try {
            size = fs.statSync(resolvedPath).size;
          } catch {}
          return {
            isImage: true,
            filename: path.basename(resolvedPath),
            path: resolvedPath,
            sizeBytes: size,
            notice: '该文件为图片格式。若需提取图中的文字、表格、界面字段或报错内容，请直接调用 ocr_document 工具进行高精度图文识别。'
          };
        }

        try {
          const content = await environment.readFile(resolvedPath);
          return { content, sizeBytes: Buffer.byteLength(content, 'utf-8') };
        } catch (error: any) {
          return { error: error.message };
        }
      }
    },

    // 阶梯 1 (API/Local): 文档与图像云端 OCR 识别（官方接口规范）
    {
      name: 'ocr_document',
      description: '识别图片、屏幕截图、PDF、Word 或 PPT 文档中的文字、表格与版面结构（支持按页解析与文字定位，适用于用户上传的附件图片、单据、扫描件或复杂文档）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件相对路径、绝对路径或 /uploads/ 附件地址' },
          purpose: {
            type: 'string',
            enum: ['text_recognition', 'rich_layout_recognition'],
            description: '解析模式：text_recognition（标准提取文字，默认）或 rich_layout_recognition（富版面与结构化解析）'
          }
        },
        required: ['path']
      },
      execute: async (args) => {
        const rawPath = String(args.path || '');
        const purpose = (args.purpose as string) || 'text_recognition';
        const resolvedPath = resolveUploadOrWorkspacePath(rawPath);

        if (!fs.existsSync(resolvedPath)) {
          return { error: `文件未找到: ${rawPath}` };
        }

        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
          return {
            error: '未配置 DEEPSEEK_API_KEY，无法调用云端文档/图片 OCR 解析服务。请在系统环境变量或设置中配置 API Key。'
          };
        }

        try {
          const fileBuffer = fs.readFileSync(resolvedPath);
          const blob = new Blob([fileBuffer]);
          const formData = new FormData();
          formData.append('file', blob, path.basename(resolvedPath));
          formData.append('purpose', purpose);

          const res = await fetch('https://api.deepseek.com/v1/tools/ocr', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey.replace(/[^\x00-\x7F]/g, '').trim()}`
            },
            body: formData
          });

          if (!res.ok) {
            const errBody = await res.text();
            return {
              error: `OCR 服务调用异常 (HTTP ${res.status}): ${errBody}`
            };
          }

          const data: any = await res.json();
          if (data.error) {
            return { error: `OCR 识别失败: ${data.error.message || JSON.stringify(data.error)}` };
          }

          const formattedPages = (data.pages || []).map((p: any) => `--- 第 ${p.index + 1} 页 ---\n${p.text}`).join('\n\n');
          return {
            success: true,
            id: data.id,
            purpose: data.purpose,
            pageCount: data.page_count,
            text: formattedPages,
            pages: data.pages,
            usage: data.usage
          };
        } catch (err: any) {
          return { error: `OCR 执行发生异常: ${err.message || String(err)}` };
        }
      }
    },

    // 阶梯 1 (API/Local): 文件安全写入 (带应用层安全根路径校验与敏感文件黑名单拦截)
    {
      name: 'write_file',
      description: '在工作区安全根目录下创建或覆写文件（具备应用层安全根路径校验与敏感文件黑名单拦截防护）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件相对路径或 /workspace 内部绝对路径' },
          content: { type: 'string', description: '待写入的文件文本内容' }
        },
        required: ['path', 'content']
      },
      execute: async (args) => {
        const targetPath = String(args.path || '');
        const content = String(args.content ?? '');
        console.log(`[Tool:write_file] 写入文件: ${targetPath}`);
        try {
          await environment.writeFile(targetPath, content);
          return {
            success: true,
            path: targetPath,
            sizeBytes: Buffer.byteLength(content, 'utf-8')
          };
        } catch (error: any) {
          return { success: false, error: error.message || String(error) };
        }
      }
    },

    // 阶梯 1/3 (IM Egress): 飞书消息安全推送 (由宿主网关代发，解决沙箱禁网/无DNS问题)
    {
      name: 'feishu_send_message',
      description: '通过宿主网关飞书通道发送消息（支持私聊 open_id、群聊 chat_id、邮箱或系统预设通知人；支持纯文本与互动卡片）。沙箱 Shell 默认隔离外网与 DNS，禁止直接 curl open.feishu.cn，必须通过此工具由宿主网关代理外发。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '消息正文内容，支持纯文本或 Markdown 排版' },
          receive_id: { type: 'string', description: '接收者标识（用户 open_id 如 ou_xxx，群聊 chat_id 如 oc_xxx，或邮箱）。如不提供则自动推送到系统预设通知人' },
          title: { type: 'string', description: '消息或卡片标题（可选，如 "代码巡检完成通知"）' },
          msg_type: {
            type: 'string',
            enum: ['text', 'interactive'],
            description: '消息类型：text (纯文本) 或 interactive (富文本互动卡片，默认推荐)'
          },
          receive_id_type: {
            type: 'string',
            enum: ['open_id', 'chat_id', 'user_id', 'email'],
            description: '接收者 ID 类型（可选，会自动根据 ID 前缀智能推导）'
          }
        },
        required: ['content']
      },
      execute: async (args) => {
        const content = String(args.content || '');
        const receiveId = args.receive_id ? String(args.receive_id) : undefined;
        const title = args.title ? String(args.title) : undefined;
        const msgType = (args.msg_type === 'text' ? 'text' : 'interactive') as 'text' | 'interactive';
        const receiveIdType = args.receive_id_type as any;

        console.log(`[Tool:feishu_send_message] 推送飞书消息: to=${receiveId || 'default_notify_user'} type=${msgType}`);

        if (feishuProvider) {
          return await feishuProvider.sendMessage({
            receiveId,
            content,
            msgType,
            receiveIdType,
            title
          });
        }

        // 回退方案：通过宿主网关本地接口发送 (127.0.0.1:8799 或 8787)
        try {
          const gwPort = process.env.PORT || 8799;
          const res = await fetch(`http://127.0.0.1:${gwPort}/api/channels/feishu/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              receive_id: receiveId,
              content,
              msg_type: msgType,
              receive_id_type: receiveIdType,
              title
            })
          });
          if (res.ok) {
            return await res.json();
          }
          const errData = await res.json().catch(() => ({}));
          return {
            success: false,
            error: (errData as any).error || `Gateway returned HTTP ${res.status}`
          };
        } catch (err: any) {
          return {
            success: false,
            error: `宿主网关飞书服务未连接或未配置 (FEISHU_APP_ID / FEISHU_APP_SECRET): ${err.message}`
          };
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
