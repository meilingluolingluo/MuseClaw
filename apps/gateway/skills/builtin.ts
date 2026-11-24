/**
 * MuseClaw Built-in Skills Ecosystem
 * 内置核心工程规程库，提供系统运维、办公协作、深度研究、生态集成与实用工具的标准实现
 */

import type { SkillCategory, SkillRequirements } from '@museclaw/protocol';

export interface BuiltinSkillFile {
  path: string;
  content: string;
  executable?: boolean;
}

export interface BuiltinSkillEntry {
  name: string;
  description: string;
  category: SkillCategory;
  channel?: 'api' | 'cli' | 'web' | 'browser' | 'gui' | 'mixed';
  requires?: SkillRequirements;
  allowedTools: string[];
  content: string;
  files?: BuiltinSkillFile[];
}

export const BUILTIN_SKILLS: BuiltinSkillEntry[] = [
  {
    name: 'amap',
    description: '高德地图服务：查询地理编码、周边设施、路线规划与天气预报。当需要了解地点、路线、耗时或天气时使用。',
    category: 'integration',
    channel: 'api',
    requires: {
      env: ['AMAP_API_KEY'],
      bins: ['python3']
    },
    allowedTools: ['web_fetch', 'execute_shell'],
    files: [
      {
        path: 'scripts/amap_helper.py',
        content: `#!/usr/bin/env python3\nimport sys, json\n\ndef format_duration(seconds: int) -> str:\n    m, s = divmod(seconds, 60)\n    h, m = divmod(m, 60)\n    return f"{h}小时{m}分" if h else f"{m}分钟"\n\nif __name__ == "__main__":\n    print(json.dumps({"helper": "amap_location_formatter", "status": "ready"}))\n`,
        executable: true
      }
    ],
    content: `---
name: amap
description: 高德地图服务：查询地理编码、周边设施、路线规划与天气预报。当需要了解地点、路线、耗时或天气时使用。
category: integration
requires:
  env: [AMAP_API_KEY]
  bins: [python3]
allowed-tools: [web_fetch, execute_shell]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 高德地图 (Amap) 技能指南

通过高德地图开放接口或服务快速解决地理位置、路线规划、出行耗时与天气预报需求。

## 核心能力与工具映射
- 地理编码 / 逆地理编码：将地点名称（如 "北京南站"、"上海陆家嘴"）转换为精确经纬度坐标 (经度,纬度, GCJ-02)，或反查地址。
- 周边检索与详情查询：按关键字（如 "咖啡馆"、"快捷酒店"）在指定城市或特定半径内搜索，获取评分、营业时间、联系电话与具体地址。
- 多模式路线规划：支持驾车 (driving)、步行 (walking)、骑行 (bicycling) 与公交地铁综合换乘 (transit)。
- 距离与耗时测算：快速计算两点间的实际路网距离与预估通行耗时。
- 城市实时天气与预报：查询指定城市未来 3-5 天的天气状况、气温与风向。

## 执行规程
1. 先端点后路线：路线规划前，必须先将起点与终点分别解析为具体经纬度坐标，再调用路线规划接口。
2. 耗时单位转换：接口返回的持续时间通常为秒、距离为米；向用户汇报时务必换算为分钟/小时与公里。
3. 对比推荐模式：若用户未指定出行方式，提供驾车与公共交通的对比，并结合当前时间段（如早晚高峰）给出最优出行建议。
4. 周边精简推荐：周边查询时，默认精选 3 家口碑最佳或距离最近的地点，附上评分与核心亮点，避免信息轰炸。`
  },
  {
    name: 'linux-ops',
    description: 'Linux 主机运维与沙箱排障：系统硬件指标、CPU/内存/磁盘健康巡检、网络端口探测与故障分析。',
    category: 'devops',
    channel: 'cli',
    requires: {
      bins: ['bash', 'df', 'free', 'ps', 'ss']
    },
    allowedTools: ['execute_shell', 'read_file', 'save_artifact'],
    files: [
      {
        path: 'scripts/health_check.sh',
        content: `#!/usr/bin/env bash\nset -euo pipefail\necho "================ Linux Host Health Inspection ================"\necho "[1. 根分区与主要挂载点磁盘使用率]"\ndf -h\necho ""\necho "[2. 系统内存与 Swap 占用]"\nfree -m\necho ""\necho "[3. CPU 占用率 Top 5 进程]"\nps aux --sort=-%cpu | head -n 6\necho ""\necho "[4. 核心服务监听端口探测]"\nss -tulpn\necho "================ Inspection Completed ================"\n`,
        executable: true
      },
      {
        path: 'scripts/clean_temp.sh',
        content: `#!/usr/bin/env bash\necho "Scanning stale temporary logs (>3 days)..."\nfind /tmp -maxdepth 2 -type f -name "*.log" -mtime +3 2>/dev/null || true\n`,
        executable: true
      }
    ],
    content: `---
name: linux-ops
description: Linux 主机运维与沙箱排障：系统硬件指标、CPU/内存/磁盘健康巡检、网络端口探测与故障分析。
category: devops
requires:
  bins: [bash, df, free, ps, ss]
allowed-tools: [execute_shell, read_file, save_artifact]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# Linux 运维排障技能 (Linux Ops)

在隔离微沙箱环境中执行主机与系统环境的巡检、性能分析和排障规程。

## 常用健康巡检指令
- 磁盘使用率：\`df -h\` 检查根分区与数据分区是否超过 85% 预警线。
- 内存与 Swap：\`free -m\` 查看可用内存与 Buffer/Cache。
- CPU 负载与前五耗资源进程：\`ps aux --sort=-%cpu | head -n 6\`。
- 端口监听状态：\`ss -tulpn\` 确认核心服务端口（如 8799、80、443 等）是否正常活跃。

## 安全与隔离准则
1. 严禁无授权重启或强制杀灭系统关键 PID 1 进程。
2. 涉及删除生产环境日志或释放磁盘空间时，仅清理确定陈旧的 \`.log.gz\`，并必须经过用户确认。`
  },
  {
    name: 'feishu',
    description: '飞书协作生态对接：发送富文本互动卡片、获取用户信息、群组消息通知与即时审批交互。',
    category: 'integration',
    channel: 'api',
    requires: {
      env: ['FEISHU_APP_ID', 'FEISHU_APP_SECRET']
    },
    allowedTools: ['web_fetch'],
    content: `---
name: feishu
description: 飞书协作生态对接：发送富文本互动卡片、获取用户信息、群组消息通知与即时审批交互。
category: integration
requires:
  env: [FEISHU_APP_ID, FEISHU_APP_SECRET]
allowed-tools: [web_fetch]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 飞书 (Feishu) 机器人集成规程

与飞书开放平台无缝联动，实现群聊通知、单聊互动与审批卡片推送。

## 规程准则
1. 消息格式优先卡片化：重要业务通知使用飞书 Interactive 消息卡片，包含清晰的标题、关键指标排版与确认按钮。
2. 身份校验与凭据保护：所有请求自动带上 tenant_access_token；严禁在日志中打印 AppSecret。
3. 异常降级处理：若卡片富文本解析失败，平滑降级为普通纯文本 post 消息发送，避免丢失通知。`
  },
  {
    name: 'web-research',
    description: '网页深度采集与结构化提取：轻量 HTTP 抓取正文与元信息，清洗页面噪音并提炼核心要点。',
    category: 'research',
    channel: 'web',
    requires: {
      bins: ['curl', 'python3']
    },
    allowedTools: ['web_fetch', 'save_artifact'],
    files: [
      {
        path: 'scripts/clean_html.py',
        content: `#!/usr/bin/env python3\nimport sys, re\n\ndef clean_html(html: str) -> str:\n    text = re.sub(r'<script.*?</script>', '', html, flags=re.DOTALL|re.IGNORECASE)\n    text = re.sub(r'<style.*?</style>', '', text, flags=re.DOTALL|re.IGNORECASE)\n    text = re.sub(r'<[^>]+>', ' ', text)\n    return re.sub(r'\\s+', ' ', text).strip()\n\nif __name__ == '__main__':\n    raw = sys.stdin.read()\n    print(clean_html(raw))\n`,
        executable: true
      }
    ],
    content: `---
name: web-research
description: 网页深度采集与结构化提取：轻量 HTTP 抓取正文与元信息，清洗页面噪音并提炼核心要点。
category: research
requires:
  bins: [curl, python3]
allowed-tools: [web_fetch, save_artifact]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 深度网页信息采集与语义萃取 (Web Research)

高效抓取文章、技术文档与资讯并进行结构化萃取。

## 规程准则
1. 高效抓取：使用 \`web_fetch\` 获取 HTML 或 Markdown 文本；若响应大于 8000 字节，提取主要阅读章节。
2. 网页清洗与降噪：剔除页眉导航、版权声明、侧边栏推荐与底部广告，仅保留正文核心内容。
3. 结构化萃取：
   - 核心主旨 (1 句话)
   - 关键论点或技术实现要点 (3-5 条要点)
   - 数据支撑与参数对比
   - 核心启示与建议`
  },
  {
    name: 'browser-automation',
    description: '无头浏览器自动化交互：单页应用深度渲染、复杂表单交互填写与 DOM 动态数据抓取。',
    category: 'research',
    channel: 'browser',
    requires: {
      bins: ['chromium-browser', 'node']
    },
    allowedTools: ['browser_open', 'save_artifact'],
    content: `---
name: browser-automation
description: 无头浏览器自动化交互：单页应用深度渲染、复杂表单交互填写与 DOM 动态数据抓取。
category: research
requires:
  bins: [chromium-browser, node]
allowed-tools: [browser_open, save_artifact]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 无头浏览器自动化 (Browser Automation)

当目标网站依赖高度动态的 JavaScript 前端渲染、或需要模拟交互时启动。

## 准则与环境控制
1. 按需启动：若静态 HTTP \`web_fetch\` 已经能获取所需数据，避免启动重量级浏览器内核。
2. 异常降级兜底：当后台 Headless Browser 独立服务未启动时，必须平滑降级为轻量静态抓取。
3. 敏感数据与 Cookie 隔离：任务结束后自动清理临时会话 Cookie 与 Storage。`
  },
  {
    name: 'tencent-meeting',
    description: '腾讯会议管理：查询预约会议、创建会议房间、生成参会链接与发送参会邀请。',
    category: 'productivity',
    channel: 'api',
    requires: {
      env: ['TENCENT_MEETING_SECRET_ID']
    },
    allowedTools: ['web_fetch'],
    content: `---
name: tencent-meeting
description: 腾讯会议管理：查询预约会议、创建会议房间、生成参会链接与发送参会邀请。
category: productivity
requires:
  env: [TENCENT_MEETING_SECRET_ID]
allowed-tools: [web_fetch]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 腾讯会议 (Tencent Meeting) 操作指南

快速为团队或用户预定线上会议，管理会议室与发送入会邀请。

## 规程准则
1. 关键参数确认：创建会议前必须确认会议主题、开始时间、持续时长与是否开启等候室。
2. 汇报格式标准化：创建完成后输出标准化卡片，包含会议号、入会链接、密码（若有）与日历提醒建议。`
  },
  {
    name: 'trip-plan',
    description: '差旅与行程全流程规划：交通班次对比、酒店推荐、日程安排与多天完整行程表交付。',
    category: 'productivity',
    channel: 'mixed',
    requires: {
      bins: ['python3']
    },
    allowedTools: ['web_fetch', 'save_artifact'],
    files: [
      {
        path: 'assets/budget_template.csv',
        content: `项目,类别,预估单价(元),数量,小计(元),备注\n高铁往返,交通,553,2,1106,二等座\n市内交通,交通,80,3,240,地铁与打车\n商务酒店,住宿,450,2,900,含早餐\n工作餐饮,餐饮,150,3,450,商务简餐\n合计,,,,2796,\n`
      },
      {
        path: 'references/packing_checklist.md',
        content: `# 差旅打包必备清单\n\n## 证件与财产\n- [ ] 身份证 / 护照\n- [ ] 公司门禁卡\n- [ ] 现金 / 银行卡\n\n## 电子设备\n- [ ] 笔记本电脑与电源适配器\n- [ ] 手机充电线与快充头\n- [ ] 移动电源 (<=20000mAh)\n- [ ] 降噪耳机\n`
      }
    ],
    content: `---
name: trip-plan
description: 差旅与行程全流程规划：交通班次对比、酒店推荐、日程安排与多天完整行程表交付。
category: productivity
requires:
  bins: [python3]
allowed-tools: [web_fetch, save_artifact]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 差旅规划技能 (Trip Plan)

面向商务出行与多天差旅提供专业行程规划，产出 Markdown/HTML 完整交付工件。

## 执行规程
1. 需求澄清：目的地、出发日期、返回日期、同行人数、预算范围与核心差旅行程。
2. 交通规划：优先考虑高铁（4小时以内）或航班（远途），给出至少两套出行组合。
3. 住宿建议：推荐距办事地点 3 公里以内的商务酒店，附评分与取消政策。
4. 交付工件：生成带有预算表、每日时间表与随身清单的完整规划报告。`
  },
  {
    name: 'compare-options',
    description: '多方案优劣对比与决策辅助：构建加权对比矩阵、技术选型分析与决策建议报告。',
    category: 'productivity',
    channel: 'mixed',
    requires: {},
    allowedTools: ['save_artifact'],
    files: [
      {
        path: 'assets/tradeoff_matrix.md',
        content: `# 方案对比与加权决策矩阵\n\n| 评估维度 | 权重 (0-1) | 方案 A | 方案 B | 方案 C |\n| :--- | :--- | :--- | :--- | :--- |\n| 实施成本 | 0.25 | 8 | 6 | 9 |\n| 稳定性能 | 0.30 | 9 | 8 | 7 |\n| 维护难度 | 0.20 | 7 | 8 | 6 |\n| 生态兼容 | 0.25 | 8 | 9 | 7 |\n| **加权总分** | **1.00** | **8.1** | **7.75** | **7.3** |\n`
      }
    ],
    content: `---
name: compare-options
description: 多方案优劣对比与决策辅助：构建加权对比矩阵、技术选型分析与决策建议报告。
category: productivity
requires: {}
allowed-tools: [save_artifact]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 多方案决策与权衡对比 (Compare Options)

当用户面临 2 个或以上技术路线、产品工具、商务选型或策略方向的抉择时，提供客观、量化且有依据的对比报告。

## 对比矩阵标准结构
1. 对比维度设定：成本/价格、性能/吞吐、易用性/上手曲线、维护与生态支持、风险与安全性。
2. 5分制加权打分表：明确各维度的权重百分比与各方案的客观得分。
3. Pros & Cons (优缺点梳理)：每个方案列出核心优势与潜在隐患。
4. 结论与推荐：根据不同诉求（成本导向 vs 性能导向）给出最终裁决建议。`
  },
  {
    name: 'weekly-review',
    description: '周度工作复盘与规划：总结本周任务完成情况、目标推进复盘、遗留项与下周关键产出。',
    category: 'productivity',
    channel: 'mixed',
    requires: {},
    allowedTools: ['read_file', 'save_artifact'],
    files: [
      {
        path: 'assets/review_template.html',
        content: `<!DOCTYPE html>\n<html lang="zh-CN">\n<head><meta charset="UTF-8"><title>周度工作复盘报告</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:800px;margin:30px auto;padding:24px;line-height:1.6;color:#1e293b;background:#f8fafc}.header{border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin-bottom:20px}h1{color:#0064d4;font-size:24px;margin:0 0 6px}.card{background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05)}h2{font-size:16px;color:#0f172a;margin-top:0;border-left:4px solid #0064d4;padding-left:8px}ul{margin:0;padding-left:20px}</style></head>\n<body><div class="header"><h1>周度工作复盘总结</h1><div style="color:#64748b;font-size:13px">生成时间: {{DATE}} · 数字员工协同交付</div></div><div class="card"><h2>一句话核心亮点</h2><p>{{HIGHLIGHT}}</p></div><div class="card"><h2>本周已交付成果 (Done)</h2><ul>{{DONE_ITEMS}}</ul></div><div class="card"><h2>下周 Top 3 核心战役</h2><ul>{{NEXT_ITEMS}}</ul></div></body></html>\n`
      }
    ],
    content: `---
name: weekly-review
description: 周度工作复盘与规划：总结本周任务完成情况、目标推进复盘、遗留项与下周关键产出。
category: productivity
requires: {}
allowed-tools: [read_file, save_artifact]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 周度工作复盘与规划 (Weekly Review)

每周系统性回顾团队与个人产出，对齐长周期目标。

## 汇总维度
1. 一句话本周总结：本周最大的突破或里程碑。
2. 已完成事项 (Done)：列出已交付的工件、完成的代码提交、上线的版本。
3. 阻塞与延期项 (Blockers)：未达预期的事项及其根本原因分析。
4. 目标推进进度：评估长周期目标完成比例变动。
5. 下周 Top 3 核心战役：明确下周最重要的 3 件事与交付标准。`
  },
  {
    name: 'inbox-triage',
    description: '待办收件箱分拣：解析多渠道杂乱待办、会议纪要与便签，按优先级与截止时间结构化沉淀。',
    category: 'productivity',
    channel: 'api',
    requires: {},
    allowedTools: ['save_artifact'],
    content: `---
name: inbox-triage
description: 待办收件箱分拣：解析多渠道杂乱待办、会议纪要与便签，按优先级与截止时间结构化沉淀。
category: productivity
requires: {}
allowed-tools: [save_artifact]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 待办事项智能分拣 (Inbox Triage)

将杂乱的文字便签、聊天截图文字或待办清单进行四象限矩阵分级。

## 分级模型 (四象限准则)
- P0 (重要且紧急)：今天必须完成，逾期会产生严重负面影响。
- P1 (重要不紧急)：推进长周期目标的核心工作，需安排专门时间槽。
- P2 (紧急不重要)：琐事或临时打扰，建议快速处理或委托。
- P3 (不重要不紧急)：参考资料或低价值项，考虑归档或暂缓。`
  },
  {
    name: 'meeting-prep',
    description: '会议准备向导：生成议程框架、背景知识速览包、发言提纲与预期达成决议清单。',
    category: 'productivity',
    channel: 'api',
    requires: {},
    allowedTools: ['save_artifact'],
    content: `---
name: meeting-prep
description: 会议准备向导：生成议程框架、背景知识速览包、发言提纲与预期达成决议清单。
category: productivity
requires: {}
allowed-tools: [save_artifact]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 会议前置准备指南 (Meeting Prep)

开会前帮助参会人员明确主题、理清上下文与准备发言提纲。

## 准备要素
1. 会议目标 (Objective)：本场会议要解决的核心痛点。
2. 关键输入材料速览：简要提炼 3 点背景。
3. 议程与时间分配：每个议题严格控制在预计分钟内。
4. 预期产出：会议结束时必须达成的明确共识或行动项 (Action Items)。`
  },
  {
    name: 'kuaidi100',
    description: '快递物流状态追踪：输入单号快速查询最新承运轨迹、预计派送时间与签收状态。',
    category: 'integration',
    channel: 'api',
    requires: {
      env: ['KUAIDI100_KEY']
    },
    allowedTools: ['web_fetch'],
    content: `---
name: kuaidi100
description: 快递物流状态追踪：输入单号快速查询最新承运轨迹、预计派送时间与签收状态。
category: integration
requires:
  env: [KUAIDI100_KEY]
allowed-tools: [web_fetch]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 快递与物流追踪规程 (Kuaidi100)

查询国内主流快递公司的最新流转动态。

## 规程准则
1. 自动识别快递公司：若用户未指定顺丰、中通、圆通等，优先调用快递公司自动识别接口。
2. 最新节点提炼：向用户汇报时，重点突出最新一条轨迹的时间、地点与派送员联系方式。`
  },
  {
    name: 'train-tickets',
    description: '12306 铁路班次与余票查询：快速检索出发到达城市间的车次信息、发车时间与座席状态。',
    category: 'utility',
    channel: 'api',
    requires: {
      bins: ['curl']
    },
    allowedTools: ['web_fetch'],
    content: `---
name: train-tickets
description: 12306 铁路班次与余票查询：快速检索出发到达城市间的车次信息、发车时间与座席状态。
category: utility
requires:
  bins: [curl]
allowed-tools: [web_fetch]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# 铁路车次与余票查询规程 (Train Tickets)

为用户提供列车时刻表、车次代码与座席余票信息。

## 规程准则
1. 车站代码映射：输入城市名称先转换为标准电报码（如北京对应 BJP）。
2. 高铁与动车优先：默认优先筛选 G/D 字头车次，明确标注入座席类别与价格。`
  },
  {
    name: 'skill-creator',
    description: '技能工程包编写向导：引导用户或 Agent 编写包含 SKILL.md、辅助脚本与模板的完整技能包。',
    category: 'utility',
    channel: 'api',
    requires: {
      bins: ['bash']
    },
    allowedTools: ['save_artifact'],
    content: `---
name: skill-creator
description: 技能工程包编写向导：引导用户或 Agent 编写包含 SKILL.md、辅助脚本与模板的完整技能包。
category: utility
requires:
  bins: [bash]
allowed-tools: [save_artifact]
metadata:
  author: MuseClaw
  version: "1.2.0"
---

# Agent 技能工程包编写向导 (Skill Creator)

指导编写符合标准工程包架构的 Agent Skill（目录组织、SKILL.md、scripts/ 辅助脚本、references/ 参考资料、assets/ 模板与环境依赖申明）。

## 黄金准则
1. 命名必须规范：小写字母、数字、单连字符，如 \`github-pr-review\`、\`daily-news-digest\`。
2. Description 是路由灵魂：必须一句话写清“做什么”以及“在什么具体触发词或场景下调用它”。
3. 准确声明业务分类 (category) 与环境要求 (requires)：
   - category 可选：\`devops\` (系统运维), \`productivity\` (办公协作), \`research\` (信息研究), \`integration\` (生态集成), \`utility\` (实用工具)
   - requires 申明：需要的系统二进制工具 (\`bins\`) 与环境变量 (\`env\`)
4. 脚本与模板丰富：在 scripts/ 下提供可执行脚本，在 assets/ 提供模板文件。
5. 指令正文包含：核心前置条件、分步执行流程、边界约束、最终交付格式。`
  },
  {
    name: 'interactive-ui',
    description: '智能交互界面规范：当用户需要可逐层展开的结构原理图、可调参数实时重算的计算器/清单、动态图表或交互式可视化演示时，通过 show_widget 直接在对话中生成自包含 HTML/SVG 组件。',
    category: 'productivity',
    channel: 'web',
    allowedTools: ['show_widget'],
    content: `---
name: interactive-ui
description: 智能交互界面规范：当用户需要可逐层展开的结构原理图、可调参数实时重算的计算器/清单、动态图表或交互式可视化演示时，通过 show_widget 直接在对话中生成自包含 HTML/SVG 组件。
category: productivity
allowed-tools: [show_widget]
metadata:
  author: MuseClaw
  version: "1.0.0"
---

# 智能交互界面 (Interactive UI) 创作规范

当纯文本或静态表格难以直观表达信息时，优先使用 \`show_widget\` 工具向用户交付直接可操作的交互界面。

## 典型适用场景
1. **结构拆解与原理演示**：机械/系统分层结构图（如点击部件逐层展开详情、高亮关联模块、缩放切换视图）。
2. **参数联动计算器与清单**：家宴采购清单、预算/成本估算、配比换算（调节人数滑块、单价或开关，明细与总计实时重算）。
3. **动态图表与方案对比**：多维度筛选、标签切换、排序对比表、交互式时间线。

## 设计与主题规范
1. **必须复用宿主 CSS 变量，严禁硬编码固定背景色与文字颜色**，确保在明亮与暗黑模式下均清晰可读：
   - 背景与表面：\`var(--om-bg)\`, \`var(--om-surface)\`, \`var(--om-surface-2)\`
   - 边框与分割线：\`var(--om-border)\`
   - 文字色彩：\`var(--om-fg)\`, \`var(--om-muted)\`
   - 强调与状态色：\`var(--om-accent)\`, \`var(--om-accent-soft)\`, \`var(--om-accent-soft-fg)\`, \`var(--accent-green)\`, \`var(--accent-amber)\`, \`var(--accent-red)\`
2. **透明自适应画布**：\`body\` 保持透明背景与零外边距，宽度使用流式布局（\`width: 100%\`），避免出现水平滚动条；在窄容器下自动换行或堆叠。
3. **自包含与语法可靠**：内联 \`<script>\` 不得存在语法错误；若使用公开 CDN（如 \`cdn.jsdelivr.net\`、\`cdnjs.cloudflare.com\`、\`esm.sh\`、\`unpkg.com\`），需做可用性兜底判断；优先使用轻量原生 SVG + JavaScript 实现。

## 交互回传与原位更新
1. **触发新一轮对话**：需要让用户点击组件按钮继续深入追问时，可调用 \`window.museclaw.send(prompt, { hidden?: boolean })\`，或在按钮上使用声明式属性 \`data-muse-send="追问内容"\`（可选 \`data-muse-hidden="true"\`）。
2. **原位更新组件**：修改或刷新已有交互卡片时，传入原 \`widget_id\` 即可原位替换。

## 降级兼容性
每次调用 \`show_widget\` 时，务必填写简洁完整的 \`fallback_text\`，以便在飞书、如流等纯文本通道或历史记录中依然保留核心结论与数据摘要。`
  }
];
