# MuseClaw 初期成果 · 真实用户使用体验审查报告

> 审查日期：2026-11-22
> 审查性质：仅分析，未修改任何代码
> 审查视角：企业员工从「进入系统 → 核心操作 → 完成目标」的完整使用链路

---

## 一、审查方法与分级标准

三方独立审查后交叉印证、去重合并。覆盖维度：界面易用性、流程顺畅度、功能完整性、错误提示、性能体验、兼容性、可访问性。全部结论均附「文件:行号」实锤，主观臆测不列入。

**统一严重度标准（按真实用户后果定义）**：

| 级别 | 定义 | 处理时效 |
| :--- | :--- | :--- |
| **P0 阻断/高危** | 数据泄露或账户风险；核心数据操作结果与提示相反（用户被明确误导）；主流程完全不可用 | 立即 |
| **P1 严重** | 主流程闭环断裂；性能随使用显著劣化；大面积静默失败；安全闸门可被绕过 | 本迭代 |
| **P2 中等** | 体验受损、边界场景、可访问性缺陷、跨入口不一致 | 排期 |
| **P3 轻微** | 打磨、术语统一、代码卫生 | 有余力时 |

---

## 二、关键结论（TL;DR）

- 视觉重构与组件打磨完成度高：7 个视图按需拆包、空态/骨架屏/防误触/两步确认普遍到位，**「有入口没内容」的裸半成品很少**，主链路（选员工→发消息→流式执行→审批→看产物）在常规登录态下可走通。
- **最大风险不在界面，而在「看不见的地方」**：安全鉴权层几乎全开（任何人可读写所有员工的会话/记忆/审批），以及大量「失败被静默吞掉 / 失败却报成功」的假反馈——这两类直接摧毁企业产品最核心的「安全可信」与「数据可靠」承诺。
- **体感上「越用越慢」有实锤**：流式每来一个 token 就重渲整棵对话树并重解析全部 Markdown；会话存储每条消息同步全量重写。
- **功能完整性存在战略落差**：README 宣称的核心卖点「通讯录式多智能体协同派单」（Milestone 5）仍标注未完成，UI 上无任何多员工编排入口，全程只绑定单个 Bot。

**问题统计**：P0 共 9 项，P1 共 12 项，P2 共 13 项，P3 共 10 项。

---

## 三、P0 — 阻断/高危（立即修复）

### P0-1 全站业务 API 鉴权形同虚设 + userId 由前端参数决定，任何匿名者可读写所有员工数据
- **场景**：员工 A（或未登录访客）直接访问 `/api/sessions?bot_id=muse&userId=财务同事账号`，即可读取对方全部对话；`DELETE /api/sessions/<id>?userId=<他人>` 可删除对方会话。未登录用户统一落到共享的 `user_web` 账户，彼此数据串台。
- **受影响用户**：全体企业员工（会话/记忆属敏感个人数据），共享网关的内网环境尤甚。
- **依据**：`apps/gateway/src/server.ts:553-594` 的 `isPublicPath` 几乎覆盖全部业务 API（`/api/sessions`、`/api/feed`、`/api/goals`、`/api/memory`、`/api/skills`、`/api/audit`、`/api/grants` 等）；`:596` 仅对「不在白名单且未登录」返回 401。`:1485/1506/1533` 均用 `currentUser?.username || url.searchParams.get('userId') || ... || 'user_web'` 决定数据归属。前端 `services/api.ts:77-83` 把 userId 放进 URL/body；`context/AppContext.tsx:125` 初始 `user=null` 且 `:313-322` 的 `getMe` 失败被空 catch 吞掉。**已独立核验。**
- **建议**：白名单收缩到仅 `/api/auth/*`、IM Webhook、`/runner/*`、静态资源；身份只从会话 Cookie 解析，删除所有 `searchParams.get('userId')` 回退；对 `data/users/<user>` 路径二次校验归属。

