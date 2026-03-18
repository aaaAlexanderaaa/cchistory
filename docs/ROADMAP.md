# Roadmap
**结论：这份 roadmap 记录的是 2026-03-18 之后的阶段性开发里程碑；它补充 `docs/design/IMPLEMENTATION_PLAN.md`，但不替代设计冻结。**

> 截至 2026-03-18，当前 registry 已经注册 `codex`、`claude_code`、`factory_droid`、`amp`、`cursor`、`antigravity`、`openclaw`、`opencode`、`lobechat`。
>
> 因此下面“更多源适配”部分会把 `antigravity` 视为已落地，把 `opencode` / `openclaw` 视为继续补强和稳定化，而不是从零开始。

# Bug 修复
**结论：短期优先级最高的是把现有能力做稳，并把 bug 反馈通道变成常规工作流。**

里程碑：

1. 建立 issue 驱动的 bug intake 节奏，欢迎用户直接提 issue，优先处理可复现问题。
2. 完成 Windows 适配专项梳理，重点覆盖路径解析、默认 source 根目录、URI/分隔符规范化、SQLite/本地文件访问差异。
3. 为已知高风险 source 补更多 fixture，避免 bug 修复后在 parser 或 linking 层反复回归。

# 基础功能增强
**结论：这一阶段的目标是让 CLI 和数据交换链路更顺手，而不是引入新抽象。**

里程碑：

1. `cli search` 增加模糊搜索能力，降低对完整关键词的依赖。
2. CLI 增加更直接的单会话读取能力，补齐“拿到一个 session / conversation 就能快速查看”的入口，并简化现有 `show` / `query` 的心智成本。
3. 优化导出 / 导入链路，减少大 bundle、冲突处理和跨机迁移时的摩擦。
4. 为高频操作封装单一命令入口，减少需要组合多个命令才能完成常见任务的情况。
5. 扩展安装渠道，降低首次使用和升级成本。

# 用户体验优化
**结论：中期重点是把已经存在的数据能力做成更好用的产品表面。**

里程碑：

1. 持续优化整体 UI/UX，优先处理信息层级、可读性、检索路径和管理操作的连贯性。
2. 开发 tree 视图，让 project / session / turn 的层级关系更直观。

# 更多源适配
**结论：source 扩展从“补数量”转向“补稳定性和泛化能力”。**

里程碑：

1. 将 `antigravity` 视为已解决的高优先级 source，并继续补 live/offline 两条链路的 fixture 与回归覆盖。
2. 继续补强 `opencode` 和 `openclaw`，重点不是声明支持，而是把真实磁盘结构、异常样本、token usage 和 project 信号补到足够稳定。
3. 新增 `gemini cli` 适配。
4. 抽象并实现通用解析器，尽量把“消息数组 / JSONL 行记录 / VS Code 状态库 / export bundle”这些常见形态统一到少数几条可复用解析路径上。

# AI 友好适配
**结论：最后一层不是再加一个 UI，而是把 CCHistory 变成更容易被 agent 直接消费的能力。**

里程碑：

1. 封装适合 agent 调用的 skill。
2. 把常见工作流收敛成少量稳定接口，例如“检索项目历史”“读取单个 turn 上下文”“导出可分享 bundle”“做 source 健康检查”。
3. 让 skill 输出尽量与当前 canonical model 对齐，避免再造一套旁路语义。
