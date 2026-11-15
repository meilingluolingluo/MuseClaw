import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '../../../packages/sandbox-core/src/loop.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: NodeJS.Timeout;
}

/**
 * 单个 MCP Stdio 服务器连接实例
 */
export class McpStdioClient {
  public readonly name: string;
  private config: McpServerConfig;
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private requestId = 1;
  private tools: McpToolSchema[] = [];

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.config = config;
  }

  public async start(): Promise<McpToolSchema[]> {
    this.stop();

    const env = { ...process.env, ...this.config.env };
    this.process = spawn(this.config.command, this.config.args || [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const rl = readline.createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const { resolve, reject, timer } = this.pendingRequests.get(msg.id)!;
          clearTimeout(timer);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            reject(new Error(`[MCP:${this.name}] ${msg.error.message || JSON.stringify(msg.error)}`));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // 忽略非 JSON 行日志
      }
    });

    this.process.stderr?.on('data', (data) => {
      // 捕获服务日志
    });

    this.process.on('error', (err) => {
      console.warn(`[MCP:${this.name}] 进程错误: ${err.message}`);
    });

    // 1. 发送 initialize 握手
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'MuseClaw', version: '0.1.0' }
    });

    // 2. 发送 notifications/initialized
    this.sendNotification('notifications/initialized', {});

    // 3. 探索工具列表
    const toolsRes = await this.sendRequest('tools/list', {});
    this.tools = toolsRes?.tools || [];
    console.log(`📡 [MCP:${this.name}] 连接就绪，已挂载 ${this.tools.length} 个工具`);
    return this.tools;
  }

  public async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args
    });
    return res?.content || res;
  }

  public getTools(): McpToolSchema[] {
    return this.tools;
  }

  public stop() {
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('MCP Client stopped'));
    }
    this.pendingRequests.clear();
    if (this.process) {
      try {
        this.process.kill();
      } catch {}
      this.process = null;
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin || this.process.stdin.destroyed) {
        return reject(new Error(`MCP server [${this.name}] 未就绪`));
      }

      const id = this.requestId++;
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP 调用超时 (${timeoutMs}ms): ${method}`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.process.stdin.write(payload);
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>) {
    if (!this.process || !this.process.stdin || this.process.stdin.destroyed) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.process.stdin.write(payload);
  }
}

/**
 * 全局 MCP 管理器：管理多 MCP 服务器与工具注册
 */
export class McpClientManager {
  private clients = new Map<string, McpStdioClient>();
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.resolve(__dirname, '../data/mcp_servers.json');
  }

  public async init() {
    const configs = this.loadConfigs();
    for (const [name, config] of Object.entries(configs)) {
      if (config.enabled !== false) {
        try {
          await this.addServer(name, config);
        } catch (err: any) {
          console.warn(`[MCP] 启动服务器 [${name}] 失败: ${err.message}`);
        }
      }
    }
  }

  public async addServer(name: string, config: McpServerConfig): Promise<ToolDefinition[]> {
    if (this.clients.has(name)) {
      this.clients.get(name)!.stop();
    }

    const client = new McpStdioClient(name, config);
    const tools = await client.start();
    this.clients.set(name, client);

    const configs = this.loadConfigs();
    configs[name] = { ...config, enabled: true };
    this.saveConfigs(configs);

    return this.getToolDefinitions();
  }

  public async removeServer(name: string): Promise<boolean> {
    const client = this.clients.get(name);
    if (!client) return false;
    client.stop();
    this.clients.delete(name);

    const configs = this.loadConfigs();
    delete configs[name];
    this.saveConfigs(configs);
    return true;
  }

  public listServers(): Array<{ name: string; toolCount: number; tools: string[] }> {
    return Array.from(this.clients.entries()).map(([name, client]) => ({
      name,
      toolCount: client.getTools().length,
      tools: client.getTools().map(t => t.name)
    }));
  }

  /**
   * 将所有运行中 MCP 服务器的工具转换为 MuseClaw ToolDefinition
   */
  public getToolDefinitions(): ToolDefinition[] {
    const toolDefs: ToolDefinition[] = [];
    for (const [serverName, client] of this.clients.entries()) {
      for (const t of client.getTools()) {
        const fullToolName = `mcp_${serverName}_${t.name}`;
        toolDefs.push({
          name: fullToolName,
          description: `[MCP:${serverName}] ${t.description || t.name}`,
          parameters: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
          execute: async (args: Record<string, unknown>) => {
            return client.callTool(t.name, args);
          }
        });
      }
    }
    return toolDefs;
  }

  private loadConfigs(): Record<string, McpServerConfig> {
    if (!fs.existsSync(this.configPath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  private saveConfigs(configs: Record<string, McpServerConfig>) {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(configs, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[MCP] 保存配置失败:', err.message);
    }
  }
}
