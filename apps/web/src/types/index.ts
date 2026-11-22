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
  role?: string;
  description?: string;
  avatar?: string;
  avatarType?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  system_prompt?: string;
  tools?: string[];
  allowedTools?: string[];
  tool_allowlist?: string[];
  approvalMode?: 'ASK' | 'AUTO_EDITS' | 'FULL';
  approval_level?: 'ask' | 'auto_edits' | 'full';
  tainted?: boolean;
  enabled?: boolean;
  is_coordinator?: boolean;
  created_at?: number;
  updated_at?: number;
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
    status?: 'approved' | 'rejected' | 'pending' | 'cancelled';
    decidedBy?: string;
    decidedAt?: number;
  };
}

export type StepStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped';

export type GoalCategory =
  | 'career'
  | 'learning'
  | 'engineering'
  | 'finance'
  | 'health'
  | 'relationships'
  | 'home'
  | 'travel'
  | 'creative'
  | 'other'
  | string;

export interface GoalStep {
  id: string;
  idx?: number;
  title: string;
  description?: string;
  verificationCommand?: string;
  verificationOutput?: string;
  status: StepStatus;
  result?: string;
  note?: string;
  blockedReason?: string;
  updatedAt?: number;
}

export interface GoalProposal {
  proposalId: string;
  reason: string;
  proposedSteps: Array<GoalStep | string>;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt?: number;
  decidedAt?: number;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  botId?: string;
  userId?: string;
  category?: string;
  status: 'active' | 'paused' | 'done' | 'completed' | 'cancelled';
  progress?: number;
  due?: string;
  cadence?: string;
  cronExpr?: string;
  nextCheckInAt?: number;
  lastCheckInAt?: number;
  steps?: GoalStep[];
  notes?: string;
  proposal?: GoalProposal;
  createdAt?: number;
  updatedAt?: number;
}

export type ScheduleKind = 'cron' | 'every' | 'at';
export type DeliverTarget = 'silent' | 'feed' | 'im_webhook' | 'all';
export type OverlapPolicy = 'skip' | 'queue';

export interface RoutineStats {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  avgDurationMs: number;
}

export interface RoutineToolCall {
  tool: string;
  args: Record<string, unknown>;
  output?: string;
  error?: string;
  timestamp?: number;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName?: string;
  agentId?: string;
  triggerSource?: 'schedule' | 'webhook' | 'manual';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: 'running' | 'success' | 'failed';
  error?: string;
  summary?: string;
  output?: string;
  toolCalls?: RoutineToolCall[];
  approvalRequired?: boolean;
  quiet?: boolean;
  sessionId?: string;
  logs?: string[];
}

export interface Routine {
  id: string;
  name: string;
  description?: string;
  agentId: string;
  scheduleKind?: ScheduleKind;
  cronExpr: string;
  scheduleHumanZh?: string;
  timezone?: string;
  instructions: string;
  enabled: boolean;
  status?: 'idle' | 'running' | 'paused';
  nextRunAt?: number;
  nextRunTimes?: number[];
  lastRunAt?: number;
  lastStatus?: string;
  overlap?: OverlapPolicy;
  timeoutSeconds?: number;
  feedPublish?: boolean;
  deliverTo?: DeliverTarget;
  deleteAfterRun?: boolean;
  webhookSecret?: string;
  stats?: RoutineStats;
  createdAt?: number;
  updatedAt?: number;
}

export type MemoryCategory = 'profile' | 'preference' | 'people' | 'routine' | 'constraint' | 'general';

export interface MemoryItem {
  id: string;
  content: string;
  category: MemoryCategory;
  source: 'user' | 'agent';
  protected?: boolean;
  rawLine?: string;
  section?: string;
}

export interface MemoryStats {
  totalBytes: number;
  maxBytes: number;
  lineCount: number;
  maxLines: number;
  itemCount: number;
  userAnchorCount: number;
  agentItemCount: number;
  usagePercent: number;
  status: 'healthy' | 'warning' | 'critical';
}

export interface MemoryChange {
  op: 'merge' | 'drop';
  before: string[];
  after?: string;
  reason?: string;
  timestamp?: number;
}

export interface MemoryPlanItem {
  op: 'merge' | 'drop';
  ids: string[];
  before: string[];
  content?: string;
  reason?: string;
}

export interface MemoryReport {
  id?: string;
  botId?: string;
  timestamp: number;
  considered: number;
  changed: number;
  merged: MemoryChange[];
  dropped: MemoryChange[];
  skipped: string[];
  planned?: MemoryPlanItem[];
  summary?: string;
  dryRun?: boolean;
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
  approvalId?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
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
