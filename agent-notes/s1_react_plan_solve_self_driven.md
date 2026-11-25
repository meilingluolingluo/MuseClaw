# 阶段一研读笔记：ReAct、Plan-and-Solve 与自驱决策机制

> 目标：深入掌握 Agent 核心原理与自主规划架构
> 步骤：s_1 研读 ReAct、Plan-and-Solve 与自驱决策机制
> 定位：为 s_2（复刻执行循环+工具层）、s_3（受控长期记忆+反思）、s_4（测试用例与架构笔记）提供可直接落地的理论骨架

---

## 0. 一页速览（TL;DR）

| 论文 | 一句话机制 | 解决的病 | 留下的大坑 |
|---|---|---|---|
| **CoT**（基线） | 一次前向里写推理链 | 多步推理 | 不与外界交互，幻觉无法被校正 |
| **ReAct** (2210.03629) | Thought → Action → Observation 交替闭环 | 幻觉/错误传播；长程决策无工作记忆 | 无全局计划；易在观测噪声中打转；终止无保证 |
| **Plan-and-Solve / PS+** (2305.04091) | 零样本两段式：先"devise a plan"再"carry out the plan" | Zero-shot-CoT 的**漏步**与**计算**错误 | 纯离线一次性规划，无环境反馈；对语义误解错误无效 |
| **Plan-and-Act** (2503.09572) | Planner(结构化高层计划) + Executor(落地动作) 分层 | 长程任务中"边规划边执行"的相互干扰 | 需要合成数据训练 Planner；重规划策略仍是工程量 |
| **Reflexion** (2303.11366) | Evaluator 打分 → 语言化反思 → 写入情节记忆 → 重试 | 无梯度条件下跨尝试学习 | 依赖二元奖励与强模型自诊断；虚假归因、reward hacking |

**核心结论**：这四篇不是四个并列技巧,而是**同一个决策环的四层抽象**——ReAct 定"单步粒度"，PS 定"计划-执行"的二次结构，Plan-and-Act 定"计划者与执行者的职责切分"，Reflexion 定"跨 episode 的元循环"。**自驱（autonomous）的本质不在推理能力，而在控制点（control points）的设计**：何时规划、何时重规划、何时反思、何时终止、何时升级给人。

---

## 1. 统一形式化：把 Agent 还原成 POMDP

```
状态   s_t = (目标 g, 工作记忆 m_t, 轨迹 τ_{0:t-1})
观测   o_t = 环境对上一动作的返回（工具输出 / API 响应 / 页面 diff）
策略   π(a_t | s_t)  ← 参数冻结的 LLM + 提示 + 记忆
动作   a_t ∈ { tool_call, answer, think, plan, reflect, stop, escalate }
转移   s_{t+1} = f(s_t, a_t, o_t)      (f 由 Agent 框架自身实现)
```

三条关键洞察：

1. **Thought 是"零副作用动作"**。它不改变环境（`o_t` 不变），只改变 `m_t`。ReAct 论文原话即：thoughts "do not affect the external environment… affect the internal state of the model"。所以 thought 的成本是 **token**，收益是**在真正付代价的动作之前做一次免费的内部仿真**。这解释了为什么 thought 在交互式任务（ALFWorld）中收益最大、在纯 QA 中收益有限。

2. **动作抽象层级决定架构**。token 级（CoT）→ 步骤级（ReAct）→ 计划级（PS / Plan-and-Act）。抽象越高，单步上下文负担越轻、越可审计；但一旦计划错，误差会沿层级向下放大，所以**高层必须配重规划**。

3. **"自驱"= 策略自己产出 `plan / reflect / stop` 这三类元动作**。绝大多数 Agent 翻车不是因为不会做题，而是元动作缺失：没有 `stop` 就死循环，没有 `reflect` 就重复同样的错误，没有 `replan` 就抱着错误计划硬跑。

---

## 2. ReAct：单步闭环的规范形式

### 2.1 机制

