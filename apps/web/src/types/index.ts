export type TabType = 'chat' | 'feed' | 'goals' | 'routines' | 'memory' | 'skills' | 'audit' | 'artifacts';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export interface Bot {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  avatarType?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  tools?: string[];
  allowedTools?: string[];
  approvalMode?: 'ASK' | 'AUTO_EDITS' | 'FULL';
  tainted?: boolean;
}

export interface Session {
  id: string;
  botId: string;
  title: string;
  lastMessageAt?: number;
  messageCount?: number;
  createdAt?: number;
}

export interface MessageAttachment {
  name: string;
  size?: number;
  type?: string;
  url?: string;
  artifactId?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  toolCalls?: Array<{
    tool: string;
    params?: any;
    result?: any;
    status?: string;
  }>;
  attachments?: MessageAttachment[];
  timestamp?: number;
  approvalRequest?: {
    actionId: string;
    description: string;
    command?: string;
  };
}

export interface GoalProposal {
  id: string;
  title: string;
  diff: string;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'paused' | 'completed';
  progress: number;
  checkInSchedule?: string;
  lastCheckIn?: number;
  proposals?: GoalProposal[];
  createdAt?: number;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'success' | 'failed';
  summary?: string;
  logs?: string[];
}

export interface Routine {
  id: string;
  name: string;
  description?: string;
  cron?: string;
  intervalMs?: number;
  enabled: boolean;
  targetBotId: string;
  prompt: string;
  sandboxMode?: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
  lastStatus?: string;
}

export interface MemoryItem {
  id: string;
  section: string;
  content: string;
  protected?: boolean;
}

export interface MemoryReport {
  id: string;
  timestamp: number;
  summary: string;
  details?: string;
}

export interface Artifact {
  id: string;
  title: string;
  type: string;
  path: string;
  size: number;
  createdAt: number;
  previewUrl?: string;
}

export interface AuditLog {
  id: string;
  timestamp: number;
  eventType: string;
  botId?: string;
  sessionId?: string;
  target?: string;
  decision?: string;
  details?: string;
}

export interface Grant {
  id: string;
  scope: string;
  permission: string;
  grantedAt: number;
  expiresAt?: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  endpoint?: string;
  apiKey?: string;
  modelId?: string;
  probeStatus?: string;
  detectedVersion?: string;
  cliPath?: string;
  isAvailable?: boolean;
  description?: string;
  custom?: boolean;
  supportedModels?: string[];
}

export interface ModelsConfig {
  activeProviderId: string;
  providers: ModelProvider[];
}

export interface FeedPost {
  id: string;
  date: string;
  title: string;
  content: string;
  area?: string;
  tags?: string[];
  reactions?: Record<string, number>;
}

export interface FeedActivity {
  id: string;
  timestamp: number;
  type: string;
  botName: string;
  summary: string;
  sessionId?: string;
}

export interface SandboxStatus {
  available: boolean;
  engine: string;
  details?: string;
}

export interface McpServer {
  id: string;
  name: string;
  status: string;
  toolsCount?: number;
}
