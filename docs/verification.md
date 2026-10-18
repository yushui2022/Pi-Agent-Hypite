# 提交前完整回归（2026-10-18）

提交检查首次运行 npm test 为 24/25：Windows 下批量状态文件在轮询读取与原子替换重叠时出现 EPERM。批量管理器现对同一路径的读取与保存排队，保留外部短暂占用的有界重试。修复后批量专项 4/4、完整回归 25/25 和 npm run saas:build 均通过；包含 200 账号 × 3 条的 600 个真实任务、中断恢复及重复确认。未改为模拟通过，也未放宽原有断言。

待提交内容已检查常见凭据模式与文件范围；本地数据库、原始用户素材、密钥配置、依赖及构建产物不纳入 Git。前端使用的生成背景与场景 WebP 随源码提交。

# 当前补充：生成式背景 UI

- 内置 image_gen 生成深/浅两张 1536×1024 背景；转换为 WebP 共 70,602 字节。4320 两资源返回 200 image/webp，响应、源码与静态产物逐字节一致。图片作为装饰层，文字与控件仍为可访问 HTML。
- npm run saas:build 与 node --test test/saas.test.mjs 通过（2/2）。新增资源仍采用显式白名单；用户媒体鉴权未改变。
- 1920/1440/768/390/320px 深浅主题十组无水平溢出；桌面场景图片进入首屏。手机实际滚动检查图片可解码；完整截图前须等待 lazy 图片加载。
- 隔离 4321 实测空输入阻止、快捷要求去重、未保存继续编辑、有效视频本地预览（2.618 秒）、无效输入保留原参考、移除后焦点、拖放、注册后续接真实上传、键盘场景预填、流程展开及切换页面清除背景作用域。pageerror 为 0。
- 隔离项目 remix_5f2eca01-c357-4dc7-9f7c-46825a53c781，仅使用合成 WebM；没有向正常用户空间创建测试数据。证据在 G:/DevCache/Temp/pi-agent-hypite/background-ui/evidence，含正常 4320 截图、布局/交互/资源 JSON。
- 未验证真实视频制作、模型调用、付费、公网或容器部署。本轮未重新运行与展示无关的全部测试。

# 历史补充：UI 图片资源

4 张 1536×1024 原图通过内置 image_gen 生成；8 个 480/960 宽 WebP 的开发服务响应均为 200 image/webp，静态构建内容与源码逐字节一致。1440/768/390px 深浅主题无水平溢出，全部图片可加载；鼠标点击图片、键盘激活场景卡均带入正确要求，真实视频本地预览不受影响，pageerror 为 0。运行 npm run saas:build 与 node --test test/saas.test.mjs（2/2 通过）。证据位于 G:/DevCache/Temp/pi-agent-hypite/ui-images/evidence。此项是静态 UI 资产交付，不代表 SaaS 已接入用户生图/视频生成服务。

# 历史补充：前端工作区精修

25/25 自动测试通过，静态构建已同步 home.js、icons.js 和 favicon.svg。隔离 4321 实测视频拖放与本地播放、注册续接上传、参考/图片选择、方案保存、两版本批次和导出、未保存保护及错误重试。1440/768/390 首页双主题无水平溢出，390px 项目四标签页可访问；首页抽检对比度最低浅色 5.30:1 / 深色 6.75:1。修复后页面运行异常为 0。证据和边界见 [前端精修记录](frontend-polish.md)。

# 历史补充：产品模块与组件体系

- 自动测试 25/25：新增当前方案阶段、批次快照独立缺项、筛选后旧页码收敛；原有双用户鉴权和媒体/批次回归保持通过。
- 隔离浏览器：真实 WebM/PNG 上传，文字替换保存，1 批 2 版本；14 个合成项目分页（12+2）、长标题搜索、详情返回保留、无匹配清除、素材类型/用途组合与播放、任务筛选/定位、未保存保留/丢弃。
- 网络错误通过浏览器拦截 503 验证前端原位重试与筛选保留；此项不表示真实网络故障恢复已部署验证。
- 1440px 深/浅主题和 390px 长内容无水平溢出；账号弹窗关闭焦点返回 mobile-account；共享组件实际计算颜色对比度：深色最低 6.97:1、浅色最低 5.07:1（未覆盖整站全部像素）；pageerror 为 0。
- 基线/改造截图位于 G:/DevCache/Temp/pi-agent-hypite/design-system/evidence。组件展示入口 `/#components`，静态构建已更新新增文件白名单。未验证真实制作、公网部署或 Docker 容器。

# 历史补充：视频复刻主线

23/23 自动测试与 `npm run saas:build` 通过。隔离服务 4321 实测：未选文件阻止创建、PNG 误选拒绝、真实 WebM 经注册续接上传并自动设为参考、播放、保存文字替换、建立 1 批 2 版本、任务汇总和筛选、批次深链接。损坏 MP4 被文件内容校验拒绝，项目保留且素材数量为 0。390px 无水平溢出，成品库导航可见，pageerror 为 0。测试数据/截图位于 G:/DevCache/Temp/pi-agent-hypite/replica-focus。未生成实际成片。

