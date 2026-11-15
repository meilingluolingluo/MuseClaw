import type { ApprovalRequest } from '../../../../packages/protocol/src/index.ts';
import type { InfoflowSender } from './sender.ts';
import type { SentinelPolicyManager } from '../../../sentinel/src/guard.ts';

export class InfoflowApprovalBridge {
  private sender: InfoflowSender;
  private sentinel: SentinelPolicyManager;

  constructor(sender: InfoflowSender, sentinel: SentinelPolicyManager) {
    this.sender = sender;
    this.sentinel = sentinel;
  }

  /**
   * 将 Sentinel 拦截的高危动作推送给如流用户
   */
  public async pushApprovalNotice(userId: string, req: ApprovalRequest): Promise<boolean> {
    const markdown = [
      `### ⚠️ 【MuseClaw 敏感操作待审批】`,
      `**操作说明**: ${req.actionSummary}`,
      `**风险等级**: \`${req.riskLevel}\``,
      `**审批编号**: \`${req.approvalId}\``,
      ``,
      `---`,
      `请直接在此会话回复以下命令完成确认：`,
      `- **批准执行**：回复 \`批准 ${req.approvalId}\``,
      `- **拒绝执行**：回复 \`拒绝 ${req.approvalId}\``
    ].join('\n');

    try {
      return await this.sender.sendPrivateMessage(userId, markdown, 'markdown');
    } catch (err: any) {
      console.error(`[InfoflowBridge] 推送审批卡片失败:`, err.message);
      return false;
    }
  }

  /**
   * 解析用户在如流中回复的文本是否属于审批指令
   * 支持指令示例：
   * "批准 appr_12345" / "同意 appr_12345" / "approve appr_12345"
   * "拒绝 appr_12345" / "驳回 appr_12345" / "deny appr_12345"
   */
  public tryHandleApprovalCommand(text: string): { isApproval: boolean; approvalId?: string; approved?: boolean } {
    const trimmed = text.trim();
    const match = trimmed.match(/^(批准|同意|approve|allow|拒绝|驳回|deny|reject)\s+([a-zA-Z0-9_\-]+)/i);

    if (!match) {
      return { isApproval: false };
    }

    const action = match[1].toLowerCase();
    const approvalId = match[2];
    const approved = ['批准', '同意', 'approve', 'allow'].includes(action);

    const success = this.sentinel.resolveApproval(approvalId, approved);
    return {
      isApproval: true,
      approvalId,
      approved: success ? approved : undefined
    };
  }
}