### P0-2 审批接口与全局模型配置接口无需登录，安全闸门可被匿名绕过
- **场景**：内网任意人 `POST /api/approvals/<id> {"approved":true,"scope":"always"}` 即可放行本该飞书/如流人工确认的「批量删除/破坏性命令」审批，并写入永久免审批授权；`POST /api/models/config` 可把全局模型 `baseUrl` 指向攻击者服务器，从此**所有员工的提示词与上下文外泄**。
- **受影响用户**：全体员工；管理员与安全审计风险最高（「确定性哨兵」形同虚设）。
- **依据**：`server.ts:583-586` 把 `/api/approvals`、`/api/audit`、`/api/policy`、`/api/grants` 列入白名单，`/api/models` 经 `:576` 前缀放行；`:1561-1569` 的审批处理无身份校验、无审批人绑定；`:1621-1627` 直接写全局模型配置。
- **建议**：审批接口强制登录 + 审批人须在预期名单内；`scope:always/24h` 仅管理员；审批回调绑定一次性 nonce 防重放；模型配置写操作限管理员；审计日志按角色鉴权。

### P0-3 企业 IM 通道硬编码默认密钥、飞书无签名可放行，可伪造「一键审批」
- **场景**：部署忘配 `.env` 时网关照常启动——如流用公开默认值校验签名，飞书在请求**不带**签名头时直接跳过校验。攻击者向 Webhook POST 伪造的卡片点击 payload 即可冒充管理员批准高危操作。
- **受影响用户**：启用飞书/如流双端审批的员工与安全管理员（账户风险 + 生产数据破坏风险叠加）。
- **依据**：`server.ts:186-187` `process.env.INFOFLOW_TOKEN || 'museclaw_token'`、`INFOFLOW_AES_KEY || '123...43位'`（**已独立核验**）；`channels/feishu/crypto.ts:21-26` 未配 key 即 `return true`，`verificationToken` 全文未使用；`feishu/receiver.ts:39-41` 无签名头则不校验；Webhook 处理位于所有鉴权之前且无限流。
- **建议**：删除硬编码默认值，密钥缺失时 fail-fast 关闭对应通道；飞书无条件校验 Token 与签名；如流加 timestamp 时效窗 + nonce 去重；Webhook 加限流。

### P0-4 会话历史加载失败被吞成空数组，用户以为历史「丢了」
- **场景**：打开历史会话时后端 500 / 断网 / ID 失效，`ChatView` 显示「你好，我是 XXX／随时为您效劳」的欢迎空态，把「加载失败」呈现成「全新空会话」。
- **受影响用户**：所有用历史会话者，网络不稳的移动端/远程办公尤甚。
- **依据**：`services/api.ts:84-91` 的 `getMessages` `catch { return []; }` 吞掉异常；`ChatView.tsx:145-150` 的错误 toast 因上游永远 resolve 而**永不可达**。
- **建议**：`getMessages` 向上抛错或返回 `{messages, error}`；区分「真空会话」与「加载失败」，后者展示带重试的错误态。

### P0-5 创建会话失败却伪造本地会话并提示「已新建会话」
- **场景**：gateway 未就绪 / 无可用 Bot / 接口 403 时点「新建」或发首条消息，用户基于一个服务端不存在的会话继续对话，内容可能无法保存。
- **受影响用户**：全体用户。
- **依据**：`context/AppContext.tsx:247-270` 的 `catch` 中构造 `draftSession`（`sess_${botId}_${Date.now()}`）并 `showToast('已新建会话','success')`；同问题见 `:183-197`。
- **建议**：失败不得伪造 ID；draft 仅供占位且标记 `localOnly`，明确提示真实失败与重试；禁止对失败操作报 success。

### P0-6 删除会话不检查 HTTP 状态，失败仍提示「会话已删除」
- **场景**：登录过期（401）/ 无权限（403）/ 服务故障时删除，列表项仍被移除并报成功；刷新后「已删除」的会话重新出现。
- **受影响用户**：所有管理会话的用户。
- **依据**：`context/AppContext.tsx:272-291` 用裸 `fetch` 且**未检查 `res.ok`** 就 `setSessions` 过滤并报成功；`fetch` 仅在网络层失败时 reject，4xx/5xx 都走成功分支。
- **建议**：改用带 `res.ok` 校验的统一请求；仅在确认成功后更新状态；401 提示重新登录。

