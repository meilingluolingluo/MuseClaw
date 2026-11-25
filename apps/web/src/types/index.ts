export type TabType = 'chat' | 'feed' | 'goals' | 'routines' | 'memory' | 'skills' | 'artifacts';

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
  kind?: 'main' | 'side';
  lastMessageAt?: number;
  messageCount?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface MessageAttachment {
  name: string;
  size?: number;
  type?: string;
  url?: string;
  artifactId?: string;
}

export interface WidgetPayload {
  id: string;
  title: string;
  html: string;
  kind?: 'html' | 'svg';
  height?: number;
  fallbackText?: string;
  createdAt?: number;
  updatedAt?: number;
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
  widgets?: WidgetPayload[];
  hidden?: boolean;
  timestamp?: number;
  avatarEvent?: AvatarSession;
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

export type MisfirePolicy = 'skip' | 'run_once';
export type RoutineRunStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'timeout' | 'interrupted';

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName?: string;
  agentId?: string;
  triggerSource?: 'schedule' | 'webhook' | 'manual';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status: RoutineRunStatus;
  attempt?: number;
  maxAttempts?: number;
  cancelledBy?: 'user' | 'timeout' | 'restart';
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
  lastStatus?: RoutineRunStatus | string;
  recentOutcomes?: RoutineRunStatus[];
  overlap?: OverlapPolicy;
  misfirePolicy?: MisfirePolicy;
  jitterSeconds?: number;
  maxRetries?: number;
  circuitBreakerThreshold?: number;
  consecutiveFailures?: number;
  circuitBrokenAt?: number;
  timeoutSeconds?: number;
  feedPublish?: boolean;
  deliverTo?: DeliverTarget;
  webhookUrl?: string;
  modelOverride?: string;
  hasQueuedRun?: boolean;
  deleteAfterRun?: boolean;
  webhookSecret?: string;
  stats?: RoutineStats;
  createdAt?: number;
  updatedAt?: number;
}

export type MemoryCategory = 'profile' | 'preference' | 'people' | 'routine' | 'constraint' | 'interest' | 'general';

export interface MemoryItem {
  id: string;
  content: string;
  category: MemoryCategory;
  source: 'user' | 'agent';
  protected?: boolean;
  rawLine?: string;
  section?: string;
  until?: string;
  origin?: 'owner' | 'agent' | 'feedback';
  weight?: number;
}

export interface MemoryTopicSummary {
  slug: string;
  name: string;
  description: string;
  aliases: string[];
  readOnly: boolean;
  entryCount: number;
  updatedAt: number;
}

export interface MemoryTopicDetail extends MemoryTopicSummary {
  content: string;
  items: MemoryItem[];
}

export interface StandingIntent {
  id: string;
  description: string;
  triggers: string[];
  cooldownSeconds: number;
  maxFires: number;
  fireCount: number;
  lastFiredAt?: number;
  expiresAt: number;
  status: 'armed' | 'done' | 'expired' | 'cancelled';
  createdAt: number;
}

export interface ReflectionIdea {
  id: string;
  text: string;
  fromSessions: number[];
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: number;
  updatedAt?: number;
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
  publishedAt?: string;
  date?: string;
  tags?: string[];
  sessionId?: string;
  routineId?: string;
  routineName?: string;
  reactions?: Record<string, number>;
  sourceUrl?: string;
  sourceName?: string;
  imageUrl?: string;
  liked?: boolean;
  dismissed?: boolean;
  kind?: 'intel' | 'insight' | 'brief';
}

