# Pi Studio · Pi Agent × Hypit

面向参考视频复刻与批量改编的 Web SaaS 项目。当前支持账号与私有空间、参考视频导入预览、替换素材与方案、多批次计划，以及深浅主题创作界面。实际视频生成、Pi/Hypit 的 SaaS 执行、支付和公网部署尚未完成。

Web 入口：Node.js 24+，运行 `npm ci` 后执行 `npm run saas:dev`，访问 http://127.0.0.1:4320 。前端在 `apps/saas-web`，API 在 `apps/saas-api`；静态构建为 `npm run saas:build`。部署配置见 [部署说明](deploy/saas/README.md)，当前能力与验证见 [进度](docs/progress.md) 和 [验收记录](docs/verification.md)。

保留本地工作台与桌面开发入口。两个上游完整源码已纳入 vendor/pi 和 vendor/hypit，可直接修改；本地工作台运行源码构建和 TypeScript 引擎，不依赖两个 npm 发布包。下方源码准备与引擎检查说明适用于这些本地入口。

源码结构、功能接通范围、修改入口和验证限制见 [源码融合说明](vendor/SOURCE-INTEGRATION.md)。

## 安装和启动

已新增「账号资料」和「批次管理」：可从 Excel 粘贴账号资料，按分组选择账号，为每个账号分配任务数量，审阅批次后确认建档，支持暂停/继续及重复请求保护。当前是批量需求建档，尚不生成视频。使用范围和 600 条任务验收见 [批量生产说明](docs/batch-production.md)。

桌面架构与阶段验收见 [实施规划](docs/desktop-roadmap.md)。P1a 开发宿主复用现有 UI，通过 Rust → stdio → Node 调用相同业务入口。完成下述源码依赖准备后，可运行 `npm run desktop:dev`；需要本机 Rust、对应的 Windows 链接工具链和 WebView2，尚不是独立安装包。`npm run desktop:smoke` 验证 Rust 桥接、真实 Pi 会话与 Hypit 检查，`npm run desktop:test` 验证 Windows 子进程树回收。

桌面开发数据放 `.data/desktop`，smoke 数据放 `.data/desktop-smoke`，与既有 Web 数据分开；P1a 请勿同时启动多个桌面实例。Cargo 构建/缓存和 WebView 缓存由启动脚本与开发配置放在 G 盘。React 迁移、独立安装包和 SQLite 尚在后续阶段。

原生桌面首轮验收已通过，范围与截图见 [桌面验收记录](docs/desktop-qa.md)。`npm run desktop:qa` 使用独立 `.data/desktop-qa` 数据，并仅为该进程开启本地 WebView2 调试端口 9431，方便 Playwright 复测；正常 `desktop:dev` 不开启调试端口。关闭窗口会检查未保存的需求；操作进行中先等待操作完成，再关闭。

需要 Node.js 24+。项目放在 G 盘，在项目目录执行：

```powershell
$env:npm_config_cache='G:\DevCache\npm'
$env:TEMP='G:\DevCache\Temp\pi-agent-hypite'
$env:TMP=$env:TEMP
New-Item -ItemType Directory -Force $env:TEMP
npm run source:setup
npm run doctor
npm start
```

打开 http://127.0.0.1:4317 。上游基线为 Pi 1.1.0、Hypit 0.2.13；版本只是可追溯起点，不限制修改。完整源码与许可证在 vendor 中，安装依赖与编译产物不会提交。首次安装需要网络，模型目录使用仓库快照，不调用生成 API。

配置按 APP_CONFIG、config.local.json、config.example.json 顺序选择。相对路径基于配置文件目录。默认任务在 .data/jobs、Pi 配置在 .data/pi、临时文件在 .cache。本机 config.local.json 沿用既有 G 盘数据，不纳入 Git。端口通过 PORT 指定。

## 修改引擎

修改 vendor/pi 中 TypeScript 后运行 `npm run source:build`，再重启工作台。Hypit 的 TypeScript 源码由 CLI 直接加载，修改后下次调用生效。`npm run pi` 打开源码构建的 Pi；`npm run hypit -- help` 访问完整 Hypit CLI。不要修改 node_modules。

## 使用

任务支持创建、编辑、复制、参考引用和导出。详情页“检查引擎接入”会启动真实 Pi、验证 Skill 和工具、记录会话 ID，不调用模型。

配置模型后，“准备工程”将当前已保存 Brief 和指令交给 Pi，允许读取 Skill、写入 Markdown/SVML/SVRun/SVS，执行 Hypit check/plan。此模式会产生模型费用，目前未验证真实模型调用。工程写入任务 project 目录，执行记录在 agent-runs，Pi 会话在 pi-sessions。当前通过文件系统查看工程文件。

会话可停止，异常中断不会自动重试。每次启动新会话，暂不续接旧上下文。会话结束、检查通过均不代表成片交付。未开放 Build、素材下载、视频生成或渲染。

## 模型配置

复制 config.example.json 为 config.local.json（已有配置时直接编辑，勿覆盖），填写 agent.provider 和 agent.model，使用 Pi 支持的真实供应商和模型 ID。通过供应商环境变量配置凭据，或运行 `npm run pi`，在 Pi 中使用 `/login`。此入口与服务共用独立 piHome。配置后重启工作台。

密钥不要写入 Brief、源码或 Git。“模型已配置”仅表示填写了模型信息，不代表认证成功。

## 验证与边界

```powershell
npm test
npm run doctor
npm run verify:integration
```

平台测试覆盖源码清单、本地源码运行路径、真实 Pi 无模型注册、停止、幂等、中断恢复、路径限制和 HTTP 工作流。集成验证调用真实 Hypit check/plan；报告在 output/integration-report.json。模型驱动编写及视频制作尚未验收。

只监听 127.0.0.1，没有远程用户认证、多租户或操作系统沙箱。Hypit 工程可导入包，只能使用可信本地工程。停止会话终止 Pi，正在运行的 Hypit 子检查可能持续到 30 秒超时。原始会话与日志可能含业务资料，不要公开数据目录。

Hypit 使用带附加条款的许可证。第三方商业提供、捆绑或多租户/SaaS 使用需核对并取得所需许可，不能按普通 Apache-2.0 推断；原文保存在 vendor/hypit/LICENSE。当前为本地集成开发版本，不宣称具备商业分发授权。
# SaaS 本地开发入口

新版创作门户无需先登录即可浏览。前端代码在 `apps/saas-web`，API 在 `apps/saas-api`；`npm run saas:build` 输出独立静态前端。Docker/Caddy 单机部署配置与边界见 [部署说明](deploy/saas/README.md)。当前未实际部署公网。

运行 `npm run saas:dev`，打开 http://127.0.0.1:4320 注册开发账号。支持私有项目、素材上传预览、替换方案与批次计划；尚未接通真实制作、支付或公网服务。实现和验证范围见 [SaaS 第一切片](docs/saas-foundation.md)。
