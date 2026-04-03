# CodeBuddy

CodeBuddy 当前按真实归档验证过的 `~/.codebuddy/` 布局接入：核心 transcript 证据位于 `.codebuddy/projects/<project>/*.jsonl`，`settings.json` 与 `local_storage/*.info` 则作为 companion evidence 保留。

> 默认根目录候选：
>
> - macOS / Linux：`~/.codebuddy`
> - Windows：当前仍需显式配置 source root；不要把自动发现当成稳定承诺

# 获取方式

CCHistory 以 `~/.codebuddy` 为 sync root，但只把非空 `.codebuddy/projects/<project>/*.jsonl` 当作 transcript-bearing 输入。

1. adapter 选择 `~/.codebuddy` 作为默认根目录。
2. 当前 transcript 入口是非空 `.codebuddy/projects/<project>/*.jsonl`。
3. 同目录的零字节 sibling JSONL 目前不会被提升为独立 session。
4. `.codebuddy/settings.json` 与 `.codebuddy/local_storage/*.info` 会作为 companion evidence 捕获，用来解释本地模型/命令历史边界，但不直接生成 turn。

# 上游存储结构

真实样本验证过的典型形态：

```text
~/.codebuddy/
  settings.json
  local_storage/
    entry_<id>.info
  projects/
    <project>/
      <session-id>.jsonl
      <empty-or-old-session>.jsonl
```

一个可见 project 目录下可能同时存在真实 transcript JSONL、零字节 sibling 文件，以及独立的 local-storage companion 记录。稳定 claim 基于这类已验证的本地布局，而不是对其它同步/云端形态的推测。

# 文件结构

当前实现主要依赖这些字段：

- transcript JSONL 行
  - 常见顶层字段：`id`、`type`、`role`、`content`、`providerData`
  - 可选字段：`status`
- content item
  - 常见类型：`input_text`、`output_text`
  - 可能带 `providerData.annotations`
- companion evidence
  - `settings.json`：本地模型与行为配置
  - `local_storage/*.info`：最近命令/提示词等本地历史

这些对象共同决定：

- session 与 turn 的边界
- 哪些 user 行只是本地命令 echo，而不是 canonical 用户提问
- assistant 文本与 usage 信息
- companion evidence 与 transcript 的分层边界

# CCHistory 当前怎么解释

- 非空 `.codebuddy/projects/**/*.jsonl` 是 CodeBuddy transcript 入口。
- `providerData.skipRun = true` 的 user 行保留为 evidence，但不会提升为 canonical `UserTurn`。
- 同目录零字节 JSONL 不会被当作独立 session；它们只说明真实磁盘布局里空文件和有效 transcript 可以共存。
- `settings.json` 与 `local_storage/*.info` 作为 companion evidence 保留，不直接生成额外 turn。

# 注意事项

CodeBuddy 虽已达到 `stable`，但当前稳定承诺仍有边界：

- 稳定 claim 以已验证的本地 `~/.codebuddy` 布局为准，不包含未经验证的云端或远程同步形态。
- Windows 仍应通过显式 source root 配置使用，不要依赖自动发现。
- 如果未来真实样本表明新的 `providerData` 语义、tool-use 形态或 companion 文件会改变 canonical 推导，必须先补 evidence-preserving capture 与回归，再扩大稳定解释范围。
