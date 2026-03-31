<p align="center">
  <strong>CCHistory</strong><br>
  <em>AI 编程助手的证据保全历史记录工具</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen" alt="Node.js >=22" />
  <img src="https://img.shields.io/badge/pnpm-10.x-orange" alt="pnpm 10.x" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

---

CCHistory 能够采集、解析并投射你与 AI 编程助手之间的所有对话，汇聚为统一的、证据保全的数据模型。它从 **Codex、Claude Code、Cursor、AMP、Factory Droid、Antigravity** 等平台的本地会话数据中收集信息，然后按照项目身份进行组织，让你能够跨工具搜索、回顾和分析所有对话内容。

<p align="center">
  <img src="docs/screenshots/web-all-turns.webp" alt="CCHistory Web — 所有对话轮次视图" width="800" />
</p>

## 核心特性

- **多平台采集** — 通过本地文件解析以及必要时的本地应用实时探测，从多个 AI 编程助手平台收集对话数据
- **证据保全** — 原始证据被完整保留并可追溯；每个 `UserTurn` 都从源数据派生，绝不直接手动创建
- **基于项目的关联** — 通过仓库指纹、工作空间路径和手动覆盖将对话轮次关联到项目
- **全文搜索** — 在所有规范化对话文本中搜索，支持按项目和数据源过滤
- **Token 用量分析** — 跨模型、项目、数据源和时间维度追踪 Token 用量
- **导出 / 导入 / 合并** — 可移植的数据包，用于备份、迁移和多主机合并
- **数据健康监控** — 漂移和一致性指标，配有数据源级别的健康矩阵

## 支持平台

| 平台 | Self-host v1 分级 | 数据源位置 |
|------|-------------------|-----------|
| Codex | **Stable** | `~/.codex/sessions/` |
| Claude Code | **Stable** | `~/.claude/projects/` |
| Cursor | **Stable** | 平台用户数据 + 项目历史 |
| AMP | **Stable** | `~/.local/share/amp/threads/` |
| Factory Droid | **Stable** | `~/.factory/sessions/` |
| Antigravity | **Stable** | 平台用户数据 `User/` + `~/.gemini/antigravity/{conversations,brain}` |
| OpenClaw | Experimental | `~/.openclaw/agents/` |
| OpenCode | Experimental | `~/.local/share/opencode/{project,storage/session}` |
| Gemini CLI | Experimental | `~/.gemini/` |
| LobeChat | Experimental | `~/.config/lobehub-storage/` |

> `Stable` 表示已经达到 self-host v1 的真实世界验证门槛。`Experimental` 表示 adapter 已经注册到代码里，但还没有足够的真实样本验证，不能作为 self-host v1 的正式支持承诺。
> 可运行 `pnpm run verify:support-status`，把这些文档声明与 adapter registry 做一致性校验。

> Antigravity 说明：CCHistory 对 Antigravity 采用两条互补的采集链路。运行中的桌面应用通过本地 language server trajectory API 提供实际对话内容（用户输入、助手回复、工具调用）。离线文件（`workspaceStorage`、`History`、`brain`）始终会被扫描，用于获取项目路径和 workspace 信号。如果桌面应用未运行，则只有离线链路会执行，此时不会恢复原始对话内容，只能获取项目元数据和证据工件。

## 系统架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                          本地源文件                                    │
│  ~/.codex  ~/.claude  ~/.cursor  ~/.factory  ~/.local/share/amp ...  │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    数据源适配器 (packages/source-adapters)             │
│  平台特定解析器: 捕获 → 提取 → 解析 → 原子化                           │
│  Blobs → Records → Fragments → Atoms → Candidates                   │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      存储层 (packages/storage)                        │
│  SQLite (通过 Node.js 内置 node:sqlite 的 DatabaseSync)               │
│  数据采集、关联、投射、搜索索引、血缘追踪                                │
└──────────┬──────────────────────┬───────────────────┬────────────────┘
           │                      │                   │
           ▼                      ▼                   ▼
┌──────────────────┐  ┌───────────────────┐  ┌─────────────────────┐
│  CLI (apps/cli)  │  │  API (apps/api)   │  │   Web (apps/web)    │
│  本地操作工具:    │  │  Fastify REST     │  │   Next.js 16        │
│  同步、搜索、     │  │  服务 端口 :8040   │  │   React 19 端口     │
│  统计、导出/导入  │  │  CORS, 认证,       │  │   :8085             │
│                  │  │  探测, 回放        │  │   SWR, Tailwind     │
└──────────────────┘  └───────────────────┘  └─────────────────────┘
```

## 快速开始

### 环境要求

- **Node.js >= 22**（根目录 `engines.node` 字段中有机器可读声明，使用内置 `node:sqlite`，无需外部数据库）
- **pnpm 10.x**（通过 `packageManager` 固定版本，并在 `engines.pnpm` 中声明支持范围）

### 安装与构建

这是仓库在全新机器上的规范安装路径：先安装两个 lockfile 对应的依赖，再完成第一次非 Web 工作区构建。

```bash
# 克隆并安装
git clone https://github.com/aaaAlexanderaaa/cchistory.git
cd cchistory
pnpm install

# 安装 Web 应用依赖（独立的 lockfile）
cd apps/web && pnpm install && cd ../..

# 第一次构建（非 Web 工作区）
pnpm run build
```

`apps/web` 的生产构建验证独立于这里的安装路径；需要时可单独运行：

```bash
NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build
```

如果要在临时副本中验证“全新机器安装路径”而不碰当前工作区，可运行：

```bash
pnpm run verify:clean-install
```

### 使用独立 CLI 制品

仓库现在还支持一个仅面向 CLI 的制品通道，适用于目标机器不想依赖完整
源码 checkout 的场景。

在仓库克隆副本中生成该制品：

```bash
pnpm run cli:artifact
```

该命令会在 `dist/cli-artifacts/` 下生成一个带版本号的展开目录，以及对应的
`.tgz` 制品。

在另一台机器上，解压生成的 tarball 后可直接运行：

```bash
# POSIX shell
./bin/cchistory --help

