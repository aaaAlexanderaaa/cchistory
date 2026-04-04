# Design Documents

本目录包含 CCHistory 的设计文档和设计决策记录。

## 按功能领域索引

### 发布与验证

| 文档 | 内容 |
|------|------|
| [SELF_HOST_V1_RELEASE_GATE.md](SELF_HOST_V1_RELEASE_GATE.md) | Self-host v1 发布的 6 项最低门槛 |
| [V1_VALIDATION_STRATEGY.md](V1_VALIDATION_STRATEGY.md) | 5 条产品目标对应的验证旅程、自动化验证器清单、手动测试矩阵 |
| [R22 — Operator Experience E2E](R22_OPERATOR_EXPERIENCE_E2E.md) | 操作者体验验证合约：摩擦分类、严重度定义、日记规则 |
| [OPERATOR_REVIEW_RUBRIC.md](OPERATOR_REVIEW_RUBRIC.md) | 操作者审查评分标准（被 R22/R29/R31 引用） |

### Source Adapters 与 Ingest

| 文档 | 内容 |
|------|------|
| [CURRENT_RUNTIME_SURFACE.md](CURRENT_RUNTIME_SURFACE.md) | 当前运行时全貌：入口点、11 个 adapter 状态、CLI/API/Web/TUI 功能清单 |
| [FIXTURE_CORPUS_MANIFEST.md](FIXTURE_CORPUS_MANIFEST.md) | 测试 fixture 的覆盖模型和采样规则 |
| [R17 — LobeChat Export Validation](R17_LOBECHAT_EXPORT_VALIDATION.md) | LobeChat 导出格式的验证调研和 promotion 决策 |

### 子 Agent、自动化与关联关系

修改 delegation graph、automation/cron 识别、或 related-work 追溯逻辑前建议阅读：

| 文档 | 内容 |
|------|------|
| [R20 — Automation/Cron/Subagent Semantics](R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md) | 基于真实数据调研的自动化/定时/子 agent 证据分类和规范处理方式 |
| [R21 — Loop Flood Control](R21_LOOP_FLOOD_CONTROL.md) | 循环/自动化流量的识别规则和降权策略 |
| [R23 — Canonical Delegation Graph](R23_CANONICAL_DELEGATION_GRAPH.md) | 父子 session、scheduled run 的关系图模型和真实数据调研 |

### Remote Agent 采集

修改 remote-agent pairing/upload/scheduling 或 agent API 前建议阅读：

| 文档 | 内容 |
|------|------|
| [REMOTE_AGENT_COLLECTION_DESIGN.md](REMOTE_AGENT_COLLECTION_DESIGN.md) | Remote agent 采集架构：控制平面、配对、上传、调度 |
| [R29 — Remote Agent Validation Contract](R29_REMOTE_AGENT_VALIDATION_CONTRACT.md) | Remote agent 工作流的手动验证合约 |

### Managed Runtime（Web/API 服务）

修改 managed API 的 read-side 行为或 web review 流程前建议阅读：

| 文档 | 内容 |
|------|------|
| [R31 — Managed API Read Diary Contract](R31_MANAGED_API_READ_DIARY_CONTRACT.md) | Web/API 服务启动后的手动验证合约 |
