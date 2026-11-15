import type { AgentProfile, TrajectoryStep } from '@museclaw/protocol';

export * from './micro-sandbox.ts';
export * from './channel-ladder.ts';
export * from './tools.ts';
export * from './loop.ts';
export * from './llm.ts';

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
    // Interacts with local Docker daemon or K8s to check container health and persistent volume mount
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
