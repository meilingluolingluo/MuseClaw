/**
 * @museclaw/sandbox-core - Channel Ladder (技能成本阶梯)
 * 执行通道阶梯分级规范：
 * API (最低成本/快) -> CLI (本地脚本) -> Web (轻量页面) -> Browser (无头浏览器) -> GUI (屏幕投屏/视觉点击)
 * 优先使用耗资最少、最稳定的接口；严禁无理由越级直接拉起昂贵的 Chromium 浏览器或视觉投屏大模型。
 */

export type ExecutionChannel = 'api' | 'cli' | 'web' | 'browser' | 'gui' | 'mixed';

export const CHANNEL_RANK: Record<ExecutionChannel, number> = {
  api: 1, // 阶梯 1: 结构化 API / MCP / 文件 / 数据库 (纳秒/毫秒级，零视觉与进程开销，~$0)
  cli: 2, // 阶梯 2: 本地轻量微沙箱命令与脚本 (毫秒级，进程隔离，~$0.001)
  web: 3, // 阶梯 3: HTTP/REST 请求与静态网页拉取 (无 DOM/JS 渲染，~$0.005)
  browser: 4, // 阶梯 4: 无头 Chromium 浏览器与 JS 渲染 (高内存，DOM 树，~$0.02)
  gui: 5, // 阶梯 5: 屏幕截图 + 视觉模型分析 + 坐标点击 (最高延迟与 Token 成本，~$0.10)
  mixed: 3
};

export const CHANNEL_DETAILS: Record<
  ExecutionChannel,
  {
    rung: number;
    name: string;
    description: string;
    costFactor: number;
    typicalLatencyMs: number;
  }
> = {
  api: {
    rung: 1,
    name: 'API / Local / MCP',
    description: '直接调用结构化接口、本地文件读取或 MCP 工具，零渲染开销，最稳定且成本最低',
    costFactor: 1,
    typicalLatencyMs: 5
  },
  cli: {
    rung: 2,
    name: 'CLI / Micro-Sandbox Shell',
    description: '在 bwrap 微沙箱中执行轻量 Shell 脚本或工具命令，受控进程级隔离',
    costFactor: 2,
    typicalLatencyMs: 25
  },
  web: {
    rung: 3,
    name: 'Web Fetch / REST',
    description: 'HTTP/REST 接口请求或轻量 HTML 页面拉取，无需启动复杂浏览器内核',
    costFactor: 5,
    typicalLatencyMs: 150
  },
  browser: {
    rung: 4,
    name: 'Headless Browser',
    description: '启动 Chromium 无头浏览器进行页面渲染、JS 执行与 DOM 交互',
    costFactor: 20,
    typicalLatencyMs: 1200
  },
  gui: {
    rung: 5,
    name: 'GUI / Screen Vision',
    description: '捕获桌面/手机屏幕图像，由多模态大模型推演坐标并模拟触控/点击，成本最高',
    costFactor: 100,
    typicalLatencyMs: 3500
  },
  mixed: {
    rung: 3,
    name: 'Mixed Channels',
    description: '跨阶梯混合协作通道',
    costFactor: 10,
    typicalLatencyMs: 200
  }
};

/**
 * 自动识别工具名称所属的执行阶梯通道
 */
export function classifyToolChannel(toolName: string): ExecutionChannel {
  const name = toolName.toLowerCase();

  // Rung 5: GUI 视觉与屏幕操作
  const guiPatterns = ['phone_screen', 'phone_act', 'phone_task', 'gui_', 'screen_', 'desktop_', 'touch_'];
  if (guiPatterns.some((p) => name.includes(p))) {
    return 'gui';
  }

  // Rung 4: 无头浏览器
  const browserPatterns = ['browser_', 'chromium_', 'puppeteer_', 'playwright_', 'page_eval'];
  if (browserPatterns.some((p) => name.includes(p))) {
    return 'browser';
  }

  // Rung 3: Web 轻量拉取与网络请求
  const webPatterns = ['web_fetch', 'http_fetch', 'fetch_url', 'rest_', 'curl_api', 'api_get', 'api_post'];
  if (webPatterns.some((p) => name.includes(p))) {
    return 'web';
  }

  // Rung 2: CLI 脚本与微沙箱 Shell
  const cliPatterns = ['execute_shell', 'shell', 'bash', 'run_script', 'exec_', 'python_execute', 'terminal'];
  if (cliPatterns.some((p) => name.includes(p))) {
    return 'cli';
  }

  // Rung 1: 默认优先归入 API / MCP / 本地轻量数据工具
  return 'api';
}

/**
 * 通道阶梯选择器：根据可用通道与任务偏好，返回最优（最低开销）通道
 */
export function selectOptimalChannel(
  availableChannels: ExecutionChannel[],
  options: { preferSpeed?: boolean; offlineOnly?: boolean } = {}
): ExecutionChannel {
  if (!availableChannels || availableChannels.length === 0) {
    return 'api';
  }

  let candidates = [...availableChannels];
  if (options.offlineOnly) {
    candidates = candidates.filter((c) => c === 'api' || c === 'cli');
    if (candidates.length === 0) candidates = ['api'];
  }

  // 严格按成本阶梯排序，优先选取最低阶梯（Rung 1 API > Rung 2 CLI > Rung 3 Web > Rung 4 Browser > Rung 5 GUI）
  candidates.sort((a, b) => CHANNEL_RANK[a] - CHANNEL_RANK[b]);
  return candidates[0];
}

