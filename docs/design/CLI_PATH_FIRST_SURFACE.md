# CLI Path-First Surface Design

> Status: Draft — 2026-07-05
> Scope: `apps/cli` — `ls` / `tree` / `show` / `stats` / `search` / `context` / `resume` / `last` / `tui`
> Related: [`UX_IMPROVEMENT_PLAN.md`](UX_IMPROVEMENT_PLAN.md), [`R37_CLI_TUI_QUALITY_AUDIT.md`](R37_CLI_TUI_QUALITY_AUDIT.md)

---

## 1. Problem

当前 CLI 的 project-level 命令（`ls` / `tree` / `show` / `stats` / `search` / `context` /
`resume` / `last` / `tui`）只接受 project **ref**（id / slug / display name / 等价 workspace
path）作为输入，没有「path as positional」的顺手形态。

- 用户在项目目录下意识敲 `cchistory ls`，得到的是
  `Use ls projects, ls sessions, or ls sources.` 的 usage error，而不是「当前目录对应的项目」。
- Resolver（`apps/cli/src/resolvers.ts:40-54`）其实已经支持 workspace path 匹配，但只在
  `--project <ref>` 这种显式 option 上能用，positional form 没有暴露。
- 子目录产生的 session 在 surface 上完全不可见：`primary_workspace_path` 是 exact match，
  没有任何 ancestor / descendant 语义，用户看不到「这个项目下还有 3 个 session 发生在
  `./apps/cli`」这层包含关系。

底层（domain + storage）字段已经齐备（`primary_workspace_path` / `working_directory` /
`resume_working_directory`），缺口集中在 CLI surface 和 resolver 层。

---

## 2. Mental Model

**目录 = 项目。** 用户视角下，他所在的目录就是项目；嵌套子目录里的 session 是该项目的子项。

三条对齐原则：

1. **Path 是默认形态**，keyword 是特殊形态。Keyword（`projects` / `sessions` / `sources`）
   优先匹配；不命中再当 path 解析。
2. **`./` 是显式 path 逃生口。** 当目录名恰好叫 `projects` / `sessions` / `sources`，
   用户敲 `cchistory ls ./projects` 强制走 path 分支，不歧义。
3. **子项目像 `ls` 区分目录和文件那样区分。** 主项目 = 完整行；子项目 = 缩进 + 醒目标记
   + 极简列（turn 数、最近活动时间）。更细节让用户自己钻下去。

---

## 3. Resolution Rules

### 3.1 Token classification

CLI 拿到第一个 positional 后按以下顺序判定：

| 输入形式 | 判定 |
|---|---|
| `projects` / `sessions` / `sources` （裸 keyword） | Keyword — 走旧的全局列表语义 |
| `./...` / `../...` / `/...` / `~user/...` （含路径分隔符或前导 `.`） | Path — 永远走 path 分支，不撞 keyword |
| 其他字符串 | 先尝试 ref（id / slug / display name），失败再尝试 path |

判定顺序：**keyword → path-form (前缀判定) → ref → path (fallback)**。
「前缀判定」保证 `./projects` 永远是 path，不会被 keyword 截胡。

### 3.2 Relative → absolute

所有 path 输入经 `path.resolve(input)`（基于 `process.cwd()`）解析成绝对路径后再做匹配。
输出里必须把 resolved 绝对路径打出来（`path_scope` 字段或表头），避免用户看着 `./foo`
但不知道 anchor 在哪。

### 3.3 Path matching tiers

针对已经 absolute 的 path，对每个候选 project 做三层匹配：

| Tier | 条件 | 含义 |
|---|---|---|
| **exact** | `normalize(workspace) === normalize(path)` | 用户就在这个项目根 |
| **descendant** | `normalize(workspace)` 以 `normalize(path) + sep` 为前缀 | path 是某项目 workspace 的祖先（即 `./apps/cli` 是项目，cwd=`.` 命中） |
| **ancestor** | `normalize(path)` 以 `normalize(workspace) + sep` 为前缀 | path 在某项目 workspace 之下（比如你在 `apps/cli/foo` 里 ls，但项目根是 `apps/cli`） |

匹配后：
- exact → 主项目（main）。**注意：同一 workspace 可以有多个 main**
  —— 不同 source / 多次 import 会写出独立 project 行但 workspace 相同。
  这种情况不再 throw，而是把所有 main 都列出来，每个旁边带 `(id=...)`
  做歧义标记，让操作者用 `show project <id>` 二次定位。
- descendant → 主项目下挂的子项目（sub_projects）。
- ancestor → 落到该 workspace 作为 main，并在输出头部加 note：
  `Resolved upward to /root/cchistory/apps/cli`。