### P0-7 高危审批决策不持久化，可重复审批、状态不可信
- **场景**：员工点审批卡片「授权/驳回」后切走会话再切回，或刷新 F5——审批结果丢失，卡片重新变回可点按钮，**可对同一高危动作重复提交决策**，且无法确认自己是否已审批。
- **受影响用户**：全体一线员工 + 安全合规团队（审批是本产品最关键的信任链路）。
- **依据**：`MessageBubble.tsx:39` 审批结果仅是本地 state，`:53-63` 提交后只 `setApprovalStatus`；`:25` 定义了回传口 `onApprovalResolved`、`:58` 也调用了，但 **`ChatView.tsx:535-542` 渲染时从未传该 prop**（全项目 grep 确认该符号仅出现在 MessageBubble 内部——**已独立核验的死代码**）；`types/index.ts:65-69` 的 `approvalRequest` 无 decision/status 字段，服务端消息无法还原审批态。
- **建议**：给 `approvalRequest` 增加 `status/decidedBy/decidedAt` 并由后端返回；MessageBubble 用该字段初始化且已决策卡片只读；补上 ChatView → MessageBubble 的 prop 传递。

### P0-8 登录/注册响应体返回明文 30 天 Token，抵消 HttpOnly 防护
- **场景**：登录页 JS（含被注入的第三方脚本/扩展）可直接读到 `result.token`，XSS 可窃取并在其他设备长期冒充员工（30 天）。
- **受影响用户**：全体登录用户，管理员风险最高。
- **依据**：`server.ts:503-509/527-533` 响应 JSON 含 `token`，同时已用 `createSessionCookie` 设置 HttpOnly Cookie；`auth/auth-service.ts:202-218` token 有效期 30 天；前端 `api.ts:52-56` 类型只声明 `{user}`，**根本不需要该 token**。
- **建议**：从响应 JSON 删除 token；HTTPS 下给 Cookie 加 `Secure` 且不信任 `x-forwarded-proto`。

### P0-9 首屏身份引导缺位，数据归属可能错乱
- **场景**：员工首次打开（或 Cookie 过期后）直接进入聊天，全程无提示「当前以谁的身份、在哪个专属沙箱里工作」；直到下载工件/加节点才被要求登录，此前产生的会话/记忆归属已混入 `user_web`。这与 README 宣称的「员工专属常驻沙箱」核心代际差异直接冲突。
- **受影响用户**：新入职员工、会话过期用户、关心个人隔离沙点卖点的用户。
- **依据**：`AppContext.tsx:125` 初始 `user=null`、`:313-322` `getMe` 失败空 catch；全项目 `setIsAuthModalOpen(true)` 仅 3 处（`TopBar.tsx:165`、`ArtifactsView.tsx:174/204`），**无首次进入自动引导**；`AppContext.tsx:181/258` 未登录时回退 `'user_web'`。
- **建议**：`getMe` 返回 null 时主动拉起 AuthModal 或常驻引导条；明确区分「访客浏览」与「登录使用」及数据归属；未登录态身份胶囊改为高对比度主按钮。

---

## 四、P1 — 严重（本迭代修复）

### P1-1 全局初始数据加载全线静默：Bot 列表、模型配置、当前用户
- **场景**：首次打开时 gateway 未启动（README 明确「没构建返回 503」）/ 断网，侧栏无数字员工、胶囊状态不实，用户不知是没配置、没登录还是服务挂了。
- **依据**：`AppContext.tsx:313-323` 空 catch；`loadBots`(238-240)、`loadModelsConfig`(174-176)、`loadSessions`(198-200) 的 catch 仅 `console.error`。
- **建议**：全局启动加载统一进错误态（顶部横幅 + 重试），区分「无数据」与「加载失败」。

### P1-2 所有 API 请求无超时、无全局离线/登录过期处理
- **场景**：网络假死、Wi-Fi 门户拦截、Cookie 过期后继续操作——按钮停在「保存中/撰写中」无限转圈；登录过期后每个接口各自抛 401，用户被零散错误轰炸却无人告知「需重新登录」。
- **依据**：`api.ts:25-47` 的 `request()` 直接 `await fetch`，无 `AbortSignal.timeout`、无 401 分支；全前端 `navigator.onLine`/`401` 检索几乎为空。
- **建议**：统一请求层加 15s 超时；拦截 401 自动拉起 AuthModal 并保留当前操作；监听 online/offline 给全局提示。