export interface LadderStepRecord {
  toolName: string;
  channel: ExecutionChannel;
  rung: number;
  timestamp: number;
}

export interface SessionLadderStats {
  sessionId: string;
  totalSteps: number;
  channelCounts: Record<ExecutionChannel, number>;
  maxRungReached: ExecutionChannel;
  totalCostScore: number;
  history: LadderStepRecord[];
  ladderComplianceRate: number; // 0.0 ~ 1.0，越低代表模型越级调用越频繁
}

export interface EscalationEvaluation {
  allowed: boolean;
  channel: ExecutionChannel;
  rung: number;
  requiresApproval: boolean;
  reason: string;
}

/**
 * 技能成本阶梯策略守卫
 * 负责追踪单会话阶梯使用情况、评估越级行为、并协同 Sentinel 实现高成本防御
 */
export class ChannelLadderPolicy {
  private sessionHistory = new Map<string, LadderStepRecord[]>();

  /**
   * 记录一次工具调用的阶梯痕迹
   */
  public recordExecution(sessionId: string, toolName: string, explicitChannel?: ExecutionChannel): LadderStepRecord {
    const channel = explicitChannel || classifyToolChannel(toolName);
    const rung = CHANNEL_RANK[channel];
    const record: LadderStepRecord = {
      toolName,
      channel,
      rung,
      timestamp: Date.now()
    };

    const history = this.sessionHistory.get(sessionId) || [];
    history.push(record);
    this.sessionHistory.set(sessionId, history);

    return record;
  }

  /**
   * 评估 Agent 即将调用的工具是否属于不合理的直接跳级/越级操作
   * 规则：
   * 1. 凡是 Rung 5 (GUI) 操作，如果会话内尚未尝试过 Rung 1~3 (API/CLI/Web)，强制标记 requiresApproval，防止模型无故拉起昂贵的手机/桌面视觉操控
   * 2. 如果之前已经有较低阶梯尝试记录，或工具属于低成本阶梯 (Rung 1~3)，直接放行
   */
  public evaluateEscalation(sessionId: string, toolName: string): EscalationEvaluation {
    const channel = classifyToolChannel(toolName);
    const rung = CHANNEL_RANK[channel];
    const history = this.sessionHistory.get(sessionId) || [];

    // 低成本阶梯直接放行
    if (rung <= 3) {
      return {
        allowed: true,
        channel,
        rung,
        requiresApproval: false,
        reason: `[Channel Ladder Rung ${rung}: ${channel.toUpperCase()}] 低成本通道，直接放行`
      };
    }

    // 检查历史调用中是否已尝试过低阶梯
    const hasAttemptedLowerRungs = history.some((h) => h.rung <= 3);

    // 针对 Rung 5 (GUI)
    if (channel === 'gui') {
      if (!hasAttemptedLowerRungs) {
        return {
          allowed: false,
          channel,
          rung,
          requiresApproval: true,
          reason: `[Channel Ladder 越级拦截] 检测到尝试直接调用高成本 GUI (Rung 5) 工具 [${toolName}]，但会话内尚未尝试 API / CLI / Web 等前置低成本通道。需要人工确认或明确降级`
        };
      }
      return {
        allowed: true,
        channel,
        rung,
        requiresApproval: false,
        reason: `[Channel Ladder Rung 5] 前置低成本通道已尝试，允许升级至 GUI 视觉操作`
      };
    }

    // 针对 Rung 4 (Browser)
    return {
      allowed: true,
      channel,
      rung,
      requiresApproval: false,
      reason: `[Channel Ladder Rung 4: Browser] 允许启用 Chromium 浏览器会话`
    };
  }

  /**
   * 获取会话阶梯使用全量统计与合规审计报告
   */
  public getSessionStats(sessionId: string): SessionLadderStats {
    const history = this.sessionHistory.get(sessionId) || [];
    const counts: Record<ExecutionChannel, number> = {
      api: 0,
      cli: 0,
      web: 0,
      browser: 0,
      gui: 0,
      mixed: 0
    };

    let totalCostScore = 0;
    let maxRung = 1;

    for (const step of history) {
      counts[step.channel] = (counts[step.channel] || 0) + 1;
      const details = CHANNEL_DETAILS[step.channel];
      totalCostScore += details ? details.costFactor : 1;
      if (step.rung > maxRung) {
        maxRung = step.rung;
      }
    }

    // 寻找 maxRung 对应的通道名
    let maxChannel: ExecutionChannel = 'api';
    for (const [ch, r] of Object.entries(CHANNEL_RANK)) {
      if (r === maxRung) {
        maxChannel = ch as ExecutionChannel;
        break;
      }
    }

    // 合规率评估：低阶梯 (1~3) 占比
    const lowRungCount = counts.api + counts.cli + counts.web;
    const ladderComplianceRate = history.length > 0 ? Number((lowRungCount / history.length).toFixed(3)) : 1.0;

    return {
      sessionId,
      totalSteps: history.length,
      channelCounts: counts,
      maxRungReached: maxChannel,
      totalCostScore,
      history,
      ladderComplianceRate
    };
  }

  public clearSession(sessionId: string): void {
    this.sessionHistory.delete(sessionId);
  }
}
