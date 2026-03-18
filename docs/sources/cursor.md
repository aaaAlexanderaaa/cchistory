# Cursor

Cursor 主要通过 VS Code 风格的 `state.vscdb` 和可选的 `agent-transcripts/*.jsonl` 接入，更像在读编辑器状态库，而不是纯聊天日志。

> 默认根目录候选：
>
> - macOS：`~/.cursor/projects`、`~/Library/Application Support/Cursor/User`、`~/Library/Application Support/Cursor`
> - Windows：`~/.cursor/projects`、`%APPDATA%\\Cursor\\User`、`%APPDATA%\\Cursor`
> - Linux：`~/.cursor/projects`、`~/.config/Cursor/User`、`~/.config/Cursor`、`~/.config/cursor/User`、`~/.config/cursor`

# 获取方式

接入时不只扫一种文件，而是把 transcript、workspaceStorage、globalStorage 这几层一起看。

1. adapter 递归扫描默认根目录。
2. 当前匹配两类文件：
   - `agent-transcripts` 目录下的 `.jsonl`
   - 任意目录下名为 `state.vscdb` 的 SQLite 文件
3. 文件优先级为：
   - `agent-transcripts` 最高
   - `workspaceStorage` 次之
   - `globalStorage` 再次
4. 对 `state.vscdb`，CCHistory 会读取 key-value 表，并只关注和 `composer`、`chat`、`bubble`、`prompt`、`generation` 相关的 key。

# 上游存储结构

关键目录通常是 `workspaceStorage/<opaque-id>/`，这里的 `<opaque-id>` 不是项目名，而是编辑器内部 storage id。

典型形态：

```text
~/Library/Application Support/Cursor/User/
  workspaceStorage/
    639bf876be3d93dd9e0d506aeb0aaff9/
      state.vscdb
      state.vscdb.backup
      workspace.json
      anysphere.cursor-retrieval/
        embeddable_files.txt
        high_level_folder_description.txt
  globalStorage/
    ...
```

另一个可能入口是：

```text
~/.cursor/projects/
  .../agent-transcripts/*.jsonl
```

# 文件结构

主数据并不在一个易读的 JSON 文件里，而是存储在 SQLite key-value store 中。

当前实现最关心的几类文件和字段：

- `workspace.json`
  - 常见字段：`folder`、`path`、`uri`
  - 这是恢复"可见 workspace 路径"的直接入口。
- `state.vscdb`
  - 是 SQLite 数据库，不是 JSON。
  - CCHistory 会找带 key/value 列的表，再筛选类似下面的 key：
    - `composerData:*`
    - `composer.composerData`
    - `aiService.generations`
    - `aiService.prompts`
    - 包含 `chatdata`、`aichat` 的 key
- retrieval sidecar
  - 例如 `embeddable_files.txt`、`high_level_folder_description.txt`
  - 这些文件能解释编辑器上下文，但当前不是主对话入口。

# CCHistory 当前怎么解释

CCHistory 优先尝试从 composer/bubble 恢复真正会话；如果恢复不了，就退回 prompt history。

- `workspace.json` 负责提供默认 working directory。
- `composerData:*` 或 `composer.composerData` 里的 bubble 引用，会映射到具体 bubble 记录，再恢复消息序列。
- 如果没有 composer 级会话，CCHistory 会尝试从 `aiService.generations` 或 `aiService.prompts` 构造一个 synthetic prompt-history session。
- `workspaceStorage/<opaque-id>` 只是存储位置，不直接等于 project identity。

# 注意事项

Cursor 的难点在于"编辑器存储 id"和"用户看到的项目路径"经常不是一回事。

- 不同 storage id 可能指向同一个 visible path。
- 也可能有只包含设置状态、并没有真实对话的 storage 目录。
- 如果只按 storage id 分项目，会把一个真实项目拆碎。
- 如果只按 basename 或 visible path 生硬合并，又会掩盖不同 storage 目录证据丰富度的差异。
