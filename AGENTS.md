# 项目协作与代码规范

## 提交信息、代码注释与文档规范

- **Git Commit 规范**：
  - 每次代码编写、修改或任务功能实现完成后，均必须主动执行 Git commit 进行代码提交保存。
  - 只陈述本次提交的代码功能、变更内容或修复逻辑本身（使用简洁明了的动宾或类别描述，如 `feat: ...`, `fix: ...`）。
  - **严禁**在 commit 描述中写入“参考其他项目”、“借鉴某某项目”、“移植自 XXX”等无意义的信息。

- **代码注释与 Docstrings**：
  - 只陈述类、函数、变量或逻辑块本身的功能、职责、参数及返回值。
  - **严禁**在注释中提及任何外部参考来源或借鉴说明。

- **文档编写**：
  - 技术文档、接口说明、架构方案中，仅聚焦陈述本系统/模块的功能设计与实现细节。
  - **严禁**添加无意义的外部参考项目背景说明。

## 桌面应用自动化操作规范 (agent-desktop)

- Use `agent-desktop` to see and operate desktop apps. Before the first use, run `agent-desktop skills get desktop` and `agent-desktop skills get platform`, and follow them.
- **命令重试机制**：仅当命令执行失败且返回结构中 `error.disposition.retry` 为 `safe` 时方可重试。
- **操作闭环规范**：严格遵循 Observe-Act-Verify 循环机制，优先通过快照获取界面元素的结构化稳定引用（ref）后再执行精准操作，并在操作后通过无障碍树复检确认状态。
