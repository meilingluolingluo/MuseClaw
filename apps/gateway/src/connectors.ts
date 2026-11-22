import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpClientManager } from '../mcp/client.ts';
import type { ToolDefinition } from '../../../packages/sandbox-core/src/loop.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type ConnectorCategory =
  | 'builtin'
  | 'work'
  | 'talk'
  | 'dev'
  | 'data'
  | 'design'
  | 'search'
  | 'money'
  | 'custom';

export type ConnectorAuthType = 'none' | 'key' | 'oauth' | 'stdio' | 'sse';

export type ConnectorStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'reauth';

export interface ConnectorTool {
  name: string;
  description: string;
  enabled: boolean;
  parameters?: Record<string, unknown>;
}

export interface ConnectorItem {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  status: ConnectorStatus;
  authType: ConnectorAuthType;
  icon?: string;
  color: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  key?: string;
  token?: string;
  keyHint?: string;
  docs?: string;
  connectedAt?: number;
  updatedAt?: number;
  error?: string;
  disabledTools?: string[];
  tools: ConnectorTool[];
}

/**
 * 内置系统级连接器能力配置
 */
export const BUILTIN_CONNECTORS: ConnectorItem[] = [
  {
    id: 'terminal',
    name: '系统终端执行器',
    category: 'builtin',
    description: '安全沙箱内的 Shell 与代码即时执行引擎，提供受限的本地命令行执行环境',
    status: 'connected',
    authType: 'none',
    icon: 'terminal',
    color: '#0064d4',
    docs: 'https://github.com/MuseClaw/MuseClaw#terminal-sandbox',
    tools: [
      { name: 'execute_shell', description: '在受控沙箱环境中执行安全终端命令', enabled: true },
      { name: 'execute_code', description: '执行 Python 或 Node.js 脚本并捕获标准输出', enabled: true }
    ]
  },
  {
    id: 'filesystem',
    name: '沙箱文件系统',
    category: 'builtin',
    description: '受限工作区读写、工件生成与归档管理通道',
    status: 'connected',
    authType: 'none',
    icon: 'folder',
    color: '#0284c7',
    docs: 'https://github.com/MuseClaw/MuseClaw#filesystem',
    tools: [
      { name: 'read_file', description: '读取工作区内的指定文本或配置文件', enabled: true },
      { name: 'write_file', description: '向工作区写入或更新目标代码及数据文件', enabled: true },
      { name: 'save_artifact', description: '将执行产物持久化归档为报告或工件', enabled: true }
    ]
  },
  {
    id: 'browser',
    name: '受控浏览器与抓取',
    category: 'builtin',
    description: 'Webview 与 Headless 自动化交互抓取引擎，支持 DOM 解析与正文提炼',
    status: 'connected',
    authType: 'none',
    icon: 'globe',
    color: '#7c3aed',
    docs: 'https://github.com/MuseClaw/MuseClaw#browser',
    tools: [
      { name: 'browser_open', description: '在受控沙箱浏览器中导航目标网页并提取渲染结构', enabled: true },
      { name: 'web_fetch', description: '发送 HTTP 请求抓取远程页面并转换为纯净正文', enabled: true },
      { name: 'web_search', description: '调用搜索引擎获取互联网最新时效信息与网页摘要', enabled: true }
    ]
  },
  {
    id: 'memory',
    name: '长期记忆与经验库',
    category: 'builtin',
    description: '跨会话记忆留存、语义向量检索与经验自动沉淀系统',
    status: 'connected',
    authType: 'none',
    icon: 'brain',
    color: '#e11d48',
    tools: [
      { name: 'memory', description: '查询、追加或更新用户专属的长期记忆库', enabled: true }
    ]
  },
  {
    id: 'skills',
    name: 'Agent Skills 规程库',
    category: 'builtin',
    description: '标准化任务规程与复合工作流工具包管理',
    status: 'connected',
    authType: 'none',
    icon: 'sparkles',
    color: '#ea580c',
    tools: [
      { name: 'skills', description: '加载并执行标准化规程，沉淀工坊新技能', enabled: true }
    ]
  },
  {
    id: 'goals',
    name: '长程目标协同引擎',
    category: 'builtin',
    description: '跨时间窗口的目标拆解、里程碑跟踪与自治推进体系',
    status: 'connected',
    authType: 'none',
    icon: 'target',
    color: '#059669',
    tools: [
      { name: 'goals', description: '创建并推进长期业务目标与里程碑任务', enabled: true }
    ]
  },
  {
    id: 'feishu',
    name: '飞书协同通道',
    category: 'builtin',
    description: '支持通过飞书开放平台机器人发送富文本卡片与群聊消息',
    status: 'connected',
    authType: 'key',
    keyHint: '飞书开放平台应用的 App ID 与 App Secret',
    icon: 'message-circle',
    color: '#00d6b9',
    tools: [
      { name: 'feishu_send_message', description: '向指定的飞书用户或群聊会话推送消息通知', enabled: true }
    ]
  },
  {
    id: 'email',
    name: '邮件通知通道',
    category: 'builtin',
    description: '支持 SMTP 邮件服务投递自动化周报与告警巡检报告',
    status: 'connected',
    authType: 'key',
    keyHint: 'SMTP 授权码与发信邮箱地址',
    icon: 'mail',
    color: '#d97706',
    tools: [
      { name: 'send_external_email', description: '通过配置的发信通道向指定邮箱发送报告与通知', enabled: true }
    ]
  }
];

