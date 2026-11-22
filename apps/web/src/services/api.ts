import type {
  Bot,
  Session,
  Goal,
  Routine,
  RoutineRun,
  MemoryItem,
  MemoryReport,
  MemoryCategory,
  MemoryStats,
  Artifact,
  AuditLog,
  Grant,
  ModelsConfig,
  ModelProvider,
  AvatarStudioView,
  AvatarSession,
  AvatarPreset,
  FeedPost,
  FeedActivity,
  SandboxStatus,
  McpServer,
  Skill,
  SkillFileEntry,
  User
} from '../types';

let onUnauthorizedCallback: (() => void) | null = null;
export function setOnUnauthorizedCallback(cb: () => void) {
  onUnauthorizedCallback = cb;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('请求超时 (15s)，请检查网络连接'));
  }, 15000);

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  const init: RequestInit = {
    ...options,
    signal: controller.signal,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  try {
    const res = await fetch(path, init);
    clearTimeout(timeoutId);

    if (res.status === 401) {
      if (!path.startsWith('/api/auth/me') && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) {
        onUnauthorizedCallback?.();
      }
    }

    if (!res.ok) {
      let errMsg = `Request failed: ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson.error || errJson.message || errMsg;
      } catch {
        // ignore JSON parse error
      }
      throw new Error(errMsg);
    }
    return res.json() as Promise<T>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export const api = {
  // Auth
  getMe: () => request<{ user: User | null }>('/api/auth/me'),
  login: (data: { username: string; password?: string }) =>
    request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data: { username: string; password?: string; displayName?: string }) =>
    request<{ user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Bots
  getBots: () => request<Bot[]>('/api/bots'),
  createBot: (data: Partial<Bot>) => request<Bot>('/api/bots', { method: 'POST', body: JSON.stringify(data) }),
  updateBot: (id: string, data: Partial<Bot>) => {
    // 前端用 camelCase，服务端存的是 snake_case；这里做一次显式映射，避免“保存成功但没生效”
    const payload: Record<string, unknown> = { ...data };
    if ('systemPrompt' in data) {
      payload.system_prompt = data.systemPrompt;
      delete payload.systemPrompt;
    }
    if ('approvalMode' in data) {
      const map: Record<string, string> = { ASK: 'ask', AUTO_EDITS: 'auto_edits', FULL: 'full' };
      payload.approval_level = map[String(data.approvalMode || 'ASK').toUpperCase()] || 'ask';
      delete payload.approvalMode;
    }
    return request<Bot>(`/api/bots/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },

  // Sessions
  getSessions: (botId: string, _userId?: string) =>
    request<Session[]>(`/api/sessions?bot_id=${encodeURIComponent(botId)}&include_empty=true`),
  createSession: (botId: string, title = '新任务对话', kind: 'main' | 'side' = 'side', _userId?: string) =>
    request<Session>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ botId, title, kind }),
    }),
  clearSession: (sessionId: string) =>
    request<{ success: boolean; cleared?: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/clear`, {
      method: 'POST',
    }),
  getMessages: async (sessionId: string, _userId?: string) => {
    const res = await request<any>(`/api/sessions/${encodeURIComponent(sessionId)}`);
    return (Array.isArray(res) ? res : res.messages) || [];
  },
  // 服务端只提供 /api/approvals/:approvalId，参数是 approved/scope
  sendDecision: (_sessionId: string, actionId: string, decision: 'APPROVE' | 'REJECT') =>
    request<{ success: boolean }>(`/api/approvals/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      body: JSON.stringify({ approved: decision === 'APPROVE', scope: 'once', operator: 'web' }),
    }),

  // Models
  getModelsConfig: () => request<ModelsConfig>('/api/models/config'),
  saveModelsConfig: (data: { activeProviderId?: string; provider?: Partial<ModelProvider> & { id: string } }) =>
    request<{ success: boolean }>('/api/models/config', { method: 'POST', body: JSON.stringify(data) }),
  testModel: (providerId: string, modelId?: string) =>
    request<{ success?: boolean; ok?: boolean; latency?: number; latencyMs?: number; message?: string; error?: string }>('/api/models/test', {
      method: 'POST',
      body: JSON.stringify({ providerId, id: providerId, model: modelId }),
    }),
  probeCli: (cliName: string) =>
    request<{ available: boolean; version?: string; path?: string }>('/api/models/probe-cli', {
      method: 'POST',
      body: JSON.stringify({ cliName }),
    }),
  getMeshNodes: () => request<any[]>('/api/mesh/nodes'),

  // Goals
  getGoals: (filter?: { category?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (filter?.category) params.set('category', filter.category);
    if (filter?.status) params.set('status', filter.status);
    const qs = params.toString();
    return request<Goal[]>(`/api/goals${qs ? `?${qs}` : ''}`);
  },
  createGoal: (data: Partial<Goal>) => request<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(data) }),
  updateGoal: (id: string, data: Partial<Goal> & Record<string, any>) =>
    request<Goal>(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteGoal: (id: string) => request<{ success: boolean }>(`/api/goals/${id}`, { method: 'DELETE' }),
  addGoalStep: (goalId: string, data: { title: string; description?: string; verificationCommand?: string }) =>
    request<Goal>(`/api/goals/${goalId}/steps`, { method: 'POST', body: JSON.stringify(data) }),
  updateGoalStep: (
    goalId: string,
    stepId: string,
    data: { status?: string; note?: string; verificationCommand?: string }
  ) => request<Goal>(`/api/goals/${goalId}/steps/${stepId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  advanceGoal: (id: string, override?: any) =>
    request<any>(`/api/goals/${id}/advance`, { method: 'POST', body: JSON.stringify(override || {}) }),
  checkInGoal: (id: string, note?: string) =>
    request<any>(`/api/goals/${id}/checkin`, { method: 'POST', body: JSON.stringify({ note }) }),
  retryGoal: (id: string, data?: { stepId?: string; guidance?: string }) =>
    request<any>(`/api/goals/${id}/retry`, { method: 'POST', body: JSON.stringify(data || {}) }),
  rollbackGoal: (id: string, data: { targetStepId: string; reason?: string }) =>
    request<any>(`/api/goals/${id}/rollback`, { method: 'POST', body: JSON.stringify(data) }),
  resolveProposal: (id: string, accept: boolean) =>
    request<any>(`/api/goals/${id}/proposal/resolve`, { method: 'POST', body: JSON.stringify({ accept }) }),

  // Routines
  getRoutines: () => request<Routine[]>('/api/routines'),
  getRoutine: (id: string) => request<{ routine: Routine; runs: RoutineRun[] }>(`/api/routines/${id}`),
  createRoutine: async (data: Partial<Routine>): Promise<Routine> => {
    const res = await request<{ success: boolean; routine: Routine }>('/api/routines', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return (res as any)?.routine ?? (res as unknown as Routine);
  },
  updateRoutine: (id: string, data: Partial<Routine>) =>
    request<Routine>(`/api/routines/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRoutine: (id: string) => request<{ success: boolean }>(`/api/routines/${id}`, { method: 'DELETE' }),
  runRoutine: (id: string) => request<{ success: boolean; message: string; run?: RoutineRun }>(`/api/routines/${id}/run`, { method: 'POST' }),
  toggleRoutine: (id: string) => request<{ success: boolean; enabled: boolean }>(`/api/routines/${id}/toggle`, { method: 'POST' }),
  getRoutineRuns: (id: string) => request<RoutineRun[]>(`/api/routines/${id}/runs`),
  triggerRoutineWebhook: (id: string, token?: string, payload?: unknown) =>
    request<{ success: boolean; message: string }>(
      `/api/routines/${id}/trigger${token ? `?token=${encodeURIComponent(token)}` : ''}`,
      { method: 'POST', body: JSON.stringify(payload || {}) }
    ),

  // Memory
  getMemory: (botId: string) =>
    request<{
      content: string;
      items: MemoryItem[];
      stats?: MemoryStats;
      reports: MemoryReport[];
    }>(`/api/memory/${botId}`),
  updateMemory: (botId: string, content: string) =>
    request<{ success: boolean; content: string; items: MemoryItem[]; stats: MemoryStats }>(
      `/api/memory/${botId}`,
      { method: 'PUT', body: JSON.stringify({ content }) }
    ),
  addMemoryItem: (botId: string, content: string, category: MemoryCategory = 'general', isUser = true) =>
    request<{ success: boolean; item?: MemoryItem; items: MemoryItem[]; stats: MemoryStats; warning?: string; error?: string }>(
      `/api/memory/${botId}/items`,
      { method: 'POST', body: JSON.stringify({ content, category, isUser }) }
    ),
  updateMemoryItem: (botId: string, itemId: string, content: string, category?: MemoryCategory) =>
    request<{ success: boolean; item?: MemoryItem; items: MemoryItem[]; stats: MemoryStats; error?: string }>(
      `/api/memory/${botId}/items/${itemId}`,
      { method: 'PUT', body: JSON.stringify({ content, category }) }
    ),
  deleteMemoryItem: (botId: string, itemId: string) =>
    request<{ success: boolean; items: MemoryItem[]; stats: MemoryStats; error?: string }>(
      `/api/memory/${botId}/items/${itemId}`,
      { method: 'DELETE' }
    ),
  consolidateMemory: (botId: string, dryRun: boolean, budgetShare = 0.2) =>
    request<{ success: boolean; report: MemoryReport; summary?: string; stats?: MemoryStats; error?: string }>(
      `/api/memory/${botId}/consolidate`,
      {
        method: 'POST',
        body: JSON.stringify({ dryRun, budget_share: budgetShare })
      }
    ),
  undoMemory: (botId: string) =>
    request<{ success: boolean; message: string; restoredMemory?: string; stats?: MemoryStats; error?: string }>(
      `/api/memory/${botId}/undo`,
      { method: 'POST' }
    ),

  // Feed
  getFeed: () => request<{ posts: FeedPost[]; settings?: any }>('/api/feed'),
  triggerFeedWrite: (instructions?: string) =>
    request<any>('/api/feed', { method: 'POST', body: JSON.stringify({ instructions }) }),
  getFeedSettings: () => request<{ daily: boolean; time: string; instructions: string }>('/api/feed/settings'),
  saveFeedSettings: (data: { daily: boolean; time: string; instructions: string }) =>
    request<{ success: boolean }>('/api/feed/settings', { method: 'POST', body: JSON.stringify(data) }),
  getFeedActivities: () => request<FeedActivity[]>('/api/feed/activity'),
  deleteFeedPost: (id: string) => request<{ ok: boolean }>(`/api/feed/posts/${id}`, { method: 'DELETE' }),

  // Sandbox & MCP
  getSandboxStatus: async (): Promise<SandboxStatus> => {
    const res = await request<any>('/api/sandbox/status');
    const micro = res?.microSandbox || res?.micro_sandbox || {};
    return {
      ...micro,
      // 服务端字段是 active，页面用 available
      available: Boolean(micro.active ?? micro.available),
      engine: micro.engine,
      blocksNetwork: micro.blocksNetwork,
      workspaceDir: micro.workspaceDir,
      reason: micro.reason,
      ladder: res?.channelLadder || res?.channel_ladder,
    } as SandboxStatus;
  },
  getMcpServers: async (): Promise<{ servers: McpServer[]; totalTools: number }> => {
    const res = await request<any>('/api/mcp/servers');
    // 服务端返回 { servers, totalTools }
    const servers = Array.isArray(res) ? res : Array.isArray(res?.servers) ? res.servers : [];
    return { servers, totalTools: typeof res?.totalTools === 'number' ? res.totalTools : 0 };
  },

  // Skills Ecosystem (Agent Skills 规程与技能管理)
  getSkills: (params?: { botId?: string; q?: string; category?: string; source?: string; readiness?: string; channel?: string; tag?: string; enabled?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.botId) sp.set('botId', params.botId);
    if (params?.q) sp.set('q', params.q);
    if (params?.category && params.category !== 'all') sp.set('category', params.category);
    if (params?.source && params.source !== 'all') sp.set('source', params.source);
    if (params?.readiness && params.readiness !== 'all') sp.set('readiness', params.readiness);
    if (params?.channel && params.channel !== 'all') sp.set('channel', params.channel);
    if (params?.tag && params.tag !== 'all') sp.set('tag', params.tag);
    if (params?.enabled !== undefined) sp.set('enabled', String(params.enabled));
    const queryStr = sp.toString();
    return request<{ skills: Skill[]; total: number }>(`/api/skills${queryStr ? `?${queryStr}` : ''}`);
  },
  getSkill: (name: string) => request<{ skill: Skill }>(`/api/skills/${encodeURIComponent(name)}`),
  createSkill: (data: Partial<Skill>) =>
    request<{ success: boolean; skill: Skill }>('/api/skills', { method: 'POST', body: JSON.stringify(data) }),
  importSkill: (text: string) =>
    request<{ success: boolean; skill: Skill }>('/api/skills/import', { method: 'POST', body: JSON.stringify({ text }) }),
  updateSkill: (name: string, data: Partial<Skill>) =>
    request<{ success: boolean; skill: Skill }>(`/api/skills/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSkill: (name: string) =>
    request<{ success: boolean; name: string }>(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  patchSkill: (name: string, patch: { enabled?: boolean; everyBot?: boolean; assignedBots?: string[] }) =>
    request<{ success: boolean; skill: Skill }>(`/api/skills/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  testSkill: (name: string, input?: string, botId?: string) =>
    request<{ success: boolean; skill: string; input: string; output: string; toolCalls?: any[] }>(`/api/skills/${encodeURIComponent(name)}/test`, {
      method: 'POST',
      body: JSON.stringify({ input, botId }),
    }),
  exportSkillUrl: (name: string) => `/api/skills/${encodeURIComponent(name)}/export`,
  exportSkillZipUrl: (name: string) => `/api/skills/${encodeURIComponent(name)}/export-zip`,
  uploadSkillZip: async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return request<{ success: boolean; skill: Skill }>('/api/skills/upload-zip', {
      method: 'POST',
      body: JSON.stringify({ base64 }),
    });
  },
  getSkillFiles: (name: string) => request<{ files: SkillFileEntry[] }>(`/api/skills/${encodeURIComponent(name)}/files`),
  getSkillFileContent: (name: string, filePath: string) =>
    request<{ success: boolean; content?: string; isText?: boolean; size?: number; error?: string }>(
      `/api/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(filePath)}`
    ),
  saveSkillFile: (name: string, filePath: string, content: string) =>
    request<{ success: boolean; error?: string }>(`/api/skills/${encodeURIComponent(name)}/file`, {
      method: 'POST',
      body: JSON.stringify({ path: filePath, content }),
    }),
  deleteSkillFile: (name: string, filePath: string) =>
    request<{ success: boolean; error?: string }>(`/api/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE',
    }),

  // Feed & Activity
  getFeedActivity: (userId?: string) =>
    request<any[]>(`/api/feed/activity${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),

  // Security & Audit
  getPolicy: () => request<any>('/api/policy'),
  savePolicy: (data: any) => request<{ success: boolean }>('/api/policy', { method: 'POST', body: JSON.stringify(data) }),
  getGrants: () => request<Grant[]>('/api/grants'),
  revokeGrant: (id: string) => request<{ success: boolean }>(`/api/grants/${id}`, { method: 'DELETE' }),
  getAuditLogs: (sessionId?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return request<AuditLog[]>(`/api/audit${qs ? `?${qs}` : ''}`);
  },

  // Avatar Studio
  avatarStatus: (botId?: string) =>
    request<AvatarStudioView>(`/api/avatar/status${botId ? `?botId=${encodeURIComponent(botId)}` : ''}`),
  avatarPresets: () => request<AvatarPreset[]>('/api/avatar/presets'),
  avatarBegin: (data: { description: string; style?: string; thread?: string; botId?: string; reference?: string }) =>
    request<AvatarSession>('/api/avatar/begin', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  avatarStart: (session: string) =>
    request<AvatarSession>('/api/avatar/start', {
      method: 'POST',
      body: JSON.stringify({ session }),
    }),
  avatarChoose: (session: string, index: number, botId?: string) =>
    request<AvatarSession>('/api/avatar/choose', {
      method: 'POST',
      body: JSON.stringify({ session, index, botId }),
    }),
  avatarCancel: (session: string) =>
    request<AvatarSession>('/api/avatar/cancel', {
      method: 'POST',
      body: JSON.stringify({ session }),
    }),
  avatarMoods: (botId?: string) =>
    request<AvatarSession>('/api/avatar/moods', {
      method: 'POST',
      body: JSON.stringify({ botId }),
    }),

  // Artifacts
  getArtifacts: () => request<Artifact[]>('/api/artifacts'),

  // Upload
  uploadFile: async (file: File) => {
    // 服务端只接受 JSON（data URL / base64），不是 multipart
    const MAX_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      throw new Error(`文件超过 10 MB（当前 ${(file.size / 1024 / 1024).toFixed(1)} MB）`);
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取本地文件失败'));
      reader.readAsDataURL(file);
    });
    if (!dataUrl.startsWith('data:')) throw new Error('无法读取文件内容');

    const res = await request<{ success: boolean; url: string; filename: string }>('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ image: dataUrl, name: file.name, type: file.type }),
    });
    if (!res?.url) throw new Error('服务端没有返回文件地址');
    return { url: res.url, name: file.name, size: file.size };
  },
};