冻结 LLM + few-shot 轨迹示例，让模型自回归地交替输出：

```
Thought:  我现在需要先确认 X 的出生年，应该搜索作者名
Action:   search[Arthur's Magazine]
Observation: ...（由环境注入，模型不生成）
Thought:  结果提到 1844 年首刊，还需确认主编
Action:   lookup[editor]
Observation: ...
Thought:  信息足够，可以作答
Action:   finish[1844]
```

论文中的两种 prompt 风格（这点常被忽略，直接影响复刻）：

- **密集交替**（推理为主的任务，HotpotQA/FEVER）：强制每一步 `Thought→Action`，保证推理链连续；
- **稀疏推理**（动作密集的决策任务，ALFWorld/WebShop）：推理只在轨迹中最相关的少数位置出现，让模型**自己决定** thought 何时异步插入。

### 2.2 关键数据（PaLM-540B，prompting，无微调）

| 基准 | Standard | CoT (reason-only) | Act-only | ReAct | 最佳组合 |
|---|---|---|---|---|---|
| HotpotQA (EM) | 28.7 | 29.4 | 25.7 | 27.4 | **35.1**（ReAct+CoT-SC） |
| FEVER (acc) | 57.1 | 56.3 | 58.9 | **60.9** | **64.6**（ReAct+CoT） |
| ALFWorld (2-shot) | — | — | 45 | **71** | — |
| WebShop (1-shot) | — | — | 30.1 | **40** | — |

三个必须记住的读法：

- **HotpotQA 上 ReAct 单独并不如 CoT（27.4 < 29.4）**。ReAct 的价值是"可 grounding"，不是"单点准确率"；收益要在 `ReAct + CoT` 组合（内外部知识互补）里才兑现 → **这直接对应"记忆/知识检索必须与内部推理并行而非替代"**。
- **交互式任务提升巨大**：ALFWorld 45→71（+26），WebShop 30.1→40（+9），甚至超过用 ~10^5 样本训练的模仿/强化学习基线。说明 thought 在"需要维护计划并处理例外"的场景才值钱。
- **Act-only 在 HotpotQA 反而最差（25.7）**：只有动作没有推理 → 不知道下一步该查什么，检索变成随机游走。

### 2.3 为什么有效 / 失败模式

**有效原因**：① 观测把模型从"内部参数记忆"拽到"外部可验证事实"，抑制幻觉传播（FEVER 上 CoT 幻觉明显更多）；② thought 承担**计划维护、进度跟踪、例外处理**四项功能；③ 轨迹是人类可读的 → 可用人工编辑 thought 来纠偏（论文中的 human-in-the-loop 实验：只改一句话就能让 Agent 转向）。

**失败模式（复刻时必须显式防御）**：

| 失败模式 | 表现 | 防御设计 |
|---|---|---|
| 观测膨胀 | 长网页/长 JSON 一次性塞回上下文 | observation 截断 + 摘要 + 结构化抽取 |
| 动作循环 | 同一 search 重复 3 次以上（Reflexion 正是用 "same action+same response > 3 cycles" 作反思触发） | 动作去重计数 + 强制换策略 |
| 无终止 | 明明已知答案还在继续 tool call | 独立判定器 / `finish` 动作 + 硬 step budget |
| 解析脆弱 | 模型输出不合 `Action:` 格式 | 严格 parser + 失败降级为"格式纠错提示" |
| 推理-行动不一致 | Thought 说查 A，Action 却查 B | 动作执行后回读 thought 做一致性校验 |

---

## 3. Plan-and-Solve：把"计划"提成一等公民

### 3.1 动机：Zero-shot-CoT 的三类错误（论文实测）

- **计算错误 7%**
- **漏步错误（missing-step）12%**
- **语义误解 27%**

PS 只针对**漏步**：把"Let's think step by step"换成显式的两段式指令。

### 3.2 原句模板（可直接复制用于复刻）

