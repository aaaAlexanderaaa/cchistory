# OpenClaw

OpenClaw 当前按真实归档验证过的 `~/.openclaw/agents/` 布局接入：核心 transcript 证据位于各 agent 的 `sessions/*.jsonl` typed-event 日志，`agent/auth-profiles.json`、`agent/models.json` 与 lifecycle 变体文件则作为 evidence-only companion 保留。

> 默认根目录候选：
>
> - macOS / Linux：`~/.openclaw/agents`
> - Windows：当前仍需显式配置 source root；不要把自动发现当成稳定承诺

# 获取方式

CCHistory 以 `~/.openclaw/agents` 为 source root，并按每个 agent 目录分别检查 transcript 与 companion evidence。

1. adapter 选择 `~/.openclaw/agents` 作为默认根目录。
2. 当前 active transcript 入口是 `agents/<agent>/sessions/*.jsonl`。
3. `agents/<agent>/sessions/*.jsonl.reset.*` 与 `*.jsonl.deleted.*` 会被保留为 evidence-only lifecycle artifacts，不直接当作 active session ingestion 入口。
4. `agents/<agent>/agent/auth-profiles.json` 与 `agents/<agent>/agent/models.json` 会作为 companion evidence 捕获，用来解释 provider / model 元数据边界，但不直接生成 turn。

# 上游存储结构

真实归档验证过的典型形态：

```text
~/.openclaw/
  agents/
    main/
      sessions/
        <session-id>.jsonl
        <session-id>.jsonl.reset.<timestamp>
        <session-id>.jsonl.deleted.<timestamp>
      agent/
        auth-profiles.json
        models.json
    anyrouter/
      agent/
        auth-profiles.json
    kimicoding/
      agent/
        auth-profiles.json
```

不是每个 agent 根目录都一定带有 transcript；有些只暴露 config companions。稳定 claim 基于已验证的本地 `agents/*/sessions/*.jsonl` active transcript 形态，以及 companion/lifecycle evidence-preserving capture。

# 文件结构

当前实现主要依赖这些字段：

- session / event JSONL 行
  - 常见顶层字段：`type`、`id`、`parentId`、`timestamp`
- `session` 事件
  - 常见字段：`version`、`cwd`
- `model_change` / `custom` 事件
  - 常见字段：`provider`、`modelId`、`customType`、`data`
- `message` 事件
  - 常见字段：`message.role`、`message.content`、`message.model`、`message.usage`、`message.stopReason`
- message content item
  - 常见类型：`text`、`thinking`、`toolCall`

这些对象共同决定：

- session 与 turn 的边界
- working directory / workspace signal
- model/provider 线索
- assistant 文本、thinking、tool call 与 tool result 片段
- lifecycle / prompt-error 等 evidence-only 边界信息

# CCHistory 当前怎么解释

- `sessions/*.jsonl` 是 active transcript 入口。
- `session.cwd` 会进入 session 的 working directory / workspace signal。
- `model_change`、`model-snapshot` 与 assistant message metadata 会补充模型标签。
- `message.role = toolResult` 与 content `toolCall` 会投影为 tool result / tool call 片段。
- `.reset.*` / `.deleted.*` 以及 `agent/*.json` 不会生成额外 active sessions，但会保留为 evidence blobs，避免丢失 reset、delete、prompt-error 与配置边界信息。

# 注意事项

OpenClaw 虽已达到 `stable`，但当前稳定承诺仍有边界：

- 稳定 claim 以已验证的本地 `~/.openclaw/agents` 归档布局为准，不包含未经验证的云端或远程同步形态。
- Windows 仍应通过显式 source root 配置使用，不要依赖自动发现。
- lifecycle 变体与 agent companion config 目前作为 evidence-only artifacts 保留；如果未来真实样本表明它们会改变 canonical turn/building 规则，必须先补回归再扩大稳定解释范围。
