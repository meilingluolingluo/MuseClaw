# Graph Report - MuseClaw  (2026-11-16)

## Corpus Check
- 73 files · ~43,222 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .css 2, .example 1, (none) 1)

## Summary
- 687 nodes · 1531 edges · 35 communities (31 shown, 4 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 143 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `615c888c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.ts
- Infoflow 通道与审批桥
- 主动例行任务调度
- Sentinel 确定性安全哨兵引擎
- app.js
- sendTask
- 飞书通道与卡片审批
- verify-memory-consolidation.ts
- SentinelPolicyManager
- verify-long-horizon-goals.ts
- 根包配置
- gateway 包配置
- sentinel 包配置
- sandbox-core 包配置
- protocol 包配置
- verify-multi-bot.ts
- pnpm 工作区配置
- 审批动作解析
- verify-taint-tracking.ts
- verify-five-features.ts
- manager.ts
- runAgentLoop
- SentinelPolicyManager
- verify-hardened-security.ts
- data/web/app.js
- client.ts
- web/package.json
- guard.ts
- 数据飞轮 (任务执行轨迹收集与微调沉淀)
- Web 工作台 (Roster Mode) 通讯录交互范式
- 薄核落地四步走 (ReAct -> Sentinel -> Sandbox -> Gateway)
- 前端 API 契约 (/api/bots, /api/sessions, /api/tasks, /api/approvals, /api/routines, /api/hooks)
- 单租户持久化沙箱 (Per-User Dedicated Sandbox: Docker / Podman / K8s Pod)
- ref_node_readline

## God Nodes (most connected - your core abstractions)
1. `SentinelPolicyManager` - 54 edges
2. `startGatewayServer()` - 30 edges
3. `ProactiveManager` - 26 edges
4. `BotRegistry` - 25 edges
5. `BotMemoryManager` - 20 edges
6. `SessionStore` - 18 edges
7. `GoalStore` - 18 edges
8. `runAgentLoop()` - 18 edges
9. `AgentProfile` - 17 edges
10. `createDefaultTools()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `原生操作确认卡片 (confirm-card, 允许/拒绝)` --semantically_similar_to--> `挂起凭证 ApprovalId`  [INFERRED] [semantically similar]
  apps/gateway/src/ui.html → docs/IMPLEMENTATION_PLAN.md
- `前端 API 契约 (/api/bots, /api/sessions, /api/tasks, /api/approvals, /api/routines, /api/hooks)` --conceptually_related_to--> `Phase 2 apps/gateway/src/server.ts (Web/WebSocket + IM Webhook 接收器)`  [INFERRED]
  apps/gateway/src/ui.html → docs/IMPLEMENTATION_PLAN.md
- `通讯录侧边栏 (Bot Roster 列表 + 历史会话列表)` --semantically_similar_to--> `Web 工作台 (Roster Mode) 通讯录交互范式`  [INFERRED] [semantically similar]
  apps/gateway/src/ui.html → docs/ARCHITECTURE.md
- `通讯录侧边栏 (Bot Roster 列表 + 历史会话列表)` --semantically_similar_to--> `虚拟团队通讯录 (Roster) + 双端协同 (Web + 企业 IM)`  [INFERRED] [semantically similar]
  apps/gateway/src/ui.html → README.md
- `SSE 流式事件协议 (session:init / stream:text-delta / tool:call_start / tool:call_end / sentinel:approval_needed)` --semantically_similar_to--> `流式事件包 (plan_step / tool_call / artifact_ready / require_approval)`  [INFERRED] [semantically similar]
  apps/gateway/src/ui.html → docs/ARCHITECTURE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **跨端 Sentinel 审批流参与方 (Cross-Channel Approval Flow)** — docs_architecture_roster_mode, docs_architecture_im_gateway, docs_architecture_relay_hub, docs_architecture_sentinel, docs_architecture_dedicated_sandbox [EXTRACTED 1.00]
- **MuseClaw 四层分层解耦分布式架构 (Access / Relay Hub / Sandbox / Data & Learning)** — readme_access_layer, readme_relay_hub, readme_sandbox_layer, readme_data_learning_layer [EXTRACTED 1.00]
- **薄核四阶段交付物 (Phase 1-4 代码文件)** — docs_implementation_plan_loop_ts, docs_implementation_plan_guard_ts, docs_implementation_plan_server_ts, docs_implementation_plan_loader_ts, docs_implementation_plan_trajectory_ts [EXTRACTED 1.00]

## Communities (35 total, 4 thin omitted)

### Community 0 - "server.ts"
Cohesion: 0.12
Nodes (15): baseTools, botMemory, botRegistry, callLLM, __dirname, getOrCreateSession(), goalEngine, goalStore (+7 more)

### Community 1 - "Infoflow 通道与审批桥"
Cohesion: 0.16
Nodes (8): InfoflowApprovalBridge, InfoflowCrypto, createInfoflowChannel(), InfoflowReceiver, InfoflowReceiverConfig, InfoflowSender, InfoflowSenderConfig, testInfoflowIntegration()

### Community 2 - "主动例行任务调度"
Cohesion: 0.07
Nodes (21): McpClientManager, McpStdioClient, computeNextRun(), matchesCron(), matchField(), ProactiveManager, Routine, RoutineRun (+13 more)

### Community 3 - "Sentinel 确定性安全哨兵引擎"
Cohesion: 0.26
Nodes (12): 原生操作确认卡片 (confirm-card, 允许/拒绝), renderActionConfirmation(req), 跨端 Sentinel 审批流 (Cross-Channel Sentinel Approval Flow), 1.2 中控与安全调度层 (Control & Relay Hub), Sentinel 确定性安全哨兵引擎, Session & State Relay 会话与状态中继, 挂起与求证状态机 (NORMAL_RUNNING -> TRIGGER_MUTATION -> STATE_SUSPENDED -> DISPATCH_APPROVAL_REQUEST -> USER_CONFIRMED -> RESUME_EXECUTION), 挂起凭证 ApprovalId (+4 more)

### Community 4 - "app.js"
Cohesion: 0.12
Nodes (32): appendMessageBubble(), createNewSession(), cycleApprovalMode(), dom, escapeHtml(), handleStreamEvent(), initEventHandlers(), loadArtifacts() (+24 more)

### Community 5 - "sendTask"
Cohesion: 0.21
Nodes (13): appendAssistantMsg(text), appendUserMsg(text), escapeHtml(str), formatTime(ts), handleKeyDown(e), loadSessions(), renderToolAccordion(name, input), sendTask() (+5 more)

### Community 6 - "飞书通道与卡片审批"
Cohesion: 0.10
Nodes (15): FeishuApprovalBridge, FeishuCrypto, createFeishuChannel(), FeishuChannelOptions, FeishuReceiver, FeishuReceiverConfig, FeishuSender, FeishuSenderConfig (+7 more)

### Community 7 - "verify-memory-consolidation.ts"
Cohesion: 0.09
Nodes (27): applyConsolidation(), buildTidyPrompt(), CONNECTIVE_CHARS, CONNECTIVE_WORDS, extractJsonProposals(), MemoryChange, MemoryItem, noNewEntities() (+19 more)

### Community 8 - "SentinelPolicyManager"
Cohesion: 0.09
Nodes (5): AuditLog, GrantStore, SentinelPolicyManager, CredentialVault, runTests()

### Community 9 - "verify-long-horizon-goals.ts"
Cohesion: 0.09
Nodes (26): cadenceToCron(), computeNextCheckIn(), GoalEngine, GoalEngineOptions, __dirname, GoalStore, Goal, GoalAdvanceResult (+18 more)

### Community 10 - "根包配置"
Cohesion: 0.13
Nodes (15): description, devDependencies, typescript@^5.7.0, license, name, private, scripts, build (+7 more)

### Community 11 - "gateway 包配置"
Cohesion: 0.18
Nodes (12): dependencies, @larksuiteoapi/node-sdk@^1.76.0, @museclaw/protocol@workspace:*, @museclaw/protocol, main, name, scripts, dev (+4 more)

### Community 12 - "sentinel 包配置"
Cohesion: 0.29
Nodes (7): dependencies, @museclaw/protocol@workspace:*, @museclaw/protocol, main, name, type, version

### Community 13 - "sandbox-core 包配置"
Cohesion: 0.29
Nodes (7): dependencies, @museclaw/protocol@workspace:*, @museclaw/protocol, main, name, type, version

### Community 14 - "protocol 包配置"
Cohesion: 0.29
Nodes (6): exports, main, name, type, types, version

### Community 15 - "verify-multi-bot.ts"
Cohesion: 0.08
Nodes (22): SessionStore, Session, allTools, dataBot, defaultRoute, __dirname, initialBots, loop (+14 more)

### Community 19 - "verify-taint-tracking.ts"
Cohesion: 0.07
Nodes (26): BotRegistry, SessionRouter, AgentProfile, SandboxCore, checkArtifact, checkBrowserEgress, checkEmailEgress, checkInternalApi (+18 more)

### Community 20 - "verify-five-features.ts"
Cohesion: 0.22
Nodes (8): __dirname, __dirname, ChannelLadderStep, ExecutionChannel, InboundMessage, RouteResult, __dirname, testDir

### Community 21 - "manager.ts"
Cohesion: 0.23
Nodes (10): __dirname, ProactiveManagerOptions, TrajectoryStep, DeepSeekOptions, LLMCaller, LLMMessage, ToolDefinition, defaultVault (+2 more)

### Community 22 - "runAgentLoop"
Cohesion: 0.25
Nodes (11): feishuChannel, infoflowChannel, refreshTools(), MuseEvent, SessionTrajectory, createDeepSeekCaller(), runAgentLoop(), createDefaultTools() (+3 more)

### Community 23 - "SentinelPolicyManager"
Cohesion: 0.10
Nodes (19): CHANNEL_DETAILS, CHANNEL_RANK, ChannelLadderPolicy, classifyToolChannel(), EscalationEvaluation, ExecutionChannel, LadderStepRecord, selectOptimalChannel() (+11 more)

### Community 24 - "verify-hardened-security.ts"
Cohesion: 0.17
Nodes (9): checkBrowser, checkMetadata, checkNormal, checkRsa, checkShadow, errorLoop, repeatLoop, sentinel (+1 more)

### Community 25 - "data/web/app.js"
Cohesion: 0.12
Nodes (32): appendMessageBubble(), createNewSession(), cycleApprovalMode(), dom, escapeHtml(), handleStreamEvent(), initEventHandlers(), loadArtifacts() (+24 more)

### Community 26 - "client.ts"
Cohesion: 0.33
Nodes (4): __dirname, McpServerConfig, McpToolSchema, PendingRequest

### Community 27 - "web/package.json"
Cohesion: 0.22
Nodes (8): description, name, private, scripts, build, dev, type, version

### Community 28 - "guard.ts"
Cohesion: 0.19
Nodes (11): AuditEvent, defaultAuditLog, __dirname, __dirname, Grant, GrantScope, __dirname, PolicyContext (+3 more)

### Community 29 - "数据飞轮 (任务执行轨迹收集与微调沉淀)"
Cohesion: 0.27
Nodes (11): 1.4 数据飞轮与自进化层 (Data & Learning Layer), Skill Miner 技能自提炼 (Reflection), Skill Registry 技能注册中心 (Global System Skills / User Private Skills), Trajectory Exporter 轨迹提取器, 数据飞轮 (任务执行轨迹收集与微调沉淀), Phase 4 packages/sandbox-core/src/trajectory.ts (微调数据集生成), 4. 数据飞轮与自进化层 (Data & Learning), Skill Miner 技能自提炼引擎 (成功链路反思 -> 参数化脚本) (+3 more)

### Community 30 - "Web 工作台 (Roster Mode) 通讯录交互范式"
Cohesion: 0.28
Nodes (9): 通讯录侧边栏 (Bot Roster 列表 + 历史会话列表), SSE 流式事件协议 (session:init / stream:text-delta / tool:call_start / tool:call_end / sentinel:approval_needed), 1.1 统一接入与展现层 (Access & Experience Layer), 企业 IM 网关 (Feishu / WeCom / DingTalk / Slack), Web 工作台 (Roster Mode) 通讯录交互范式, 流式事件包 (plan_step / tool_call / artifact_ready / require_approval), 前端交互范式 (通讯录 Roster + 流式卡片), 1. 统一接入层 (Access Layer) (+1 more)

### Community 31 - "薄核落地四步走 (ReAct -> Sentinel -> Sandbox -> Gateway)"
Cohesion: 0.25
Nodes (7): 薄核落地四步走 (ReAct -> Sentinel -> Sandbox -> Gateway), Phase 1 apps/sentinel/src/guard.ts (确定性规则匹配器), Phase 3 packages/skills-registry/src/loader.ts (动态加载任务专属工具脚本), Phase 1 packages/sandbox-core/src/loop.ts (极简 Agent Loop 状态机), 模型调用层 (统一大模型流式调用与 Function Calling 转换), Phase 2 apps/gateway/src/server.ts (Web/WebSocket + IM Webhook 接收器), MuseClaw 企业常驻型多智能体数字员工工作站 (Enterprise Always-On Multi-Agent Workstation)

### Community 32 - "前端 API 契约 (/api/bots, /api/sessions, /api/tasks, /api/approvals, /api/routines, /api/hooks)"
Cohesion: 0.29
Nodes (6): 前端 API 契约 (/api/bots, /api/sessions, /api/tasks, /api/approvals, /api/routines, /api/hooks), loadBots(), loadRoutinesData(), toggleRoutineStatus(id), triggerRoutineNow(id), 主动例行任务 (Cron 调度) 与外部 Webhook 事件唤醒

### Community 33 - "单租户持久化沙箱 (Per-User Dedicated Sandbox: Docker / Podman / K8s Pod)"
Cohesion: 0.33
Nodes (6): Chromium Profile 持久化 (Cookie / LocalStorage) 与 /workspace 工作空间持久化, 单租户持久化沙箱 (Per-User Dedicated Sandbox: Docker / Podman / K8s Pod), 1.3 执行与沙箱层 (Sandbox Execution Layer), 执行沙箱层 (持久化浏览器与 Shell 执行环境), 员工专属常驻沙箱 (Always-on, 持久化登录态与工作区), 3. 执行与沙箱层 (Per-User Isolated Sandboxes)

## Knowledge Gaps
- **15 isolated node(s):** `resolveAction(approvalId, approved)`, `Chromium Profile 持久化 (Cookie / LocalStorage) 与 /workspace 工作空间持久化`, `Phase 3 packages/skills-registry/src/loader.ts (动态加载任务专属工具脚本)`, `模型调用层 (统一大模型流式调用与 Function Calling 转换)`, `执行沙箱层 (持久化浏览器与 Shell 执行环境)` (+10 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 236 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SentinelPolicyManager` connect `SentinelPolicyManager` to `server.ts`, `Infoflow 通道与审批桥`, `主动例行任务调度`, `飞书通道与卡片审批`, `verify-long-horizon-goals.ts`, `verify-multi-bot.ts`, `verify-taint-tracking.ts`, `verify-five-features.ts`, `manager.ts`, `runAgentLoop`, `SentinelPolicyManager`, `verify-hardened-security.ts`, `guard.ts`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Are the 25 inferred relationships involving `startGatewayServer()` (e.g. with `.consolidateMemory()` and `.getConsolidationHistory()`) actually correct?**
  _`startGatewayServer()` has 25 INFERRED edges - model-reasoned connections that need verification._
- **What connects `resolveAction(approvalId, approved)`, `Chromium Profile 持久化 (Cookie / LocalStorage) 与 /workspace 工作空间持久化`, `Phase 3 packages/skills-registry/src/loader.ts (动态加载任务专属工具脚本)` to the rest of the system?**
  _15 weakly-connected nodes found - possible missing edges._
- **Should `server.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11578947368421053 - nodes in this community are weakly interconnected._
- **Why does `ProactiveManager` connect `主动例行任务调度` to `SentinelPolicyManager`, `server.ts`, `verify-five-features.ts`, `manager.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `主动例行任务调度` be split into smaller, more focused modules?**
  _Cohesion score 0.06662770309760374 - nodes in this community are weakly interconnected._
- **Why does `@larksuiteoapi/node-sdk` connect `gateway 包配置` to `飞书通道与卡片审批`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._