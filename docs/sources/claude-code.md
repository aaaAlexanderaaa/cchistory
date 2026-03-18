# Claude Code

CCHistory 通过扫描 `~/.claude/projects` 下的 JSONL 会话文件接入 Claude Code。一个 project 目录里可能同时存在主线程和 subagent sidechain。

> 默认根目录：`~/.claude/projects`
>
> Windows 下当前实现同样按用户 home 目录解析，也就是 `%USERPROFILE%\\.claude\\projects`。

# 获取方式

接入方式基于文件扫描，但比 Codex 多了一层"project 目录 + sidechain 文件"的关系。

1. adapter 从 `~/.claude/projects` 递归扫描所有 `.jsonl` 文件。
2. 每个文件先作为一个 blob 捕获。
3. Claude runtime parser 逐行解析消息、工具调用、工具结果、workspace 信号以及 sidechain 关系。
4. `parentUuid` / `isSidechain` 会被保留成 session relation，而不是简单丢掉。

# 上游存储结构

磁盘布局通常是"一个 workspace 对应一个目录，目录下有主 session 文件，也可能有 `subagents/` 目录"。

典型形态：

```text
~/.claude/
  projects/
    -Users-mock-user-workspace-chat-ui-kit/
      cc1df109-4282-4321-8248-8bbcd471da78.jsonl
      b98095d7-b7ee-4d23-9d4c-beb9725d1dc5.jsonl
      subagents/
        agent-a0a2928875cb36a92.jsonl
```

这里的 project 目录名通常是 workspace path 的编码形式，所以它对 project linking 有帮助，但不是唯一可信来源。

# 文件结构

文件格式为 line-delimited JSON，但单行记录的语义更像"消息节点"而不是统一事件总线。

常见字段：

- 顶层字段
  - `type`
  - `uuid`
  - `timestamp`
  - `cwd`
  - `sessionId`
  - `parentUuid`
  - `isSidechain`
- `message`
  - `role`
  - `model`
  - `content[]`
  - `usage`
  - `stop_reason`

`content[]` 中常见条目：

- `text`
- `thinking`
- `tool_use`
- `tool_result`

另外还会看到一些非对话记录，例如：

- `file-history-snapshot`
- slash command 触发的 meta 用户消息
- 本地命令生成的说明性噪声

# CCHistory 当前怎么解释

处理重点不在于"能不能解析消息"，而是把 sidechain、meta 噪声和真实对话区分开来。

- 顶层 `cwd` 会被提升成 `workspace_signal`。
- `parentUuid` / `isSidechain` 会被提升成 `session_relation`。
- `message.model` 会变成 `model_signal`。
- `tool_use` 和 `tool_result` 会分别变成 `tool_call` / `tool_result`。
- `thinking` 内容块（格式为 `{type: "thinking", thinking: "..."}`）当前未被特别处理，会被归入未识别内容并记录 loss audit。（注意：Factory Droid 对 thinking 有显式处理，会将其作为隐藏的 source meta 保留。）
- 某些 Claude interruption marker 会被保留为 `source_meta`，并显式排除出 `UserTurn` 锚点。

# 注意事项

Claude Code 的主要风险在于：很多看起来像 user 的文本，实际上只是命令包装层或 sidechain 噪声。

- slash command 可能先生成一条真实用户请求，再生成一条 meta 展开的系统提示。
- `subagents/` 里的 sidechain 不能简单和主线程拼成一个会话，也不能直接忽略。
- 只看 `role=user` 容易把工具包装提示误记成真实用户问题。
- Claude Code 的磁盘布局对 workspace 友好，但消息内容层的噪声控制更重要。