**PS**：
```
Q: [X]
A: Let's first understand the problem and devise a plan to solve the problem.
   Then, let's carry out the plan and solve the problem step by step.
```

**PS+**（在 PS 上补三条更细的指令，针对计算与信息遗漏）：
```
Q: [X]
A: Let's first understand the problem, extract relevant variables and their
   corresponding numerals, and devise a plan. Then, let's carry out the plan,
   calculate intermediate results (pay attention to calculation and common sense),
   and solve the problem step by step.
```
（第 2 步再用答案抽取 prompt："Therefore, the answer (arabic numerals) is" —— 两段式抽取，与 Zero-shot-CoT 相同）

### 3.3 结果（GPT-3 text-davinci-003，10 数据集）

| 方法 | 数学平均 | 说明 |
|---|---|---|
| Zero-shot CoT | 70.4 | "step by step" |
| Zero-shot PS | 72.9 | +2.5 |
| **Zero-shot PS+** | **76.7** | +6.3，超过 Zero-shot PoT（73.5），接近 8-shot Manual-CoT（77.6） |

单项亮点：AddSub 85.3→92.2，SingleEq 88.1→94.7，AQuA 38.9→46.0。

### 3.4 关键局限（决定它不能单独用作 Agent 骨架）

1. **一次性离线规划**：计划在 v1 就冻结，不消费任何环境观测 → **不是 Agent，只是 prompt**。
2. **不能纠语义误解**（占错误 27%，恰是最大头）→ 需要外部反馈或反思机制补。
3. **计划粒度不可控**：模型自己决定拆几层，长程任务容易"计划对了、执行漏了"。
4. **指令措辞敏感**：PS 的增益几乎全来自 trigger sentence 的措辞，跨模型迁移性未验证。

> **给我的判断**：PS 的真正遗产不是"提示词技巧"，而是**"计划是显式产物（artifact）"** 这一架构决策——计划一旦变成可观察、可编辑、可重生成的对象，重规划、并行化、人工干预、成本预算才都成为可能。Plan-and-Execute 家族（含 Plan-and-Act）都是这条线的延伸。

---

## 4. Plan-and-Act：计划者 / 执行者的职责切分

- **Planner**：输出**结构化**高层计划，每一步带 state 描述（"当前页面/状态是什么"），不是笼统的 to-do。
- **Executor**：只负责"当前子目标 → 环境动作"，上下文被刻意收窄 → 长程不迷路。
- 训练侧：用合成数据把 ground-truth 轨迹反向标注为"可行计划"，从而训一个真正会规划的 Planner（LLM 原生并不擅长）、以及一个会跟随计划的 Executor。
- 结果：WebArena-Lite **54%（arXiv v2 摘要）/ 57.58%（ICML'25 与官方 README）**，WebVoyager 文本 SOTA **81.36%**。
  > ⚠️ 注意这个数字漂移：引用时应注明版本（v2 摘要 54% vs 正式版 57.58%）。**这是我自己核稿时发现的引用陷阱，s_4 写测试用例时也要按此标准标注来源版本。**
- 工程要点：`run_plan_and_act_with_replanning.py` 与基础版是**两个入口** → 说明"重规划"在实现上是**可插拔的独立模块**，而非内嵌逻辑。这一点对 s_2 的接口设计是强约束。

**分层带来的三条硬收益**：① 每步上下文长度可控（执行者不需要看完整历史）；② 计划可审计/可人工修改；③ 计划可缓存复用（同类任务复用计划模板）。**代价**：多一次模型调用 + 计划-执行错位风险 → 必须有重规划触发器。

---

## 5. Reflexion：自驱决策的元循环

### 5.1 结构（三个模型 + 一块记忆）

