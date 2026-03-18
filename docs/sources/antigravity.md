# Antigravity

Antigravity 是当前最特殊的数据源。CCHistory 通过 live 和 offline 两条链路**同时**采集数据：live trajectory API 提供实际对话内容（用户输入、助手回复、工具调用），offline 文件扫描提供项目路径、workspace 信号和辅助证据。两条链路是互补关系，不是主备关系。

> 默认根目录候选：
>
> - macOS：`~/Library/Application Support/Antigravity/User`、`~/Library/Application Support/Antigravity`、`~/.gemini/antigravity/brain`、`~/.gemini/antigravity`
> - Windows：`%APPDATA%\\Antigravity\\User`、`%APPDATA%\\Antigravity`、`~/.gemini/antigravity/brain`、`~/.gemini/antigravity`
> - Linux：`~/.config/Antigravity/User`、`~/.config/Antigravity`、`~/.config/antigravity/User`、`~/.config/antigravity`、`~/.gemini/antigravity/brain`、`~/.gemini/antigravity`

# 获取方式

每次 sync 时，CCHistory 会依次执行 live 采集和 offline 文件扫描，然后将两者的结果合并到同一个 session 中。

**Live 采集**（需要 Antigravity 桌面应用正在运行）：

1. 从本机进程列表中找 `language_server_*` 进程。
2. 要求命令行里带 `--app_data_dir antigravity`。
3. 解析 `--csrf_token` 和 `--extension_server_port`。
4. 用 `lsof` 推断 API port，再通过本机 HTTPS 调 `GetAllCascadeTrajectories` 和 `GetCascadeTrajectorySteps`。
5. `CORTEX_STEP_TYPE_USER_INPUT.userInput.userResponse` 是最高保真度的用户原文。

**Offline 文件扫描**（始终执行，无论 live 是否成功）：

- 递归扫描 `state.vscdb`（提供 trajectory summary、workspace 路径等元数据）
- 扫描 `History/entries.json`（提供历史快照索引）
- 扫描 `~/.gemini/antigravity/brain` 下的 `task.md` 和 `Conversation_*_History.md`（提供任务定义和对话快照）

合并时，如果 live 已经为某个 session 提供了标题和 workspace，offline 的同名信号不会覆盖 live 的结果。

# 上游存储结构

Antigravity 的磁盘数据天然分散，至少涉及三层：编辑器状态、历史快照、brain 工件。典型形态如下：

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

Antigravity 没有单一的"会话文件格式"，live、SQLite、JSON、Markdown 四种形态都会出现。当前实现依赖的主要形态：

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

Live 和 offline 各自承担不同职责：

**Live 提供对话内容：**

- `userInput.userResponse` → 用户原文（最可信的来源）
- `notifyUser` / `plannerResponse` → assistant 文本
- 工具步骤（`runCommand`、`viewFile` 等）→ tool call / tool result

**Offline 提供辅助信号：**

- `state.vscdb` 中的 trajectory summary（protobuf 编码）→ session 元数据、workspace 路径、标题
- `History/entries.json` → 历史快照索引
- `brain/task.md` 和 companion markdown → system / assistant 证据（不等价于用户消息）

Offline 文件优先级：

1. `globalStorage/state.vscdb`
2. `workspaceStorage/*/state.vscdb`
3. `History/entries.json`
4. `brain` 下的 markdown

# 注意事项

- 离线数据（`items[].text`、标题、plan markdown）可能是 agent 重写过的内容，不能作为用户原文使用。
- 如果 Antigravity 桌面应用未运行，live 链路不可用，那么 sync 只会得到 offline 的项目信号和证据工件，没有实际对话内容。
- 同一个 visible path 可能对应多个 storage id，也可能和 Cursor 指向同一路径。
- 即使 live 和 offline 都成功采集，offline 的对话快照（如 `Conversation_*_History.md`）仍然不等价于 live 的原始对话，它更像是 agent 生成的摘要。
