---
name: MuseClaw Design System
description: Modern Enterprise Digital Employee Workstation Design System
colors:
  primary: "#0064d4"
  primary-dark: "#1793ff"
  primary-soft: "#e5f0ff"
  primary-soft-dark: "#1a2b4a"
  neutral-bg: "#ffffff"
  neutral-bg-dark: "#181819"
  surface: "#ffffff"
  surface-dark: "#202022"
  surface-2: "#f2f2f4"
  surface-2-dark: "#2a2a2d"
  border: "#e7e7ea"
  border-dark: "#333337"
  text-main: "#111112"
  text-main-dark: "#ffffff"
  text-muted: "#6b6b71"
  text-muted-dark: "#9d9da4"
  success: "#34c759"
  success-dark: "#30d158"
  danger: "#ff3b30"
  danger-dark: "#ff453a"
  warning: "#ff9500"
  warning-dark: "#ffd60a"
  accent-purple: "#af52de"
  accent-purple-dark: "#bf5af2"
typography:
  display:
    fontFamily: "Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
rounded:
  sm: "8px"
  md: "14px"
  lg: "20px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  nav-rail:
    width: "68px"
    backgroundColor: "{colors.surface}"
  bubble-user:
    backgroundColor: "{colors.text-main}"
    textColor: "{colors.neutral-bg}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  bubble-agent:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-main}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
---

# MuseClaw Design System

## Overview
MuseClaw 界面设计系统旨在为企业级数字员工协同打造具备「极高信息密度、极低视觉噪音、清晰层级划分与精准反馈」的生产力交互工作台。采用本地托管的现代无衬线字体 Figtree、圆角胶囊容器、层级分明的表面色阶与自适应暗色模式（Dark Mode）。

## Colors
系统构建在语义化表面色阶之上，分为浅色与暗色两套官方调色盘：
- **Primary / Brand**：浅色 `#0064d4`，暗色 `#1793ff`。用于主操作按钮、选中态强调与活动指示器。
- **Primary Soft**：浅色 `#e5f0ff`，暗色 `#1a2b4a`。用于胶囊轻量选中底色与通知背景。
- **Background & Surfaces**：
  - Base Background：浅色 `#ffffff`，暗色 `#181819`。
  - Surface Level 1：浅色 `#ffffff`，暗色 `#202022`。用于侧边栏与卡片主体。
  - Surface Level 2：浅色 `#f2f2f4`，暗色 `#2a2a2d`。用于输入框、次级卡片与智能体消息底色。
- **Borders & Dividers**：浅色 `#e7e7ea`，暗色 `#333337`。细线勾勒，杜绝厚重感。
- **Typography Colors**：主文本 `#111112`（暗色 `#ffffff`），次级文本 `#6b6b71`（暗色 `#9d9da4`），弱化说明文本 `#8e8e93`（暗色 `#7c7c82`）。
- **Status Accents**：
  - 成功 / 正常运行：`#34c759`（暗色 `#30d158`）
  - 警告 / 等待审批：`#ff9500`（暗色 `#ffd60a`）
  - 错误 / 风险拦截：`#ff3b30`（暗色 `#ff453a`）
  - 自动化 / 技能规程：`#af52de`（暗色 `#bf5af2`）

## Typography
排版以 Figtree 为核心，确保现代排版节奏：
- **Display (`1.75rem / 28px`, 700)**：用于系统大标题与核心数据展示。
- **Heading (`1.125rem / 18px`, 600)**：用于卡片标题、抽屉头部与模块划分。
- **Body (`0.875rem / 14px`, 400)**：正文默认字号，行高保持在 1.5 倍以提升阅读舒适度。
- **Caption / Meta (`0.75rem / 12px`, 500)**：时间戳、状态标签与次级信息说明。
- **Code / Mono (`0.8125rem / 13px`)**：等宽字体，用于指令、JSON 参数、Token 与工具输出展示。

## Layout
工作台采用三栏自适应工作流布局：
1. **NavRail（68px）**：最左侧紧凑导航栏，固定呈现产品主图标、功能工作台切换胶囊与全局设置。
2. **SideDrawer（280px - 320px）**：上下文抽屉，用于展示当前工作台的次级结构（如数字员工会话列表、目标树概览或自动化过滤器）。
3. **Main Stage（自适应 flex: 1）**：主视图舞台，包含固定高度的顶栏（TopBar）与支持内部独立滚动的核心工作区。

## Elevation & Depth
通过微阴影与表面明暗对比建立空间进深，避免高反差重黑阴影：
- **Flat / Base**：无阴影，仅依靠 `1px` 微细边框隔离区域。
- **Card Shadow**：浅色模式下 `0 2px 14px rgba(0, 0, 0, 0.06)`，暗色模式下纯靠表面亮度分层。
- **Floating / Modal**：`0 4px 24px rgba(0, 0, 0, 0.25)`，用于弹窗、抽屉悬浮层与悬停浮层。

## Shapes
圆角阶梯统一规划：
- **Small (`8px`)**：输入框、普通按钮、工具标签、状态 Badge。
- **Medium (`14px`)**：消息气泡、卡片主体、嵌套面板。
- **Large (`20px`)**：模态弹窗、主工作区大容器。
- **Pill (`9999px`)**：头像、开关滑块、操作胶囊与浮动指示器。

## Components
核心基础组件规范：
- **BotAvatar**：支持预设角色、动画视频态（idle, working, happy, waiting, error）与离线状态指示环。
- **MessageBubble**：区分用户气泡（深色高辨识实体）与智能体气泡（平缓 Surface-2 底色），内嵌 Markdown 富文本与思考块。
- **ToolTrace**：结构化工具折叠卡片，清晰呈现工具名、参数预览与执行结果/错误状态。
- **StatusCapsule**：圆角胶囊标签，支持脉冲呼吸点与语义状态色。
- **ActionDrawer & Modal**：遮罩毛玻璃背景（`backdrop-filter: blur(12px)`），右上角快捷关闭，底部固定操作条。

## Do's and Don'ts
### Do's
- 保持界面信息密度的同时预留至少 `12px - 16px` 的呼吸感间距。
- 所有数据加载状态均使用骨架屏或优雅的进度胶囊，避免整页空白闪烁。
- 每一个不可逆操作（删除、终止、强制停止）必须具备二次确认或 Toast 撤销能力。
- 保证高对比度无障碍合规，图标与操作按钮附带清晰的 `title` 或 `aria-label`。

### Don'ts
- 严禁出现未经截断的大段溢出文本破坏网格对齐。
- 严禁混合使用未定义字号、随意硬编码 HEX 颜色值。
- 严禁在页面各处使用不同圆角风格或突兀的高饱和度渐变色。
