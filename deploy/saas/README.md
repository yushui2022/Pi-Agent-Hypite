# Web + API 单机部署

本目录交付可部署代码与配置，尚未实际部署到服务器。当前范围是创作准备内测：账号、私有项目、媒体、替换方案和批次；不是开放收费的生成平台。

## 代码边界

| 模块 | 源码 | 部署产物/职责 |
| --- | --- | --- |
| Web 前端 | `apps/saas-web`；共享 `apps/web/remix.js`、`ui.js`、`style.css` | `npm run saas:build` 输出 `dist/saas-web`；不含密钥、数据库或引擎源码 |
| 服务端 API | `apps/saas-api`、`packages/saas`、`packages/remix` | Node 24，用户会话、权限、项目和媒体接口 |
| HTTPS 入口 | `Caddyfile`、`web.Dockerfile` | 静态文件和同域 `/api/*` 反向代理 |
| 持久化 | `studio_data` 命名卷 | `/data/saas.sqlite`、WAL 和 `/data/media` |
| 制作执行 | 既有 `vendor/pi`、`vendor/hypit`、`workers/agent` | 本次 API 镜像未包含/启动；未来独立 Worker 接入 |

前端源码仍采用原生 JS 模块，没有引入框架迁移。构建是白名单复制，不需要安装运行时 npm 依赖。API 也仅依赖 Node 内置模块。

## Linux 主机操作

要求 Docker Engine + Compose、一个解析到服务器的域名和可用的 80/443 端口。以下在仓库根目录执行：

```sh
cp deploy/saas/.env.example deploy/saas/.env
# 编辑 DOMAIN=你的域名，只填主机名，不带协议或路径
docker compose --env-file deploy/saas/.env -f deploy/saas/compose.yaml config --quiet
docker compose --env-file deploy/saas/.env -f deploy/saas/compose.yaml up -d --build
docker compose --env-file deploy/saas/.env -f deploy/saas/compose.yaml ps
docker compose --env-file deploy/saas/.env -f deploy/saas/compose.yaml logs --tail=100 api web
```

访问 `https://你的域名/`。Caddy 自动申请证书，浏览器与 API 同域；只发布 Web 的 80/443，不能再公开 API 的 4320。`SAAS_TRUST_PROXY=true` 仅用于这一拓扑：Caddy 覆盖 X-Real-IP 后转发，API 据此限流；不要在可以直连的 API 上启用。

容器 API 使用非 root 用户；数据卷与镜像分离。不要运行 `down -v`，否则会删除账号和素材。此实现仅允许一个 API 副本，不能基于共享 SQLite 卷横向扩容。

## 不使用 Docker

`npm run saas:build` 的文件可放到 Web 服务器静态目录。API 启动配置：`NODE_ENV=production`、`PUBLIC_ORIGIN=https://你的域名`、`SAAS_DATA_ROOT=独立持久目录`、`SAAS_SERVE_WEB=false`，然后 `node apps/saas-api/server.mjs`。默认只监听 127.0.0.1:4320，代理与 API 同机时保持此配置。代理需保留原始 Host；开启可信代理前必须限制 API 网络可达性并覆盖客户端 IP 头。

本地开发仍运行 `npm run saas:dev`，访问 http://127.0.0.1:4320。生产模式缺少 HTTPS PUBLIC_ORIGIN 会拒绝启动，不使用请求头自动猜测域名。

## 升级与备份

部署前记录 Git 提交与镜像 ID，并备份数据卷。备份时停止 API 写入，整体复制 `studio_data`（数据库、WAL 与媒体必须一致），完成后再启动 API；恢复到新的测试卷先验证账号、项目、媒体读取，不能只复制正在写入的 `.sqlite` 文件。升级只重建镜像，保留卷；数据库结构未来变更需单独迁移/回滚方案。

## 验证与上线边界

- 已验证：静态产物构建、Compose 配置解析；23 项自动测试中的 API 独立模式、HTTPS Cookie、域名与来源保护、双用户隔离、媒体权限及持久化。
- 尚未验证：Docker 镜像实际构建/启动、证书签发、服务器重启与卷恢复。本机 Docker CLI 存在，但引擎未启动，因此未声称容器实测通过。
- 公开商业上线前仍需：邮箱验证/找回、存储总配额与清理策略、服务监控/备份演练、PostgreSQL/对象存储、生成队列/真实产物、计费与运营配置。当前单文件限制不是租户总配额，不能无限开放上传注册。
- Hypit 托管许可未解决，当前部署包不提供其执行能力；Pi/Hypit 本地源码保留，不应因此误认为 SaaS 已接通生产链路。
- Windows 上如要构建 Docker 镜像，应先确认 Docker/WSL 虚拟磁盘位于 G 盘。本轮未启动引擎或下载基础镜像。

配置参考：[Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[Docker Compose services](https://docs.docker.com/reference/compose-file/services/)。
