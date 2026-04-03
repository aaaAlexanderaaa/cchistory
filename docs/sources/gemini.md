# Gemini CLI

Gemini CLI 当前按真实样本验证过的 `~/.gemini/` 布局接入：核心 transcript 证据位于 `.gemini/tmp/<project-or-hash>/chats/*.json`，而 `projects.json`、`.project_root` sidecar 与同目录 `logs.json` 则作为 project/workspace 与 companion evidence 保留。

> 默认根目录候选：
>
> - macOS / Linux：`~/.gemini`
> - Windows：当前仍需显式配置 source root；不要把自动发现当成稳定承诺

# 获取方式

CCHistory 以 `~/.gemini` 为 sync root，但只把 `tmp/**/chats/*.json` 当作 transcript-bearing 输入。

1. adapter 选择 `~/.gemini` 作为默认根目录。
2. 当前 transcript 入口是 `.gemini/tmp/<project-or-hash>/chats/*.json`。
3. `projects.json` 与 `.project_root` sidecar 用于恢复 project / workspace 线索。
4. 同级 `logs.json` 作为 companion evidence 保留，用来解释缺失 companion 场景和局部活动轨迹，但不直接生成独立 turn。
5. `.gemini/antigravity/*` 属于另一条 source family 的伴随数据，不进入 Gemini CLI transcript 解析边界。

# 上游存储结构

真实样本验证过的典型形态：

```text
~/.gemini/
  projects.json
  history/
    <project>/.project_root
  tmp/
    <project>/
      .project_root
      chats/
        session-*.json
    <hash>/
      logs.json
      chats/
        session-*.json
```

当前 stable claim 同时覆盖两类已验证局部变体：

- companion-backed project 目录（`projects.json` + `.project_root`）
- missing-companion hashed tmp 目录（只有 `chats/*.json` + `logs.json`）

# 文件结构

当前实现主要依赖这些字段：

- chat session JSON
  - 常见字段：`sessionId`、`projectHash`、`startTime`、`lastUpdated`、`messages`
- message item
  - 常见字段：`id`、`timestamp`、`type`、`content`、`model`
- root / companion evidence
  - `projects.json`：workspace-path 到 project label 的映射
  - `.project_root`：指向绝对 workspace path
  - `logs.json`：同目录活动/命令历史

这些对象共同决定：

- session 与 turn 的边界
- working directory / workspace signal
- assistant 文本与模型标签
- missing-companion 情况下仍可保留的 session 证据

# CCHistory 当前怎么解释

- `tmp/**/chats/*.json` 是 Gemini CLI transcript 入口。
- `projects.json` 和 `.project_root` 作为 evidence-preserving companion 输入，用于恢复 `working_directory` 与标题线索。
- 缺失 companion metadata 时，session 仍然有效，只是可能退化为 hash/title 级展示。
- `logs.json` 作为 companion evidence 保留，用来约束同目录活动边界和真实归档布局。
- `.gemini/antigravity/*` 不进入 Gemini adapter 的 transcript 解析路径。

# 注意事项

Gemini CLI 虽已达到 `stable`，但当前稳定承诺仍有边界：

- 稳定 claim 以已验证的本地 `~/.gemini` chat-json + companion 布局为准，不包含未经验证的云端或远程同步形态。
- Windows 仍应通过显式 source root 配置使用，不要依赖自动发现。
- 如果未来真实样本表明 tool-use、token-usage 或新的 sidecar 形态会改变 canonical 推导，必须先补 evidence-preserving capture 与回归，再扩大稳定解释范围。