### P1-3 流式逐 token 重渲染 + 每 token 重解析全部 Markdown —— 「越用越慢」
- **场景**：2000+ token 回答，每来一个 delta 就重渲当前会话最多 35 条气泡，每条助手气泡重新跑正则清洗 + `marked.parse()` + 代码高亮；表现为输出越来越卡、风扇狂转、长对话后切会话明显延迟。
- **依据**：`ChatView.tsx:282-306` 每 delta `setStreamingContent`；`:162-178` effect 依赖流式内容触发整组件重渲；`:535-558` map 渲染最多 35 个气泡；`MessageBubble.tsx:30` 无 `React.memo`、`:208-218` 同步执行 `renderMarkdown` 无缓存；`utils/markdown.ts:128-143/165-173` 每次 `marked.parse` + `hljs.highlightAuto`。正面对照 `FeedView.tsx:40-47/275-283` 用了 memo + useMemo。
- **建议**：rAF 或 30-50ms 节流合并 delta；MessageBubble 包 `React.memo`；历史消息 `renderMarkdown` 按 content 用 useMemo 缓存；流式气泡单独轻量渲染；长会话引入虚拟滚动。

### P1-4 会话存储每条消息同步全量重写 + 空会话重启即丢
- **场景**：同一会话用几个月，`sessions.json` 涨到数 MB，每发一条消息就整文件同步重写并阻塞 Node 事件循环，多人共用时全网关（含他人流式输出）一起卡；用户刚建的空会话/草稿刷新或重启后消失。
- **依据**：`bots/session-store.ts:83-93` `saveUser` 过滤 `messages.length>0` 后 `writeFileSync`+`renameSync` 全量重写；`:59` 加载同样丢弃空会话；前端 `api.ts:78` 请求 `include_empty=true` 却被落盘层丢弃。
- **建议**：持久化空会话；改为按会话分文件 + 追加式日志 + 异步/批量写入；给消息设上限与归档。

### P1-5 添加计算节点轮询吞掉所有错误，永远显示「正在等待连接」
- **场景**：接口 500/401/断网，或用户根本没执行命令，UI 永远 spinner +「正在等待个人电脑计算节点连接…」，失败与「尚未上线」完全等价。
- **依据**：`AddMachineModal.tsx:21-38` `setInterval` 中 `catch {}` 静默，`res.ok===false` 连 catch 都不进。
- **建议**：连续 N 次失败切「检测服务异常，请检查网络或刷新」并提供重试；401 引导登录。

### P1-6 Toast 错误 3.8 秒即消失、无 aria-live、无键盘关闭、文本不可复制
- **场景**：较长错误来不及读完就消失；屏幕阅读器用户听不到播报；键盘用户无法关闭；错误文本无法选中复制求助。
- **依据**：`AppContext.tsx:129-135` 对所有类型统一 3800ms；`Toast.tsx:14-35` 仅一个 `div onClick`，无 `role/aria-live/tabIndex`/关闭按钮，图标未 `aria-hidden`。
- **建议**：error/warning 常驻或至少 8s 并带关闭按钮；容器 `role="log" aria-live="polite"`，错误项 `role="alert"`；提供可聚焦关闭按钮。

### P1-7 浏览器存储被禁用/隐私模式下整个工作台白屏
- **场景**：Safari 无痕、企业管控浏览器禁用本地存储、内嵌 WebView 中打开，`localStorage.getItem` 抛 SecurityError，React 初始化失败，白屏无提示。
- **依据**：`AppContext.tsx:94-96` 在 useState 初始化器里直接访问 localStorage 无 try/catch；`:100/206/232`、`GoalsView.tsx:360-361/402-403` 同样无保护。对照 `index.html:9-21` 的主题脚本**有** try/catch，React 侧遗漏。
- **建议**：封装 `safeStorage`（get/set 全 try/catch，失败降级内存 Map）统一替换。

### P1-8 局域网 HTTP 环境「复制」假成功
- **场景**：通过 `http://192.168.x.x:8799` 访问（企业内网典型部署），点消息/工具结果的复制，`navigator.clipboard` 为 undefined 抛错，但界面已先弹「已复制到剪贴板」，粘贴时发现什么都没复制。
- **依据**：`MessageBubble.tsx:44-51`、`ToolTrace.tsx:137-142` 直接 `navigator.clipboard.writeText` 无 await/catch 就无条件 `setCopied(true)`。项目**已有**正确降级 `utils/clipboard.ts:4-39`，且 `MemoryView.tsx:256-267`、`RoutinesView.tsx:341-350` 已使用，唯独聊天区漏掉。
- **建议**：两处统一改用 `copyToClipboard()` 并按返回 boolean 决定 toast。

