# AMP

> 默认根目录：`~/.local/share/amp/threads`
>
> Windows 下当前代码仍会按 home 目录探测 `%USERPROFILE%\.local\share\amp\threads`，但还没有真实 Windows 主机验证；运维上应在 `Sources` 中确认或覆盖 `base_dir`。

AMP 通过读取 `~/.local/share/amp/threads` 下的整线程 JSON 文件接入。与前几个 JSONL 源不同，AMP 将整段线程存储在单个 JSON 文件中。

# 获取方式

AMP 的接入逻辑是"一个 thread 文件对应一个候选会话"：

1. adapter 扫描 `~/.local/share/amp/threads` 下的 `.json` 文件。
2. 每个文件先整体解析成一个 root object。
3. CCHistory 会先把 root 本身写成一条 `RawRecord`，再把 `messages[]` 逐项拆成独立 record。
4. AMP runtime parser 用 root 里的 `env.initial.trees` 恢复 workspace，用每条 message 恢复对话和工具轨迹。

# 上游存储结构

AMP 的磁盘布局通常很扁平，一条线程对应一个 JSON 文件。典型形态：

```text
~/.local/share/amp/
  threads/
    T-019d19fb-1a2b-7345-8cde-0f1a2b3c4d5e.json
```

相比 JSONL 源，AMP 没有明显的 sidecar 或按日期分目录的组织层。

# 文件结构

AMP 文件是一个完整的 JSON 对象，顶层 metadata 和 `messages[]` 均承载关键信息。

常见顶层字段：

- `id`
- `created`
- `title`
- `messages[]`
- `env.initial.trees[]`
- `meta`

`messages[]` 常见字段：

- `timestamp`
- `role`
- `messageId`
- `content[]`
- `state.stopReason`
- `usage`
- `userState.cwd`

`content[]` 常见条目：

- `text`
- `tool_use`
- `tool_result`

`env.initial.trees[]` 很关键，因为 workspace 常常只在那里出现，例如：

- `uri=file:///Users/mock_user/workspace/history-lab`
- `displayName=history-lab`

# CCHistory 当前怎么解释

root record 并非噪声，而是恢复 project 语义最关键的证据之一。各字段的映射方式如下：

- root `title` 会变成 `title_signal`。
- `env.initial.trees[0].uri` 会被规范化成 `workspace_signal`。
- 后续 `messages[]` 才是实际对话消息。
- `tool_use` / `tool_result` 会进入工具轨迹。
- assistant message 上的 `usage` 和 `state.stopReason` 会进入 token usage / stop reason 投影。

# 注意事项

- workspace 路径往往只在 root 的 `env.initial.trees` 里。
- 某些 message 里会带 `userState.cwd`，但它更像补充，不应替代 root signal。
- AMP 文件是一整个 JSON，因此 malformed 文件的失败面更大——不是"坏一行"，而是"坏整个线程"。

需要同时保留 root 和 `messages[]` 的解析结果：仅看 `messages[]` 容易丢失 workspace 信息，仅看 root 则会丢失实际会话内容。
