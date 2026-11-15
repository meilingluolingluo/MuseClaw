# Graph Report - MuseClaw  (2026-11-16)

## Corpus Check
- 66 files · ~35,644 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: .example 1, (none) 1, .css 1)

## Summary
- 605 nodes · 1340 edges · 28 communities (24 shown, 4 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 121 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8ef2bdb9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.ts
- Infoflow 通道与审批桥
- 主动例行任务调度
- 架构设计概念层
- app.js
- Web 控制台前端
- 飞书通道与卡片审批
- verify-memory-consolidation.ts
- verify-multi-bot.ts
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
- protocol/src/index.ts
- runAgentLoop
- SentinelPolicyManager
- verify-hardened-security.ts
- sentinel/src/index.ts
- client.ts
- web/package.json

## God Nodes (most connected - your core abstractions)
1. `SentinelPolicyManager` - 45 edges
2. `ProactiveManager` - 26 edges
3. `startGatewayServer()` - 26 edges
4. `BotRegistry` - 25 edges
5. `BotMemoryManager` - 20 edges
6. `SessionStore` - 18 edges
7. `GoalStore` - 18 edges
8. `runAgentLoop()` - 18 edges
9. `AgentProfile` - 17 edges
10. `FeishuApprovalBridge` - 16 edges

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

## Communities (28 total, 4 thin omitted)

### Community 0 - "server.ts"
Cohesion: 0.12
Nodes (14): baseTools, botMemory, botRegistry, __dirname, getOrCreateSession(), goalEngine, goalStore, mcpManager (+6 more)

### Community 1 - "Infoflow 通道与审批桥"
Cohesion: 0.17
Nodes (8): InfoflowApprovalBridge, InfoflowCrypto, createInfoflowChannel(), InfoflowReceiver, InfoflowReceiverConfig, InfoflowSender, InfoflowSenderConfig, testInfoflowIntegration()

### Community 2 - "主动例行任务调度"
Cohesion: 0.07
Nodes (25): McpClientManager, McpStdioClient, computeNextRun(), matchesCron(), matchField(), __dirname, ProactiveManager, ProactiveManagerOptions (+17 more)

### Community 3 - "架构设计概念层"
Cohesion: 0.07
Nodes (36): 原生操作确认卡片 (confirm-card, 允许/拒绝), renderActionConfirmation(req), 跨端 Sentinel 审批流 (Cross-Channel Sentinel Approval Flow), Chromium Profile 持久化 (Cookie / LocalStorage) 与 /workspace 工作空间持久化, 1.4 数据飞轮与自进化层 (Data & Learning Layer), 单租户持久化沙箱 (Per-User Dedicated Sandbox: Docker / Podman / K8s Pod), 1.2 中控与安全调度层 (Control & Relay Hub), 1.3 执行与沙箱层 (Sandbox Execution Layer) (+28 more)

### Community 4 - "app.js"
Cohesion: 0.12
Nodes (32): appendMessageBubble(), createNewSession(), cycleApprovalMode(), dom, escapeHtml(), handleStreamEvent(), initEventHandlers(), loadArtifacts() (+24 more)

### Community 5 - "Web 控制台前端"
Cohesion: 0.09
Nodes (28): 前端 API 契约 (/api/bots, /api/sessions, /api/tasks, /api/approvals, /api/routines, /api/hooks), appendAssistantMsg(text), appendUserMsg(text), escapeHtml(str), formatTime(ts), handleKeyDown(e), loadBots(), loadRoutinesData() (+20 more)

### Community 6 - "飞书通道与卡片审批"
Cohesion: 0.14
Nodes (11): FeishuApprovalBridge, FeishuCrypto, createFeishuChannel(), FeishuChannelOptions, FeishuReceiver, FeishuReceiverConfig, FeishuSender, FeishuSenderConfig (+3 more)

### Community 7 - "verify-memory-consolidation.ts"
Cohesion: 0.09
Nodes (27): applyConsolidation(), buildTidyPrompt(), CONNECTIVE_CHARS, CONNECTIVE_WORDS, extractJsonProposals(), MemoryChange, MemoryItem, noNewEntities() (+19 more)

### Community 8 - "verify-multi-bot.ts"
Cohesion: 0.13
Nodes (6): BotRegistry, SessionRouter, SessionStore, AgentProfile, Session, SandboxCore

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
Cohesion: 0.09
Nodes (20): allTools, dataBot, defaultRoute, __dirname, initialBots, loop, mentionMuseRoute, mentionQuotedRoute (+12 more)

### Community 19 - "verify-taint-tracking.ts"
Cohesion: 0.08
Nodes (22): checkArtifact, checkBrowserEgress, checkEmailEgress, checkInternalApi, checkLocalEcho, checkReadFile, checkShellCatEnv, checkShellCurl (+14 more)

### Community 20 - "verify-five-features.ts"
Cohesion: 0.27
Nodes (6): __dirname, __dirname, __dirname, testDir, __dirname, testDataDir

### Community 21 - "protocol/src/index.ts"
Cohesion: 0.18
Nodes (10): GatewayRelay, ChannelLadderStep, ExecutionChannel, InboundMessage, MuseEvent, RouteResult, TrajectoryStep, DeepSeekOptions (+2 more)

### Community 22 - "runAgentLoop"
Cohesion: 0.30
Nodes (9): feishuChannel, infoflowChannel, SessionTrajectory, createDeepSeekCaller(), runAgentLoop(), createDefaultTools(), exportToShareGPT(), main() (+1 more)

### Community 23 - "SentinelPolicyManager"
Cohesion: 0.08
Nodes (23): PolicyContext, SentinelPolicyManager, ApprovalRequest, CHANNEL_DETAILS, CHANNEL_RANK, ChannelLadderPolicy, classifyToolChannel(), EscalationEvaluation (+15 more)

### Community 24 - "verify-hardened-security.ts"
Cohesion: 0.17
Nodes (9): checkBrowser, checkMetadata, checkNormal, checkRsa, checkShadow, errorLoop, repeatLoop, sentinel (+1 more)

### Community 26 - "client.ts"
Cohesion: 0.22
Nodes (5): __dirname, McpServerConfig, McpToolSchema, PendingRequest, rl

### Community 27 - "web/package.json"
Cohesion: 0.22
Nodes (8): description, name, private, scripts, build, dev, type, version

## Knowledge Gaps
- **15 isolated node(s):** `resolveAction(approvalId, approved)`, `Chromium Profile 持久化 (Cookie / LocalStorage) 与 /workspace 工作空间持久化`, `Phase 3 packages/skills-registry/src/loader.ts (动态加载任务专属工具脚本)`, `模型调用层 (统一大模型流式调用与 Function Calling 转换)`, `执行沙箱层 (持久化浏览器与 Shell 执行环境)` (+10 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 221 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SentinelPolicyManager` connect `SentinelPolicyManager` to `server.ts`, `Infoflow 通道与审批桥`, `主动例行任务调度`, `飞书通道与卡片审批`, `verify-long-horizon-goals.ts`, `verify-multi-bot.ts`, `verify-taint-tracking.ts`, `verify-five-features.ts`, `runAgentLoop`, `verify-hardened-security.ts`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `startGatewayServer()` (e.g. with `.consolidateMemory()` and `.getConsolidationHistory()`) actually correct?**
  _`startGatewayServer()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **What connects `resolveAction(approvalId, approved)`, `Chromium Profile 持久化 (Cookie / LocalStorage) 与 /workspace 工作空间持久化`, `Phase 3 packages/skills-registry/src/loader.ts (动态加载任务专属工具脚本)` to the rest of the system?**
  _15 weakly-connected nodes found - possible missing edges._
- **Should `server.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12280701754385964 - nodes in this community are weakly interconnected._
- **Why does `ProactiveManager` connect `主动例行任务调度` to `server.ts`, `verify-five-features.ts`, `protocol/src/index.ts`, `SentinelPolicyManager`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Should `主动例行任务调度` be split into smaller, more focused modules?**
  _Cohesion score 0.06696428571428571 - nodes in this community are weakly interconnected._
- **Why does `@larksuiteoapi/node-sdk` connect `gateway 包配置` to `飞书通道与卡片审批`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._