# Sources

截至 2026-04-02，CCHistory registry 中有 11 个 source adapter。其中 10 个达到 `stable` 自托管支持分级，本目录覆盖的就是这 10 个已通过真实数据验证的 source reference；其余 1 个仍为 `experimental`。

> 产品语义、`UserTurn` 定义、以及 project-first 约束，仍然以 `HIGH_LEVEL_DESIGN_FREEZE.md` 为准。
>
> 这里的重点是开发者视角的"数据从哪里来、磁盘上长什么样、CCHistory 目前怎么读"，不是重新定义 canonical model。
>
> 开发里程碑见 [`docs/ROADMAP.md`](../ROADMAP.md)。

# 统一采集流程

所有 source 最终都会进入同一条 capture → records → fragments → atoms → `UserTurn` 的链路，只是入口文件不同。

1. CCHistory 先为每个平台解析默认根目录，或者使用用户通过 CLI / API 覆盖后的 `base_dir`。
2. `runSourceProbe` 递归扫描根目录，按 adapter 的 `matchesSourceFile` 规则筛文件。
3. 每个文件先被捕获为 `CapturedBlob`，保留 `origin_path`、校验和、文件修改时间等证据。
4. adapter 再把 blob 拆成 `RawRecord`、`SourceFragment`、`ConversationAtom`，最后投影成 `Session`、`UserTurn`、`TurnContext`。
5. 结果写入本地 SQLite；如果是常规 `sync`，原始文件快照也会落到 `.cchistory/raw/`。

Antigravity 是唯一的明显例外：

- 它会先通过本机运行中的 language server 采集 live trajectory（实际对话内容）。
- 然后始终扫描 `state.vscdb`、`History`、`brain` 等离线文件（提供项目路径和辅助证据）。
- 两条链路是互补关系，不是主备关系。

# CCHistory 本地存储布局

CCHistory 的本地存储由一个 SQLite 数据库、一组按 blob id 命名的原始快照、以及少量 inspection 产物组成。典型目录如下：

```text
.cchistory/
  cchistory.sqlite
  cchistory.sqlite-wal
  cchistory.sqlite-shm
  raw/
    <source-id>/
      <blob-id>.jsonl
      <blob-id>.json
      <blob-id>.vscdb
      <blob-id>.md
  inspections/
    antigravity-live-2026-03-18/
      manifest.json
      summaries.json
      user-inputs.json
```

几个关键点：

- `cchistory.sqlite` 是主索引和 canonical store。
- `raw/<source-id>/` 存的是原始文件快照，文件名以 `blob.id` 为主，扩展名尽量保留原文件类型。
- `inspections/` 不是核心 runtime 数据；它更像调试或数据核查时留下的辅助产物。
- `--store` 和 `--db` 只会改变 store 落点，不改变内部布局的基本形态。

# SQLite 里的对象分层

数据库不仅存储最终的 turns，还完整保留了从证据到投影的多个层次。

| 层次 | 主要表 | 作用 |
| --- | --- | --- |
| Capture / evidence | `source_instances`, `stage_runs`, `loss_audits`, `captured_blobs`, `raw_records`, `source_fragments` | 保留原始采集结果、阶段运行信息、以及解析损失 |
| Canonical conversation | `conversation_atoms`, `atom_edges`, `sessions`, `user_turns`, `turn_contexts`, `derived_candidates` | 存放规范化后的会话、用户轮次、上下文和候选推导结果 |
| Project / lifecycle | `project_current`, `project_link_revisions`, `project_lineage_events`, `project_manual_overrides`, `tombstones` | 管理 project linking、修订和逻辑对象生命周期 |
| Knowledge / import | `knowledge_artifacts`, `artifact_coverage`, `import_bundles` | 高层知识对象及 bundle 导入记录 |
| Search | `search_index` | FTS5 可用时做全文检索；不可用时会回退到 substring search |

## Windows 默认根目录状态（2026-03-27）

为了避免把未经验证的路径猜测误写成支持承诺，Windows 上的默认根目录目前分成两类：

