# Design Documents

本目录收录 CCHistory 的设计决策、运行时清单、验证合约和审查记录。
阅读顺序取决于你要解决的问题：

- 产品语义和架构不变量：先读
  [`../../HIGH_LEVEL_DESIGN_FREEZE.md`](../../HIGH_LEVEL_DESIGN_FREEZE.md)。
- 当前代码实际暴露了什么：读
  [`CURRENT_RUNTIME_SURFACE.md`](CURRENT_RUNTIME_SURFACE.md)。
- 发布支持范围和验证方式：读
  [`SELF_HOST_V1_RELEASE_GATE.md`](SELF_HOST_V1_RELEASE_GATE.md) 与
  [`V1_VALIDATION_STRATEGY.md`](V1_VALIDATION_STRATEGY.md)。
- 具体功能或审查工作：按下面的功能领域进入。

`self-host v1` 是部署和支持范围，不是 package semver。当前仓库发布版本是
`0.3.0`。

## 发布与验证

| 文档 | 内容 |
|------|------|
| [SELF_HOST_V1_RELEASE_GATE.md](SELF_HOST_V1_RELEASE_GATE.md) | 单用户 self-host 支持范围的最低发布门槛、支持 tier 定义、验证命令 |
| [V1_VALIDATION_STRATEGY.md](V1_VALIDATION_STRATEGY.md) | 产品目标对应的验证旅程、自动化验证器清单、手动测试矩阵 |
| [CURRENT_RUNTIME_SURFACE.md](CURRENT_RUNTIME_SURFACE.md) | 当前运行时全貌：入口点、adapter 状态、CLI/API/Web/TUI 功能清单 |
| [R43 — CC History Lite](R43_CC_HISTORY_LITE_DESIGN.md) | 单机、零存储 Lite profile 的 Full/Lite parity、CLI/TUI、单向导出与隔离边界 |
| [FIXTURE_CORPUS_MANIFEST.md](FIXTURE_CORPUS_MANIFEST.md) | 测试 fixture 的覆盖模型和采样规则 |
| [OPERATOR_REVIEW_RUBRIC.md](OPERATOR_REVIEW_RUBRIC.md) | 操作者审查评分标准，被 R22/R29/R31 等合约引用 |

## Source Adapters 与 Ingestion

| 文档 | 内容 |
|------|------|
| [R17 — LobeChat Export Validation](R17_LOBECHAT_EXPORT_VALIDATION.md) | LobeChat 导出格式的验证调研和 promotion 决策 |
| [R38 — Pillar Derivation Session Audit](R38_PILLAR_DERIVATION_SESSION_AUDIT.md) | pillar / session 推导相关审查记录 |

Source 支持状态的代码级事实在
[`packages/source-adapters/src/platforms/registry.ts`](../../packages/source-adapters/src/platforms/registry.ts)。
更宽泛的 domain/API enum 只是 schema allowance，不代表 adapter 已经注册或
达到 stable 支持。
Source 产品价值分层属于设计语义，定义在
[`../../HIGH_LEVEL_DESIGN_FREEZE.md`](../../HIGH_LEVEL_DESIGN_FREEZE.md)；
当前注册 adapter 到价值分层的映射记录在
[`CURRENT_RUNTIME_SURFACE.md`](CURRENT_RUNTIME_SURFACE.md)。

## CLI、TUI 与 Operator Experience

| 文档 | 内容 |
|------|------|
| [R22 — Operator Experience E2E](R22_OPERATOR_EXPERIENCE_E2E.md) | 操作者体验验证合约：摩擦分类、严重度定义、日记规则 |
| [R37 — CLI/TUI Quality Audit](R37_CLI_TUI_QUALITY_AUDIT.md) | CLI/TUI 质量审查记录 |
| [R38 — CLI/TUI Product UX Audit](R38_CLI_TUI_PRODUCT_UX_AUDIT.md) | CLI/TUI 产品体验审查记录 |
| [CLI_PATH_FIRST_SURFACE.md](CLI_PATH_FIRST_SURFACE.md) | CLI path-first surface：path 作默认 positional、子项目包含关系、JSON 双轨 |
| [UX_IMPROVEMENT_PLAN.md](UX_IMPROVEMENT_PLAN.md) | 用户体验改进计划 |

## 子 Agent、自动化与关联关系

修改 delegation graph、automation/cron 识别、或 related-work 追溯逻辑前建议阅读：

| 文档 | 内容 |
|------|------|
| [R20 — Automation/Cron/Subagent Semantics](R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md) | 基于真实数据调研的自动化/定时/子 agent 证据分类和规范处理方式 |
| [R21 — Loop Flood Control](R21_LOOP_FLOOD_CONTROL.md) | 循环/自动化流量的识别规则和降权策略 |
| [R23 — Canonical Delegation Graph](R23_CANONICAL_DELEGATION_GRAPH.md) | 父子 session、scheduled run 的关系图模型和真实数据调研 |

## Remote Agent 采集

修改 remote-agent pairing/upload/scheduling 或 agent API 前建议阅读：

| 文档 | 内容 |
|------|------|
| [REMOTE_AGENT_COLLECTION_DESIGN.md](REMOTE_AGENT_COLLECTION_DESIGN.md) | Remote agent 采集架构：控制平面、配对、上传、调度 |
| [R29 — Remote Agent Validation Contract](R29_REMOTE_AGENT_VALIDATION_CONTRACT.md) | Remote agent 工作流的手动验证合约 |

## Managed Runtime（Web/API 服务）

修改 managed API 的 read-side 行为或 web review 流程前建议阅读：

| 文档 | 内容 |
|------|------|
| [R31 — Managed API Read Diary Contract](R31_MANAGED_API_READ_DIARY_CONTRACT.md) | Web/API 服务启动后的手动验证合约 |

## 已关闭的倡议（archived/）

`archive/` 下是已关闭、不再活跃的设计倡议。仅供历史追溯——任何从中得出的
现行规则都已迁移到 `AGENTS.md`、`HIGH_LEVEL_DESIGN_FREEZE.md` 或对应的
代码模块。

| 文档 | 内容 | 关闭于 |
|------|------|--------|
| [STORAGE_BOUNDARY/](archive/STORAGE_BOUNDARY/) | R41/R42 storage-boundary migration：audit、V2 contract、migration plan、scale baseline | 2026-06-24 (R42) |
