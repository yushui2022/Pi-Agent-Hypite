# 项目规格与项目卡

方法论：Codex MVP开发方法论 v2.0。日期：2026-10-17。

## 目标与范围

项目：Pi Agent × Hypit 视频生产平台。
目标用户：管理多个 TikTok 账号的视频运营团队。
问题：参考改编、素材生产和多账号变体需要重复劳动，制作过程难复用、追踪。
本轮目标：本地任务准备 MVP；视频生产闭环仍处于 P0 技术验证。
假设：Pi 加载 Hypit Skill 后，可以利用原有 CLI 形成可修改的视频工程与成片。

首版能力：独立任务工程、制作执行与记录、反馈修改及变体。
用户于 2026-10-17 明确要求先做平台，不等待素材和视频 API。当前交付任务准备工作台，不把需求复制描述为素材复用或视频变体生成。
本轮不做：完整账号后台、自动发布、投放、热点发现、分布式集群。
第一条完整链路：参考和商品 Brief → Pi 分析与改编 → Hypit 工程检查及 Build → 预览审核 → 一次修改 → 一个变体 → 交付归档。

## 执行顺序及模块

1. scripts/doctor.mjs：本地环境、CLI、RPC 和 Skill 发现验证。
2. packages/hypit-adapter：依据实际 CLI JSON 定义检查、构建、查询契约；验证后再实现。
3. workers/agent：会话事件、任务工程、超时与退出；先比较 RPC 与 SDK 的实际适配需要。
4. 最小制作样例：真实输入、工程、修改、变体及产物证据。
5. P0 达标后再确定 apps/api 和 apps/web 的 MVP 切片。

## 契约与边界

- doctor 配置：piCli、hypitRoot、tempRoot 均为绝对路径；无密钥。
- doctor 只启动 CLI 与无工具 RPC，读取 get_commands；不发送模型 prompt，不提交 Build。
- 输出 JSON 包括时间、版本、检查状态和报告位置；失败返回非零退出码。
- 每次检查创建独立临时目录和 Pi 配置目录。目录隔离不是操作系统安全沙箱。
- 后续 ProductionJob 与 AgentRun、Hypit Build 分开追踪；Agent 声称完成不能作为交付状态。
- 不自动重试付费提交；实际费用未知时不能记为零。

### 当前纵向切片（2026-10-17）

以本地 CLI 先验证数据与执行接口，不提前扩展运营后台。
`create brief.json` 创建 job_<UUID>，保存字段 title/account/product/language/requirements/technicalSample/references。
`show <id>` 重新读取持久化任务、Brief 与检查记录。
`check <id> <相对路径>` 与 `plan <id> <相对路径>` 调用真实 Hypit JSON 接口，保存退出码、诊断、时间、入口文件哈希及成功状态。
支持 hypit.cli-check@1、hypit.cli-plan@1 和 hypit.cli-error@1；未知协议按失败处理。
无自动重试；子进程默认 30 秒超时，输出上限 2 MiB。此处仅约束 check/plan 直接子进程，不是完整 Build 取消机制。
每次记录采用不同 UUID，写临时文件再原子更名；检查过程不改写任务的 draft 状态。
哈希只覆盖入口，不代表导入依赖已冻结。工程与本机包仍须可信，目录检查不提供多租户隔离。

- AC-06：任务创建后可从磁盘重新读取，任务目录独立且标记技术样例。
- AC-07：真实 Author/Run 检查及 plan 通过；错误工程返回失败并保存诊断。
- AC-08：拒绝非法任务 ID、越界入口、未知协议、坏 JSON；超时与超量输出不能误报成功。

## 本地 Web MVP

技术：Node 原生 HTTP + HTML/CSS/JavaScript，无新增依赖；沿用文件持久化。
入口 apps/api/server.mjs；页面 apps/web；业务 packages/jobs。
只绑定 127.0.0.1，Host/Origin 验证和 JSON 请求限制，限制请求 64 KiB。可信单人本机使用，无远程用户鉴权。
GET /api/jobs 列表；POST /api/jobs 创建；GET /api/jobs/:id 详情；PUT /api/jobs/:id/brief 保存；POST /api/jobs/:id/duplicate 复制已保存需求；POST /api/jobs/:id/inspect 检查；GET /api/services 返回服务状态。
保存使用 brief 内容哈希作 revision；并行写入串行化，过期 revision 返回 409，避免两个窗口静默覆盖。CLI 与其他进程直接写文件不受此锁保护。
变体只复制已保存需求，分配独立工程目录，不复制生成资产或检查历史。
- AC-09：浏览器无素材、API 可创建任务、编辑保存、复制变体，刷新与服务重启后数据仍在。
- AC-10：列表搜索、筛选和空状态可用；服务页真实标记未配置，生成不可用。
- AC-11：旧版本保存返回 409，跨站请求与非法 Host 被拒绝；手机与桌面布局可用。

## 验收

- AC-01：真实本地 Pi/Hypit 可启动并返回版本。
- AC-02：真实 Pi RPC 返回 skill:hypit；退出成功；保存可核对报告。
- AC-03：真实参考改编成片，保留输入、工程、Build ID 与输出。
- AC-04：同一任务完成一次反馈修改和一个账号变体，明确复用内容。
- AC-05：验证失败、取消、恢复及重复提交边界；费用记录有来源。

## 真实风险与待定项

模型供应商与预算、参考视频、商品事实、目标语言和验收人待明确。
CLI 可启动不代表 Runtime、渲染或模型调用可用。
Windows 子进程、资源复用、取消后费用与商用许可需要专项核验。
本轮在本地 Windows 工作站验证，后续部署方式未锁定。


## 2026-10-17 核心集成更新

锁定 Pi 1.1.0 / Hypit 0.2.13，Skill 随库保存。新增任务绑定 Pi RPC、工程工具、持久记录、停止及中断恢复。9 项测试通过，包含真实无模型 Pi 接入。模型编写与视频生成未验收；无 Build 入口，尚不是完整视频交付版本。安装及许可边界以 README 为准。
