import type { AgentProfile, TrajectoryStep } from '@museclaw/protocol';

export * from './attachment.ts';
export * from './vision.ts';
export * from './environment.ts';
export * from './micro-sandbox.ts';
export * from './channel-ladder.ts';
export * from './vault.ts';
export * from './tools.ts';
export * from './widget-validator.ts';
export * from './loop.ts';
export * from './llm.ts';
export * from './multica-bridge.ts';
export * from './reasoning.ts';
export * from './providers/types.ts';
export * from './providers/executable.ts';
export * from './providers/async-queue.ts';
export * from './providers/claude-driver.ts';
export * from './providers/codex-driver.ts';
export * from './providers/pi-driver.ts';
export * from './providers/openai-compat-driver.ts';
export * from './providers/environment-bridge.ts';
export * from './providers/registry.ts';

/**
 * SandboxCore
 * Manages per-user sandbox container lifecycle, Chromium profiles, and execution logs.
 */
export class SandboxCore {
  private userId: string;
  private containerId?: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Ensures the user's dedicated sandbox container is running.
   */
  public async ensureRunning(profile: AgentProfile): Promise<string> {
    console.log(`[SandboxCore] Ensuring sandbox active for user: ${this.userId}, Bot profile: ${profile.name}`);
    return `sandbox-${this.userId}`;
  }

  /**
   * Runs an agent task loop inside the user's isolated sandbox environment
   */
  public async executeTask(prompt: string): Promise<TrajectoryStep[]> {
    console.log(`[SandboxCore] Executing in sandbox container: "${prompt}"`);
    return [];
  }
}
