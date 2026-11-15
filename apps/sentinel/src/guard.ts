import type { ApprovalRequest } from '@museclaw/protocol';
import type { SentinelHook } from '../../../packages/sandbox-core/src/loop.ts';
import { ChannelLadderPolicy, type ExecutionChannel, classifyToolChannel } from '../../../packages/sandbox-core/src/channel-ladder.ts';

export interface PolicyContext {
  approval_level?: 'ask' | 'auto_edits' | 'full';
  botId?: string;
  sessionId?: string;
  isTainted?: boolean;
}

export class SentinelPolicyManager implements SentinelHook {
  private pendingApprovals = new Map<
    string,
    {
      request: ApprovalRequest;
      resolve: (approved: boolean) => void;
    }
  >();

  // 会话级污点状态追踪 (Taint Tracking)
  private taintedSessions = new Set<string>();
  private sessionTaintReasons = new Map<string, string[]>();

  // 技能成本阶梯策略管理器 (Channel Ladder)
  private channelLadder = new ChannelLadderPolicy();

  public getChannelLadder(): ChannelLadderPolicy {
    return this.channelLadder;
  }

  public isSessionTainted(sessionId?: string): boolean {
    if (!sessionId) return false;
    return this.taintedSessions.has(sessionId);
  }

  public taintSession(sessionId: string, reason = '读取了内部敏感/私有数据'): void {
    if (!sessionId) return;
    this.taintedSessions.add(sessionId);
    const existing = this.sessionTaintReasons.get(sessionId) || [];
    existing.push(reason);
    this.sessionTaintReasons.set(sessionId, existing);
    console.log(`[Sentinel:Taint] 会话已标记污染 (Tainted): ${sessionId}，原因: ${reason}`);
  }

  public untaintSession(sessionId: string): void {
    if (!sessionId) return;
    this.taintedSessions.delete(sessionId);
    this.sessionTaintReasons.delete(sessionId);
    console.log(`[Sentinel:Taint] 会话已解除污染 (Untainted): ${sessionId}`);
  }

  public getTaintReasons(sessionId?: string): string[] {
    if (!sessionId) return [];
    return this.sessionTaintReasons.get(sessionId) || [];
  }

  /**
   * 判断一个工具调用是否属于敏感数据源 (Taint Source)
   * 触发源例如：读取内部文件、查询数据库、调用内网私有 API、读取凭据、获取员工通讯录等
   */
  public isTaintSource(
    name: string,
    args: Record<string, unknown>,
    _output?: unknown
  ): { isSource: boolean; reason?: string } {
    const toolLower = name.toLowerCase();

    // 显式私有数据读取工具
    const sourcePatterns = [
      'read_file',
      'read_private',
      'cat_file',
      'sql_query',
      'database_query',
      'query_db',
      'fetch_internal_api',
      'get_secret',
      'read_secret',
      'read_memory',
      'get_contacts',
      'fetch_user_profile',
      'load_private_data'
    ];
    if (sourcePatterns.some((pattern) => toolLower.includes(pattern))) {
      return { isSource: true, reason: `调用了私有/敏感数据读取工具 [${name}]` };
    }

    // Shell 命令读取了敏感文件路径
    if (toolLower === 'bash' || toolLower === 'execute_shell' || toolLower === 'terminal') {
      const cmd = String(args.command || args.cmd || '');
      const readCommands = ['cat ', 'head ', 'tail ', 'less ', 'more ', 'grep ', 'awk ', 'sed '];
      const sensitiveKeywords = [
        '.env',
        'id_rsa',
        'id_ed25519',
        'credentials',
        'shadow',
        'token',
        'key',
        'password',
        'salary',
        'finance',
        'financial',
        'user_data',
        'customer',
        'database',
        'dump.sql',
        'private'
      ];
      const hasReadCmd = readCommands.some((c) => cmd.includes(c));
      const hasSensitiveKeyword = sensitiveKeywords.some((k) => cmd.includes(k));
      if (hasReadCmd && hasSensitiveKeyword) {
        return { isSource: true, reason: `Shell 读取了内部敏感文件/配置: ${cmd}` };
      }
    }

    return { isSource: false };
  }

  /**
   * 判断一个工具调用是否属于网络出站/外发行为 (Egress Sink)
   * 目标包含：发邮件、发Webhook、上传文件到外部、Shell发起curl/wget/ssh/nc等出站网络连接
   */
  public isEgressAction(name: string, args: Record<string, unknown>): { isEgress: boolean; target?: string } {
    const toolLower = name.toLowerCase();

    // 显式出网与通信类工具
    const egressToolPatterns = [
      'send_external_email',
      'send_email',
      'mail',
      'post_to_slack',
      'send_webhook',
      'http_request',
      'external_fetch',
      'upload_file',
      'external_api',
      'post_external'
    ];
    if (egressToolPatterns.some((pattern) => toolLower.includes(pattern))) {
      const target = String(args.to || args.url || args.endpoint || args.recipient || name);
      return { isEgress: true, target };
    }

    // 浏览器打开外网地址
    if (toolLower === 'browser_open' || toolLower.includes('browser')) {
      const url = String(args.url || '');
      // 外部公网 URL
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return { isEgress: true, target: url };
      }
    }

