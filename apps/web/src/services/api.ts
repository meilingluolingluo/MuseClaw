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
  updateBot: (id: string, data: Partial<Bot>) =>
    request<Bot>(`/api/bots/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Sessions
  getSessions: (botId: string) => request<Session[]>(`/api/bots/${botId}/sessions`),
  createSession: (botId: string, title?: string) =>
    request<Session>(`/api/bots/${botId}/sessions`, { method: 'POST', body: JSON.stringify({ title }) }),
  getMessages: (sessionId: string) => request<Message[]>(`/api/sessions/${sessionId}/messages`),
  sendDecision: (sessionId: string, actionId: string, decision: 'APPROVE' | 'REJECT') =>
    request<{ success: boolean }>(`/api/sessions/${sessionId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ actionId, decision }),
    }),

  // Models
  getModelsConfig: () => request<ModelsConfig>('/api/models/config'),
  saveModelsConfig: (data: ModelsConfig) =>
    request<{ success: boolean }>('/api/models/config', { method: 'POST', body: JSON.stringify(data) }),
  testModel: (providerId: string, modelId?: string) =>
    request<{ success: boolean; latency?: number; message?: string }>('/api/models/test', {
      method: 'POST',
      body: JSON.stringify({ providerId, modelId }),
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
  createRoutine: (data: Partial<Routine>) =>
    request<Routine>('/api/routines', { method: 'POST', body: JSON.stringify(data) }),
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
  getSandboxStatus: () => request<SandboxStatus>('/api/sandbox/status'),
  getMcpServers: () => request<McpServer[]>('/api/mcp/servers'),

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
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json() as Promise<{ url: string; name: string; size: number }>;
  },
};