export interface ProactiveStatus {
  enabled: boolean;
  quietStart: string;
  quietEnd: string;
  lastActiveAt: number;
  lastBriefAt: number;
  lastBriefDay: string;
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

export type McpTransportType = 'stdio' | 'http' | 'sse';
export type McpServerStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'auth_required'
  | 'disabled';
export type McpRiskLevel = 'safe' | 'moderate' | 'sensitive';

export interface McpToolView {
  name: string;
  fullName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  risk: McpRiskLevel;
  estimatedTokens: number;
}

export interface McpServer {
  name: string;
  transport: McpTransportType;
  enabled: boolean;
  status: McpServerStatus;
  description: string;
  category: string;
  docs?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  envMasked: Record<string, string>;
  headersMasked: Record<string, string>;
  envKeys: string[];
  headerKeys: string[];
  timeoutMs: number;
  connectTimeoutMs: number;
  maxResultBytes: number;
  risk: McpRiskLevel;
  everyBot: boolean;
  assignedBots: string[];
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  connectedAt?: number;
  lastProbeAt?: number;
  lastLatencyMs?: number;
  error?: string;
  errorKind?: string;
  toolCount: number;
  enabledToolCount: number;
  estimatedTokens: number;
  tools: McpToolView[];
  source: 'managed' | 'workspace' | 'catalog';
}

export interface McpProbeResult {
  ok: boolean;
  transport: McpTransportType;
  latencyMs: number;
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  toolCount: number;
  estimatedTokens: number;
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  authRequired?: boolean;
  error?: string;
  errorKind?: string;
  server?: McpServer | null;
}

export interface McpToolCallResult {
  ok: boolean;
  server: string;
  tool: string;
  fullName: string;
  durationMs: number;
  outputText: string;
  raw?: unknown;
  truncated: boolean;
  originalBytes: number;
  isError?: boolean;
  error?: string;
}

export interface McpLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'stderr';
  message: string;
}

export interface McpRuntimeStatus {
  npx: boolean;
  node: boolean;
  uvx: boolean;
  docker: boolean;
  python3: boolean;
}

export interface McpCatalogField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  help?: string;
}

export interface McpCatalogArgField {
  index: number;
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}

export interface McpCatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  transport: McpTransportType;
  command?: string;
  args?: string[];
  url?: string;
  docs?: string;
  risk?: McpRiskLevel;
  requiresRuntime?: keyof McpRuntimeStatus;
  requiredEnv?: McpCatalogField[];
  requiredHeaders?: McpCatalogField[];
  requiredArgs?: McpCatalogArgField[];
  tags?: string[];
}

export interface McpImportGap {
  target: 'env' | 'header' | 'url' | 'arg';
  key: string;
  rawValue: string;
  label: string;
}

export interface McpParsedImportEntry {
  name: string;
  config: {
    transport?: McpTransportType;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    description?: string;
    category?: string;
  };
  gaps: McpImportGap[];
  exists: boolean;
}

export type ConnectorCategory =
  | 'builtin'
  | 'work'
  | 'talk'
  | 'dev'
  | 'data'
  | 'design'
  | 'search'
  | 'money'
  | 'custom';

export type ConnectorAuthType = 'none' | 'key' | 'oauth' | 'stdio' | 'sse';

export type ConnectorStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'reauth';

export interface ConnectorTool {
  name: string;
  description: string;
  enabled: boolean;
  parameters?: Record<string, unknown>;
}

export interface ConnectorItem {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  status: ConnectorStatus;
  authType: ConnectorAuthType;
  icon?: string;
  color: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  key?: string;
  token?: string;
  keyHint?: string;
  docs?: string;
  connectedAt?: number;
  updatedAt?: number;
  error?: string;
  disabledTools?: string[];
  tools: ConnectorTool[];
}

export type SkillCategory = 'devops' | 'productivity' | 'research' | 'integration' | 'utility' | 'custom';
export type SkillSource = 'builtin' | 'custom' | 'imported' | 'learned';
export type SkillChannel = 'api' | 'cli' | 'web' | 'browser' | 'gui' | 'mixed';
export type SkillLifecycleState = 'active' | 'stale' | 'archived';
export type SkillTrustLevel = 'builtin' | 'custom' | 'imported' | 'learned';
export type SkillSecurityVerdict = 'safe' | 'caution' | 'dangerous';

