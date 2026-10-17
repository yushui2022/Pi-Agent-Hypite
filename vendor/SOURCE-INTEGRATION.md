# 源码融合与能力边界

## 本次目标与结构

之前是 npm 发布包集成，仓库内没有两个完整上游，不能直接修改引擎。现在把两套完整源码作为可维护的源码分支放入本仓库（普通目录，无嵌套 Git、无 submodule）。这次完成源码纳入、安装构建、运行切换和验证；业务能力尚未全部接到工作台。

- vendor/pi：1,933 个上游文件；MIT 许可；Agent、AI provider、会话、CLI、TUI、客户端和服务端等完整源码。
- vendor/hypit：1,767 个上游文件；保留原许可证；工程编译、运行、生成、渲染、Studio、服务、Skill 和样例。
- vendor/pi-model-data：43 个模型目录数据文件，取自与源码匹配的 Pi AI 1.1.0 官方发布包，仅提取模型 JSON 元数据；来源哈希见 PI-MODEL-DATA.md。用于可重复构建，不是模型权重或认证信息。
- vendor/upstream-sources.json：两个上游 URL、commit、完整文件清单及原始 SHA256。允许修改源码，哈希用于比较而非禁止修改。
- workers/agent 与 packages/hypit-adapter：平台会话与工程操作接口。

## 实际运行链路

工作台 → workers/agent → vendor/pi/packages/coding-agent/dist/bundle/cli.js（本地源码构建）→ 任务工具 → vendor/hypit/bin/hypit.mjs → vendor/hypit/packages 下的 TypeScript 源码。

扩展使用本仓库 Pi AI 构建导出的 Type。根 package.json 已移除两个发布包依赖，不静默回退到 npm 安装版本。config.local.json 的显式路径覆盖仍保留，但服务状态会注明自定义来源。

## 功能现状与下一步取舍

| 能力 | 源码位置 | 当前工作台状态 |
|---|---|---|
| Agent 循环、工具、模型接入 | pi/packages/agent、ai、coding-agent | 会话/工具/停止/记录已接通；真实模型请求未验收 |
| 会话历史、压缩、续接 | pi/packages/coding-agent/src/core | 源码保留；工作台每次新建会话，尚无续接界面 |
| Pi 原生 CLI/TUI | pi/packages/coding-agent、tui | npm run pi 可运行原生入口；未嵌入网页 |
| 工程编译、检查、计划 | hypit/packages/compiler-*、video-cli | 已用源码执行真实 check/plan |
| 分镜与参考视频改编流程 | hypit/skills/hypit、packages | Skill 已接入；自动复刻质量尚无真实验收 |
| 生成、供应商、语音、图像 | hypit/packages/generation、provider-* 等 | 源码保留；未配置凭据，未接入工作台生成流程 |
| Build、渲染、预览 | hypit/packages/runtime*、render-hyperframes、studio | 源码保留；工作台未接通，不宣称可交付视频 |
| Python 服务 | hypit/services | 源码保留；未安装服务虚拟环境/模型权重 |

目前先保留上游功能，之后按实际流程决定删减。优先顺序：Pi 可续接任务会话 → Hypit 工程浏览/修改 → 本地预览与 Build 生命周期 → 有 API 后真实参考改编与验收。不要用“源码存在”替代“功能已接通”。

## 安装、修改与升级

运行 npm run source:setup：使用 Pi 原始 npm lock 和 Hypit 原始 pnpm lock 安装依赖（禁用安装生命周期脚本），恢复已记录模型目录，然后编译 Pi。不下载模型权重、不调用模型。Windows 默认使用 G:/DevCache 下缓存；构建产物在 G 盘源码目录。

修改 Pi 后运行 npm run source:build；修改 Hypit TypeScript 后下次 CLI 会直接读取源码。重启工作台并运行 npm run doctor、npm test、npm run verify:integration。原生入口是 npm run pi 和 npm run hypit -- <命令>。

npm run source:models 显式更新模型目录：访问上游公开模型目录，不发生成请求；更新后重新构建和检查。默认安装不会访问实时模型列表，避免同一份源码随日期变化突然无法编译。

升级上游：读取两份 PROVENANCE.md，比较 upstream-sources.json 记录的基线与新 commit；合并上游变更并保留本地补丁，更新清单和 lock，再验证。不要直接用新 npm 包覆盖源码。固定基线用于追溯，源码可以自主修改。

## 验证和真实风险

- Pi 全部运行包从源码构建通过；本地修复 OpenCode Go 缺失 Google API 注册，未删除模型以回避类型检查。
- Hypit npm run check 类型检查通过。
- 平台 12 项测试通过：含完整源码文件清单、本地构建模块加载、默认源码路径、真实 Pi RPC 与任务行为。
- 源码 Hypit Author/Run check 和 plan 通过，错误工程被拒绝。
- Pi 全仓 npm run check 最终通过（格式、依赖、入口图、安装锁、全仓类型与 browser smoke）。首次检查失败的原因是实时模型目录与旧测试不匹配，以及初次依赖安装未包含全部评测依赖；使用匹配源码版本的模型元数据快照和统一完整安装后通过，未删除测试或放宽类型检查。
- 未执行真实模型/视频生成，未运行上游所有测试（含付费 API 测试）；可选原生组件及 Python 服务尚未逐一安装验证。
- 安装网络失败、上游目录变化、Windows 原生依赖均可能影响新机器安装；本机已验证关键路径。Hypit 的商业授权限制仍适用。
