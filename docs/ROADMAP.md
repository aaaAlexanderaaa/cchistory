# Roadmap

本 roadmap 记录 CCHistory 接下来的主要工作方向，分为以下五个部分。各部分之间没有严格的先后依赖，可以并行推进。

> 截至 2026-03-18，当前 registry 已注册 `codex`、`claude_code`、`factory_droid`、`amp`、`cursor`、`antigravity`、`openclaw`、`opencode`、`lobechat`。
>
> 本文档作为 `docs/design/IMPLEMENTATION_PLAN.md` 的补充，但不替代设计冻结。

# Bug 修复

欢迎用户直接提 issue，优先处理可复现问题。

- 建立 issue 驱动的 bug intake 节奏。
- 完成 Windows 适配专项梳理，重点覆盖路径解析、默认 source 根目录、URI/分隔符规范化、SQLite/本地文件访问差异。

# 基础功能增强

- `cli search` 增加模糊搜索能力，降低对完整关键词的依赖。
- CLI 增加更直接的单会话 / session 读取能力，补齐"拿到一个 session 就能快速查看"的入口，简化现有 `show` / `query` 的心智成本。
- 优化导出 / 导入链路，减少大 bundle、冲突处理和跨机迁移时的摩擦。
- 为高频操作封装单一命令入口，减少需要组合多个命令才能完成常见任务的情况。
- 扩展安装渠道，降低首次使用和升级成本。

# 用户体验优化

- 持续优化整体 UI/UX，优先处理信息层级、可读性、检索路径和管理操作的连贯性。
- 开发 tree 视图，让 project / session / turn 的层级关系更直观。

# 适配更多的源

`antigravity` 已完成适配。接下来的重点：

- 继续补强 `opencode` 和 `openclaw`，把真实磁盘结构、异常样本、token usage 和 project 信号补到足够稳定。
- 新增 `gemini cli` 适配。
- 抽象并实现通用解析器，将"消息数组 / JSONL 行记录 / VS Code 状态库 / export bundle"等常见形态统一到少数几条可复用解析路径上。

# AI 友好适配

- 封装适合 agent 调用的 skill，把常见工作流收敛成少量稳定接口（如检索项目历史、读取单个 turn 上下文、导出可分享 bundle、source 健康检查等）。
- skill 输出尽量与当前 canonical model 对齐，避免再造一套旁路语义。
