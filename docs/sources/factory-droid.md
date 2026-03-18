# Factory Droid

Factory Droid 通过读取 `~/.factory/sessions` 下的会话 JSONL 和同名 `.settings.json` sidecar 接入。主日志负责 turn 边界，sidecar 负责补充模型和累计 token 信息。

> 默认根目录：`~/.factory/sessions`
>
> Windows 下当前实现同样按用户 home 目录解析，也就是 `%USERPROFILE%\\.factory\\sessions`。

# 获取方式

接入方式为"主会话文件 + sidecar 补充信息"的双文件读取。

1. adapter 扫描 `~/.factory/sessions` 下的 `.jsonl` 文件。
2. CCHistory 对每个 `.jsonl` 文件建立 blob 后，会额外尝试读取同路径同名的 `.settings.json`。
3. 主文件负责提取 `session_start`、消息、工具事件和文本。
4. sidecar 主要补 `model` 和 session 级 token usage。

# 上游存储结构

磁盘布局通常是一层 workspace 编码目录，下面并排放 transcript 和 sidecar。

典型形态：

```text
~/.factory/
  sessions/
    -Users-mock-user-workspace-history-lab/
      11111111-2222-4333-8444-555555555555.jsonl
      11111111-2222-4333-8444-555555555555.settings.json
```

这个布局说明：

- transcript 和 settings 是同一会话的两面。
- 只读 `.jsonl` 会丢 token 汇总和默认模型信息。

# 文件结构

主文件是 JSONL，sidecar 是普通 JSON，两者职责分得比较清楚。

主文件里的常见记录：

- `type=session_start`
  - 常见字段：`id`、`title`、`sessionTitle`、`cwd`
- `type=message`
  - 核心字段在 `message` 里
  - 常见内容：`role`、`model`、`usage`、`content[]`

`content[]` 常见条目：

- `text`
- `thinking`
- `tool_use`
- `tool_result`

sidecar `*.settings.json` 常见字段：

- `model`
- `tokenUsage`
- `assistantActiveTimeMs`
- `autonomyLevel`
- `interactionMode`

# CCHistory 当前怎么解释

CCHistory 把 transcript 当成主语义来源，把 sidecar 当成补充证据。

- `session_start.cwd` 会变成 `workspace_signal`。
- `session_start.sessionTitle` / `title` 会变成 `title_signal`。
- `message.content[].text` 会进入文本 fragment。
- `tool_use` / `tool_result` 会进入工具轨迹。
- `thinking` 会保留为隐藏的 source meta。
- `settings.model` 会补成 `model_signal`。
- `settings.tokenUsage` 会补成 session 级 token usage fragment。

# 注意事项

Factory Droid 的主要风险不在于格式复杂，而在于容易漏读 sidecar。

- 主 `.jsonl` 没有 sidecar 时也能工作，但信息会不完整。
- sidecar 不能替代 transcript，因为它没有 turn 边界、工具调用链和真实文本顺序。
- 如果把 sidecar 当主数据，会失去"用户究竟问了什么"的上下文。
