# Pi Agent × Hypit

本地视频工程工作台。已集成真实 Pi RPC、任务专属会话与 Hypit check/plan；视频生成、渲染和交付链路尚未完成。

## 安装和启动

需要 Node.js 24+。项目放在 G 盘，在项目目录执行：

```powershell
$env:npm_config_cache='G:\DevCache\npm'
$env:TEMP='G:\DevCache\Temp\pi-agent-hypite'
$env:TMP=$env:TEMP
New-Item -ItemType Directory -Force $env:TEMP
npm ci --no-audit --no-fund
npm run doctor
npm start
```

打开 http://127.0.0.1:4317 。锁定 Pi 1.1.0、Hypit 0.2.13，不需另外克隆两个仓库。完整 Hypit Skill 保存在 vendor/hypit，来源见 PROVENANCE.md。

配置按 APP_CONFIG、config.local.json、config.example.json 顺序选择。相对路径基于配置文件目录。默认任务在 .data/jobs、Pi 配置在 .data/pi、临时文件在 .cache。本机 config.local.json 沿用既有 G 盘数据，不纳入 Git。端口通过 PORT 指定。

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

测试覆盖真实 Pi 无模型注册、停止、幂等、中断恢复、路径限制和 HTTP 工作流。集成验证调用真实 Hypit check/plan；报告在 output/integration-report.json。模型驱动编写及视频制作尚未验收。

只监听 127.0.0.1，没有远程用户认证、多租户或操作系统沙箱。Hypit 工程可导入包，只能使用可信本地工程。停止会话终止 Pi，正在运行的 Hypit 子检查可能持续到 30 秒超时。原始会话与日志可能含业务资料，不要公开数据目录。

Hypit 使用带附加条款的许可证。第三方商业提供、捆绑或多租户/SaaS 使用需核对并取得所需许可，不能按普通 Apache-2.0 推断；原文保存在 vendor/hypit/LICENSE。当前为本地集成开发版本，不宣称具备商业分发授权。