# 历史补充：2026-10-18 创作门户与部署拆分

最终回归：`npm test` 23/23，通过；`npm run saas:build` 和 `docker compose ... config --quiet` 通过。正常服务 4320 已重启加载新版本。

新增部署模式测试覆盖独立 API、Host/Origin 校验、Secure Cookie、完整 brief 与幂等冲突。浏览器验证创意注册续接、视频上传播放/汇总、模板与未保存保护、移动退出和权限拦截；1440/768/390 布局检查，pageerror 为 0。静态构建和 Compose 解析通过。Docker 引擎未运行，容器构建、HTTPS 签发、公网部署未验证。详情见部署和前端 NOTES。

# 历史补充：2026-10-18 SaaS 私有空间

22/22 自动测试通过；浏览器验证注册、登录、上传播放、方案/批次保存刷新恢复、第二用户隔离和退出素材鉴权。细节与未验证边界见 [saas-foundation.md](saas-foundation.md)。尚无公网部署、支付、实际制作或并发生产负载验证。

# 历史补充：2026-10-18 复刻项目准备流程

21/21 自动测试通过；隔离 Web 实测素材导入播放、方案保存、两个批次恢复与 JSON 导出；原生 WebView2 实测动态视频播放和替换批次保存。详见 [remix-workflow.md](remix-workflow.md)。本次无实际视频替换生成、成片、付费调用或用户素材输入。

# 历史：2026-10-18 账号管理

20/20 自动测试通过；隔离 Web 验证 200 条导入、错误行修正预览、跨页 41 条批量修改、详情保存保护、返回上下文和关联批次；原生桌面验证导入 2 条、批量更新并重读市场字段。截图与限制见 [accounts-management.md](accounts-management.md)。没有视频生产、供应商调用或正式账号修改。

# 历史：2026-10-18 批量任务建档

`npm test` 18/18 通过，新增 4 项覆盖账号导入/去重/冲突/停用、200 账号 × 3 条真实建档、进度丢失恢复不覆盖用户修改、TSV 解析边界。实际 UI 验证 200 个账号导入、100 个账号生成 300 条任务并暂停/继续；实际桌面 IPC 创建 6 条任务。明细、批次 ID、截图与限制见 [batch-production.md](batch-production.md)。

“已建齐”仅表示需求与工程目录已创建，不表示媒体生成或交付。没有模型/视频 API 调用，也没有素材生成吞吐测试。

# 历史：2026-10-18 原生 WebView 验收

实际原生窗口交互已完成，详细输入、任务/会话 ID、截图、退出进程证据与范围见 [desktop-qa.md](desktop-qa.md)。复测 `npm test` 14/14，`npm run desktop:test` 1/1；重新构建的桌面程序验证 Esc 放弃后清空输入、原生关闭时保护草稿、操作进行中阻止关闭、重启后恢复需求与检查/会话记录。未使用模型/视频 API。

本条替代下方历史记录中“原生 WebView 未验证”的状态；独立安装包、强制崩溃全链路、原生导出及多实例仍未验收。

# 历史：2026-10-18 桌面 P1a

- `npm test`：14/14 通过，包含原 HTTP/任务/Pi 回归，以及 stdio 并发创建、错误输入、协议版本、帧上限、正常退出和重启持久化。
- `npm run desktop:check`：通过。Cargo.lock 锁定 Tauri 2.12.4；本机沿用现有 Windows GNU Rust 工具链，构建位于 G:/DevCache/CargoTarget，下载缓存 G:/DevCache/CargoHome。
- `npm run desktop:test`：1/1 通过。真实启动 Node 父进程及子进程，关闭 Windows Job Object 后等待并确认子进程终止、父进程回收；没有用模拟状态代替进程退出。
- `npm run desktop:smoke`：实际 Rust 可执行文件退出码 0。通过 stdio 创建/读取任务 `job_297d00b0-c2fb-43db-94cd-c6488d8a2189`，真实 Hypit `check main.svml` 成功；Pi 接入检查返回会话 `01a14abd-a72b-77f0-8183-7bed11ea83a5`。记录位于 `.data/desktop-smoke/jobs`，不写入原 Web 数据。
- 当前无模型配置，返回 `generation:false`、`modelConfigured:false`；本次没有调用付费模型/视频 API，没有验证视频 Build、渲染或生产交付。
- 明确未验证：原生 WebView 点击流程、窗口未保存拦截、宿主崩溃后的业务恢复全链路、自包含安装包、脱离源码目录运行和干净机器安装。Job Object 句柄释放测试仅证明操作系统进程回收，不等于完整崩溃恢复验收。

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