### P1-9 「审计」三套互相冲突的入口，同一 URL 呈现两种 UI
- **场景**：点左侧「审计」进全页视图；回对话点顶栏「审计模式」弹右侧抽屉；此时 F5 或直接访问 `/audit` 又变成「对话+审计抽屉」，全页视图消失；前进/后退还会 tab 与抽屉错位。管理者无法建立稳定预期。
- **依据**：入口一 `NavRail.tsx:51/76` → `App.tsx:82-90/109` 全页；入口二 `TopBar.tsx:189-203` → `ChatView.tsx:585-589` 抽屉；入口三 `AppContext.tsx:70-91` 对 audit 特判强制改写为 chat+抽屉，且 `:78` 合法 tab 数组故意去掉 audit。同一 `/audit` 两种渲染。
- **建议**：二选一统一——建议保留 NavRail 全页 Tab（管理者主视图），抽屉改为「本会话审计」伴随面板；删除 popstate 对 audit 的强制改写。

### P1-10 【安全相关】匿名可调用 `/api/tasks` 消耗企业模型额度
- **场景**：任何能访问网关者循环 POST `/api/tasks` 即可驱动收费大模型与沙箱工具，产生账单与日志污染，连 Cookie 都不需要。
- **依据**：`server.ts:563` 将 `/api/tasks` 列入白名单；`:2305-2316` userId 可取 body 任意值；`:2394-2396` 调全局模型。
- **建议**：并入 P0-1 统一鉴权整改；加每用户限流与并发上限，超限 429。

### P1-11 【功能完整性战略落差】多智能体协同派单（核心卖点）UI 未实现
- **场景**：员工被「每个员工的专属 AI 虚拟团队」「通讯录式多智能体协同」吸引而来，实际 SideDrawer 只是「单员工列表 + 切换」，**没有任何「一个任务分派给多个数字员工协同」的编排入口**，ChatView 全程只绑定单个 `activeBot`（`ChatView.tsx:237-238` 只发单个 `bot_id`）。
- **依据**：`README.md:11-12` 核心定位；`README.md:133-135` Milestone 5「通讯录式多角色调度」仍为 `[ ]` 未勾选；`docs/PRODUCT.md` 相关描述。
- **建议**：作为产品级 P1 单列待办——明确这是「初期单 Bot 可用的 MVP」与「宣传的虚拟团队」之间的落差，或在对外文案中如实降级表述，避免预期错位。

### P1-12 审批挂起无超时提示；点「停止」后审批卡片残留，再点必然失败
- **场景**：Sentinel 拦截等待人工审批，用户等太久点了「停止」，之后又去点气泡里的「授权执行」——提交一个已被取消的 approvalId，只得到「审批提交失败」。审批期间 `isStreaming` 一直为 true，界面只有「思考中/正在回答」，无「等待审批，请到卡片确认」说明。
- **依据**：`ChatView.tsx:332-347` 追加审批卡片、`:423-425` handleStop 直接 abort；网关 `server.ts:2438-2442` 断连时 `cancelPendingForSession`；`MessageBubble.tsx:53-63` 按钮仍在。
- **建议**：停止/断流时禁用或移除对应审批卡片；卡片显示倒计时与「若已停止请重新发起」；流状态文案区分「等待人工审批」。

---

## 五、P2 — 中等（排期修复）

