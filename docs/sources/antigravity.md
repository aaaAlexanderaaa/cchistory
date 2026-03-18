# Antigravity
**结论：Antigravity 是当前最特殊的数据源；CCHistory 会优先走 live trajectory API 读取真正的 `userInput.userResponse`，live 不可用时才退回到 `state.vscdb`、`History` 和 `brain` 这些离线证据。**

> 默认根目录候选：
>
> - macOS：`~/Library/Application Support/Antigravity/User`、`~/Library/Application Support/Antigravity`、`~/.gemini/antigravity/brain`、`~/.gemini/antigravity`
> - Windows：`%APPDATA%\\Antigravity\\User`、`%APPDATA%\\Antigravity`、`~/.gemini/antigravity/brain`、`~/.gemini/antigravity`
> - Linux：`~/.config/Antigravity/User`、`~/.config/Antigravity`、`~/.config/antigravity/User`、`~/.config/antigravity`、`~/.gemini/antigravity/brain`、`~/.gemini/antigravity`

# 获取方式
**结论：Antigravity 的采集分成 live 和 offline 两条链路，而且它们的保真度不一样。**

当前顺序如下：

1. 先尝试 live 采集。
   - 从本机进程列表中找 `language_server_*` 进程。
   - 要求命令行里带 `--app_data_dir antigravity`。
   - 解析 `--csrf_token` 和 `--extension_server_port`。
   - 用 `lsof` 推断 API port，再通过本机 HTTPS 调 `GetAllCascadeTrajectories` 和 `GetCascadeTrajectorySteps`。
2. 如果 live 成功：
   - 直接读取 trajectory summary 和 step stream。
   - `CORTEX_STEP_TYPE_USER_INPUT.userInput.userResponse` 被当作最高保真度的用户原文。
3. 如果 live 不可用：
   - 递归扫描 `state.vscdb`
   - 扫描 `History/entries.json`
   - 扫描 `~/.gemini/antigravity/brain` 下的 `task.md` 和 `Conversation_*_History.md`

# 上游存储结构
**结论：Antigravity 的磁盘数据天然分散，至少有三层：编辑器状态、历史快照、brain 工件。**

典型形态：

```text
~/Library/Application Support/Antigravity/User/
  globalStorage/
    state.vscdb
  workspaceStorage/
    <opaque-id>/
      state.vscdb
      state.vscdb.backup
      workspace.json
  History/
    entries.json

~/.gemini/antigravity/
  conversations/
    <cascade-id>.pb
  brain/
    <cascade-id>/
      task.md
      task.md.metadata.json
      implementation_plan.md
      implementation_plan.md.metadata.json
      walkthrough.md
      walkthrough.md.metadata.json
      Conversation_<id>_History.md
      Conversation_<id>_History.md.metadata.json
```

这三层分别回答不同问题：

- `state.vscdb`：编辑器内部状态、trajectory summary、history 相关 key。
- `History/entries.json`：快照索引，能指回具体 artifact 文件及时间。
- `brain/`：按 cascade id 组织的 markdown 工件。

# 文件结构
**结论：Antigravity 没有单一“会话文件格式”；live、SQLite、JSON、Markdown 都会出现。**

当前实现依赖的主要形态：

- live trajectory summary / steps
  - summary 提供 `summary`、`createdTime`、`lastModifiedTime`、workspace / git 信息。
  - steps 提供 `type`、`metadata.createdAt`，以及 `userInput`、`notifyUser`、`plannerResponse`、`runCommand` 等 payload。
- `state.vscdb`
  - 是 SQLite key-value store。
  - 当前重点关注 trajectory summary key、history key，以及与 chat/prompt 相关的记录。
- `History/entries.json`
  - 索引历史条目，包含 artifact id 和 timestamp。
- `brain/*.md`
  - `task.md` 更像任务定义。
  - `implementation_plan.md`、`walkthrough.md` 更像 agent 生成工件。
  - `Conversation_*_History.md` 可能包含 conversation history snapshot。

# CCHistory 当前怎么解释
**结论：CCHistory 明确区分“原始 prompt 的高保真来源”和“只能作为离线证据的派生工件”。**

- live `userInput.userResponse` 是最可信的用户原文。
- live `notifyUser` / `plannerResponse` 会转成 assistant 文本。
- live 工具步骤会被归一化成 tool call / tool result。
- 离线 `state.vscdb` 和 `History` 主要用于恢复 session 边界、workspace、标题、以及 prompt 候选。
- `brain/task.md` 和 companion markdown 会被保留为 system / assistant 证据，不会自动等价于用户消息。
- 文件优先级当前为：
  - `globalStorage/state.vscdb`
  - `workspaceStorage/*/state.vscdb`
  - `History/entries.json`
  - `brain` 下的 markdown

# 注意事项
**结论：Antigravity 最容易踩的坑是把离线工件错当成原始对话。**

- `items[].text`、标题、plan markdown 都可能是 agent 重写过的内容。
- 没有运行中的桌面 app 时，CCHistory 仍能 ingest 很多证据，但那不等价于完整 raw conversation recovery。
- 同一个 visible path 可能对应多个 storage id，也可能和 Cursor 指向同一路径。
- 离线链路的价值主要是“保留证据和补 project 信号”，不是百分之百还原原始聊天。
