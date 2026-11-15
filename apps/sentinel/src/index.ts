import type { ActionRiskLevel, ApprovalRequest } from '@museclaw/protocol';

/**
 * Sentinel Security Engine
 * Deterministic policy enforcement gating mutating / irreversible sandbox actions.
 */
export class SentinelGuard {
  private dangerousCommands = ['rm -rf', 'drop database', 'delete from', 'mkfs', 'shutdown'];
  private mutatingHttpMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

  /**
   * Evaluates command / API call risk level before execution
   */
  public evaluateShellCommand(command: string): ActionRiskLevel {
    const isDangerous = this.dangerousCommands.some((bad) => command.toLowerCase().includes(bad));
    if (isDangerous) return 'irreversible';
    if (command.startsWith('curl') || command.startsWith('wget')) return 'high_risk';
    return 'read_only';
  }

  public shouldSuspend(risk: ActionRiskLevel): boolean {
    return risk === 'high_risk' || risk === 'irreversible';
  }
}

console.log('🛡️ Sentinel Security Engine loaded.');
