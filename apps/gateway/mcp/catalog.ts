import { execFileSync } from 'node:child_process';
import type { McpCatalogEntry, McpRuntimeStatus } from './types.ts';

let cachedRuntimes: { ts: number; data: McpRuntimeStatus } | null = null;

function commandExists(cmd: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(probe, [cmd], { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 探测宿主环境中可用的 MCP 运行时命令（60 秒缓存）
 */
export function detectMcpRuntimes(force = false): McpRuntimeStatus {
  const now = Date.now();
  if (!force && cachedRuntimes && now - cachedRuntimes.ts < 60_000) {
    return cachedRuntimes.data;
  }
  const data: McpRuntimeStatus = {
    npx: commandExists('npx'),
    node: commandExists('node'),
    uvx: commandExists('uvx'),
    docker: commandExists('docker'),
    python3: commandExists('python3') || commandExists('python')
  };
  cachedRuntimes = { ts: now, data };
  return data;
}

/**
 * 预置精选可运行 MCP 服务目录
 */
export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'filesystem',
    name: 'Filesystem 文件工作区',
    category: 'utility',
    description: '安全授权指定本地目录的文件读取、目录检索与编辑能力',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    risk: 'moderate',
    requiresRuntime: 'npx',
    requiredArgs: [
      {
        index: 2,
        key: 'rootDir',
        label: '授权根目录路径',
        placeholder: '/home/user/workspace 或 .',
        defaultValue: '.',
        required: true
      }
    ],
    tags: ['本地文件', '官方']
  },
  {
    id: 'memory',
    name: 'Knowledge Graph 记忆图谱',
    category: 'data',
    description: '基于本地实体-关系图谱的持久化结构化知识记忆服务',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    risk: 'safe',
    requiresRuntime: 'npx',
    tags: ['知识图谱', '官方']
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking 深度推演',
    category: 'utility',
    description: '为复杂架构设计与多步排错提供结构化链式反思工具',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    risk: 'safe',
    requiresRuntime: 'npx',
    tags: ['推理增强', '官方']
  },
  {
    id: 'context7',
    name: 'Context7 实时框架文档',
    category: 'dev',
    description: '实时拉取最新开源库与框架官方文档和代码片段，消除 API 幻觉',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    docs: 'https://github.com/upstash/context7',
    risk: 'safe',
    requiresRuntime: 'npx',
    tags: ['文档检索', '零密钥']
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki 开源仓库百科',
    category: 'dev',
    description: '零鉴权远程 MCP 端点，直接检索与提问 GitHub 开源仓库架构文档',
    transport: 'http',
    url: 'https://mcp.deepwiki.com/mcp',
    docs: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    risk: 'safe',
    tags: ['远程 HTTP', '零密钥']
  },
  {
    id: 'playwright',
    name: 'Playwright 浏览器自动化',
    category: 'browser',
    description: '使用真实浏览器内核执行页面导航、表单交互、截图与 DOM 调试',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    docs: 'https://github.com/microsoft/playwright-mcp',
    risk: 'moderate',
    requiresRuntime: 'npx',
    tags: ['浏览器', '自动化']
  },
  {
    id: 'fetch',
    name: 'Fetch 网页正文抓取',
    category: 'search',
    description: '轻量级网页内容抓取并自动转换为 Markdown 正文',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    risk: 'safe',
    requiresRuntime: 'uvx',
    tags: ['网页抓取', 'uvx']
  },
  {
    id: 'boardui',
    name: 'BoardUI 设计系统',
    category: 'design',
    description: 'React + Tailwind v4 仪表盘组件目录、主题变量与代码生成工具',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'boardui@latest', 'mcp'],
    docs: 'https://www.boardui.com',
    risk: 'safe',
    requiresRuntime: 'npx',
    tags: ['UI 组件', '前端']
  },
  {
    id: 'github',
    name: 'GitHub 研发协同',
    category: 'dev',
    description: '仓库检索、代码读取、Issue/PR 管理与提交历史分析',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    docs: 'https://github.com/github/github-mcp-server',
    risk: 'moderate',
    requiresRuntime: 'npx',
    requiredEnv: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token',
        placeholder: 'ghp_xxxxxxxxxxxx',
        required: true,
        secret: true,
        help: 'GitHub Developer Settings 生成的 PAT 令牌'
      }
    ],
    tags: ['Git', '代码库']
  },
  {
    id: 'tavily',
    name: 'Tavily AI 联网搜索',
    category: 'search',
    description: '面向 Agent 的高精度互联网实时检索与网页结构化提纯',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'tavily-mcp@latest'],
    docs: 'https://docs.tavily.com/documentation/mcp',
    risk: 'safe',
    requiresRuntime: 'npx',
    requiredEnv: [
      {
        key: 'TAVILY_API_KEY',
        label: 'Tavily API Key',
        placeholder: 'tvly-xxxxxxxxxxxx',
        required: true,
        secret: true
      }
    ],
    tags: ['联网搜索', 'RAG']
  },
  {
    id: 'brave-search',
    name: 'Brave Search 搜索引擎',
    category: 'search',
    description: '高速网页与本地商户搜索 MCP 服务',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    risk: 'safe',
    requiresRuntime: 'npx',
    requiredEnv: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave Search API Key',
        placeholder: 'BSAxxxxxxxxxxxx',
        required: true,
        secret: true
      }
    ],
    tags: ['网页检索']
  },
  {
    id: 'amap-maps',
    name: '高德地图 Amap MCP',
    category: 'search',
    description: '国内地理编码、POI 检索、公交驾车路线规划与实时气象查询',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@amap/amap-maps-mcp-server'],
    docs: 'https://lbs.amap.com/api/mcp-server/summary',
    risk: 'safe',
    requiresRuntime: 'npx',
    requiredEnv: [
      {
        key: 'AMAP_MAPS_API_KEY',
        label: '高德 Web 服务 Key',
        placeholder: '输入高德开放平台 Key',
        required: true,
        secret: true
      }
    ],
    tags: ['地图出行', '气象']
  },
  {
    id: 'postgres',
    name: 'PostgreSQL 只读分析',
    category: 'data',
    description: '检查 PostgreSQL 表结构并执行只读 SQL 查询分析',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost:5432/mydb'],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    risk: 'sensitive',
    requiresRuntime: 'npx',
    requiredArgs: [
      {
        index: 2,
        key: 'dsn',
        label: 'PostgreSQL 连接串 (DSN)',
        placeholder: 'postgresql://user:password@localhost:5432/dbname',
        defaultValue: 'postgresql://localhost:5432/postgres',
        required: true
      }
    ],
    tags: ['数据库', 'SQL']
  },
  {
    id: 'sqlite',
    name: 'SQLite 本地数据库',
    category: 'data',
    description: '本地 SQLite 数据库查询、Schema 自省与数据分析洞察',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', './data/local.db'],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    risk: 'moderate',
    requiresRuntime: 'uvx',
    requiredArgs: [
      {
        index: 2,
        key: 'dbPath',
        label: 'SQLite 数据库文件路径',
        placeholder: './data/local.db',
        defaultValue: './data/local.db',
        required: true
      }
    ],
    tags: ['数据库', 'uvx']
  },
  {
    id: 'notion',
    name: 'Notion 远程工作区',
    category: 'work',
    description: '检索、阅读与更新 Notion 页面与多维数据库',
    transport: 'http',
    url: 'https://mcp.notion.com/mcp',
    docs: 'https://developers.notion.com/docs/mcp',
    risk: 'moderate',
    requiredHeaders: [
      {
        key: 'Authorization',
        label: 'Authorization Header / Bearer Token',
        placeholder: 'Bearer ntn_xxxxxxxxxxxx',
        required: true,
        secret: true
      }
    ],
    tags: ['远程 HTTP', '知识库']
  },
  {
    id: 'linear',
    name: 'Linear 研发任务',
    category: 'work',
    description: '搜索、创建与更新 Linear 团队 Issue、项目与周期进度',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    docs: 'https://linear.app/docs/mcp',
    risk: 'moderate',
    requiredHeaders: [
      {
        key: 'Authorization',
        label: 'Authorization Header / API Key',
        placeholder: 'Bearer lin_api_xxxxxxxxxxxx',
        required: true,
        secret: true
      }
    ],
    tags: ['远程 HTTP', '项目管理']
  },
  {
    id: 'sentry',
    name: 'Sentry 线上异常监控',
    category: 'dev',
    description: '拉取线上 Issue 堆栈、事件上下文与性能指标诊断',
    transport: 'http',
    url: 'https://mcp.sentry.dev/mcp',
    docs: 'https://docs.sentry.io/product/sentry-mcp/',
    risk: 'safe',
    requiredHeaders: [
      {
        key: 'Authorization',
        label: 'Sentry Auth Token Header',
        placeholder: 'Bearer sntrys_xxxxxxxxxxxx',
        required: true,
        secret: true
      }
    ],
    tags: ['远程 HTTP', 'APM']
  }
];