| 编号 | 问题 | 场景 / 受影响用户 | 判断依据 | 建议 |
| :--- | :--- | :--- | :--- | :--- |
| P2-1 | 多视图加载失败展示误导性空态、无重试 | 断网/接口异常打开工件、审计、技能、动态页；用户误以为「没有记录/没有授权」 | `ArtifactsView.tsx:26-36/119-126`、`AuditView.tsx:15-31/85-86/131-136`、`SkillsView.tsx:132-134/543`、`FeedView.tsx:194-202` catch 仅 console.error；正确范式见 `GoalsView.tsx:108-127/540-545` | 把 GoalsView 的「错误态+重试」抽成通用组件统一接入 |
| P2-2 | 重复提交/并发点击缺统一保护 | 连点 starter 卡片、审批按钮、撤销授权造成重复对话/审批/不可逆配置变更 | starter `ChatView.tsx:470-523` 绕过 `ChatComposer.tsx:77-89` 的 `isStreaming` 保护且无 disabled；`AuditView.tsx:37-45/98-106` 撤销无二次确认；`TopBar.tsx:176-186` 门禁单击即循环 | busy 状态提到公共并统一禁用；不可逆操作加二次确认 |
| P2-3 | a11y：表单 label 未关联、可点击元素无键盘路径 | 屏幕阅读器填写模型配置、键盘选会话/模型、键盘打开图片 | `ModelSettingsModal.tsx:225-233/246-260/333-343/357-380` label 无 htmlFor；`:263-270/345-353` `<span onClick>` 无 role/tabIndex；`SideDrawer.tsx:199-209` option 无 onKeyDown；`MessageBubble.tsx:176-184` img onClick 无键盘路径 | 补 htmlFor/id 或 aria-label；自定义可点击元素改原生 button 或补 role/tabIndex/onKeyDown |
| P2-4 | Feed「一键跟进讨论」丢失 prompt，跨页断点 | 从态势流点「跟进」期望带上下文进对话，结果输入框空的 | `FeedView.tsx:254-263` 只 selectSession+setTab；对照 `GoalsView.tsx:358-364` 正确写 `sessionStorage` + 派发 `museclaw:chat_draft`，`ChatComposer.tsx:37-53` 监听 | Feed 复用同一草稿机制预填 prompt |
| P2-5 | 顶栏模型胶囊虚假「DeepSeek ● 在线」就绪 | 全新部署未配模型，看绿点以为就绪，发消息却报「Agent 未返回任何输出」 | `TopBar.tsx:53-55` 空配置兜底 `{id:'deepseek',name:'DeepSeek'}`、`:157-158` 无条件渲染绿点；对照 `NavRail.tsx:55/103` 用 `hasConfiguredModel` 才显绿点——同状态两处标准相反 | TopBar 复用 `hasConfiguredModel`，未配置显示灰点并点击直达配置 |
| P2-6 | 门禁模式按钮带下拉箭头却单击即循环切到 FULL，无确认 | 员工以为点开下拉菜单「选择」，实际每点一下静默推进一档，连点即切「全权托管」 | `TopBar.tsx:176-186` 带 ChevronDown 却 `onClick={cycleApprovalMode}`；`AppContext.tsx:293-310` 立即 `(idx+1)%3` 生效，仅 toast；对照 `AgentProfileDrawer.tsx:566-589` 用三选项 radio；`DESIGN.md:141` 要求不可逆操作二次确认 | 改真下拉或复用 radio；切 FULL 加二次确认；统一两处文案 |
| P2-7 | 未登录生成 `user_default` 假 token，节点归属错乱 | 未登录接入个人算力，复制的 install 命令含 `token=user_default`，登录后节点「消失」 | `AddMachineModal.tsx:12` `user?.username || 'user_default'`、`:14-38` 生成与轮询；`server.ts:1735-1743` 信任 URL token；结合 P0-9 | 打开前强制校验登录；生成一次性高熵注册 token 而非用户名 |
| P2-8 | 产品宣称 Feed 支持审批流，UI 无任何审批动作 | 管理者在态势流看到「门禁审批」条目期望就地审批，实际只能跳进会话找气泡 | `docs/PRODUCT.md:13` 宣称审批流；`FeedView.tsx:32-38` approval 仅图标+标签、`:265-273` 只跳转；全项目 `sendDecision` 唯一调用点 `MessageBubble.tsx:56` | Feed 审批卡片内联通过/驳回并展示状态 |
| P2-9 | 审批卡片「查看审计详情 →」只开抽屉、不定位记录 | 面对高危审批点该链接，弹出抽屉停在全量流水第一条，需在长列表里自己翻找 | `MessageBubble.tsx:135-142` 仅 `setIsAuditDrawerOpen(true)`；`AuditDrawer.tsx:34/86-88/230-338` 只按 sessionId 过滤、无 approvalId 定位/高亮 | 给 AuditDrawer 加 `focusApprovalId`，打开时定位并高亮对应记录 |
| P2-10 | 大列表无虚拟滚动或分页 | Feed 100 动态+60 活动、记忆上百条、会话几十个时，首屏变慢、滚动掉帧 | `FeedView.tsx:330-340/369-372`、`MemoryView.tsx:662-803`、`SkillsView.tsx:700-833`、`ArtifactsView.tsx:128-183`、`SideDrawer.tsx:194` 全量 map；ChatView 有 35 条窗口是正面案例 | Feed 活动流/记忆/会话列表加虚拟滚动或分页 |
| P2-11 | 首屏同步加载 Markdown + 15 种语言高亮包 | 弱网/移动端首次打开白屏偏长 | `App.tsx:11-32` 视图已 lazy，但 `:7` 静态 import ChatView、`:34-37` Modal 全静态；`utils/markdown.ts:1-15/45-47` 顶层 import 并注册 15 语言；`vite.config.ts:4-19` 无 manualChunks | 高亮改按语言动态 import；Modal 也 lazy；配 manualChunks |
| P2-12 | 每轮对话全量重拉会话 + 多标签不同步 + 乐观更新不回滚 | 每发一条侧栏抖动；A 标签切主题/B 不变；切门禁/技能失败只弹 toast 界面仍显示「已生效」 | `ChatView.tsx:418-419` finally 无条件 loadSessions；`AppContext.tsx:94-105/203-210/232-236` 无 storage 事件；`:293-310`、`SkillsView.tsx:201-209` 乐观更新 catch 不回滚 | 仅在变更时增量更新；加 storage 监听；乐观更新保存 prev 并在 catch 回滚 |
| P2-13 | SSE 解析仅认 `\n\n` 与 `data: `，异常分帧静默丢弃并误报模型故障 | 经 Nginx 反向代理用 `\r\n` 换行时，解析失败只 console.warn，最终报「Agent 未返回任何输出，请检查大模型/节点」——把解析 bug 误报成模型故障 | `ChatView.tsx:270-280` split('\n\n')、`:349-351` 仅 console.warn、`:369-376` 误导性提示；网关 `server.ts:2481` 直连确为 `\n\n` 故直连可用、代理场景脆弱 | 按 `/\r?\n\r?\n/` 切分兼容 `data:` 无空格；解析失败超阈值提示「流式数据解析异常」 |

