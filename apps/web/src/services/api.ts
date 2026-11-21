import type {
  Bot,
  Session,
  Message,
  Goal,
  Routine,
  RoutineRun,
  MemoryItem,
  MemoryReport,
  Artifact,
  AuditLog,
  Grant,
  ModelsConfig,
  ModelProvider,
  FeedPost,
  FeedActivity,
  SandboxStatus,
  McpServer,
  User
} from '../types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const init: RequestInit = {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  const res = await fetch(path, init);
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
  getSessions: (botId: string, userId?: string) =>
    request<Session[]>(`/api/sessions?bot_id=${encodeURIComponent(botId)}&userId=${encodeURIComponent(userId || 'user_web')}&include_empty=true`),
  createSession: (botId: string, title = '新任务对话', userId?: string) =>
    request<Session>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ botId, title, userId: userId || 'user_web' }),
    }),
  getMessages: async (sessionId: string, userId?: string) => {
    try {
      const res = await request<any>(`/api/sessions/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId || 'user_web')}`);
      return (Array.isArray(res) ? res : res.messages) || [];
    } catch {
      return [];
    }
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
  getGoals: () => request<Goal[]>('/api/goals'),
  createGoal: (data: Partial<Goal>) => request<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(data) }),
  updateGoal: (id: string, data: Partial<Goal>) =>
    request<Goal>(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteGoal: (id: string) => request<{ success: boolean }>(`/api/goals/${id}`, { method: 'DELETE' }),

  // Routines
  getRoutines: () => request<Routine[]>('/api/routines'),
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
  runRoutine: (id: string) => request<RoutineRun>(`/api/routines/${id}/run`, { method: 'POST' }),
  getRoutineRuns: (id: string) => request<RoutineRun[]>(`/api/routines/${id}/runs`),

  // Memory
  getMemory: (botId: string) =>
    request<{ content: string; items: MemoryItem[]; reports: MemoryReport[] }>(`/api/memory/${botId}`),
  updateMemory: (botId: string, content: string) =>
    request<{ success: boolean }>(`/api/memory/${botId}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  consolidateMemory: (botId: string, dryRun: boolean) =>
    request<{ success: boolean; summary?: string; diff?: string }>(`/api/memory/${botId}/consolidate`, {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),
  undoMemory: (botId: string) => request<{ success: boolean }>(`/api/memory/${botId}/undo`, { method: 'POST' }),

  // Feed
  getFeed: () => request<{ posts: FeedPost[]; settings?: any }>('/api/feed'),
  triggerFeedWrite: (instructions?: string) =>
    request<FeedPost>('/api/feed', { method: 'POST', body: JSON.stringify({ instructions }) }),
  getFeedSettings: () => request<{ daily: boolean; time: string; instructions: string }>('/api/feed/settings'),
  saveFeedSettings: (data: { daily: boolean; time: string; instructions: string }) =>
    request<{ success: boolean }>('/api/feed/settings', { method: 'POST', body: JSON.stringify(data) }),
  getFeedActivities: () => request<FeedActivity[]>('/api/feed/activity'),

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
  getMcpServers: async (): Promise<McpServer[]> => {
    const res = await request<any>('/api/mcp/servers');
    // 服务端返回 { servers, totalTools }
    return Array.isArray(res) ? res : Array.isArray(res?.servers) ? res.servers : [];
  },

  // Security & Audit
  getPolicy: () => request<any>('/api/policy'),
  savePolicy: (data: any) => request<{ success: boolean }>('/api/policy', { method: 'POST', body: JSON.stringify(data) }),
  getGrants: () => request<Grant[]>('/api/grants'),
  revokeGrant: (id: string) => request<{ success: boolean }>(`/api/grants/${id}`, { method: 'DELETE' }),
  getAuditLogs: () => request<AuditLog[]>('/api/audit'),

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