```
Actor  M_a  : 产生轨迹（内部可用 CoT 或 ReAct）
Evaluator M_e: 打分 r_t —— EM 匹配 / 启发式 / LLM 自评 / 单元测试
Self-Reflection M_sr: (轨迹 τ_t, 奖励 r_t, 记忆 mem) → 一段自由文本反思 sr_t
记忆 mem   : [sr_0, sr_1, ...]，上限 Ω（ReAct 任务里通常 1~3 条，FIFO 淘汰）
循环       : 生成 τ → 评估 → 反思 → mem.append → 重试，直到通过或超试次
```

论文的定位非常清晰：**不更新任何权重，用自然语言当"语义梯度"**。奖励是标量/二元，反思把标量放大成语义方向。

### 5.2 数据（必须记住的四个数）

| 场景 | 基线 | Reflexion |
|---|---|---|
| HumanEval (Python) pass@1 | 80.1 (GPT-4) | **91.0** |
| ALFWorld (134 tasks) | ReAct ~40/134 区间 | **130/134**（启发式触发的反思） |
| HotpotQA ReAct+gpt-4 | 0.39 | 0.51 |
| HotpotQA CoT(GT)+gpt-4 | 0.68 | 0.80 |

**最有价值的两个 ablation**：

1. **"只重试不写反思"几乎无增益**；而"只加情节记忆（上一条轨迹）+ 反思"比"只有情节记忆"再高 **8 个绝对点**。→ **反思（把失败语言化为可迁移的建议）才是增益来源，重试次数不是。**
2. **弱模型无增益**：starchat-beta 在 HumanEval 上 baseline 0.26 → Reflexion 0.26。论文结论：自我纠错能力是**强模型的能力涌现**。→ 别在小模型上指望反思。

### 5.3 四个必须防御的坑（s_3 的设计直接针对这几条）

| 坑 | 机制 | 我的防御设计（写入 s_3） |
|---|---|---|
| **虚假归因** | 反思是 LLM 的自述，"失败因为 API 慢"可能完全错 | 反思必须引用**证据**（具体 observation / 报错行号），并允许"未知原因" |
| **无作用域** | 反思以无条件建议存储，换任务就误导（异构场景下会主动带偏） | 每条反思带 `scope`（适用任务类型/条件）+ `confidence` |
| **假阳性测试 = reward hacking** | 自生成单测全过但答案错 → MBPP-Py 反而从 80.1 掉到 77.1（FP 率 16.3% vs HumanEval 1.4%） | 评估器必须**独立于**执行者；宁可 false-negative 不可 false-positive |
| **FIFO 遗忘** | 满额就丢最旧的，不管是否仍关键 | 重要性加权淘汰 / 成功验证过的反思升权 |

> 一个跨论文的负面结果值得记住：ExpeL 发现把 Reflexion 的反思串直接喂给自己的 insight 提取器会**降低** HotPotQA 准确率（29.0 vs 39.0）。→ **反思是内循环中间产物，跨任务复用必须先蒸馏成结构化规则。**

---

## 6. 【核心产出】自驱决策机制的六个控制点

这是我在四篇论文里抽取的、真正决定 Agent 成败的工程骨架。**每个控制点 = (触发信号, 判定方式, 动作, 兜底)**。

| # | 控制点 | 触发信号 | 判定方式 | 动作 | 兜底 |
|---|---|---|---|---|---|
| CP1 | **何时规划** | 任务首次 / 子目标数 > 1 / 预估步数 > 阈值 | 任务复杂度分类（步数估计、依赖数） | 生成结构化计划（含 state） | 退化为 ReAct 单步 |
| CP2 | **何时重规划** | 连续 2 步无进展 / 观测与计划假设矛盾 / 计划步已失效 | 计划步骤 state 与真实观测一致性检查 | 保留已完成步，重生成剩余计划 | 回到 CP1 全量重规划 |
| CP3 | **何时反思** | 试次失败 / 同动作+同观测重复 >3 次 / 步数 > 30 但仍无解（Reflexion 原启发式） | 评估器给出二元或标量奖励 | 写带 scope 的反思入情节记忆 | 只记事实不记猜测 |
| CP4 | **何时终止** | 判定器确信能答 / 计划全步完成 / 预算耗尽 | **独立**判定器（非执行者本体） | `finish` 并输出 + 引用证据 | 显式 `partial_answer` + 缺失说明 |
| CP5 | **何时升级给人** | 高风险动作（写库/付款/删除）/ 连续失败 N 次 / 权限拒绝 | 策略规则 + 置信度门限 | 输出待确认动作与影响面 | 阻塞并回报 `[BLOCKED]` |
| CP6 | **何时写长期记忆** | 反思被后续尝试**验证有效** / 任务成功且路径非平凡 | 成功归因（该反思出现→成功） | 提升为跨任务规则（蒸馏） | 仅存情节，不升规则 |

