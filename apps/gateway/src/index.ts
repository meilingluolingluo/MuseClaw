import type { MuseEvent, ApprovalRequest } from '@museclaw/protocol';

/**
 * MuseClaw Gateway & Relay Service
 * Handles unified session state, IM bot webhooks, and sandbox dispatching.
 */
export class GatewayRelay {
  private activeSessions = new Map<string, { userId: string; botId: string; status: string }>();

  public async dispatchTask(userId: string, botId: string, goal: string) {
    console.log(`[Gateway] Dispatching task for user ${userId} to bot ${botId}: "${goal}"`);
    // 1. Locate or spin up user's dedicated sandbox
    // 2. Stream events back via WebSocket / streaming event protocol
  }

  public async handleApprovalCallback(approvalId: string, decision: 'approved' | 'rejected') {
    console.log(`[Gateway] Received approval callback for ${approvalId}: ${decision}`);
    // Notify Sentinel to unpause the paused sandbox execution
  }
}

console.log('🚀 MuseClaw Gateway & Relay Service initialized.');
