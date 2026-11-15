import type { ApprovalRequest } from '../../../../packages/protocol/src/index.ts';
import type { FeishuSender } from './sender.ts';
import type { SentinelPolicyManager } from '../../../sentinel/src/guard.ts';

export class FeishuApprovalBridge {
  private sender: FeishuSender;
  private sentinel: SentinelPolicyManager;

  constructor(sender: FeishuSender, sentinel: SentinelPolicyManager) {
    this.sender = sender;
    this.sentinel = sentinel;
  }

  /**
   * 构建飞书原生可交互审批卡片 (带真正的点击按钮)
   */
  public buildApprovalCard(req: ApprovalRequest): Record<string, unknown> {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '⚠️ 【MuseClaw 敏感操作执行确认】' },
        template: 'orange'
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: [
              `**操作说明**: ${req.actionSummary}`,
              `**风险等级**: <font color="red">${req.riskLevel}</font>`,
              `**审批编号**: \`${req.approvalId}\``,
              `**申请时间**: ${new Date(req.requestedAt).toLocaleTimeString()}`
            ].join('\n')
          }
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '✅ 允许执行' },
              type: 'primary',
              value: {
                action: 'approve',
                approvalId: req.approvalId
              }
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '❌ 拒绝操作' },
              type: 'danger',
              value: {
                action: 'reject',
                approvalId: req.approvalId
              }
            }
          ]
        }
      ]
    };
  }

  /**
   * 将审批卡片直接推送到用户的飞书私聊
   */
  public async pushApprovalCard(receiveId: string, req: ApprovalRequest): Promise<boolean> {
    const card = this.buildApprovalCard(req);
    try {
      return await this.sender.sendMessage(receiveId, card, 'interactive', 'open_id');
    } catch (err: any) {
      console.error('[FeishuBridge] 推送审批卡片失败:', err.message);
      return false;
    }
  }

  /**
   * 处理飞书卡片按钮点击回调 (card.action.trigger)
   */
  public handleCardAction(actionValue: Record<string, unknown>): { success: boolean; approvalId: string; approved: boolean } {
    const approvalId = String(actionValue.approvalId || '');
    const action = String(actionValue.action || '');
    const approved = action === 'approve';

    const success = this.sentinel.resolveApproval(approvalId, approved);
    return { success, approvalId, approved };
  }

  /**
   * 兜底解析文本消息回复（如用户直接回复“批准 appr_12345”）
   */
  public tryHandleTextApproval(text: string): { isApproval: boolean; approvalId?: string; approved?: boolean } {
    const match = text.trim().match(/^(批准|同意|approve|allow|拒绝|驳回|deny|reject)\s+([a-zA-Z0-9_\-]+)/i);
    if (!match) return { isApproval: false };

    const action = match[1].toLowerCase();
    const approvalId = match[2];
    const approved = ['批准', '同意', 'approve', 'allow'].includes(action);

    const success = this.sentinel.resolveApproval(approvalId, approved);
    return { isApproval: true, approvalId, approved: success ? approved : undefined };
  }
}