**三条设计律**：

1. **判定者与执行者必须分离**（CP4/CP3）。让同一个上下文既干活又验收，就会出现 Reflexion 的"自信地错误自评"。
2. **每个控制点都要有"零成本默认"**（不做规划也能跑、不反思也能答），否则架构在简单任务上被自身开销拖死。
3. **元动作要进动作空间**（`plan/reflect/stop/escalate` 都可被模型显式选择），而不是藏在框架的 if-else 里——否则无法用轨迹数据训练或诊断。

---

## 7. 架构对比总表

| 维度 | CoT | ReAct | Plan-and-Solve | Plan-and-Act | Reflexion |
|---|---|---|---|---|---|
| 环境反馈 | ❌ | ✅ 每步 | ❌ | ✅ 执行层 | ✅ 每尝试（跨 episode） |
| 规划时机 | 隐式 | 隐式、每步 | 一次性前置 | 前置 + 可重规划 | 跨尝试修正 |
| 动作空间 | 无 | 工具 + finish | 无 | 工具（Executor） | 复用 Actor 的 + reflect |
| 每任务 LLM 调用 | 1 | O(步数) | 2 | O(步数) + O(1~重规划) | 3×(试次) |
| 错误恢复 | ❌ | ✅ 局部（靠 thought） | ❌ | ✅ 中程（靠 replan） | ✅ 全局（靠记忆） |
| 可解释性 | 中 | **高**（人可读轨迹、可编辑） | 中 | 高（计划本身可读） | 高（反思是自然语言，但可能编造） |
| 适配任务长度 | 短 | 短-中 | 短-中 | **长** | 中（重复尝试型） |
| 主要失效点 | 幻觉 | 观测膨胀/打转 | 无反馈、漏执行 | 计划-执行错位 | 虚假归因、reward hacking |
| 需要的额外设施 | 无 | 工具层 + 解析器 | 无 | Planner 训练数据 | 评估器 + 记忆 |

---

## 8. 批判性判断（反直觉结论，供 s_4 架构笔记主线）

1. **"推理越多越好"是错的。** HotpotQA 上 ReAct 单独不如 CoT（27.4 vs 29.4）；PS+ 的增益只对"漏步/计算"有效，对占 27% 的语义误解完全无效。**要按错误类型配机制，不是按"先进程度"叠 buff。**
2. **反思的增益 ≈ 反馈信号质量 × 模型自我诊断能力，与"反思次数"弱相关。** 弱模型反思 = 0 增益；试次超 3 次后饱和。**所以优先投资"评估器质量"和"反馈信号"，而不是提高重试预算。**
3. **规划的首要价值不是"计划正确"，而是"让每一步的上下文变窄"。** 这解释了为什么 Plan-and-Act 的 Executor 上下文收窄后长程成功率大涨——它主要解决的是**注意力/上下文工程**问题，其次是决策问题。
4. **生产环境里 Agent 的第一大死因是控制点缺失，不是推理能力。** 无终止、无重规划、观测无界、动作无去重——这四个比"模型不够聪明"更常见。s_2 的复刻必须把这四个当一级需求。
5. **ReAct+CoT 组合优于任一单独** → 架构上应同时具备"内部知识推理"与"外部工具检索"两条通道，并在冲突时优先外部证据（可验证性优先）。