---

## 六、P3 — 轻微（打磨）

| 编号 | 问题 | 判断依据 | 建议 |
| :--- | :--- | :--- | :--- |
| P3-1 | 多处确认态 setTimeout 未清理，卸载后无效 setState | `SideDrawer.tsx:52-54`、`FeedView.tsx:183/237`、`GoalsView.tsx:342`、`RoutinesView.tsx:279`、`MemoryView.tsx:237/324`、`SkillsView.tsx:300/332`、`MessageBubble.tsx:50`、`ToolTrace.tsx:141`、`AppContext.tsx:132-134` | 封装 useTimeout 统一 cleanup |
| P3-2 | 崩溃边界把技术错误原文展示给普通用户 | `App.tsx:65-76` 渲染 `{error.message}`，用户看到 `Cannot read properties of undefined` | 显示友好文案+重试/联系管理员，技术细节折叠或只写日志 |
| P3-3 | loadSessions 无条件把当前会话改成列表第一项 | `AppContext.tsx:183-186`；`ChatView.tsx:418-419` 每轮调用；服务端按 updated_at 倒序故多数无感，但延迟时会「发完消息被跳到别的会话」 | `loadSessions(botId, keepActiveId?)` 保留用户当前选中项 |
| P3-4 | AuditDrawer 关闭按钮提示「(Esc)」但未实现键盘监听 | `AuditDrawer.tsx:141-149` title 明写 (Esc)，全文无 keydown；对照 `Modal.tsx:54-59` 有 | 补 Escape 关闭 useEffect（勿与 Modal 捕获监听冲突） |
| P3-5 | MemoryView「取消编辑」注释承诺防丢稿，实际直接丢弃 | `MemoryView.tsx:203-206` 注释写「有改动时确认」，函数体只 `setEditingItemId(null)`；`:757-761/782` 调用 | 缓存初始值，取消/Esc 时有改动给轻量确认 |
| P3-6 | Webhook 复制命令写死假 secret，外部集成必然 401 | `RoutinesView.tsx:671-676` `webhookSecret || 'secret'` | 无 secret 时禁用复制并提示先配置令牌 |
| P3-7 | 导航与页面术语三套叫法不统一 | `NavRail.tsx:44-53` 短标签 vs `TopBar.tsx:57-66` 全称 vs `docs/PRODUCT.md:12-18` 第三套；`DESIGN.md` 强调低认知负荷 | 制定术语对照表统一为一套词 |
| P3-8 | 会话写入无版本号/并发控制，多标签同时发消息互相覆盖 | `session-store.ts:130-152` 全对象覆盖无 version/ETag；`ChatView.tsx:187-211` 各标签独立增量 | 加 version 字段写盘前比较；冲突 409 让前端合并 |
| P3-9 | 旧版浏览器/WebView 兼容：matchMedia API、新 CSS | `AppContext.tsx:114-121`、`TopBar.tsx:46-50` 用 `addEventListener` 无 `addListener` 回退；`styles.css:5537` color-mix、`:6157` backdrop-filter 无 @supports 兜底（主流现代浏览器无碍） | 加 addListener 回退；@supports 包裹增强样式 |
| P3-10 | 服务端全局吞异常只打不退出，进程可能带病运行 | `server.ts:63-68` 全局吞 `uncaughtException/unhandledRejection`；`App.tsx:51-80` ViewBoundary 无 componentDidCatch 上报 | 未捕获异常计数超阈值优雅重启；错误边界上报后端 |

