/**
 * 智能体动态轨迹格式化与业务意图解析器
 * 将原始会话、工具调用、例行任务巡检与安全审计事件，
 * 转化为结构化、高可读性的自然语言动态流水。
 */

export interface FormattedActivityItem {
  id: string;
  title: string;
  subtitle: string;
  timestamp: number;
  status: 'done' | 'running' | 'error';
  iconType?: 'check' | 'heart' | 'memory' | 'search' | 'routine';
  sessionId?: string;
  showAvatar?: boolean;
}

/**
 * 清除文本中的 Markdown 标记与冗余空行，生成干净的单行摘要
 */
export function stripMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[|].*[|]$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 截取简短描述
 */
export function cleanBrief(text: string, maxLen = 80): string {
  const clean = stripMarkdown(text);
  if (!clean) return '';
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen).trim()}…`;
}

/**
 * 格式化时间为 HH:mm
 */
export function formatTimeLabel(ts: number): string {
  if (!ts || isNaN(ts)) return '刚刚';
  const d = new Date(ts);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 日期分组标签判断
 */
export function getDayGroup(ts: number): '今天' | '昨天' | '更早' {
  const d = new Date(ts);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;

  const itemTime = d.getTime();
  if (itemTime >= startOfToday) return '今天';
  if (itemTime >= startOfYesterday) return '昨天';
  return '更早';
}

/**
 * 解析工具调用为清晰的自然语言
 */
export function humanizeToolCall(tool: string, params: any = {}, _result?: any): { title: string; subtitle: string; iconType: 'check' | 'memory' | 'search' | 'routine' } {
  const toolName = String(tool || '').toLowerCase();
  const command = String(params?.command || params?.cmd || '');
  const path = String(params?.path || params?.filePath || params?.targetPath || '');
  const basename = path ? path.split(/[/\\]/).pop() || path : '';

  if (toolName.includes('memory') || toolName.includes('recall') || basename.toUpperCase() === 'MEMORY.MD') {
    if (basename.toUpperCase() === 'MEMORY.MD') {
      return {
        title: '读取 MEMORY.md 文件',
        subtitle: 'Read your memory file',
        iconType: 'memory',
      };
    }
    const query = params?.query || params?.keyword || '核心偏好与上下文';
    return {
      title: `搜索 ${query} 记忆`,
      subtitle: `Searched memories for ${query}`,
      iconType: 'memory',
    };
  }

  if (toolName === 'read_file' || toolName === 'read') {
    return {
      title: `读取 ${basename || '工作区文件'}`,
      subtitle: `Read file ${basename}`,
      iconType: 'check',
    };
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    return {
      title: `更新 ${basename || '文件配置'}`,
      subtitle: `Updated file ${basename}`,
      iconType: 'check',
    };
  }

  if (toolName.includes('shell') || toolName.includes('exec') || toolName.includes('command')) {
    if (command.includes('git status')) {
      return {
        title: '巡检 Git 代码暂存区',
        subtitle: 'Checked repository working tree and staged files',
        iconType: 'check',
      };
    }
    if (command.includes('df') || command.includes('free') || command.includes('uptime')) {
      return {
        title: '巡检系统磁盘与资源负载',
        subtitle: 'Inspected disk usage and memory consumption',
        iconType: 'routine',
      };
    }
    if (command.includes('curl') || command.includes('ping')) {
      return {
        title: '网络连通性与出网探测',
        subtitle: 'Tested network gateway and port status',
        iconType: 'check',
      };
    }
    return {
      title: '在微沙箱中执行受控指令',
      subtitle: cleanBrief(command, 60) || 'Executed command in sandbox',
      iconType: 'check',
    };
  }

  if (toolName.includes('12306') || command.includes('12306')) {
    return {
      title: '查询 12306 车次余票与行程',
      subtitle: 'Query train schedules and seat availability',
      iconType: 'check',
    };
  }

  return {
    title: `调用 ${tool} 工具执行操作`,
    subtitle: cleanBrief(JSON.stringify(params), 50) || 'Task step completed',
    iconType: 'check',
  };
}

/**
 * 将安全审计日志转换为友好的人类可读动作
 */
export function humanizeAuditLog(log: any): { title: string; subtitle: string; iconType: 'check' | 'routine' } {
  const event = String(log?.event || log?.tool || '').toUpperCase();
  const details = typeof log?.details === 'object' ? log?.details : {};

  if (event === 'APPROVAL_DECISION') {
    return {
      title: '安全策略授权审批通过',
      subtitle: details?.scope === 'once' ? '放行单次受控操作' : '已获得执行放行授权',
      iconType: 'check',
    };
  }

  if (event === 'TAINT_EVENT') {
    return {
      title: '敏感数据流向追踪',
      subtitle: details?.reason ? cleanBrief(details.reason, 70) : '检测到内部配置文件读取，已建立污点标记',
      iconType: 'check',
    };
  }

  if (event === 'SENTINEL_INTERCEPT') {
    return {
      title: '安全核心红线阻断',
      subtitle: details?.reason ? cleanBrief(details.reason, 70) : '拦截未授权的高危操作',
      iconType: 'check',
    };
  }

  return {
    title: '受控沙箱安全合规核验',
    subtitle: log?.target || '完成环境隔离与最小权限核验',
    iconType: 'check',
  };
}

/**
 * 合并、清洗并格式化智能体执行流水
 * 仅包含真实业务任务：用户对话请求、工具执行步骤、例行任务巡检与目标推进。
 * 审批与安全审核事件属于底层安全记录，不放入任务层级。
 */
export function deriveBotActivities(
  feedItems: any[] = [],
  sessions: any[] = [],
  botId: string
): FormattedActivityItem[] {
  const result: FormattedActivityItem[] = [];
  const seenIds = new Set<string>();

  // 1. 处理来自 FeedActivity 的流水（严格排除审批审核事件）
  for (const item of feedItems) {
    if (!item) continue;
    // 排除所有审批、审核和底层审计记录
    if (item.kind === 'approval' || item.kind === 'audit') continue;
    const rawTitle = (item.title || '').trim();
    if (rawTitle.includes('审批') || rawTitle.includes('审核') || rawTitle.includes('approval')) continue;

    const ts = item.ts ? new Date(item.ts).getTime() : Date.now();
    const id = item.id || `feed_${ts}_${Math.random().toString(36).slice(2, 6)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    let title = rawTitle;
    let subtitle = cleanBrief(item.text || '', 90);
    let iconType: FormattedActivityItem['iconType'] = 'check';

    if (item.kind === 'routine') {
      title = title.replace(/^例行任务:\s*/, '');
      subtitle = item.quiet ? '未发现新异常 (NOTHING NEW)' : (subtitle || '自动化巡检完成');
      iconType = 'routine';
    } else if (item.kind === 'chat') {
      if (title === '你能干啥') {
        title = '业务与技能咨询';
        subtitle = '介绍自动化数字员工能力与执行权限范围';
      } else if (title.includes('天气')) {
        title = '查询实时天气与出行环境';
        subtitle = '查询了当前所在城市天气情况并生成出行建议';
      } else if (title.includes('车票') || title.includes('12306')) {
        title = '查询 12306 车次余票与行程';
        subtitle = '检索了列车发车时刻与各席位余票价格';
      } else if (title.includes('开工') || title.includes('付款')) {
        title = '安排开工付款明细';
        subtitle = '已记录开工付款计划与明细事实';
      } else if (title.includes('记忆') || title.includes('MEMORY')) {
        iconType = 'memory';
      }
    }

    result.push({
      id,
      title: title || '受控任务执行',
      subtitle: subtitle || '执行完毕',
      timestamp: ts,
      status: 'done',
      iconType,
      sessionId: item.sessionId,
      showAvatar: item.kind === 'chat',
    });
  }

  // 2. 从 Session 消息及工具调用提取重要业务动作
  for (const session of sessions) {
    if (!session || !session.messages) continue;
    if (botId && session.bot_id && session.bot_id !== botId && session.botId !== botId) continue;

    for (const msg of session.messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls) {
          const tcId = `tc_${tc.startedAt || Date.now()}_${tc.tool}`;
          if (seenIds.has(tcId)) continue;
          seenIds.add(tcId);

          const human = humanizeToolCall(tc.tool, tc.params, tc.result);
          result.push({
            id: tcId,
            title: human.title,
            subtitle: human.subtitle,
            timestamp: tc.startedAt || session.updated_at || session.created_at || Date.now(),
            status: tc.status === 'running' ? 'running' : tc.ok === false ? 'error' : 'done',
            iconType: human.iconType,
            sessionId: session.id,
          });
        }
      }
    }
  }

  // 按时间倒序排序
  result.sort((a, b) => b.timestamp - a.timestamp);

  return result;
}

/**
 * 将活动条目按“今天”、“昨天”、“更早”进行分组
 */
export function groupActivities(items: FormattedActivityItem[]): { label: string; items: FormattedActivityItem[] }[] {
  const groups: Record<string, FormattedActivityItem[]> = {
    今天: [],
    昨天: [],
    更早: [],
  };

  for (const item of items) {
    const day = getDayGroup(item.timestamp);
    groups[day].push(item);
  }

  const result: { label: string; items: FormattedActivityItem[] }[] = [];
  if (groups['今天'].length > 0) result.push({ label: '今天', items: groups['今天'] });
  if (groups['昨天'].length > 0) result.push({ label: '昨天', items: groups['昨天'] });
  if (groups['更早'].length > 0) result.push({ label: '更早', items: groups['更早'] });

  return result;
}