`normalizeLocalPathIdentity`（已存在于 `packages/domain`）继续作为基础归一化层，
不引入 `fs.realpath`（见 §8 Non-goals）。

---

## 4. Per-Command Surface Changes

| 命令 | 旧形态 | 新形态 | 默认变化 |
|---|---|---|---|
| `ls` | bare = usage error；`ls projects\|sessions\|sources` = 全局 | bare = cwd-aware 项目视图；`ls <path>` = path-scoped；keyword 形态保留全局语义 | bare 从 error → cwd-aware（**纯新增，无破坏**） |
| `tree` | `tree projects\|project\|session <ref>` | 增加 `tree <path>` 入口；bare `tree` = cwd | 同上 |
| `show` | `show project <ref>` | `show <path>` 直接走 project resolver | 新增 path 入口 |
| `stats` | `stats [--by dim]` | `stats <path> [--by dim]`；命中多个项目时**默认按项目分块** | 加 path 维度 |
| `search` | `search <query> [--project <ref>]` | **不动 surface**，`--project <path>` 经统一 resolver 等价工作 | 无 |
| `context project <ref>` | 已支持 workspace path | **不动 surface**，统一 resolver | 无 |
| `resume <ref>` | 已支持 workspace path | **不动 surface**，统一 resolver | 无 |
| `last [ref]` | 已支持 workspace path | **不动 surface**，统一 resolver | 无 |
| `tui --project <ref>` | 已支持 workspace path | **不动 surface**，统一 resolver | 无 |

「不动 surface」的命令清单意思是：它们共享同一个 `resolveProjectRef` 入口，path 形态
在 resolver 里早就 work，不需要再改 CLI 层。本次工作要把 resolver 抽成统一 pipeline，
所有命令共用同一个 path 解析路径。

---

## 5. Sub-Project Rendering

`cchistory ls <path>` 命中 main + N 个 sub_projects 时，渲染样例：

```
cchistory [chat-ui-kit]   src-3 codex        12 sessions   340 turns   2h ago
  ↳ ./apps/cli            src-3 codex          2 sessions     8 turns   45m ago
  ↳ ./frontend_demo       src-3 claude_code    1 session      3 turns   2d ago
```

- 主项目行 = 现有 `ls projects` 的列（display name + ref + sessions + turns + last active），
  前缀 `cchistory [ref]` 让 path scope 显式。
- 子项目行 = 缩进两空格 + `↳` + 相对路径 + source + sessions + turns + last active。
  **不展开** turn 列表、source mix、related work — 那些细节让用户 `tree <sub-path>`
  自己钻。
- `--long` 时主项目行展开成今天的 `--long` 列；子项目行不变。
- 子项目行数 > 10 时折叠，提示 `--recursive` 展开。

`tree <path>` 渲染保持现有 hierarchy 形态，但根节点换成 path-scope 而不是「all projects」。

---

## 6. JSON Output Shape（Option C：双轨）

`ls <path> --json` 输出同时包含**平铺数组**和**层次视图**，让旧消费者不破：

```json
{
  "kind": "projects",
  "db_path": "/root/cchistory.sqlite",
  "path_scope": "/root/cchistory",
  "resolved_path": "/root/cchistory",
  "projects": [
    {
      "project_id": "proj-1",
      "display_name": "cchistory",
      "slug": "cchistory",
      "primary_workspace_path": "/root/cchistory",
      "session_count": 12,
      "committed_turn_count": 340,
      "candidate_turn_count": 0
    },
    {
      "project_id": "proj-2",
      "display_name": "cli",
      "slug": "cli",
      "primary_workspace_path": "/root/cchistory/apps/cli",
      "session_count": 2,
      "committed_turn_count": 8,
      "candidate_turn_count": 0
    }
  ],
  "hierarchy": {
    "main": {
      "project_id": "proj-1",
      "relative_path": "."
    },
    "sub_projects": [
      {
        "project_id": "proj-2",
        "relative_path": "./apps/cli",
        "depth": 1
      }
    ]
  }
}
```

当**多个 main 共享同一 workspace**时，`hierarchy` 还会带 `mains[]`：

```json
"hierarchy": {
  "main": { "project_id": "proj-1", "relative_path": "." },
  "mains": [
    { "project_id": "proj-1", "relative_path": "." },
    { "project_id": "proj-1b", "relative_path": "." }
  ],
  "sub_projects": []
}
```

