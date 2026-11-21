import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApprovalRequest } from '@museclaw/protocol';
import type { SentinelHook } from '../../../packages/sandbox-core/src/loop.ts';
import { ChannelLadderPolicy, type ExecutionChannel, classifyToolChannel } from '../../../packages/sandbox-core/src/channel-ladder.ts';
import { GrantStore, type GrantScope } from './grants.ts';
import { AuditLog, defaultAuditLog } from './audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PolicyContext {
  approval_level?: 'ask' | 'auto_edits' | 'full';
  botId?: string;
  sessionId?: string;
  isTainted?: boolean;
}

export interface SentinelPolicyConfig {
  version?: string;
  description?: string;
  deny_tools?: string[];
  high_risk_patterns?: string[];
  cloud_metadata_targets?: string[];
  credential_patterns?: string[];
  egress_allowlist?: string[];
  always_ask_tools?: string[];
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

  // 授权复用管理器 (Grants Store)
  private grantStore: GrantStore;

  // 结构化审计日志 (Audit Log)
  private auditLog: AuditLog;

  // 声明式外部安全策略
  private policyConfig: SentinelPolicyConfig = {};
  private policyPath: string;

  constructor(customStorePath?: string, customPolicyPath?: string) {
    this.grantStore = new GrantStore(customStorePath);
    this.auditLog = defaultAuditLog;
    this.policyPath = customPolicyPath || path.resolve(__dirname, '../../../config/sentinel-policy.json');
    this.loadPolicy();
  }

  public getChannelLadder(): ChannelLadderPolicy {
    return this.channelLadder;
  }

  public getGrantStore(): GrantStore {
    return this.grantStore;
  }

  public getAuditLog(): AuditLog {
    return this.auditLog;
  }

  public getPolicyConfig(): SentinelPolicyConfig {
    return this.policyConfig;
  }

  /**
   * 加载或热重载声明式外部策略配置 (sentinel-policy.json)
   */
  public loadPolicy(customPath?: string): void {
    const targetPath = customPath || this.policyPath;
    try {
      if (fs.existsSync(targetPath)) {
        const raw = fs.readFileSync(targetPath, 'utf-8');
        this.policyConfig = JSON.parse(raw);
        console.log(`[Sentinel:Policy] 成功载入外部声明式策略文件: ${targetPath}`);
        return;
      }
    } catch (err: any) {
      console.warn(`[Sentinel:Policy] 外部策略文件解析异常，使用内置安全基线: ${err.message}`);
    }

    // 内置安全默认基线 (Hard Baseline)
    this.policyConfig = {
      version: '1.0',
      deny_tools: [],
      high_risk_patterns: ['rm -rf', 'drop ', 'truncate ', 'mkfs', 'dd if=', 'chmod 777', ':(){ :|:& };:'],
      cloud_metadata_targets: ['169.254.169.254', 'metadata.google.internal', 'metadata.azure.com'],
      credential_patterns: ['/etc/shadow', '/etc/sudoers', '.ssh/id_rsa', '.ssh/id_ed25519', '.aws/credentials', '.env'],
      egress_allowlist: ['localhost', '127.0.0.1', '*.feishu.cn', 'open.feishu.cn', 'api.deepseek.com'],
      always_ask_tools: ['send_external_email']
    };
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

    this.auditLog.record('TAINT_EVENT', {
      sessionId,
      details: { action: 'tainted', reason }
    });

    console.log(`[Sentinel:Taint] 会话已标记污染 (Tainted): ${sessionId}，原因: ${reason}`);
  }

  public untaintSession(sessionId: string): void {
    if (!sessionId) return;
    this.taintedSessions.delete(sessionId);
    this.sessionTaintReasons.delete(sessionId);

    this.auditLog.record('TAINT_EVENT', {
      sessionId,
      details: { action: 'untainted' }
    });

    console.log(`[Sentinel:Taint] 会话已解除污染 (Untainted): ${sessionId}`);
  }

  public getTaintReasons(sessionId?: string): string[] {
    if (!sessionId) return [];
    return this.sessionTaintReasons.get(sessionId) || [];
  }