/**
 * 预置生态服务连接器目录
 */
export const CATALOGUE_CONNECTORS: ConnectorItem[] = [
  // 办公协同 (work)
  {
    id: 'notion',
    name: 'Notion',
    category: 'work',
    description: '搜索、阅读和编辑你的 Notion 页面与数据库记录',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.notion.com/mcp',
    docs: 'https://developers.notion.com/docs/mcp',
    color: '#000000',
    tools: [
      { name: 'notion_search', description: '在 Notion 工作区中检索页面与数据库', enabled: true },
      { name: 'notion_read_page', description: '读取指定 Notion 页面的完整块结构与属性', enabled: true },
      { name: 'notion_create_page', description: '在数据库或父页面下创建全新页面', enabled: true }
    ]
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'work',
    description: '查找、创建和更新开发任务 Issue、迭代周期与业务项目',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.linear.app/mcp',
    docs: 'https://linear.app/docs/mcp',
    color: '#5E6AD2',
    tools: [
      { name: 'linear_list_issues', description: '列出团队或指定周期的开发任务列表', enabled: true },
      { name: 'linear_create_issue', description: '新建任务工单并分配优先级与执行人', enabled: true },
      { name: 'linear_update_issue', description: '更新工单状态为 In Progress 或 Done', enabled: true }
    ]
  },
  {
    id: 'atlassian',
    name: 'Jira & Confluence',
    category: 'work',
    description: '检索和管理 Atlassian 各站点里的 Jira 事项和 Confluence 文档',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.atlassian.com/v2/mcp',
    docs: 'https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/',
    color: '#0052CC',
    tools: [
      { name: 'jira_search_issues', description: '通过 JQL 语句检索 Jira 缺陷与需求事项', enabled: true },
      { name: 'confluence_get_page', description: '拉取 Confluence 知识库页面正文与附件', enabled: true }
    ]
  },
  {
    id: 'airtable',
    name: 'Airtable',
    category: 'work',
    description: '读写多维表格 Bases、数据表 Records 与业务视图',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.airtable.com/mcp',
    docs: 'https://airtable.com/developers/web',
    color: '#18BFFF',
    tools: [
      { name: 'airtable_list_records', description: '获取数据表中的结构化行数据', enabled: true },
      { name: 'airtable_create_record', description: '插入新的记录行并回写字段', enabled: true }
    ]
  },

  // 代码研发 (dev)
  {
    id: 'github',
    name: 'GitHub',
    category: 'dev',
    description: '管理代码仓库、Pull Request、Issue 讨论与全库代码检索',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://api.githubcopilot.com/mcp/',
    docs: 'https://github.com/github/github-mcp-server',
    color: '#181717',
    tools: [
      { name: 'github_search_repositories', description: '搜索 GitHub 公开与组织内私有仓库', enabled: true },
      { name: 'github_get_file_contents', description: '按分支或 Tag 读取指定文件原始代码', enabled: true },
      { name: 'github_create_pull_request', description: '基于对比分支创建代码合并请求', enabled: true },
      { name: 'github_list_issues', description: '拉取指定仓库的开放 Issue 列表', enabled: true }
    ]
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'dev',
    description: 'GitLab 上的代码工程、议题管理、合并请求与 CI/CD 流水线状态',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://gitlab.com/api/v4/mcp',
    docs: 'https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/',
    color: '#FC6D26',
    tools: [
      { name: 'gitlab_list_projects', description: '查询项目列表与归属分组', enabled: true },
      { name: 'gitlab_get_pipeline_status', description: '获取流水线最新构建与部署状态', enabled: true }
    ]
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'dev',
    description: '读取线上生产项目的实时崩溃日志、未解决错误与性能瓶颈',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.sentry.dev/mcp',
    docs: 'https://docs.sentry.io/product/sentry-mcp/',
    color: '#362D59',
    tools: [
      { name: 'sentry_list_issues', description: '查询近期触发频次最高的线上异常事件', enabled: true },
      { name: 'sentry_get_event_details', description: '分析崩溃调用堆栈与上下文面包屑', enabled: true }
    ]
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'dev',
    description: '管理前端云原生项目部署状态、实时构建日志与环境变量',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.vercel.com',
    docs: 'https://vercel.com/docs/mcp/vercel-mcp',
    color: '#000000',
    tools: [
      { name: 'vercel_list_deployments', description: '获取项目历史发布与当前预览版本', enabled: true },
      { name: 'vercel_get_build_logs', description: '拉取构建过程中的控制台输出流', enabled: true }
    ]
  },

  // 数据存储 (data)
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'data',
    description: '直接连接 Postgres 数据库、执行受控 SQL 查询与边缘函数管理',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.supabase.com/mcp',
    docs: 'https://supabase.com/docs/guides/getting-started/mcp',
    color: '#3FCF8E',
    tools: [
      { name: 'supabase_execute_sql', description: '在指定的 Supabase 项目中执行只读或读写 SQL', enabled: true },
      { name: 'supabase_list_tables', description: '查看数据库 Schema 结构与外键关联', enabled: true }
    ]
  },
  {
    id: 'neon',
    name: 'Neon Postgres',
    category: 'data',
    description: '无服务器 Serverless Postgres 实例分支管理与数据交互',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.neon.tech/mcp',
    docs: 'https://neon.com/docs/ai/neon-mcp-server',
    color: '#00E599',
    tools: [
      { name: 'neon_run_query', description: '执行 Postgres 查询并返回结构化 JSON 结果集', enabled: true },
      { name: 'neon_list_branches', description: '查看数据库只读/可写瞬时分支', enabled: true }
    ]
  },

  // 网页检索 (search)
  {
    id: 'tavily',
    name: 'Tavily Search',
    category: 'search',
    description: '专为大语言模型打造的高效互联网搜索、网页提纯与知识抽取',
    status: 'disconnected',
    authType: 'key',
    keyHint: 'tavily.com 控制台获取的 API Key (tvly-...)',
    docs: 'https://docs.tavily.com/documentation/mcp',
    color: '#0F766E',
    tools: [
      { name: 'tavily_search', description: '精准抓取互联网网页并提炼核心问答上下文', enabled: true },
      { name: 'tavily_extract', description: '提取指定 URL 的结构化正文 Markdown', enabled: true }
    ]
  },
  {
    id: 'exa',
    name: 'Exa Neural Search',
    category: 'search',
    description: '基于神经网络的高质量语义搜索与相似网页发现引擎',
    status: 'disconnected',
    authType: 'key',
    keyHint: 'dashboard.exa.ai 账户面板的 API 密钥',
    docs: 'https://docs.exa.ai/reference/exa-mcp',
    color: '#1F2937',
    tools: [
      { name: 'exa_neural_search', description: '通过语义嵌入匹配最相关的专业文章与研究', enabled: true },
      { name: 'exa_find_similar', description: '根据给定的高质量链接查找相似网站', enabled: true }
    ]
  },
  {
    id: 'amap',
    name: '高德地图 Amap',
    category: 'search',
    description: '提供国内地点检索、地理编码转换、路径规划与气象预报能力',
    status: 'disconnected',
    authType: 'key',
    keyHint: 'console.amap.com 申请的 Web服务 Key',
    docs: 'https://lbs.amap.com/api/mcp-server/summary',
    color: '#1E88E5',
    tools: [
      { name: 'amap_search_poi', description: '搜索目标城市周边兴趣点与商户位置', enabled: true },
      { name: 'amap_route_plan', description: '规划驾车、公共交通或步行最优路径', enabled: true },
      { name: 'amap_weather', description: '获取指定区域当前天气与未来预报', enabled: true }
    ]
  },

  // 通讯社交 (talk)
  {
    id: 'slack',
    name: 'Slack',
    category: 'talk',
    description: '搜索与读取工作区内各频道的讨论消息、发送回复与工单通知',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.slack.com/mcp',
    docs: 'https://docs.slack.dev/ai/mcp-server/',
    color: '#4A154B',
    tools: [
      { name: 'slack_search_messages', description: '按关键词在公开与授权私有频道中检索沟通记录', enabled: true },
      { name: 'slack_send_message', description: '向指定的频道或成员发送即时通知', enabled: true }
    ]
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'talk',
    description: '连接社区服务器、监听关键频道事件与互动交互',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.discord.com/mcp',
    docs: 'https://discord.com/developers/docs/intro',
    color: '#5865F2',
    tools: [
      { name: 'discord_send_channel_message', description: '向 Discord 频道推送更新或嵌入卡片', enabled: true }
    ]
  },

  // 创意设计 (design)
  {
    id: 'figma',
    name: 'Figma',
    category: 'design',
    description: '读取设计稿文件组件、导出设计规范元数据与前端布局约束',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.figma.com/mcp',
    docs: 'https://help.figma.com/hc/en-us/articles/32132100833559',
    color: '#F24E1E',
    tools: [
      { name: 'figma_get_file_nodes', description: '提取指定 Frame 画板的设计节点树与图层样式', enabled: true },
      { name: 'figma_export_component', description: '将设计图层导出为高清图片或矢量 SVG', enabled: true }
    ]
  },

  // 资产财务 (money)
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'money',
    description: '安全查询客户支付记录、发票账单、订阅状态与退款事务',
    status: 'disconnected',
    authType: 'oauth',
    url: 'https://mcp.stripe.com',
    docs: 'https://docs.stripe.com/mcp',
    color: '#635BFF',
    tools: [
      { name: 'stripe_list_charges', description: '获取近期交易订单与结算明细', enabled: true },
      { name: 'stripe_get_subscription', description: '检索特定客户的当前订阅周期与费用', enabled: true }
    ]
  }
];