    // Shell 命令中的出站网络行为 (curl, wget, ssh, scp, nc, git push 等)
    if (toolLower === 'bash' || toolLower === 'execute_shell' || toolLower === 'terminal') {
      const cmd = String(args.command || args.cmd || '');
      const egressCommands = [
        'curl ',
        'wget ',
        'nc ',
        'ncat ',
        'netcat ',
        'ssh ',
        'scp ',
        'sftp ',
        'rsync ',
        'telnet ',
        'git push',
        'npm publish',
        'python -m smtplib',
        'python3 -m smtplib'
      ];
      const matched = egressCommands.find((c) => cmd.includes(c));
      if (matched) {
        return { isEgress: true, target: `Shell 网络出站命令 [${matched.trim()}]: ${cmd}` };
      }
    }

    return { isEgress: false };
  }

  // 1. 规则预检：判断是否属于高危破坏性操作 (支持差异化审批分级、双向污点外发阻断与技能阶梯跃迁守卫)
  public evaluateToolCall(
    name: string,
    args: Record<string, unknown>,
    context?: PolicyContext
  ): { isDangerous: boolean; reason?: string; isTaintedEgress?: boolean; channelLadder?: { channel: ExecutionChannel; rung: number; reason?: string } } {
    const level = context?.approval_level || 'ask';
    const toolLower = name.toLowerCase();

    // 无论任何级别，绝对拦截底层元数据外泄、系统私钥与物理破坏命令 (Hard Invariants)
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

    // -------------------------------------------------------------------------
    // 2. 双向污点外发阻断 (Taint Egress Barrier)
    // 只要当前会话处于受污染状态 (Tainted)，且尝试进行网络出站或外部发信 (Egress)：
    // 即使 approval_level 为 full 或 auto_edits，也绝对不能静默放行，强制触发人工审批确认！
    // -------------------------------------------------------------------------
    const isTainted = Boolean(
      context?.isTainted || (context?.sessionId ? this.isSessionTainted(context.sessionId) : false)
    );
    const egress = this.isEgressAction(name, args);

    if (isTainted && egress.isEgress) {
      const reasons = context?.sessionId ? this.getTaintReasons(context.sessionId) : [];
      const reasonSuffix = reasons.length > 0 ? ` (污染源: ${reasons.join('; ')})` : '';
      return {
        isDangerous: true,
        reason: `[Taint Egress 阻断] 当前会话已读取内部私有/敏感数据${reasonSuffix}，禁止未经审批直接向外部发送数据或请求 [${egress.target || name}]，以防止间接提示词注入 (Indirect Prompt Injection) 造成数据外泄`,
        isTaintedEgress: true
      };
    }

    // -------------------------------------------------------------------------
    // 3. 技能成本阶梯校验 (Channel Ladder Escalation Check)
    // 凡调用 Rung 5 (GUI) 高成本视觉/模拟触控工具，若会话尚未尝试过 API / CLI / Web 等低成本通道，
    // 一律拦截并要求审批，避免模型肆意调用耗时极长的多模态视觉操作
    // -------------------------------------------------------------------------
    const escalation = this.channelLadder.evaluateEscalation(context?.sessionId || 'default', name);
    if (escalation.requiresApproval && level !== 'full') {
      return {
        isDangerous: true,
        reason: escalation.reason,
        channelLadder: {
          channel: escalation.channel,
          rung: escalation.rung,
          reason: escalation.reason
        }
      };
    }

    // 记录阶梯足迹
    if (context?.sessionId) {
      this.channelLadder.recordExecution(context.sessionId, name);
    }

    // Full 模式：除底层死线与 Tainted Egress 外，其余操作放行
    if (level === 'full') {
      return { isDangerous: false };
    }

    // Auto-Edits 模式：文档编辑与产出类动作免批放行，仅拦截删除与支付类
    if (level === 'auto_edits') {
      const editTools = ['write', 'edit', 'save_artifact', 'create_file', 'append'];
      if (editTools.some((p) => toolLower.includes(p))) {
        return { isDangerous: false };
      }
    }

    // 默认 Ask 严格模式：命中了高危操作关键词一律拦截
    const dangerousPatterns = ['delete', 'drop', 'remove', 'rm', 'kill', 'send_external_email', 'pay'];
    const isNameDangerous = dangerousPatterns.some((pattern) => toolLower.includes(pattern));
    if (isNameDangerous) {
      return { isDangerous: true, reason: `工具名称命中了高危操作关键词 [${name}]` };
    }

    return { isDangerous: false };
  }

  // 3. 挂起等待人类审批（返回一个 Promise）
  public waitForApproval(request: ApprovalRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(request.approvalId, { request, resolve });
      console.log(`[Sentinel] 动作已挂起，等待审批 ID: ${request.approvalId}`);
    });
  }

  // 4. 供 Web 或企业 IM 回调的解挂方法
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

  public getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).map((item) => item.request);
  }
}
