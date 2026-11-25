export type McpTransportType = 'stdio' | 'http' | 'sse';

export type McpServerStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'auth_required'
  | 'disabled';

export type McpErrorKind =
  | 'auth'
  | 'timeout'
  | 'unreachable'
  | 'protocol'
  | 'process'
  | 'config';

export type McpRiskLevel = 'safe' | 'moderate' | 'sensitive';

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpToolPolicy {
  enabled?: boolean;
  risk?: McpRiskLevel;
}

export interface McpServerConfig {
  transport?: McpTransportType;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  description?: string;
  category?: string;
  docs?: string;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  maxResultBytes?: number;
  risk?: McpRiskLevel;
  disabledTools?: string[];
  toolPolicies?: Record<string, McpToolPolicy>;
  everyBot?: boolean;
  assignedBots?: string[];
  source?: 'managed' | 'workspace' | 'catalog';
}

export interface McpLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'stderr';
  message: string;
}

export interface McpToolView {
  name: string;
  fullName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  risk: McpRiskLevel;
  estimatedTokens: number;
}

export interface McpServerInfo {
  name?: string;
  version?: string;
}

export interface McpServerSnapshot {
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
  serverInfo?: McpServerInfo;
  protocolVersion?: string;
  connectedAt?: number;
  lastProbeAt?: number;
  lastLatencyMs?: number;
  error?: string;
  errorKind?: McpErrorKind;
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
  tools: McpToolSchema[];
  toolCount: number;
  estimatedTokens: number;
  serverInfo?: McpServerInfo;
  protocolVersion?: string;
  authRequired?: boolean;
  error?: string;
  errorKind?: McpErrorKind;
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

export interface McpRuntimeStatus {
  npx: boolean;
  node: boolean;
  uvx: boolean;
  docker: boolean;
  python3: boolean;
}

export interface McpCatalogEnvField {
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
  requiredEnv?: McpCatalogEnvField[];
  requiredHeaders?: McpCatalogEnvField[];
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
  config: McpServerConfig;
  gaps: McpImportGap[];
  exists: boolean;
}
