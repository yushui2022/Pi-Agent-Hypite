# 当前补充：2026-10-18 源码集成

本轮依据用户纠正：完整 Pi/Hypit 源码纳入 vendor，工作台运行本地源码；不再依赖两个 npm 发布包。后文此前记录为历史，不代表当前路径配置。详见 [源码融合说明](../vendor/SOURCE-INTEGRATION.md)。平台 12 项测试通过、Pi 运行包编译通过、Hypit 类型检查及真实 check/plan 通过。Pi 全仓检查也已通过；首次失败在使用匹配版本的模型元数据快照与完整安装后解决。完整视频生产尚未接通。

# 验证记录

最新前端升级验证见 [frontend-upgrade.md](frontend-upgrade.md)，包含 5 项回归测试、隔离浏览器操作、主题对比度及桌面/390px 截图。

## 任务导航增强

- `npm test`：7/7，通过新增筛选排序组合、源数组不变、无效恢复参数与路由约束测试。
- `node --check apps/web/app.js` 通过。
- 隔离 4318 浏览器：按名称排序并搜索“咖啡” → 打开任务 → 刷新仍为同一任务 → 返回列表仍保留排序与搜索。
- 修改语言后复制被阻止，原输入保留；改回原值后可直接离开，无误报弹窗。
- 清除筛选恢复全列表，结果计数正确；1280px 桌面截图 task-navigation.png。
- 正式 4317 列表仍读取 5 条原记录。本轮没有修改正式任务、调用生成服务或发布外部网站。
- 保存时表单 inert 与创建失败解锁已实现；未通过延迟注入专项测试慢网络输入竞争。hash 导航用于刷新定位，不宣称实现完整历史路由栈。

日期：2026-10-17（Asia/Shanghai）。

## 环境与代码快照

- Windows；Node v24.13.0；Pi 1.1.0。
- Hypit 0.2.13，源码提交 78d7436071bace1ee2bc9bf662d0b89cc3d84e2f。
- doctor.mjs SHA256：85E6E538F9860EEE675DA1522E3A09C41A01395F8392AFDD5804BFA455AEB274。
- 仓库暂无提交，以脚本哈希对应本次运行。

## 实际运行

命令：`npm run doctor`。
预期：工具返回版本，Pi RPC get_commands 包含 skill:hypit，正常退出并保存报告。
实际：退出码 0；command=skill:hypit；检查状态 passed。
报告：G:/DevCache/Temp/pi-agent-hypite/doctor-kS0wn2/report.json。

| 验收项 | 状态 | 证据/限制 |
| --- | --- | --- |
| AC-01 CLI 启动 | 通过 | 真实 Pi/Hypit 版本输出 |
| AC-02 Skill 加载 | 通过 | 真实 RPC 命令注册记录；未发送模型请求 |
| AC-03 参考改编 | 未验证 | 尚无参考素材与制作配置 |
| AC-04 修改和变体 | 未验证 | 尚无首版工程与成片 |
| AC-05 异常与费用 | 未验证 | 探针不涉及付费执行或 Build |

本次无 Mock。此证据仅证明进程启动及 Skill 发现，不证明模型遵循 Skill、成片质量、商业许可或批量吞吐。

## 本地任务与 Hypit 检查切片（20:52，Asia/Shanghai）

- `npm test`：4 项测试通过。任务持久化、不同任务目录、非法 ID 和越界路径为真实文件操作；协议错误、退出码、超时和输出上限使用受控假 CLI 进程，不能作为真实 Hypit 兼容性证据。
- `npm run verify:integration`：退出码 0，真实 Hypit Author check、Run check、plan 成功，plan 的 requestCount 为 0；错误工程返回 SOURCE_HEADER_MISSING，4 次检查记录可重新读取，任务仍为 draft。
- `npm run job -- show job_64cdb3ec-d561-4143-a363-d267ae9d91de`：独立 CLI 进程成功读取前一轮真实任务与全部检查记录。
- 最新集成任务：job_c4d01877-4647-42a2-b1db-ea7d1be4d246。
- 报告：output/integration-report.json，包含当前实现、CLI、测试和验证脚本的 SHA256 快照。
- AC-06/07/08 通过。AC-03/04/05 仍未验证。

首次集成的失败证据保存在 job_4517ee3c-5e40-45fe-bd66-c9ed202985cf：文本 Record 不能作为 Target，已修改为 text:Render 的逻辑输出后重跑。没有修改验收含义。
本轮仅文本工程；没有视频生成、模型调用、Build 提交、计费与生产隔离验证。

## Web 工作台验收（2026-10-17）

- `npm test`：5/5 通过。新增真实 HTTP 服务测试覆盖列表空数据、创建、编辑、过期 revision 409、独立复制、服务器重启后读取、非法输入及 Origin/Host 403。
- 浏览器：创建无素材任务，修改需求并保存，复制变体，刷新后仍有两条独立记录；服务重启后列表仍可读取。
- 浏览器：搜索不存在关键词展示空状态；制作需求筛选排除技术样例；服务页显示未配置；生成按钮禁用。
- 布局：默认窄屏（约 461 px）和 1440×960 桌面均实际查看；修复侧栏状态点被 flex 拉伸的问题。
- 交付截图：output/workspace-desktop.png。测试页面保留在本地工作台。
- AC-09/10/11 通过。需求 JSON 导出已实现，浏览器文件下载未专项验证。检查底层实跑证据见前述记录，本轮未重复视频生产验证。
- 版本证据：output/web-source-snapshot.json 记录本轮 Web 与任务代码的 SHA256。
- 未通过项历史：首次 Host 拒绝测试使用 fetch，Host 被客户端改写；改为原生 http.get 确认真正发送伪造 Host 后返回 403。未放宽断言。


## 2026-10-17 核心集成更新

锁定 Pi 1.1.0 / Hypit 0.2.13，Skill 随库保存。新增任务绑定 Pi RPC、工程工具、持久记录、停止及中断恢复。9 项测试通过，包含真实无模型 Pi 接入。模型编写与视频生成未验收；无 Build 入口，尚不是完整视频交付版本。安装及许可边界以 README 为准。

页面验收：本地任务 job_ccacd78f-0666-4e6f-8c30-ab9e23b7b815 点击接入检查成功，真实 Pi sessionId 为 01a14a8e-3f2b-758c-9ae4-fbf55745f70a。截图 output/agent-integration.png。Windows 并发读取时原子替换增加短暂重试；修复后重新执行 9 项测试全部通过。真实 Hypit main.svml/build.svrun 检查和 plan 通过，错误工程被拒绝。Doctor 报告：G:/DevCache/Temp/pi-agent-hypite/doctor-NpMX5T/report.json。