---

## 七、明确未发现显著问题的维度（如实说明）

1. **大数据量下崩溃**：后端都有明确上限——审计 200 条环形缓冲+默认返回 50（`sentinel/audit.ts:19/74-79`）、Feed 上限 100/活动 60（`feed-store.ts:157/347`）、ChatView 35 条渐进窗口；不会 OOM，只会卡（见 P1-3/P2-10）。
2. **移动端完全不可用**：`styles.css` 有 900/640/600px 多档响应式、抽屉窄屏改覆盖层、`index.html:5` viewport-fit=cover；审计表可横向滚动。移动端可用。
3. **React Hooks 规则 / 条件 return**：全部 tsx 的 `return null` 均在 hooks 调用之后，未发现同类「hooks 数量不一致」残留（参考提交 3f4fbf0）。
4. **原生 confirm 残留**：全前端 `confirm/alert/prompt` 检索为 0，两步内联确认已在各视图落地（参考提交 089a10c）。
5. **模态窗可访问性基础设施**：`Modal.tsx:35-80` 已实现焦点移入/归还、Escape、Tab 焦点陷阱、`role="dialog"`/`aria-modal`、背景滚动锁定（具体表单内 label 缺失见 P2-3）。
6. **Markdown 渲染安全**：`utils/markdown.ts:58-126` 有 href/image 白名单与 html 转义，原始 HTML 不进 `dangerouslySetInnerHTML`。
7. **模型密钥泄露到前端**：`bots/provider-store.ts:422-548` 返回配置时已清空 apiKey（`:539`）并掩码（但 P0-2 允许匿名**写入** key，风险等价）。
8. **Cron 并发防重叠**：`proactive/manager.ts:79/220/251-260/619-620` 默认 `overlap:'skip'` + stale 超时复位；外部 Webhook 有 429 限流（`:444-451`）。

---

## 八、优先修复路线图

**第 0 步（立即，安全红线）**
1. P0-1 收紧鉴权白名单 + 身份只从 Cookie 解析 + 删除 userId 参数回退
2. P0-2 审批/模型/审计接口鉴权与审批人绑定
3. P0-3 删除 IM 硬编码密钥 + 强制签名校验 + Webhook 限流
4. P0-8 移除登录响应中的明文 token

**第 1 步（本迭代，数据可信 + 主流程闭环）**
5. P0-4/5/6 消除三处「假成功/静默失败」，统一错误态与重试
6. P0-7 审批状态持久化 + 补 `onApprovalResolved` 传参
7. P1-1/2 全局加载可见化 + 请求超时/401 统一处理（一处治理，全场收益）
8. P0-9 首屏身份引导

**第 2 步（本迭代，性能与体验）**
9. P1-3 流式节流 + memo + Markdown 缓存（解决「越用越慢」）
10. P1-4 会话分文件/异步落盘 + 空会话持久化
11. P1-7/8 safeStorage + 剪贴板降级
12. P1-9 统一审计入口

**第 3 步（排期）**：P2 全部 + P3 打磨；P1-11 多智能体协同作为产品级专项评估。

---

*本报告为审查分析产物，未对项目代码做任何修改。*
