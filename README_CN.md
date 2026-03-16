<p align="center">
  <strong>CCHistory</strong><br>
  <em>AI 编程助手的证据保全历史记录工具</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen" alt="Node.js >=22" />
  <img src="https://img.shields.io/badge/pnpm-10.x-orange" alt="pnpm 10.x" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/License-Private-lightgrey" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

---

CCHistory 能够采集、解析并投射你与 AI 编程助手之间的所有对话，汇聚为统一的、证据保全的数据模型。它从 **Codex、Claude Code、Cursor、AMP、Factory Droid、Antigravity、OpenClaw、OpenCode 和 LobeChat** 的本地会话数据中收集信息，然后按照项目身份进行组织，让你能够跨工具搜索、回顾和分析所有对话内容。

<p align="center">
  <img src="docs/screenshots/web-all-turns.webp" alt="CCHistory Web — 所有对话轮次视图" width="800" />
</p>

## 目录

- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [支持平台](#支持平台)
- [快速开始](#快速开始)
  - [环境要求](#环境要求)
  - [安装步骤](#安装步骤)
  - [快速启动](#快速启动)
- [命令行工具 (CLI)](#命令行工具-cli)
  - [同步 (sync)](#同步-sync)
  - [列表 (ls)](#列表-ls)
  - [搜索 (search)](#搜索-search)
  - [统计 (stats)](#统计-stats)
  - [树形图 (tree)](#树形图-tree)
  - [详情 (show)](#详情-show)
  - [导出 / 导入 / 合并](#导出--导入--合并)
  - [查询 (query)](#查询-query)
- [API 服务](#api-服务)
  - [启动 API 服务器](#启动-api-服务器)
  - [核心接口](#核心接口)
  - [管理接口](#管理接口)
  - [配置项](#api-配置项)
- [Web 界面](#web-界面)
  - [启动 Web 服务器](#启动-web-服务器)
  - [所有对话轮次](#所有对话轮次)
  - [项目视图](#项目视图)
  - [收件箱](#收件箱)
  - [数据源管理](#数据源管理)
  - [数据健康](#数据健康)
- [项目结构](#项目结构)
- [开发指南](#开发指南)
  - [构建命令](#构建命令)
  - [测试](#测试)
  - [代码检查](#代码检查)

---

## 核心特性

- **多平台采集** — 通过本地文件解析，从 9 个 AI 编程助手平台收集对话数据。
- **证据保全** — 原始证据被完整保留并可追溯；每个 `UserTurn` 都从源数据派生，绝不直接手动创建。
- **基于项目的关联** — 通过仓库指纹、工作空间路径和手动覆盖将对话轮次关联到项目。宁可漏关联也不错误合并。
- **三种关联状态** — `committed`（确认关联）、`candidate`（候选关联，需要审核）、`unlinked`（未关联）。
- **全文搜索** — 在所有规范化对话文本中搜索，支持按项目和数据源过滤。
- **Token 用量分析** — 跨模型、项目、数据源和时间维度追踪输入、输出、缓存和推理 token。
- **导出 / 导入 / 合并** — 可移植的数据包，用于备份、迁移和多主机合并。
- **遮罩模板** — 确定性规则，在展示层折叠重复内容而不修改原始证据。
- **数据健康监控** — 漂移和一致性指标，配有数据源级别的健康矩阵。

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

**核心领域模型：**

| 概念 | 说明 |
|------|------|
| `UserTurn` | 主要对象 — 从原始证据派生的单个用户提交边界 |
| `ProjectIdentity` | 通过证据（仓库指纹、工作空间路径）派生的关联项目 |
| `Session` | 来自源平台的原始对话容器 |
| `ConversationAtom` | 最小的可追溯语义单元（用户、助手、工具、系统） |
| `MaskTemplate` | 确定性展示规则，折叠重复内容但不修改证据 |
| `KnowledgeArtifact` | 高层级派生对象（决策、事实、模式），覆盖一个或多个轮次 |

## 支持平台

| 平台 | 类型 | 数据源位置 |
|------|------|-----------|
| Codex | 本地编程助手 | `~/.codex/sessions/` |
| Claude Code | 本地编程助手 | `~/.claude/projects/` |
| Factory Droid | 本地编程助手 | `~/.factory/sessions/` |
| AMP | 本地编程助手 | `~/.local/share/amp/threads/` |
| Cursor | 本地编程助手 | 平台用户数据 + 项目历史 |
| Antigravity | 本地编程助手 | 平台用户数据 `workspaceStorage/` |
| OpenClaw | 本地编程助手 | 平台特定路径 |
| OpenCode | 本地编程助手 | 平台特定路径 |
| LobeChat | 对话导出 | 导出包或应用数据库 |

## 快速开始

### 环境要求

- **Node.js >= 22**（使用内置 `node:sqlite`，无需外部 SQLite 库）
- **pnpm 10.x**（通过 `packageManager` 字段强制指定）

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/aaaAlexanderaaa/cchistory.git
cd cchistory

# 安装工作空间依赖（覆盖 packages/* 和 apps/api, apps/cli）
pnpm install

# 安装 Web 应用依赖（独立的 lockfile）
cd apps/web && pnpm install && cd ../..
```

### 快速启动

```bash
# 1. 构建所有核心包
pnpm run build

# 2. 同步本地数据源到默认存储
node apps/cli/dist/index.js sync

# 3. 列出发现的项目
node apps/cli/dist/index.js ls projects

# 4. 启动 API + Web 开发服务
pnpm services:start

# 5. 在浏览器中打开 http://localhost:8085
```

## 命令行工具 (CLI)

CLI（`apps/cli`）是主要的本地操作工具，读写本地 SQLite 存储。

```
用法: cchistory <command> [options]

全局选项:
  --store <dir>    存储目录 (数据库在 <dir>/cchistory.sqlite)
  --db <file>      显式指定 SQLite 文件路径
  --index          仅从已有存储读取 (读取命令默认)
  --full           重新扫描数据源到临时内存存储
  --json           机器可读的 JSON 输出
  --showall        在列表中包含空项目
```

### 同步 (sync)

将本地源文件采集到存储中。

```bash
cchistory sync                          # 同步所有默认数据源
cchistory sync --source codex           # 仅同步 Codex
cchistory sync --limit-files 10         # 限制每个数据源的文件数量（用于测试）
```

```
Synced 7 source(s) into /workspace/.cchistory/cchistory.sqlite

Source           Host          Sessions  Turns  Status
---------------  ------------  --------  -----  -------
Codex (codex)    host-e336320  4         4      healthy
Claude Code      host-e336320  4         4      healthy
Cursor (cursor)  host-e336320  2         1      healthy
...
```

### 列表 (ls)

浏览项目、会话和数据源。

```bash
cchistory ls projects                   # 列出项目 (默认隐藏空项目)
cchistory ls sessions                   # 列出所有会话
cchistory ls sources                    # 列出已配置的数据源
cchistory ls projects --showall         # 包含空项目
```

```
Name                   Status     Hosts  Sessions  Turns  Last Activity
---------------------  ---------  -----  --------  -----  ------------------------
chat-ui-kit            tentative  1      3         3      2026-03-13T09:11:15.457Z
history-lab            tentative  1      2         2      2026-03-16T16:42:12.467Z
shared-product-lab     tentative  1      1         1      2026-03-16T16:41:50.982Z
...
```

### 搜索 (search)

跨所有对话轮次的全文搜索。

```bash
cchistory search "data security"                        # 全局搜索
cchistory search "refactor" --project chat-ui-kit       # 限定项目范围
cchistory search "docker" --source codex --limit 5      # 限定数据源范围
```

```
Unassigned (1)
  2026-03-16 01cee9b87cb2 Do a deep research about data security and document some resources...
```

### 统计 (stats)

总览和用量分析。

```bash
cchistory stats                                 # 总览
cchistory stats usage --by model                # 按模型分析 Token 用量
cchistory stats usage --by project              # 按项目分析 Token 用量
cchistory stats usage --by day                  # 每日用量柱状图
```

```
DB                  : .cchistory/cchistory.sqlite
Sources             : 7
Projects            : 5
Sessions            : 13
Turns               : 11
Turns With Tokens   : 8/8
Coverage            : 100.0%
Input Tokens        : 79,536
Output Tokens       : 5,117
Total Tokens        : 461,890
```

### 树形图 (tree)

项目-会话-轮次结构的层级视图。

```bash
cchistory tree projects                             # 所有项目
cchistory tree project chat-ui-kit                  # 单个项目及其轮次
```

```
chat-ui-kit [tentative] sessions=3 turns=3
  host-e336320f / claude_code: 2 session(s)
  host-e336320f / codex: 1 session(s)
history-lab [tentative] sessions=2 turns=2
  host-e336320f / amp: 1 session(s)
  host-e336320f / factory_droid: 1 session(s)
Unassigned sessions=4
```

### 详情 (show)

查看单个实体的详细信息。

```bash
cchistory show project chat-ui-kit          # 项目详情
cchistory show session <session-id>         # 会话详情及轮次
cchistory show turn <turn-id>               # 完整轮次及上下文
cchistory show source codex                 # 数据源详情
```

### 导出 / 导入 / 合并

用于备份和多主机合并的可移植数据包。

```bash
# 导出所有数据源到数据包
cchistory export --out ./my-backup

# 导出指定数据源（不含原始数据）
cchistory export --out ./my-backup --source codex --no-raw

# 导入数据包到当前存储
cchistory import ./my-backup

# 导入时处理冲突
cchistory import ./my-backup --on-conflict skip    # skip | replace | error

# 在两个存储之间直接合并
cchistory merge --from /host-a/.cchistory --to /host-b/.cchistory
```

### 查询 (query)

结构化 JSON 输出，用于程序化消费。

```bash
cchistory query turns --search "refactor" --limit 5
cchistory query turn --id <turn-id>
cchistory query sessions --project <project-id>
cchistory query projects
```

## API 服务

API（`apps/api`）是基于 Fastify 的 REST 服务器，提供对 CCHistory 存储的读取和管理访问。

### 启动 API 服务器

```bash
# 通过规范的开发服务脚本启动
pnpm services:start                     # 同时启动 API 和 Web

# 或仅启动 API
bash scripts/dev-services.sh start api  # API 在端口 8040
```

### 核心接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `GET` | `/api/sources` | 列出所有已配置的数据源 |
| `GET` | `/api/turns` | 列出对话轮次（`?limit=`, `?offset=`） |
| `GET` | `/api/turns/search` | 搜索轮次（`?q=`, `?project_id=`, `?source_ids=`） |
| `GET` | `/api/turns/:turnId` | 完整轮次投射 |
| `GET` | `/api/turns/:turnId/context` | 轮次上下文（回复、工具调用） |
| `GET` | `/api/sessions` | 列出所有会话 |
| `GET` | `/api/sessions/:sessionId` | 会话及其轮次 |
| `GET` | `/api/projects` | 列出项目（`?state=committed\|candidate\|all`） |
| `GET` | `/api/projects/:projectId` | 项目详情 |
| `GET` | `/api/projects/:projectId/turns` | 项目轮次 |
| `GET` | `/api/projects/:projectId/revisions` | 版本和血缘历史 |
| `GET` | `/api/artifacts` | 知识工件 |
| `POST` | `/api/artifacts` | 创建/更新知识工件 |

### 管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/source-config` | 列出数据源配置 |
| `POST` | `/api/admin/source-config` | 添加手动数据源 |
| `POST` | `/api/admin/source-config/:sourceId` | 覆盖数据源目录 |
| `POST` | `/api/admin/source-config/:sourceId/reset` | 重置数据源到默认值 |
| `POST` | `/api/admin/probe/runs` | 运行数据源探测并持久化 |
| `POST` | `/api/admin/pipeline/replay` | 回放管道（试运行差异对比） |
| `GET` | `/api/admin/linking` | 关联审核队列 |
| `POST` | `/api/admin/linking/overrides` | 创建/更新关联覆盖 |
| `GET` | `/api/admin/masks` | 内置遮罩模板 |
| `GET` | `/api/admin/drift` | 漂移和一致性报告 |
| `POST` | `/api/admin/lifecycle/candidate-gc` | 归档/清除候选轮次 |

### API 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `PORT` | `8040` | API 监听端口 |
| `HOST` | `127.0.0.1` | API 监听主机 |
| `CCHISTORY_CORS_ORIGIN` | `http://localhost:8085,http://127.0.0.1:8085` | 允许的 CORS 来源 |
| `CCHISTORY_API_TOKEN` | _(无)_ | Bearer 认证令牌（除 `/health` 外的所有路由） |

**示例：**

```bash
curl http://localhost:8040/api/sources | python3 -m json.tool
```

```json
{
  "sources": [
    {
      "id": "srcinst-codex-abc123",
      "platform": "codex",
      "display_name": "Codex",
      "total_sessions": 4,
      "total_turns": 4,
      "sync_status": "healthy"
    }
  ]
}
```

## Web 界面

Web 前端（`apps/web`）是基于 Next.js 16 的应用，使用 React 19、Tailwind CSS 4 和 SWR 进行数据获取。通过 Next.js 路由处理器将 API 请求代理到 Fastify 后端。

### 启动 Web 服务器

```bash
# 同时启动 API + Web
pnpm services:start

# 在浏览器中打开
open http://localhost:8085
```

### 所有对话轮次

浏览所有编程会话中的每个轮次。在**轮次流**（虚拟化列表）和**会话地图**（时间线可视化）之间切换。支持按项目、关联状态和值轴进行过滤。

<p align="center">
  <img src="docs/screenshots/web-turn-detail.webp" alt="所有轮次 — 带详情面板的轮次流" width="800" />
</p>

点击任意轮次卡片可打开详情面板，展示完整的用户输入、助手回复、工具调用、Token 用量、会话元数据和管道血缘信息。

### 项目视图

按工作空间身份组织的项目卡片视图。每张卡片显示已确认和候选的轮次数量、Token 用量、会话数量和活跃时间。支持在**项目网格**和**会话地图**视图之间切换。

<p align="center">
  <img src="docs/screenshots/web-projects.webp" alt="项目 — 网格视图和项目卡片" width="800" />
</p>

### 收件箱

分类处理未关联和候选的轮次。收件箱呈现需要项目关联决策的轮次。可以审查证据、关联到已有项目、创建新项目或忽略。

<p align="center">
  <img src="docs/screenshots/web-inbox.webp" alt="收件箱 — 分类处理未关联轮次" width="800" />
</p>

### 数据源管理

配置和监控采集数据源。查看同步状态、会话/轮次数量和目录路径。支持添加手动数据源、覆盖目录或重置为默认值。

<p align="center">
  <img src="docs/screenshots/web-sources.webp" alt="数据源 — 管理员配置" width="800" />
</p>

### 数据健康

通过漂移和一致性指标监控系统完整性。漂移时间线显示最近 7 天的趋势，数据源健康矩阵列出每个数据源的诊断信息。

<p align="center">
  <img src="docs/screenshots/web-data-health.webp" alt="数据健康 — 漂移时间线和数据源矩阵" width="800" />
</p>

## 项目结构

```
cchistory/
├── apps/
│   ├── api/                    # Fastify REST API 服务器
│   ├── cli/                    # 命令行操作工具
│   └── web/                    # Next.js 16 Web 前端
├── packages/
│   ├── domain/                 # 核心领域契约和类型
│   ├── source-adapters/        # 平台特定的解析器和适配器
│   ├── storage/                # SQLite 持久化、数据采集、关联
│   ├── api-client/             # 共享 API DTO 契约
│   └── presentation/           # 展示层映射 (DTO → UI 类型)
├── scripts/                    # 开发服务生命周期脚本
├── mock_data/                  # 用于测试的脱敏夹具数据集
├── docs/                       # 文档和设计文档
├── HIGH_LEVEL_DESIGN_FREEZE.md # 权威的产品范围定义
└── AGENTS.md                   # 开发指南
```

### 构建依赖图

```
domain (叶节点)
├── source-adapters → domain
├── storage → domain
├── api-client (叶节点)
│   └── presentation → api-client
├── api → domain, source-adapters, storage
├── cli → domain, source-adapters, storage
└── web → api-client, presentation
```

## 开发指南

### 构建命令

```bash
# 构建所有非 Web 包（按依赖顺序）
pnpm run build

# 构建特定包
pnpm --filter @cchistory/domain build
pnpm --filter @cchistory/source-adapters build
pnpm --filter @cchistory/storage build
pnpm --filter @cchistory/api-client build
pnpm --filter @cchistory/presentation build
pnpm --filter @cchistory/cli build
pnpm --filter @cchistory/api build

# 构建 Web 应用（限制 Node 内存以适应受限主机）
NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build

# 构建所有内容（包括 Web）
pnpm run build:all:safe

# 验证核心本地源切片（domain + adapters 测试 + storage + cli + api）
pnpm run validate:core
```

### 测试

所有测试套件使用 Node.js 内置测试运行器（`node --test`）。

```bash
pnpm --filter @cchistory/source-adapters test    # 27 个适配器和解析器测试
pnpm --filter @cchistory/storage test            # 59 个存储和血缘测试
pnpm --filter @cchistory/presentation test       # 5 个展示层映射测试
pnpm --filter @cchistory/cli test                # 12 个 CLI 集成测试
pnpm --filter @cchistory/api test                # 10 个 API 端点测试
```

### 代码检查

```bash
cd apps/web && pnpm lint                         # ESLint 零警告策略
```

### 开发服务

```bash
pnpm services:start          # 通过 supervisor 启动 API (8040) + Web (8085)
pnpm services:stop           # 停止所有托管服务
pnpm services:restart        # 重启所有服务
pnpm services:status         # 检查服务状态
```