  /**
   * 判断一个工具调用是否属于敏感数据源 (Taint Source)
   */
  public isTaintSource(
    name: string,
    args: Record<string, unknown>,
    _output?: unknown
  ): { isSource: boolean; reason?: string } {
    const toolLower = name.toLowerCase();

    // 排除内置记忆、工件与技能：Agent 检索自身记忆或工件是标准协作行为，严禁将其污染扩散为外泄风险
    if (toolLower === 'memory' || toolLower === 'read_memory' || toolLower === 'save_artifact' || toolLower === 'skills') {
      return { isSource: false };
    }

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
        '/etc/shadow',
        'id_rsa',
        'id_ed25519',
        '.aws/credentials',
        'salaries.xlsx',
        'salary',
        'financial_report',
        'dump.sql'
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
   */
  public isEgressAction(name: string, args: Record<string, unknown>): { isEgress: boolean; target?: string } {
    const toolLower = name.toLowerCase();

    // 飞书消息发送工具
    if (toolLower === 'feishu_send_message' || toolLower.includes('feishu')) {
      const target = `open.feishu.cn (Feishu: ${args.receive_id || 'default_user'})`;
      return { isEgress: true, target };
    }

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
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return { isEgress: true, target: url };
      }
    }

    // Shell 命令中的出站网络行为
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

