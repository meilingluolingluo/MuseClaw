/**
 * @museclaw/protocol
 * Core event and data contracts for MuseClaw.
 */

// 0. Channel Ladder (兼容性保留)
export type ExecutionChannel = 'api' | 'cli' | 'web' | 'browser' | 'gui' | 'mixed';

// 0.1 Skill Ecosystem Models (Agent Skills 标准化规程与技能包体系)
export type SkillCategory = 'devops' | 'productivity' | 'research' | 'integration' | 'utility' | 'custom';
export type SkillSource = 'builtin' | 'custom' | 'imported' | 'learned';

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

export interface SkillMetadata {
  author?: string;
  version?: string;
  category?: SkillCategory;
  tags?: string[];
  license?: string;
  homepage?: string;
  [key: string]: unknown;
}

export interface SkillFileEntry {
  path: string;
  size: number;
  executable?: boolean;
  isText: boolean;
  updatedAt?: number;
}

export interface SkillDefinition {
  name: string;
  description: string;
  category: SkillCategory;
  channel?: ExecutionChannel;
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
  metadata?: SkillMetadata;
  allowedTools?: string[];
  license?: string;
  compatibility?: string;
  warnings: string[];
  updatedAt?: number;
  createdAt?: number;
}

export interface ChannelLadderStep {
  toolName: string;
  channel: ExecutionChannel;
  rung: number;
  timestamp: number;
}

// 1. Agent Profile (多 Bot 实体与配置定义)
export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  system_prompt: string;
  systemPrompt?: string;          // 兼容别名
  model?: string;
  tool_allowlist: string[];
  defaultTools?: string[];        // 兼容别名
  memory_ns: string;              // 独立记忆命名空间，如 "bots/<id>"
  memory?: string;                // 本地 MEMORY.md 静态记忆文本
  approval_level?: 'ask' | 'auto_edits' | 'full'; // 差异化审批级别: ask (严格审批) | auto_edits (免批编辑) | full (仅拦截破坏底线)
  is_coordinator?: boolean;       // 全局协调者（默认最多一个）
  enabled: boolean;
  created_at: number;
  updated_at: number;
  role?: string;
  avatar?: string;
  sandboxConfig?: {
    requiresBrowser: boolean;
    persistentProfile: boolean;
    resourceLimit: {
      memoryMb: number;
      cpuShares: number;
    };
  };
}

// 1.1 Session 数据模型 (会话强从属于单一 Bot)
export interface Session {
  id: string;
  bot_id: string;                 // 会话归属的 Bot ID，创建后不可换绑
  botId?: string;                 // 兼容别名
  userId?: string;                // 归属用户 ID
  title?: string;
  kind?: 'main' | 'side';         // 会话类型：'main' 主聊 (常驻核心对话) | 'side' 旁聊 (独立隔离任务)
  created_at?: number;
  updated_at: number;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
    /** 用户上传的附件，历史回放时用于还原图片与文件 */
    attachments?: Array<{ name?: string; type?: string; url: string; size?: number }>;
    /** 工具执行轨迹：刷新/回放时仍能看到调用过程 */
    toolCalls?: Array<{
      tool: string;
      params?: unknown;
      result?: unknown;
      status?: string;
      durationMs?: number;
      ok?: boolean;
    }>;
    /** 模型思考过程（若开启 reasoning） */
    reasoning?: string;
  }>;
}

// 1.2 入站消息与路由结果类型
export interface InboundMessage {
  text: string;
  session_id?: string;
  bot_id?: string;
  user_id?: string;
}

export interface RouteResult {
  bot: AgentProfile;
  session_id: string;
  mention_name?: string;
}

// 2. Sentinel Security & Approval (哨兵门禁与审批模型)
export type ActionRiskLevel = 'read_only' | 'low_risk' | 'high_risk' | 'irreversible';

export interface ApprovalRequest {
  approvalId: string;
  approval_id?: string;
  sessionId: string;
  session_id?: string;
  botId: string;
  bot_id?: string;
  userId: string;
  user_id?: string;
  riskLevel: ActionRiskLevel;
  actionSummary: string;
  targetDetails: {
    command?: string;
    endpoint?: string;
    method?: string;
    parameters?: Record<string, unknown>;
  };
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  isTainted?: boolean;
  channelLadder?: {
    channel: ExecutionChannel;
    rung: number;
    reason?: string;
  };
  requestedAt: number;
  decidedAt?: number;
}

// 3. AG-UI & Streaming Event Types (流式交互事件规范)
export type MuseEvent =
  | { type: 'agent:state'; botId: string; bot_id?: string; session_id?: string; state: 'idle' | 'running' | 'paused' | 'error' }
  | { type: 'stream:text-delta'; text: string; bot_id?: string; session_id?: string }
  | { type: 'task:plan'; steps: Array<{ id: string; description: string; status: 'pending' | 'in_progress' | 'done' | 'failed' }>; bot_id?: string; session_id?: string }
  | { type: 'tool:call_start'; toolName: string; input: Record<string, unknown>; bot_id?: string; session_id?: string }
  | { type: 'tool:call_end'; toolName: string; output: unknown; durationMs: number; bot_id?: string; session_id?: string }
  | { type: 'sentinel:approval_needed'; request: ApprovalRequest; bot_id?: string; session_id?: string }
  | { type: 'sentinel:taint_updated'; sessionId: string; isTainted: boolean; reason: string; bot_id?: string; session_id?: string }
  | { type: 'ladder:escalation'; sessionId: string; toolName: string; fromRung?: number; toRung: number; channel: ExecutionChannel; bot_id?: string; session_id?: string }
  | { type: 'sandbox:execution'; command: string; engine: 'bwrap' | 'env_scrubbed'; networkBlocked: boolean; bot_id?: string; session_id?: string }
  | { type: 'artifact:created'; artifactType: 'file' | 'report' | 'screenshot'; title: string; url: string; bot_id?: string; session_id?: string }
  | { type: 'avatar'; event: AvatarSession; bot_id?: string; session_id?: string };

// 4. Trajectory Export Format (执行轨迹导出格式，供模型微调与对齐使用)
export interface TrajectoryStep {
  stepIndex: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  thought?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
  observation?: unknown;
}

export interface SessionTrajectory {
  sessionId: string;
  userId: string;
  botId: string;
  taskGoal: string;
  isSuccessful: boolean;
  steps: TrajectoryStep[];
  timestamp: number;
}

// 5. Virtual Persona & Avatar System (虚拟形象全生命周期模型)
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
