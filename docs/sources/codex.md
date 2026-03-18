# Codex

CCHistory 通过扫描 `~/.codex/sessions` 下的会话日志文件接入 Codex。核心输入是按时间分目录的 `.jsonl` 事件流，而不是单独的数据库或索引文件。

> 默认根目录：`~/.codex/sessions`
>
> Windows 下当前实现同样按用户 home 目录解析，也就是 `%USERPROFILE%\\.codex\\sessions`。

# 获取方式

接入方式比较直接：递归扫描会话文件，然后按行解析事件。

1. `getDefaultSourcesForHost()` 会把 Codex 默认根目录解析为 `~/.codex/sessions`。
2. adapter 递归扫描该目录，匹配所有 `.jsonl` 和 `.json` 文件。
3. 每个文件先被 capture 成一个 blob，再拆成 `RawRecord`。
4. Codex 专用 runtime parser 根据每条记录里的 `type` 生成 workspace、model、tool call、token usage 等 fragment。

# 上游存储结构

磁盘结构为"日期目录 + 单文件会话日志"，文件名里通常带时间戳和会话 id。

典型形态：

```text
~/.codex/
  sessions/
    2026/
      03/
        13/
          rollout-2026-03-13T10-33-37-019ce50a-d285-7a52-b98a-6a3a66a48547.jsonl
```

这里有两个要点：

- 日期目录只是方便落盘和归档，不是 project identity。
- 单个 `.jsonl` 文件通常就是一个会话线程，但线程里会混入大量指令注入、工具流量、token 事件和元信息。

# 文件结构

会话文件本质上是 line-delimited JSON，常见记录类型包括 `session_meta`、`turn_context`、`response_item`、`event_msg`。

当前实现最依赖的几类记录：

- `session_meta`
  - 常见字段在 `payload` 里，例如 `id`、`timestamp`、`cwd`、`originator`、`cli_version`、`instructions`。
  - `cwd` 是最直接的 workspace 信号。
- `turn_context`
  - 常见字段也在 `payload` 里，例如 `cwd`、`model`。
  - 适合补全当前 turn 的工作目录和模型。
- `response_item`
  - `payload.type=message` 时，`payload.role` 和 `payload.content[]` 才是主要对话内容。
  - `payload.type=function_call` / `custom_tool_call` 表示工具调用。
  - `payload.type=function_call_output` / `custom_tool_call_output` 表示工具返回。
- `event_msg`
  - `payload.type=token_count` 时会携带 turn 级或累计 token usage。

对开发者来说，可以把它理解成：

- 同一个文件里同时混有"真正对话"和"系统运行轨迹"。
- `response_item.payload.content[]` 才是最接近用户可见消息的地方。

# CCHistory 当前怎么解释

处理策略是保留完整证据，但只把少数结构化字段提升为 canonical 信号。

- `session_meta.payload.cwd` 和 `turn_context.payload.cwd` 会被提升成 `workspace_signal`。
- `session_meta.payload.model` 或 `turn_context.payload.model` 会被提升成 `model_signal`。
- `response_item.payload.type=message` 会被拆成文本 fragment。
- `function_call` / `custom_tool_call` 会变成 `tool_call`。
- `function_call_output` / `custom_tool_call_output` 会变成 `tool_result`。
- `event_msg.payload.type=token_count` 会变成 token usage signal，并尝试计算累计值和增量值。

# 注意事项

Codex 的难点不在"怎么读 JSONL"，而在于如何区分真实用户意图和大量注入上下文。

- 很长的 `AGENTS.md`、系统说明、skills 列表可能直接落在同一个会话里。
- 有些样本会缺失结构化 `cwd`，这时不能假设没有 workspace，只能承认证据变弱。
- 文件路径里的日期和文件名不应被当作 project 语义。
- CCHistory 的原则是保留这些注入内容作为证据，再在投影层决定哪些内容不该成为 `UserTurn` 锚点。
