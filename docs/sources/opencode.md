# OpenCode

OpenCode 当前按真实归档验证过的全局存储布局接入：核心证据位于 `~/.local/share/opencode/storage/`，并可结合可选的 `~/.local/share/opencode/project/` 根来补充 workspace 线索。

> 默认根目录候选：
>
> - macOS / Linux：`~/.local/share/opencode/storage`、`~/.local/share/opencode/project`、`~/.local/share/opencode/storage/session`
> - Windows：当前仍需显式配置 source root；不要把自动发现当成稳定承诺

# 获取方式

CCHistory 先把 `storage/session` 视为 transcript 入口，再通过 `storage/message` 与 `storage/part` 组装出可读的 turn 与上下文。

1. adapter 优先选择 `~/.local/share/opencode/storage`。
2. 当前匹配的 transcript-bearing 文件是 `storage/session/**/*.json`。
3. 读取 session 后，会按 `sessionID` 关联：
   - `storage/message/<session-id>/*.json`
   - `storage/part/<message-id>/*.json`
4. `storage/todo/*.json` 与 `storage/session_diff/*.json` 当前作为 companion evidence / layout proof，不直接当作 transcript。

# 上游存储结构

真实归档验证过的典型形态：

```text
~/.local/share/opencode/
  storage/
    project/
      global.json
    session/
      global/<session-id>.json
    message/
      <session-id>/*.json
    part/
      <message-id>/*.json
    session_diff/*.json
    todo/*.json
```

某些安装还会出现 `~/.local/share/opencode/project/<workspace>/storage/...` 的 project-local 形态；CCHistory 会保留这类根作为补充发现候选，但稳定 claim 基于已经回归覆盖的 `storage` 主布局。

# 文件结构

当前实现主要依赖这些字段：

- session JSON
  - 常见字段：`id`、`directory`、`projectID`、`summary`、`time`、`title`、`version`
- message JSON
  - 常见字段：`id`、`sessionID`、`role`、`time`、`model`、`summary`
- part JSON
  - 常见字段：`id`、`messageID`、`sessionID`、`type`、`text`

这些对象共同决定：

- session 与 turn 的边界
- working directory / workspace signal
- assistant 文本与 tool call/result 片段
- 可恢复的 message/part 级证据

# CCHistory 当前怎么解释

- `storage/session/global/*.json` 是会话入口。
- `directory` 与相关 workspace 线索会进入 project 关联与 session 展示。
- `storage/message/<session-id>` 为该 session 提供消息层记录。
- `storage/part/<message-id>` 为消息补全文本、plan、tool call 与 tool result。
- `session_diff` / `todo` 目前不会生成额外 turn，但会继续作为真实布局边界的一部分被 fixture 和 review 约束。

# 注意事项

OpenCode 虽已达到 `stable`，但当前稳定承诺仍有边界：

- 稳定 claim 以已验证的本地磁盘布局为准，不包含未经验证的云端或远程同步形态。
- Windows 仍应通过显式 source root 配置使用，不要依赖自动发现。
- 如果未来真实样本表明 `session_diff`、`todo` 或 project-local `.opencode` 目录会影响 canonical 推导，必须先补 evidence-preserving capture 与回归，再扩大稳定解释范围。
