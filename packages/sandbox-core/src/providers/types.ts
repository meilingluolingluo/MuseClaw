export type ProviderDriverKind = 'claude' | 'codex' | 'pi' | 'ollama' | 'openai-compat';

export const NATIVE_AGENT_DRIVERS: ReadonlySet<ProviderDriverKind> = new Set([
  'claude',
  'codex',
  'pi'
]);

export type PermissionMode = 'ask' | 'auto_edits' | 'full';
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ProviderModelDescriptor {
  slug: string;
  name: string;
  isCustom?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  contextWindow?: number;
}

export interface ProviderAuthSnapshot {
  status: 'authenticated' | 'unauthenticated' | 'unknown';
  method?: string;
  label?: string;
  email?: string;
  subscriptionType?: string;
  endpoint?: string;
}

export type ProviderStatus =
  | 'ready'
  | 'unauthenticated'
  | 'warning'
  | 'error'
  | 'not_found'
  | 'disabled';

export interface ProviderSnapshot {
  instanceId: string;
  driver: ProviderDriverKind;
  displayName: string;
  enabled: boolean;
  installed: boolean;
  status: ProviderStatus;
  version: string | null;
  executablePath?: string;
  auth: ProviderAuthSnapshot;
  models: ProviderModelDescriptor[];
  slashCommands?: string[];
  checkedAt: number;
  environmentId: string;
  environmentLabel: string;
  message?: string;
  installCommand?: string;
}

export interface ProviderInstanceConfig {
  instanceId: string;
  driver: ProviderDriverKind;
  displayName: string;
  enabled: boolean;
  environmentId: string;
  model: string;
  customModels?: string[];
  binaryPath?: string;
  configDir?: string;
  cwd?: string;
  extraArgs?: string;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  env?: Record<string, string>;
  permissionMode?: PermissionMode;
  effort?: ReasoningEffort;
  description?: string;
  isDefault?: boolean;
}

export type AgentRuntimeEvent =
  | { type: 'session.started'; providerSessionId: string; model?: string; version?: string }
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.delta'; text: string }
  | { type: 'tool.start'; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | {
      type: 'tool.end';
      toolCallId: string;
      toolName: string;
      output: unknown;
      isError?: boolean;
      durationMs: number;
    }
  | {
      type: 'approval.request';
      requestId: string;
      toolName: string;
      summary: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'turn.completed';
      text: string;
      reasoning?: string;
      providerSessionId?: string;
      usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
      durationMs: number;
    }
  | { type: 'turn.failed'; error: string; code?: string; retryable?: boolean }
  | { type: 'turn.interrupted'; reason?: string };

export interface TurnRunParams {
  sessionKey: string;
  instance: ProviderInstanceConfig;
  prompt: string;
  systemPrompt?: string;
  cwd?: string;
  model?: string;
  effort?: ReasoningEffort;
  permissionMode?: PermissionMode;
  resumeSessionId?: string;
  signal?: AbortSignal;
}

export interface ApprovalDecision {
  approved: boolean;
  updatedInput?: Record<string, unknown>;
  message?: string;
}

export interface ProviderDriver {
  readonly kind: ProviderDriverKind;
  readonly supportsNativeSession: boolean;
  probe(
    instance: ProviderInstanceConfig,
    options?: { environmentId?: string; environmentLabel?: string }
  ): Promise<ProviderSnapshot>;
  runTurn(params: TurnRunParams): AsyncGenerator<AgentRuntimeEvent, void, void>;
  interruptTurn(sessionKey: string): Promise<void>;
  respondApproval(requestId: string, decision: ApprovalDecision): Promise<boolean>;
  closeSession(sessionKey: string): Promise<void>;
  disposeAll(): Promise<void>;
}

export interface EnvironmentInfo {
  environmentId: string;
  label: string;
  kind: 'local' | 'remote';
  hostname: string;
  platform: string;
  arch: string;
  status: 'online' | 'offline';
  connectedAt?: number;
  lastSeenAt?: number;
  snapshots?: ProviderSnapshot[];
}