# Windows CMD
bin\cchistory.cmd --help
```

升级方式是用更新版本的制品目录替换当前展开目录。如果要在本地验证这个
制品通道，可运行：

```bash
pnpm run verify:cli-artifact
```

该验证会解压两个不同版本号的制品，并通过执行已安装的
`cchistory templates` 来确认首次安装与替换式升级都可用。

### 全局安装 CLI

```bash
# 构建并全局链接 cchistory 命令
pnpm run cli:link

# 现在可以在任何地方使用 cchistory
cchistory sync
cchistory ls projects
cchistory search "refactor"
cchistory stats
```

或者不全局安装直接运行：

```bash
# 通过 pnpm 脚本
pnpm cli -- sync
pnpm cli -- ls projects

# 或直接通过 node
node apps/cli/dist/index.js sync
```

### 启动 Web 界面和 API

```bash
# 同时启动两个服务（API 端口 :8040，Web 端口 :8085）
pnpm services:start

# 打开控制台
open http://localhost:8085
```

### 首次同步

```bash
# 同步所有自动检测到的本地数据源
cchistory sync

# 查看发现的内容
cchistory ls sources
cchistory ls projects
cchistory stats
```

> 如果要完整同步 Antigravity 的 turn，请先在同一台机器上启动 Antigravity 桌面应用，再运行 `cchistory sync`。

## 截图

<table>
<tr>
<td width="50%">
<strong>所有轮次 — 轮次流</strong><br>
<img src="docs/screenshots/web-all-turns.webp" alt="所有轮次视图" width="100%" />
浏览所有编程会话中的每个轮次，支持按项目、关联状态和值轴进行过滤。
</td>
<td width="50%">
<strong>轮次详情面板</strong><br>
<img src="docs/screenshots/web-turn-detail.webp" alt="轮次详情面板" width="100%" />
完整的用户输入、助手回复、工具调用、Token 用量和管道血缘信息。
</td>
</tr>
<tr>
<td width="50%">
<strong>项目视图</strong><br>
<img src="docs/screenshots/web-projects.webp" alt="项目视图" width="100%" />
项目卡片展示已确认/候选轮次数量、Token 用量、会话数和工作空间路径。
</td>
<td width="50%">
<strong>收件箱</strong><br>
<img src="docs/screenshots/web-inbox.webp" alt="收件箱视图" width="100%" />
分类处理未关联和候选轮次。关联到项目、创建新项目或忽略。
</td>
</tr>
<tr>
<td width="50%">
<strong>数据源管理</strong><br>
<img src="docs/screenshots/web-sources.webp" alt="数据源管理" width="100%" />
配置数据源，查看同步状态，添加手动数据源，覆盖目录。
</td>
<td width="50%">
<strong>数据健康</strong><br>
<img src="docs/screenshots/web-data-health.webp" alt="数据健康" width="100%" />
漂移时间线、一致性指标和每个数据源的健康诊断信息。
</td>
</tr>
</table>

## 文档

详细指南请查看 `docs/guide/` 目录：

- **[CLI 指南](docs/guide/cli.md)** — 所有命令、参数和输出示例
- **[API 指南](docs/guide/api.md)** — REST 接口、配置和请求/响应模式
- **[Web 界面指南](docs/guide/web.md)** — 功能、导航、视图和配置
- **[Inspection Guide](docs/guide/inspection.md)** — 说明何时使用 `probe:*` 与 `inspect:*` 这类证据/诊断辅助命令
- **[数据源技术说明](docs/sources/README.md)** — 已验证数据源的存储布局与采集路径
- **[Self-Host V1 发布门槛](docs/design/SELF_HOST_V1_RELEASE_GATE.md)** — 单用户 self-host v1 的最小发布标准
- **[开发路线图](docs/ROADMAP.md)** — 当前里程碑式开发计划

设计文档位于 `docs/design/`。

## 项目结构

```
cchistory/
├── apps/
│   ├── api/                    # Fastify REST API 服务器 (:8040)
│   ├── cli/                    # 命令行工具 (cchistory)
│   └── web/                    # Next.js 16 Web 前端 (:8085)
├── packages/
│   ├── domain/                 # 核心领域契约和类型
│   ├── source-adapters/        # 平台特定的解析器
│   ├── storage/                # SQLite 持久化和关联
│   ├── api-client/             # 共享 API DTO 契约
│   └── presentation/           # DTO → UI 类型映射
├── scripts/                    # 开发服务生命周期脚本
├── mock_data/                  # 脱敏的夹具数据集
├── docs/
│   ├── guide/                  # 用户指南（CLI、API、Web）
│   ├── design/                 # 内部设计文档
│   └── screenshots/            # Web 界面截图
└── LICENSE                     # MIT 许可证
```

## 开发

```bash
# 构建所有非 Web 包
pnpm run build

# 构建 Web 应用
NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build

# 运行测试
pnpm --filter @cchistory/source-adapters test    # 27 个测试
pnpm --filter @cchistory/storage test            # 59 个测试
pnpm --filter @cchistory/presentation test       # 5 个测试
pnpm --filter @cchistory/cli test                # 12 个测试
pnpm --filter @cchistory/api test                # 10 个测试

# 代码检查
cd apps/web && pnpm lint

# 开发服务
pnpm services:start       # 启动 API + Web
pnpm services:stop        # 停止所有服务
pnpm services:status      # 检查状态
```

## 许可证

[MIT](LICENSE)