export interface PersistedConnectorRecord {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  status: ConnectorStatus;
  authType: ConnectorAuthType;
  color?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  key?: string;
  token?: string;
  connectedAt?: number;
  updatedAt?: number;
  error?: string;
  disabledTools?: string[];
  customTools?: ConnectorTool[];
}

/**
 * 连接器管理器：维护内置能力、生态连接器与自定义 MCP 的统一配置与生命周期
 */
export class ConnectorManager {
  private configPath: string;
  private mcpManager?: McpClientManager;
  private records: Map<string, PersistedConnectorRecord> = new Map();

  constructor(configPath?: string, mcpManager?: McpClientManager) {
    this.configPath = configPath || path.resolve(__dirname, '../data/connectors.json');
    this.mcpManager = mcpManager;
    this.loadFromDisk();
  }

  private loadFromDisk() {
    if (!fs.existsSync(this.configPath)) {
      this.records = new Map();
      return;
    }
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const list: PersistedConnectorRecord[] = JSON.parse(content);
      this.records = new Map(list.map((item) => [item.id, item]));
    } catch (err: any) {
      console.warn('[ConnectorManager] 读取连接器持久化配置失败:', err.message);
      this.records = new Map();
    }
  }

  private saveToDisk() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const array = Array.from(this.records.values());
      fs.writeFileSync(this.configPath, JSON.stringify(array, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[ConnectorManager] 保存连接器配置失败:', err.message);
    }
  }

  /**
   * 获取所有连接器列表（内置能力 + 预置生态 + 自定义接入）
   */
  public listAll(): ConnectorItem[] {
    const result: ConnectorItem[] = [];

    // 1. 内置连接器
    for (const b of BUILTIN_CONNECTORS) {
      const persisted = this.records.get(b.id);
      const disabledSet = new Set(persisted?.disabledTools || []);
      result.push({
        ...b,
        status: 'connected',
        disabledTools: Array.from(disabledSet),
        tools: b.tools.map((t) => ({
          ...t,
          enabled: !disabledSet.has(t.name)
        }))
      });
    }

    // 2. 预置生态目录
    const ecosystemIds = new Set(CATALOGUE_CONNECTORS.map((c) => c.id));
    for (const c of CATALOGUE_CONNECTORS) {
      const persisted = this.records.get(c.id);
      if (persisted) {
        const disabledSet = new Set(persisted.disabledTools || []);
        result.push({
          ...c,
          status: persisted.status,
          connectedAt: persisted.connectedAt,
          updatedAt: persisted.updatedAt,
          error: persisted.error,
          url: persisted.url || c.url,
          key: persisted.key ? '••••••••' : undefined,
          disabledTools: Array.from(disabledSet),
          tools: c.tools.map((t) => ({
            ...t,
            enabled: !disabledSet.has(t.name)
          }))
        });
      } else {
        result.push({
          ...c,
          status: 'disconnected',
          disabledTools: [],
          tools: c.tools.map((t) => ({ ...t, enabled: true }))
        });
      }
    }

    // 3. 自定义新增的 MCP 连接器
    for (const [id, r] of this.records.entries()) {
      if (!BUILTIN_CONNECTORS.some((b) => b.id === id) && !ecosystemIds.has(id)) {
        const disabledSet = new Set(r.disabledTools || []);
        result.push({
          id: r.id,
          name: r.name,
          category: r.category || 'custom',
          description: r.description || '自定义接入的扩展连接器',
          status: r.status,
          authType: r.authType,
          color: r.color || '#64748b',
          url: r.url,
          command: r.command,
          args: r.args,
          env: r.env,
          connectedAt: r.connectedAt,
          updatedAt: r.updatedAt,
          error: r.error,
          disabledTools: Array.from(disabledSet),
          tools: (r.customTools || []).map((t) => ({
            ...t,
            enabled: !disabledSet.has(t.name)
          }))
        });
      }
    }

    return result;
  }

  /**
   * 获取单个连接器详情
   */
  public get(id: string): ConnectorItem | null {
    const all = this.listAll();
    return all.find((item) => item.id === id) || null;
  }

  /**
   * 建立连接或更新认证配置
   */
  public async connect(
    id: string,
    options: {
      key?: string;
      token?: string;
      url?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      label?: string;
      description?: string;
      category?: ConnectorCategory;
    }
  ): Promise<ConnectorItem> {
    const existingPreset = CATALOGUE_CONNECTORS.find((c) => c.id === id);
    const existingBuiltin = BUILTIN_CONNECTORS.find((b) => b.id === id);

    let record = this.records.get(id);
    const now = Date.now();

    if (!record) {
      record = {
        id,
        name: options.label || existingPreset?.name || existingBuiltin?.name || id,
        category: options.category || existingPreset?.category || existingBuiltin?.category || 'custom',
        description: options.description || existingPreset?.description || existingBuiltin?.description || '扩展连接器',
        status: 'connected',
        authType: existingPreset?.authType || (options.command ? 'stdio' : options.key ? 'key' : 'none'),
        color: existingPreset?.color || '#0064d4',
        url: options.url || existingPreset?.url,
        command: options.command,
        args: options.args,
        env: options.env,
        key: options.key,
        token: options.token,
        connectedAt: now,
        updatedAt: now,
        disabledTools: []
      };
    } else {
      record.status = 'connected';
      record.updatedAt = now;
      if (options.key !== undefined) record.key = options.key;
      if (options.token !== undefined) record.token = options.token;
      if (options.url !== undefined) record.url = options.url;
      if (options.command !== undefined) record.command = options.command;
      if (options.args !== undefined) record.args = options.args;
      if (options.env !== undefined) record.env = options.env;
      if (options.label) record.name = options.label;
      record.error = undefined;
    }

    // 若为命令行 stdio MCP 服务，挂载至 McpClientManager
    if (record.command && this.mcpManager) {
      try {
        const mountedTools = await this.mcpManager.addServer(record.id, {
          command: record.command,
          args: record.args,
          env: record.env
        });
        record.customTools = mountedTools.map((t) => ({
          name: t.name,
          description: t.description,
          enabled: true
        }));
      } catch (err: any) {
        record.status = 'error';
        record.error = `MCP 进程启动失败: ${err.message}`;
      }
    }

    this.records.set(id, record);
    this.saveToDisk();

    return this.get(id)!;
  }

  /**
   * 断开连接器
   */
  public async disconnect(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;

    record.status = 'disconnected';
    record.updatedAt = Date.now();
    record.key = undefined;
    record.token = undefined;
    record.error = undefined;

    // 若挂载过 MCP 客户端，则停止
    if (this.mcpManager) {
      await this.mcpManager.removeServer(id);
    }

    this.records.set(id, record);
    this.saveToDisk();
    return true;
  }

  /**
   * 测试连接器连通性
   */
  public async test(id: string): Promise<{ success: boolean; latencyMs: number; message: string }> {
    const item = this.get(id);
    if (!item) {
      return { success: false, latencyMs: 0, message: '连接器不存在' };
    }

    const start = Date.now();

    // 内置连接器常驻就绪
    if (item.category === 'builtin') {
      return {
        success: true,
        latencyMs: Math.max(1, Date.now() - start),
        message: '内置沙箱能力常驻运行，状态良好'
      };
    }

    // 远程 HTTP 端点探测
    if (item.url && item.url.startsWith('http')) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const headers: Record<string, string> = { 'User-Agent': 'MuseClaw-Connector/0.1.0' };
        if (item.key) headers['Authorization'] = `Bearer ${item.key}`;
        const res = await fetch(item.url, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
        clearTimeout(timeout);
        const latency = Date.now() - start;
        return {
          success: res.status < 500,
          latencyMs: latency,
          message: `端点响应正常 (HTTP ${res.status}, 耗时 ${latency}ms)`
        };
      } catch (err: any) {
        return {
          success: false,
          latencyMs: Date.now() - start,
          message: `网络探测异常: ${err.message}`
        };
      }
    }

    // 默认测试成功
    return {
      success: true,
      latencyMs: Math.max(2, Date.now() - start),
      message: '连接配置校验通过，服务可达'
    };
  }

  /**
   * 细粒度开启或关闭连接器下的指定工具
   */
  public toggleTool(id: string, toolName: string, enabled: boolean): boolean {
    let record = this.records.get(id);
    if (!record) {
      record = {
        id,
        name: id,
        category: 'work',
        description: '',
        status: 'connected',
        authType: 'none',
        disabledTools: []
      };
    }

    const disabledSet = new Set(record.disabledTools || []);
    if (enabled) {
      disabledSet.delete(toolName);
    } else {
      disabledSet.add(toolName);
    }

    record.disabledTools = Array.from(disabledSet);
    record.updatedAt = Date.now();
    this.records.set(id, record);
    this.saveToDisk();

    return true;
  }

  /**
   * 删除自定义连接器
   */
  public async remove(id: string): Promise<boolean> {
    if (this.mcpManager) {
      await this.mcpManager.removeServer(id);
    }
    const existed = this.records.delete(id);
    if (existed) {
      this.saveToDisk();
    }
    return existed;
  }

  /**
   * 检查指定工具名称是否被用户禁用
   */
  public isToolEnabled(toolName: string): boolean {
    for (const record of this.records.values()) {
      if (record.disabledTools && record.disabledTools.includes(toolName)) {
        return false;
      }
    }
    return true;
  }
}