| Adapter | Windows 状态 | 说明 |
| --- | --- | --- |
| `cursor` | 已验证默认根目录 | 自动发现已覆盖 `%APPDATA%\Cursor\User`、`%APPDATA%\Cursor` 与 `~/.cursor/projects`。 |
| `antigravity` | 已验证默认根目录 | 自动发现已覆盖 `%APPDATA%\Antigravity\User`、`%APPDATA%\Antigravity` 以及 `~/.gemini/antigravity/*` 伴随目录。 |
| `codex` | 需手动确认/覆盖 | 当前代码仍会探测 `%USERPROFILE%\.codex\sessions`，但尚未完成真实 Windows 主机验证。 |
| `claude_code` | 需手动确认/覆盖 | 当前代码仍会探测 `%USERPROFILE%\.claude\projects`，但尚未完成真实 Windows 主机验证。 |
| `factory_droid` | 需手动确认/覆盖 | 当前代码仍会探测 `%USERPROFILE%\.factory\sessions`，但尚未完成真实 Windows 主机验证。 |
| `amp` | 需手动确认/覆盖 | 当前代码仍会探测 `%USERPROFILE%\.local\share\amp\threads`，但尚未完成真实 Windows 主机验证。 |
| `gemini` | 需手动确认/覆盖 | 已达到 `stable`，但当前仍不要把 Windows 自动发现当成稳定能力；请显式配置 source root。 |
| `openclaw` | 需手动确认/覆盖 | 已达到 `stable`，但不要把 Windows 自动发现当成稳定能力；请显式配置 source root。 |
| `opencode` | 需手动确认/覆盖 | 已达到 `stable`，但仍不要把 Windows 自动发现当成稳定能力；请显式配置 source root。 |
| `lobechat` | 需手动确认/覆盖 | 仍属 `experimental`，不要把 Windows 自动发现当成稳定能力。 |
| `codebuddy` | 需手动确认/覆盖 | 已达到 `stable`，但当前仍不要把 Windows 自动发现当成稳定能力；请显式配置 source root。 |

需要手动配置时，请在 Web 的 `Sources` 页面新增/覆盖 `base_dir`，或调用 `/api/admin/source-config`。

# 当前 source 一览

本目录列出已通过真实数据验证、达到 `stable` 分级的 10 个源；`lobechat` 暂不在此展开。

| Source | Family | 主要入口 | 文档 |
| --- | --- | --- | --- |
| Codex | `local_coding_agent` | `~/.codex/sessions` 下的 `.jsonl` / `.json` | [codex.md](./codex.md) |
| Claude Code | `local_coding_agent` | `~/.claude/projects` 下的 `.jsonl` | [claude-code.md](./claude-code.md) |
| Factory Droid | `local_coding_agent` | `~/.factory/sessions` 下的 `.jsonl` + `.settings.json` | [factory-droid.md](./factory-droid.md) |
| AMP | `local_coding_agent` | `~/.local/share/amp/threads` 下的 thread `.json` | [amp.md](./amp.md) |
| Cursor | `local_coding_agent` | `state.vscdb`、`workspace.json`、`agent-transcripts/*.jsonl` | [cursor.md](./cursor.md) |
| Antigravity | `local_coding_agent` | live trajectory API（对话内容）+ 离线 `state.vscdb` / `History` / `brain`（项目信号） | [antigravity.md](./antigravity.md) |
| Gemini CLI | `local_coding_agent` | `.gemini/tmp/**/chats/*.json` + `projects.json` / `.project_root` / `logs.json` companions | [gemini.md](./gemini.md) |
| OpenClaw | `local_coding_agent` | `~/.openclaw/agents/**` 下的 typed-event `sessions/*.jsonl` + evidence-only companions | [openclaw.md](./openclaw.md) |
| OpenCode | `local_coding_agent` | `.local/share/opencode/storage/**` 与可选 `.local/share/opencode/project/**` | [opencode.md](./opencode.md) |
| CodeBuddy | `local_coding_agent` | `.codebuddy/projects/*.jsonl` + `settings.json` / `local_storage/*.info` companions | [codebuddy.md](./codebuddy.md) |

# 如何阅读下面的文档

每个 source 文档都围绕同样四个问题展开，便于横向比较：

- CCHistory 目前怎么找到这个源。
- 上游工具通常怎么把数据放到磁盘上。
- 单个会话文件大概长什么样。
- CCHistory 当前依赖哪些字段恢复 workspace、session、tool call、token usage 或 raw prompt。

暂未收录到本目录的 source：

- `lobechat`

原因：

- 它虽然已经进入 registry / fixture / parser 范围，但仍然属于 `experimental`，还不适合写成"面向开发者的技术说明"并作为稳定参考。
