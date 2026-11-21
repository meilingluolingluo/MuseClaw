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
    durationMs?: number;
    ok?: boolean;
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
  /** 服务端字段：cron 表达式，如 "0 9 * * 1-5" */
  cronExpr: string;
  /** 服务端字段：执行指令 */
  instructions: string;
  /** 归属的数字员工 */
  agentId: string;
  enabled: boolean;
  status?: 'idle' | 'running' | 'paused';
  nextRunAt?: number;
  lastRunAt?: number;
  lastStatus?: string;
  createdAt?: number;
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
  id?: string;
  ts?: string;
  timestamp?: number;
  event?: string;
  eventType?: string;
  botId?: string;
  sessionId?: string;
  tool?: string;
  target?: string;
  decision?: string;
  operator?: string;
  details?: any;
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
  baseUrl?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  modelId?: string;
  candidateModels?: string[];
  supportedModels?: string[];
  description?: string;
  isLocalAgent?: boolean;
  installed?: boolean;
  isAvailable?: boolean;
  executablePath?: string;
  cliPath?: string;
  version?: string;
  detectedVersion?: string;
  hasKey?: boolean;
  maskedKey?: string;
  custom?: boolean;
}

export interface ModelsConfig {
  activeProviderId: string;
  providers: ModelProvider[];
}

export interface FeedPost {
  id: string;
  title: string;
  body?: string;
  content?: string;
  area?: string;
  prompt?: string;
  ts?: string;
  date?: string;
  tags?: string[];
  sessionId?: string;
  routineId?: string;
  routineName?: string;
  reactions?: Record<string, number>;
}

export interface FeedActivity {
  id: string;
  ts?: string;
  timestamp?: number;
  kind?: 'pass' | 'goal' | 'artifact' | 'approval' | 'routine' | 'chat' | string;
  type?: string;
  title?: string;
  text?: string;
  summary?: string;
  botName?: string;
  sessionId?: string;
  sessionTitle?: string;
  path?: string;
  quiet?: boolean;
}

export interface SandboxStatus {
  available: boolean;
  engine: string;
  version?: string;
  blocksNetwork?: boolean;
  workspaceDir?: string;
  reason?: string;
  details?: string;
}

export interface McpServer {
  name: string;
  toolCount?: number;
  tools?: string[];
}

export type SkillCategory = 'devops' | 'productivity' | 'research' | 'integration' | 'utility' | 'custom';
export type SkillSource = 'builtin' | 'custom' | 'imported' | 'learned';
export type SkillChannel = 'api' | 'cli' | 'web' | 'browser' | 'gui' | 'mixed';

export interface SkillRequirements {
  bins?: string[];
  env?: string[];
  os?: string[];
}

export interface SkillReadiness {
  ready: boolean;
  missingBins?: string[];
  missingEnv?: string[];
  details?: string;
}

export interface SkillFileEntry {
  path: string;
  size: number;
  executable?: boolean;
  isText: boolean;
  updatedAt?: number;
}

export interface Skill {
  name: string;
  description: string;
  category: SkillCategory;
  channel?: SkillChannel;
  tags?: string[];
  source: SkillSource;
  enabled: boolean;
  everyBot?: boolean;
  assignedBots: string[];
  content: string;
  body: string;
  dirPath?: string;
  files?: SkillFileEntry[];
  filesCount?: number;
  scriptsCount?: number;
  requires?: SkillRequirements;
  readiness?: SkillReadiness;
  metadata?: Record<string, unknown>;
  allowedTools?: string[];
  license?: string;
  compatibility?: string;
  warnings: string[];
  updatedAt?: number;
  createdAt?: number;
}
