# Roadmap

本 roadmap 记录 CCHistory 接下来的主要工作方向，分为以下六个部分。各部分之间没有严格的先后依赖，可以并行推进。

> 当前已注册的适配器请参见 `packages/source-adapters/src/registry.ts` 或运行 `pnpm run verify:support-status` 查看完整列表与状态。
>
> 自 2026-03-20 起，self-host v1 的发布门槛以 [`docs/design/SELF_HOST_V1_RELEASE_GATE.md`](./design/SELF_HOST_V1_RELEASE_GATE.md) 为准。各 adapter 的 `stable` / `experimental` 分级同样以 registry 和 `verify:support-status` 输出为准。
>
> 本文档是实时里程碑路线图，但不替代设计冻结。

## Self-Host V1 Release Gate `P0`

当前 P0 不是继续扩大对外支持面，而是先满足 self-host v1 的 6 条发布门槛：

- 干净机器能按文档装起来。
- 升级不会破坏已有库。
- 备份恢复在干净目录验证通过。
- `apps/web` production build 不依赖外网。
- `stable` adapters 都有真实样本和回归测试。
- README、runtime surface、registry 的支持状态一致。

## Bug 修复 `P0`

欢迎用户直接提 issue，优先处理可复现问题。

- issue 驱动的 bug intake 基线已建立；后续重点是把真实用户反馈持续收敛到现有模板、triage 和 backlog 节奏。
- Windows 兼容性首轮专项已完成；后续仅在新的真实 Windows 样本暴露额外路径、默认根目录或 URI 边界时继续收口。

## 基础功能增强 `P1`

- `cli search` 的模糊搜索基线已交付；后续按真实检索反馈继续优化召回质量与结果可读性。
- CLI 更直接的单会话 / session 读取入口已交付；后续只在新的 operator workflow 证明 `show` / `query` 仍有明显心智成本时再扩展。
- 导出 / 导入链路的当前基线已覆盖大 bundle、冲突处理与跨机迁移的首轮可用性；后续按真实使用摩擦继续迭代。
- 高频操作的首批单一命令入口已交付；后续只在新的 operator workflow 证明仍有明显组合成本时再扩展。
- 安装渠道扩展的第一条 repo-distributed baseline 已落地；后续再按分发需求决定是否增加新的官方渠道。
- 自动化 / `cron` / subagent 的次级证据语义成为新方向：要把真实 `UserTurn`、委派任务、定时触发和辅助元数据分层存储，并保持可追溯的父任务关系。

## 用户体验优化 `P1`

- 持续优化整体 UI/UX，优先处理信息层级、可读性、检索路径和管理操作的连贯性。
- tree 视图首个 canonical slice 已交付；后续继续按真实使用反馈优化层级可读性和导航效率。
- 针对 `cron`、`/loop` 等高重复自动化 turn 的 recall / search 去稀释成为下一轮重点，目标是证据保留但默认投影不被循环流量淹没。
- CLI / TUI / API 的下一轮改进以 operator-experience-led、test-first 的 e2e walkthrough 为牵引：agent 需要按真实用户路径跑通流程，并把摩擦系统性回流到 backlog。

## 适配更多的源 `P1`

`antigravity` 已完成适配。接下来的重点：

- `openclaw` 已完成当前 stable promotion slice；后续仅在新的真实样本暴露额外边界、Windows 默认根目录得到独立验证、或 evidence-preserving 规则需要扩展时再追加收口。
- `gemini` 已完成当前 stable promotion slice；后续仅在新的真实样本暴露额外消息形态、Windows 默认根目录得到独立验证、或 companion/evidence 规则需要扩展时再追加收口。
- `codebuddy` 已完成当前 stable promotion slice；后续仅在新的真实样本暴露额外 `providerData` 语义、Windows 默认根目录得到独立验证、或零字节 sibling / companion 规则需要扩展时再追加收口。
- 通用解析器的首轮抽象已完成；后续仅在新的 source family 暴露出未覆盖形态时继续扩展复用边界。
- `lobechat` 暂时继续保持 `experimental`；在新的真实样本补齐前不作为当前阻塞项，优先级暂时让位给 automation/subagent 语义和 recall quality 工作。

## AI 友好适配 `P2`

- 面向 agent 的首批 repo-owned skill 已落地；后续重点是根据真实调用反馈扩展覆盖面，而不是再造并行语义层。
- skill 输出继续与 canonical model 对齐，新增能力也应复用现有语义而不是分叉旁路接口。
- 多 agent / subagent 的 session/task 关系需要回收到 canonical model，而不是继续把 delegated prompts 平铺成普通 `UserTurn`。
