import type { ApprovalRequest } from '@museclaw/protocol';
import type { SentinelHook } from '@museclaw/sandbox-core/src/loop.js';

export class SentinelPolicyManager implements SentinelHook {
  private pendingApprovals = new Map<
    string,
    {
      request: ApprovalRequest;
      resolve: (approved: boolean) => void;
    }
  >();

  // 1. 规则预检：判断是否属于高危破坏性操作
  public evaluateToolCall(name: string, args: Record<string, unknown>): { isDangerous: boolean; reason?: string } {
    const dangerousPatterns = ['delete', 'drop', 'remove', 'rm', 'kill', 'send_external_email', 'pay'];
    const toolLower = name.toLowerCase();

    // 命中危险动作命名
    const isNameDangerous = dangerousPatterns.some((pattern) => toolLower.includes(pattern));
    if (isNameDangerous) {
      return { isDangerous: true, reason: `工具名称命中了高危操作关键词 [${name}]` };
    }

    // 检查 bash/shell 工具内部的具体命令行参数
    if (toolLower === 'bash' || toolLower === 'execute_shell' || toolLower === 'terminal') {
      const cmd = String(args.command || args.cmd || '');
      const hasBadCmd = ['rm -rf', 'drop ', 'truncate ', 'mkfs', 'dd if='].some((p) => cmd.includes(p));
      if (hasBadCmd) {
        return { isDangerous: true, reason: `Shell 包含破坏性系统命令: ${cmd}` };
      }

      // 出向安全与元数据接口防御 (Egress Gate)
      const egressBadTargets = ['169.254.169.254', 'metadata.google.internal', 'metadata.azure.com'];
      const matchedEgress = egressBadTargets.find((target) => cmd.includes(target));
      if (matchedEgress) {
        return { isDangerous: true, reason: `Shell 尝试探测云主机元数据接口 [${matchedEgress}]: ${cmd}` };
      }

      // 核心凭证与敏感系统文件外泄防御
      const credentialPatterns = ['/etc/shadow', '/etc/sudoers', '.ssh/id_rsa', '.ssh/id_ed25519', '.aws/credentials'];
      const matchedCred = credentialPatterns.find((pattern) => cmd.includes(pattern));
      if (matchedCred) {
        return { isDangerous: true, reason: `Shell 尝试访问敏感凭证或私钥文件 [${matchedCred}]: ${cmd}` };
      }
    }

    // 检查浏览器/HTTP工具访问云元数据服务
    if (toolLower === 'browser_open' || toolLower.includes('browser')) {
      const url = String(args.url || '');
      if (url.includes('169.254.169.254') || url.includes('metadata.google.internal')) {
        return { isDangerous: true, reason: `浏览器工具尝试访问云元数据服务: ${url}` };
      }
    }

    return { isDangerous: false };
  }

  // 2. 挂起等待人类审批（返回一个 Promise）
  public waitForApproval(request: ApprovalRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(request.approvalId, { request, resolve });
      console.log(`[Sentinel] 动作已挂起，等待审批 ID: ${request.approvalId}`);
    });
  }

  // 3. 供 Web 或企业 IM 回调的解挂方法
  public resolveApproval(approvalId: string, approved: boolean): boolean {
    const item = this.pendingApprovals.get(approvalId);
    if (!item) {
      console.warn(`[Sentinel] 未找到待审批项或已超时: ${approvalId}`);
      return false;
    }

    item.request.status = approved ? 'approved' : 'rejected';
    item.request.decidedAt = Date.now();
    item.resolve(approved);
    this.pendingApprovals.delete(approvalId);

    console.log(`[Sentinel] 审批已处理: ${approvalId} -> ${approved ? '批准' : '拒绝'}`);
    return true;
  }

  public getPendingRequests(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).map((v) => v.request);
  }
}