- `projects` 数组：所有命中项目（mains + sub）平铺，旧 `jq .projects[]` 不破。
- `hierarchy` 对象：显式层次。新消费者读它。
  - `main`（单数）保留向后兼容（取第一个），`mains`（数组）是歧义场景的规范字段。
- `path_scope` / `resolved_path`：path 输入和 resolve 后的绝对路径，都打出来。
- bare `cchistory ls`（无 path 输入）也走这个 shape，只是 `path_scope` 等于 cwd。

`stats`、`tree`、`show` 的 JSON 各自保留现有 `kind`，新增 `path_scope` / `resolved_path`
/ `hierarchy` 字段（仅当命令接受 path 时）。

---

## 7. Stats Aggregation Rule

`stats <path>` 命中多个项目时的默认行为：

- **默认 = 按项目分块**。每个项目一块（main 一块，每个 sub_project 一块），
  header 标注 scope。等价于隐式 `--by project`。
- 用户想要合并视图（所有子项目一起聚合）→ 显式加 `--merge`（或 `--aggregate`，
  命名待定）。
- 用户想要全局 → 显式 `stats` 不带 path，或带 keyword 形态（如果未来加）。

理由：传 path 就是想看「这个固定路径下的内容」，子项目本身就是不同的东西；
合并反而是异常路径，需要 opt-in。

---

## 8. Search Equivalence Note

`search <query> --project <path>` 不需要新增 path positional。Path 解析应该是一条
**统一 pipeline**，所有命令共用同一个 `resolveProjectRef` 入口：

- `--project <ref>` 接受 id / slug / display name / workspace path —— 已经 work。
- 新增的 path positional（在 `ls` / `tree` / `show` / `stats` 上）只是「顺手入口」，
  内部调用同一个 resolver。
- resolver 层等价 = 表面形态可以不同，但解析结果一致。

不在 `search` 上加 path positional 的原因：query 已经占了 positional，再加 path 二义。
保持 `--project <path>` 即可。

---

## 9. Non-Goals

- **跨设备 / 符号链接**：不做 `fs.realpath`。按字面路径比，避免用户看到的 path 跟
  他们想的不一样（`/var/www` 解析成 `/private/var/www`）。Zero-match 时可考虑加一条
  hint `path not found; pass --canonical to resolve symlinks`，但 v1 不实现。
- **递归无限展开**：`ls <path>` 默认只展开**直接** sub_projects（depth=1）。
  `--recursive` 展开 N 层；循环或异常深的层级硬截断。
- **TUI 入口扩展**：`tui --project <path>` 已 work，本次不改 TUI surface。
- **Web / API surface**：不在本次范围。

---

## 10. Migration & Backward Compatibility

bare `cchistory ls` / `cchistory tree`（无 positional）今天直接抛 usage error
（`apps/cli/src/commands/browse.ts:60`），改成 cwd-aware 是**纯新增行为**：

- 没有脚本能依赖一个 error 输出，所以无破坏。
- `cchistory ls projects|sessions|sources`（带 keyword）维持全局语义不变。
- `cchistory ls --json` 从 error → JSON 输出，也是纯新增。

JSON 加 `hierarchy` 字段对现有消费者透明（不读就不影响）；`projects` 数组语义不变
（命中范围可能从「全部」变成「path-scoped + sub_projects」，这是预期的，且仅当用户
显式传 path 时发生）。

---

## 11. Implementation Outline

落地顺序建议（每步可独立 review）：

1. **统一 resolver**：把 `resolveProjectRef` 升级成支持 exact / descendant / ancestor
   三层匹配，返回 `{ main, sub_projects, ancestor_note? }`。所有现有 caller 仍能拿
   单 project（取 `main`）。
2. **Path token classifier**：在 `args.ts` 加 keyword/path/ref 判定，token 形态
   `./...` / `/...` / `~...` 强制 path；keyword 集合显式列举。
3. **`ls` surface**：cwd-default bare、`ls <path>` positional、sub-project 渲染、
   JSON shape C。
4. **`tree` / `show` / `stats` surface**：复用 resolver，加 path positional。
5. **Tests**：覆盖 keyword vs `./` escape、relative → absolute、三层匹配、JSON shape
   兼容性、`stats` 分块默认 / `--merge` 合并。

每步对应一组 unit + 端到端 fixture，不依赖下步即可验证。

---

## 12. Open Items

- `--merge` 还是 `--aggregate`？倾向 `--merge`（更直白），但要看跟现有 `merge` 命令
  是否歧义。
- 子项目折叠阈值（默认 10？环境变量？）。
- `last <path>` 是否需要支持（当前 `last [project-ref]` 已支持 ref，path 形态是
  resolver 副产品，应该自动 work，但要测试确认）。