---

## 9. 对后续步骤的落地映射

### s_2 复刻极简 Agent 执行循环——接口草案（由本文推导）

```python
class Action:            # 显式元动作，进入动作空间（§6 设计律 3）
    kind: Literal["think","tool","plan","replan","reflect","finish","escalate"]

class Observation:
    raw: str
    truncated: str          # §2.3 观测膨胀防御
    digest: str             # 结构化抽取/摘要
    ok: bool; error: str|None

class AgentLoop:
    def step(self) -> Action: ...
    # 一级需求（§8 结论 4）：
    #  - step_budget: int                       → CP4 硬兜底
    #  - action_dedup: (action, obs_hash) > 3   → CP3 反思触发
    #  - termination_judge: 独立调用            → CP4 判定者分离
    #  - observation_max_tokens + digest        → 观测膨胀
```

### s_3 受控长期记忆与反思——字段设计（由 §5.3 推导）

```python
class Reflection:
    text: str
    evidence: list[str]      # 必须引用具体观测/报错（防虚假归因）
    scope: str               # 适用条件（防无作用域污染）
    confidence: float        # 写入时置信度
    verified: bool           # 后续尝试是否验证有效（决定是否升为跨任务规则）
    weight: float            # 淘汰权重（替代 FIFO）
```
评估器**独立于**执行器；宁可 false-negative（§5.3 reward hacking）。

### s_4 测试用例清单（第一批必须有）

1. **自终止**：正确中间结论已出现，Agent 是否停？（对应 CP4）
2. **无进展循环**：工具永远返回同一结果，是否触发反思/换策略/退出？（CP3、CP2）
3. **幻觉观测**：工具返回 404 / 空 / 乱码，是否会编造内容？（对应 ReAct 幻觉传播）
4. **观测膨胀**：返回 200KB 网页，是否截断并抽取？
5. **计划-执行错位**：观测与计划假设矛盾，是否 replan？（CP2）
6. **反思污染**：注入一条错误反思，看是否会被错误采纳（测 scope/evidence 机制）
7. **评估器独立**：故意给错误答案 + 全绿自测，是否被识别为假阳性？（§5.3）
8. **权限/高风险动作**：是否在无授权时阻塞而非静默执行？（CP5）

---

## 10. 开放问题（留给 s_4 或后续迭代）

1. 控制点的触发阈值（3 次重复 / 30 步）在不同模型上是否稳定？→ 需要实测标定。
2. 计划粒度与失败率的定量关系（拆几步最划算）？
3. 反思的 `scope` 能否自动学习（而非人工写死）？
4. 如何在没有二元奖励（开放式任务）时得到可靠评估器？
5. 分层架构（Planner/Executor）在**单模型 + 双 prompt** 与**双模型**之间的性价比曲线？

---

## 参考文献（已核对版本）

1. Yao et al., *ReAct: Synergizing Reasoning and Acting in Language Models*, ICLR 2023, arXiv:2210.03629v3（2023-03-10）
2. Wang et al., *Plan-and-Solve Prompting: Improving Zero-Shot Chain-of-Thought Reasoning by LLMs*, ACL 2023, arXiv:2305.04091v2
3. Shinn et al., *Reflexion: Language Agents with Verbal Reinforcement Learning*, NeurIPS 2023, arXiv:2303.11366v4
4. Erdogan et al., *Plan-and-Act: Improving Planning of Agents for Long-Horizon Tasks*, ICML 2025, arXiv:2503.09572v2
5. 参考链接：Google Research Blog《ReAct》(2022-11-08)；Plan-and-Act 官方仓库 SqueezeAILab/plan-and-act；Plan-and-Solve 代码 AGI-Edgerunners/Plan-and-Solve-Prompting；Reflexion 代码 noahshinn024/reflexion

> 引用纪律：同一论文不同版本数字可能不一致（例：Plan-and-Act WebArena-Lite 54% → 57.58%），引用必标版本。