  /**
   * 规则预检：判断是否属于高危操作 (结合声明式外部策略 + Grants 授权复用 + 双向污点阻断 + 技能成本阶梯)
   */
  public evaluateToolCall(
    name: string,
    args: Record<string, unknown>,
    context?: PolicyContext
  ): {
    isDangerous: boolean;
    reason?: string;
    isTaintedEgress?: boolean;
    channelLadder?: { channel: ExecutionChannel; rung: number; reason?: string };
  } {
    const level = context?.approval_level || 'ask';
    const toolLower = name.toLowerCase();
    const targetStr = String(args.command || args.cmd || args.url || args.to || args.path || '');

    // -------------------------------------------------------------------------
    // 0. 检查复用授权 (Grants Check): 若用户已授予当前会话或永久白名单，自动免批放行
    // -------------------------------------------------------------------------
    const grantCheck = this.grantStore.check(name, targetStr, context?.sessionId);
    if (grantCheck.hasGrant) {
      this.auditLog.record('GRANT_USED', {
        sessionId: context?.sessionId,
        botId: context?.botId,
        tool: name,
        target: targetStr,
        details: { grantId: grantCheck.grant?.id, scope: grantCheck.grant?.scope }
      });
      return { isDangerous: false, reason: `已由复用授权 (${grantCheck.grant?.scope}) 自动豁免` };
    }

    // -------------------------------------------------------------------------
    // 1. 策略黑名单拦截 (deny_tools)
    // -------------------------------------------------------------------------
    if (this.policyConfig.deny_tools && this.policyConfig.deny_tools.includes(name)) {
      const reason = `工具 [${name}] 已被企业安全策略全局禁用 (deny_tools)`;
      this.auditLog.record('SENTINEL_INTERCEPT', {
        sessionId: context?.sessionId,
        botId: context?.botId,
        tool: name,
        target: targetStr,
        details: { reason }
      });
      return { isDangerous: true, reason };
    }

    // -------------------------------------------------------------------------
    // 2. 底层绝对破坏性操作与凭证防护 (Hard Invariants)
    // -------------------------------------------------------------------------
    if (toolLower === 'bash' || toolLower === 'execute_shell' || toolLower === 'terminal') {
      const cmd = String(args.command || args.cmd || '');
      const patterns = this.policyConfig.high_risk_patterns || ['rm -rf', 'drop ', 'truncate ', 'mkfs', 'dd if='];
      const matchedBad = patterns.find((p) => cmd.includes(p));
      if (matchedBad) {
        const reason = `Shell 包含破坏性系统命令: ${cmd}`;
        this.auditLog.record('SENTINEL_INTERCEPT', {
          sessionId: context?.sessionId,
          botId: context?.botId,
          tool: name,
          target: cmd,
          details: { reason }
        });
        return { isDangerous: true, reason };
      }

      // 出向安全与元数据接口防御 (Egress Gate)
      const egressBadTargets = this.policyConfig.cloud_metadata_targets || ['169.254.169.254', 'metadata.google.internal', 'metadata.azure.com'];
      const matchedEgress = egressBadTargets.find((target) => cmd.includes(target));
      if (matchedEgress) {
        const reason = `Shell 尝试探测云主机元数据接口 [${matchedEgress}]: ${cmd}`;
        this.auditLog.record('SENTINEL_INTERCEPT', {
          sessionId: context?.sessionId,
          botId: context?.botId,
          tool: name,
          target: cmd,
          details: { reason }
        });
        return { isDangerous: true, reason };
      }

      // 核心凭证与敏感系统文件外泄防御
      const credentialPatterns = this.policyConfig.credential_patterns || ['/etc/shadow', '/etc/sudoers', '.ssh/id_rsa', '.ssh/id_ed25519', '.aws/credentials'];
      const isHarmlessGitMeta = /git\s+(check-ignore|status|diff\s+--name-only|ls-files)/.test(cmd);
      const matchedCred = !isHarmlessGitMeta ? credentialPatterns.find((pattern) => cmd.includes(pattern)) : undefined;
      if (matchedCred) {
        // 在 full 模式下，项目工作区内的 .env / 配置文件读取免批放行；仅阻止对操作系统级高危凭证 (/etc/shadow, /etc/sudoers, 私钥 id_rsa) 的非授权窥探
        const isSystemCredential = ['/etc/shadow', '/etc/sudoers', 'id_rsa', 'id_ed25519', '.aws/credentials'].some((sc) => matchedCred.includes(sc));
        if (isSystemCredential || level !== 'full') {
          const reason = `Shell 尝试访问敏感凭证或私钥文件 [${matchedCred}]: ${cmd}`;
          this.auditLog.record('SENTINEL_INTERCEPT', {
            sessionId: context?.sessionId,
            botId: context?.botId,
            tool: name,
            target: cmd,
            details: { reason }
          });
          return { isDangerous: true, reason };
        }
      }
    }

    // 检查浏览器/HTTP工具访问云元数据服务
    if (toolLower === 'browser_open' || toolLower.includes('browser')) {
      const url = String(args.url || '');
      const egressBadTargets = this.policyConfig.cloud_metadata_targets || ['169.254.169.254', 'metadata.google.internal'];
      const matchedEgress = egressBadTargets.find((target) => url.includes(target));
      if (matchedEgress) {
        return { isDangerous: true, reason: `浏览器工具尝试访问云元数据服务: ${url}` };
      }
    }

    // -------------------------------------------------------------------------
    // 3. 双向污点外发阻断 (Taint Egress Barrier)
    // 只要当前会话处于受污染状态 (Tainted)，且试图进行网络出站 (Egress)：
    // 即使 approval_level 为 full 或 auto_edits，也绝对不能静默放行，强制触发人工审批确认！
    // -------------------------------------------------------------------------
    const isTainted = Boolean(
      context?.isTainted || (context?.sessionId ? this.isSessionTainted(context.sessionId) : false)
    );
    const egress = this.isEgressAction(name, args);

    if (isTainted && egress.isEgress) {
      // 检查是否在白名单 egress_allowlist 中
      const allowlist = this.policyConfig.egress_allowlist || [];
      const targetHost = String(egress.target || '');
      const isAllowed = allowlist.some((domain) => {
        if (domain === '*') return true;
        if (domain.startsWith('*.')) return targetHost.toLowerCase().includes(domain.slice(2).toLowerCase());
        return targetHost.toLowerCase().includes(domain.toLowerCase());
      });

      if (!isAllowed) {
        const reasons = context?.sessionId ? this.getTaintReasons(context.sessionId) : [];
        const reasonSuffix = reasons.length > 0 ? ` (污染源: ${reasons.join('; ')})` : '';
        const reason = `[Taint Egress 阻断] 当前会话已读取内部私有/敏感数据${reasonSuffix}，禁止未经审批直接向外部发送数据或请求 [${egress.target || name}]，以防止间接提示词注入 (Indirect Prompt Injection) 造成数据外泄`;
        this.auditLog.record('TAINT_EVENT', {
          sessionId: context?.sessionId,
          botId: context?.botId,
          tool: name,
          target: egress.target,
          details: { reason, isTaintedEgress: true }
        });
        return {
          isDangerous: true,
          reason,
          isTaintedEgress: true
        };
      }
    }

    // -------------------------------------------------------------------------
    // 4. 强制要求人工审批的工具 (always_ask_tools)
    // -------------------------------------------------------------------------
    if (this.policyConfig.always_ask_tools && this.policyConfig.always_ask_tools.includes(name)) {
      return { isDangerous: true, reason: `工具 [${name}] 在企业安全策略中被配置为必须人工确认 (always_ask_tools)` };
    }

    // -------------------------------------------------------------------------
    // 5. 技能成本阶梯校验 (Channel Ladder Escalation Check)
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

  // 挂起等待人类审批
  public waitForApproval(request: ApprovalRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(request.approvalId, { request, resolve });
      console.log(`[Sentinel] 动作已挂起，等待审批 ID: ${request.approvalId}`);

      // 人一直不回来（关页面/断线）时，别把会话永久挂住
      const timer = setTimeout(() => {
        const item = this.pendingApprovals.get(request.approvalId);
        if (!item) return;
        item.request.status = 'rejected';
        item.request.decidedAt = Date.now();
        item.resolve(false);
        this.pendingApprovals.delete(request.approvalId);
        console.warn(`[Sentinel] 审批超时自动拒绝: ${request.approvalId}`);
      }, 15 * 60 * 1000);
      timer.unref?.();
    });
  }

  /** 用户点「停止」时，把它这一轮的待审批项一并拒绝 */
  public cancelPendingForSession(sessionId: string, reason = '客户端已断开'): number {
    let cancelled = 0;
    for (const [approvalId, item] of this.pendingApprovals) {
      if (item.request.sessionId !== sessionId) continue;
      item.request.status = 'rejected';
      item.request.decidedAt = Date.now();
      item.resolve(false);
      this.pendingApprovals.delete(approvalId);
      cancelled += 1;
      console.log(`[Sentinel] 审批随会话结束取消: ${approvalId} (${reason})`);
    }
    return cancelled;
  }

  // 供 Web 或企业 IM 回调的解挂方法 (支持授予 once / session / 24h / always 作用域)
  public resolveApproval(
    approvalId: string,
    approved: boolean,
    scope: GrantScope = 'once',
    operator = 'human'
  ): boolean {
    const item = this.pendingApprovals.get(approvalId);
    if (!item) {
      console.warn(`[Sentinel] 未找到待审批项或已超时: ${approvalId}`);
      return false;
    }

    item.request.status = approved ? 'approved' : 'rejected';
    item.request.decidedAt = Date.now();
    item.resolve(approved);
    this.pendingApprovals.delete(approvalId);

    // 结构化审计记录
    this.auditLog.record('APPROVAL_DECISION', {
      sessionId: item.request.sessionId,
      botId: item.request.botId,
      tool: item.request.targetDetails?.parameters?.name || item.request.actionSummary,
      target: item.request.targetDetails?.command || item.request.actionSummary,
      decision: approved ? 'approved' : 'rejected',
      operator,
      details: { approvalId, scope, actionSummary: item.request.actionSummary }
    });

    // 若批准且授予 scope 大于 once，自动注册复用授权 (Grant)
    if (approved && scope !== 'once') {
      const toolMatch = item.request.actionSummary.match(/准备执行高危操作: ([^\s(]+)/);
      const toolName = (item.request.targetDetails as any)?.tool || (item.request as any)?.toolName || (toolMatch ? toolMatch[1] : '*');
      const target = item.request.targetDetails?.command ||
        item.request.targetDetails?.parameters?.url ||
        item.request.targetDetails?.parameters?.to ||
        item.request.targetDetails?.parameters?.path ||
        undefined;

      this.grantStore.addGrant({
        tool: toolName,
        target: target ? String(target) : undefined,
        scope,
        sessionId: item.request.sessionId
      });
    }

    console.log(`[Sentinel] 审批已处理: ${approvalId} -> ${approved ? '批准' : '拒绝'} (Scope: ${scope}, 操作人: ${operator})`);
    return true;
  }

  public getPendingApprovals(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).map((item) => item.request);
  }
}