export interface SkillEnvRequirementSpec {
  name: string;
  prompt?: string;
  help?: string;
  optional?: boolean;
}

export interface SkillEnvVarStatus {
  name: string;
  configured: boolean;
  source?: 'process' | 'managed';
  maskedValue?: string;
  prompt?: string;
  help?: string;
  optional?: boolean;
}

export interface SkillRequirements {
  bins?: string[];
  env?: string[];
  envSpecs?: SkillEnvRequirementSpec[];
  os?: string[];
}

export interface SkillReadiness {
  ready: boolean;
  status?: 'available' | 'setup_needed' | 'unsupported';
  missingBins?: string[];
  missingEnv?: string[];
  envStatus?: SkillEnvVarStatus[];
  details?: string;
}

export interface SkillSecurityFinding {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  file: string;
  message: string;
}

export interface SkillSecurityReport {
  trustLevel: SkillTrustLevel;
  verdict: SkillSecurityVerdict;
  policyAction: 'allow' | 'ask' | 'block';
  findings: SkillSecurityFinding[];
}

export interface SkillLintFinding {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
}

export interface SkillLintReport {
  score: number;
  estimatedTokens: number;
  findings: SkillLintFinding[];
}

export interface SkillUsageStats {
  useCount: number;
  viewCount: number;
  patchCount: number;
  lastUsedAt?: number;
  pinned?: boolean;
  lifecycleState: SkillLifecycleState;
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
  usage?: SkillUsageStats;
  lint?: SkillLintReport;
  security?: SkillSecurityReport;
  hasBuiltinOverride?: boolean;
  updatedAt?: number;
  createdAt?: number;
}

export interface ManagedSkillEnvItem extends SkillEnvVarStatus {
  usedBy: string[];
}

export interface SkillImportPreview {
  valid: boolean;
  error?: string;
  name?: string;
  description?: string;
  category?: SkillCategory;
  requires?: SkillRequirements;
  readiness?: SkillReadiness;
  lint?: SkillLintReport;
  security?: SkillSecurityReport;
  conflict?: 'builtin' | 'existing_custom' | null;
  content?: string;
}

// 虚拟形象系统类型定义
export type AvatarMood = 'idle' | 'working' | 'waiting' | 'happy' | 'error';
export type AvatarStyle = 'muse' | 'flat' | 'clay' | 'watercolor' | 'pixel' | 'line' | 'sticker';
export type AvatarStage = 'estimate' | 'drawing' | 'choose' | 'posing' | 'animating' | 'done' | 'cancelled' | 'failed';

export interface AvatarCostEstimate {
  pictures?: number;
  clips?: number;
  model?: string;
  clip_model?: string;
  cloud?: boolean;
  error?: string;
}

export interface AvatarSession {
  id: string;
  thread: string;
  botId?: string;
  stage: AvatarStage;
  description: string;
  style: AvatarStyle | string;
  reference?: string;
  cost?: AvatarCostEstimate;
  candidates: Array<string | null>;
  errors?: string[];
  chosen?: number | null;
  face?: string | null;
  moods?: Partial<Record<AvatarMood, string>>;
  clips?: Partial<Record<AvatarMood, string>>;
  message?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AvatarFaceMeta {
  id: string;
  botId?: string;
  description: string;
  style: string;
  model: string;
  clip_model?: string;
  created: number;
  moods?: Partial<Record<AvatarMood, string>>;
  clips?: Partial<Record<AvatarMood, string>>;
}

export interface AvatarPreset {
  id: string;
  name: string;
  description: string;
  style: string;
  emoji?: string;
  moods: Record<AvatarMood, string>;
  clips?: Partial<Record<AvatarMood, string>>;
}

export interface AvatarStudioView {
  available: boolean;
  provider?: string;
  imageModel: string;
  videoModel?: string;
  cloud: boolean;
  current: AvatarSession | null;
  face: AvatarFaceMeta | null;
  presets: AvatarPreset[];
  customFaces?: AvatarFaceMeta[];
}

