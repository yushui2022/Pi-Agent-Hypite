# 2026-10-20 首次真实部署

- 部署于 <https://pi-studio-saas.xiaoyushui2022.workers.dev>：`wrangler deploy` 成功，D1 `pi-studio`（APAC，6 张表已建）、R2 `pi-media-test`（CORS 规则已写入并回读确认）、两个 R2 secret 已上传。
- `npm run smoke:deployed`：5/5 通过，针对线上地址 —— 健康检查与首页可用；注册拿到 `pi_saas_session`；创建项目；**申请上传 → 用签名 URL 直传真实 R2 → 确认 → 素材登记**（项目内出现 1 个素材且哈希与上传一致）；素材鉴权读取字节一致，匿名读取 401。
- **部署后发现的高危缺陷**：Workers 的 PBKDF2 迭代上限为 100,000，原实现用 210,000，注册在生产直接 500。本地 workerd 版本较旧，未实现该限制，因此 18 项会话测试全绿也没能拦住。已降至 100,000 并注明平台原因；本地 `verify:session` 18/18、`verify:worker-api` 10/10 复跑通过后重新部署并跑通冒烟。
- 同时给请求 catch 增加服务端日志（路径、状态、错误信息），只写日志不回给客户端——否则这类 500 在生产里无法定位。
- 未验证：浏览器内的直传（CORS 预检、100 MB 大文件、断网重试）。冒烟测试的 PUT 来自 Node，不经过 CORS。

# 2026-10-20 生产 Worker 入口验证

- `npm run verify:worker-api`：10/10 通过。脚本用 esbuild 打包**真实生产入口** `apps/saas-worker/src/index.ts`，在本地 workerd 启动，不是专用测试桩。
- 覆盖：类型检查与打包（产物不含 Node 存储、vendor、Pi CLI 或 Hypit）；`/healthz`；未登录 401；注册返回与本地后端同形状的用户并下发 `pi_saas_session`；跨 Origin 写请求 403；项目创建/列表/详情；上传授权返回签名 URL 且键带本项目前缀；**确认前项目里没有素材，确认后才登记**；素材鉴权读取且字节哈希一致、匿名 401；保存方案与检查可用且 `execute` 仍 409；另一空间看不到该项目、也不能替它申请上传。
- 回归：`verify:session` 18/18、`verify:migration` 9/9、`verify:r2` 5/5（真实 R2 桶）、`npm test` 51/51。
- 修复：生产入口曾导出 `SESSION_COOKIE_NAME` 常量，workerd 把每个导出当处理器，启动即失败；已移除。
- 未验证：真实部署、浏览器中的直传（CORS 预检、100 MB 大文件、断网重试）。前端只做了 `node --check` 与 `npm run saas:build`。


# 2026-10-20 真实 R2 验收（首个离开本机的验证）

- `npm run verify:r2`：5/5 通过，针对真实 Cloudflare R2 桶，非本地模拟。
- 预签名 PUT 返回 200，对象写入成功；预签名 GET 取回字节数与 SHA-256 均与上传一致。
- 用错误校验和签名后上传同内容，R2 返回 4xx 拒绝 —— 强制校验和（`x-amz-checksum-sha256` 参与签名）在真实服务端成立。
- 预签名 DELETE 返回 204，随后 GET 为 404，桶内无残留探针对象。
- 凭证来源为本机 `.env`（git 忽略），脚本只打印掩码；报告中不含密钥。报告：`G:/DevCache/Temp/pi-agent-hypite/r2-acceptance/report-*.json`。
- 这解除了此前"签名 URL 是否被 R2 接受"的未验证项。仍未验证/未完成：Worker 入口部署、D1 上云、真实素材上传 100 MB 级并发、费用计量。
- 提醒：本轮使用的令牌曾在对话截图中出现，应按凭证泄露处理并轮换。


# 2026-10-20 R2 直传授权与完成确认验证

- `npm run verify:session`：18/18 通过（新增 7 项上传检查）；`workers:storage:test` 12/12、`npm test` 51/51 未回归；`tsc -p experiments/workers-storage/tsconfig.json` 通过。
- 申请上传返回的键以 `workspaces/<本空间>/projects/<项目>/assets/asset_` 开头；URL 指向 S3 端点且签名头为 `host;x-amz-checksum-sha256`，校验和以 base64 出现在必须发送的头里。
- 拒绝路径：超过 100 MB → 413；类型不在白名单 → 415；校验和非 64 位十六进制 → 400；他人项目的 projectId → 404（在签发 URL 之前拦下）。
- 未上传就确认 → 409 且申请转为 `failed`；对象校验和与申请不一致 → 422 且对象被删除；一致 → 200 并返回真实哈希与大小，对象保留，重复确认 → 409。
- 其他空间用同一 uploadId 确认 → 404（按空间作用域查询，等同不存在）；过期申请确认 → 409。
- 修正：R2 的原生校验和是 ArrayBuffer（见 `r2.ts`），初版按字符串比较会永远失败，已改为十六进制。
- **未验证**：签名 URL 被真实 R2 接受、真实网络下的中断与重试、真实费用。未连接云账号，未上传任何对象。


# 2026-10-20 R2 直传签名验证

- `npm test`：51/51 通过（新增 7 项 SigV4 测试）；`tsc -p experiments/workers-storage/tsconfig.json` 通过。
- 与独立实现（`test/sigv4.test.mjs` 内用 node:crypto 按规范另写一份）在 7 组输入上逐字节一致：普通键、含空格与中文的键、短有效期、带会话令牌、GET、单附加头、双附加头。
- 断言 payload 恒为 `UNSIGNED-PAYLOAD`，规范化请求不覆盖自身签名；附加头参与 `X-Amz-SignedHeaders` 且拒绝覆盖 `host` 与 `X-Amz-Signature`。
- 边界：有效期 1 秒–7 天、带路径端点、绝对键、非法桶名均被拒绝；同一时刻签名确定，时间变化则签名变化。
- **未验证**：签出的 URL 是否被 R2 接受。本地 workerd 只提供 R2 binding，没有 S3 端点，此项必须由真实桶验收。
- 未连接云账号，未上传任何对象，无费用。

# 2026-10-20 Worker 账号与会话验证

- `npm run verify:session`：11/11 通过（本地 workerd）。TypeScript 与纯 Worker 构建通过；未配置测试标记时入口返回 503。
- 注册在同一批次建立用户、空间、成员与会话，各表计数为 1；Cookie 带 `HttpOnly`、`SameSite=Strict`、`Path=/`、正 `Max-Age`，并在 https 下带 `Secure`、http 下不带。
- 身份只来自服务端会话：`/api/session` 返回的空间与 `sessions` 表记录一致；密码以 `pbkdf2-sha256$210000$<salt>$<hash>` 存储。
- 错误密码与不存在的账号返回完全相同的响应，不泄露账号是否存在；重复邮箱注册 409 且不新增用户。
- 登出后该会话记录被删除、其余设备会话不受影响；伪造令牌与过期令牌均 401。
- **本地 scrypt 哈希在 Worker 内被明确拒绝**（`code: password-reset-required`），不当作密码错误。这是 Workers 无 scrypt 的必然结果。
- 两空间互不可见：乙在自己空间写入项目后，甲的列表为空且 workspaceId 不同。
- 回归：`workers:storage:test` 12/12、`npm test` 44/44。
- 未连接 Cloudflare 账号，未部署，无费用。报告：`G:/DevCache/Temp/pi-agent-hypite/worker-session/run-*/report.json`。

# 2026-10-20 Cloudflare 上线准备验证

- `npm run verify:migration`：9/9 通过。本地构造与 SaaS 服务器相同的 SQLite DDL 和 `media/<空间>/.remix/<项目>/<素材>` 布局，迁移后灌入本地 workerd 的 D1 与 R2，逐项比对。
- 覆盖的 9 项：夹具结构与服务器一致；迁移核对每个素材大小与 SHA-256（4/4）；过期会话不迁移、有效会话保留；R2 清单键带空间前缀且哈希等于真实字节；素材缺失时迁移拒绝通过并定位到项目；超过 D1 单项目 1.5 MiB 的工程被报告且不写入 `data.sql`；完整 schema 在 D1 建成 5 张表；迁移后行数、项目文档逐字一致与版本哈希一致；R2 写入后取回字节与清单哈希一致。
- 真实本地数据演练：`node scripts/migrate-to-d1.mjs` 对现有 `.data/saas`（2 用户 / 2 空间 / 1 项目）迁移 `ok: true`，2/2 素材按大小与 SHA-256 核对通过，产出 2 个 R2 键。
- 该演练暴露并修复了一个真实缺陷：素材实际布局是 `<dataRoot>/media/<workspaceId>/.remix/<projectId>/<assetId>`（`apps/saas-api/server.mjs` 为每个空间单独建 remix 根），初版按 `<dataRoot>/.remix` 查找会误报缺失。夹具与迁移路径现已按真实布局对齐。

- `npm run workers:storage:test`：12/12 仍通过（schema 扩展后无回归）；`npm test`：44/44 通过。
- 未连接任何 Cloudflare 账号，未部署，无费用。产物与报告：`G:/DevCache/Temp/pi-agent-hypite/d1-migration/run-*`（`report.json`、`export/data.sql`、`export/r2-manifest.json`）。
- 仍未验证：Worker 侧正式会话/登录接口、R2 直传与完成确认、跨服务失败对账、云端真实应用与配额。

# 2026-10-20 A 路线核实验证

- `hypit check` 与 `hypit plan` 在本机对官方换商品、换人工程真实通过（`ok: true`），未提交任何生成。
- `node experiments/remix-a/inventory.mjs vendor/hypit/examples/podcast swap-item.svrun`：32 个计划步骤，13 次付费模型调用（9 次 `@hypit/gpt-image@1#gpt-image-2`、4 次 `@hypit/seedance@1#seedance-2-mini`），其余为本地媒体操作（inspect/normalize/mux）、`whisperx-alignment` 3 次与 `render-hyperframes` 1 次。
- 同一工具对 `vendor/hypit/examples/interview` 的 `swap-host.svrun`：29 步，10 次付费调用（7 图 + 3 视频）。
- 源码核对：`examples/podcast/swap-item.svml` 使用 `seedance:ReferenceVideo` 且每个图片参考显式声明 `person-reference="true"`；`packages/seedance/README.md` 要求该字段必填，为 A 路线的原生支持证据。`packages/volcengine-matting/README.md` 描述为"去除动态人像背景，把剪影放到另一张图上"，与 B 方向相反。
- `inventory.mjs` 的能力归类是启发式按包名匹配，未识别项以 `other` 原样保留，未做猜测性归并。
- 未验证：真实爆款视频分析、真实生成、生成结果与原作在节奏/构图/文字上的一致性、音色与口型。未执行 `build`，无费用，无用户数据改动。

# 2026-10-20 工程映射层验证

- `npm test`：44/44 通过（新增 8 项映射测试）；`npm --prefix experiments/workers-p0 run check`：TypeScript 检查通过。
- 有效方案：完整替换表（3×5 秒、字幕对齐镜头、配音/音乐/字体显式声明）产出 `pi-studio.p0-project@1`，并被真实 `compileProject` 编译为 normalize-1/2/3 + final 四步；上传清单为 6 个固定名称。相同输入两次得到相同 `key`，改动一个字幕即改变 `key`。
- 拒绝路径（plan 级，不产出工程）：画面空档、字幕区间未与镜头边界对齐、未声明配音角色、音频项素材未声明角色、已声明角色在替换表中缺失、时间未对齐 25 fps、素材缺失、未声明字体。
- 能力缺口（capability 级，保留工程但 `engine` 为空）：2 镜头不等长 → `engine.shot-count` + `engine.shot-duration`；图片作主画面 → `engine.source-format`；音频被裁剪到片段区间 → `engine.audio-trim`；某镜头无字幕 → `engine.caption-required`。
- 映射常量与 `packages/remix/preparation.mjs` 的 `preparationProfile` 逐字段比对，防止两处规则漂移。
- 本轮为纯函数验证，**未执行任何媒体编码**，未调用模型，未改动用户数据；`execute` 仍返回 409。云端 P0 关口结论不变。

# 2026-10-20 本地制作执行桥接

- `npm test`：36/36；`npm --prefix experiments/workers-p0 run check` 通过。
- `npm run workers:execution:test`：真实本地 workerd 重启续跑、重复提交复用、修改单镜头局部重做通过；最终 MP4 15 秒/375 帧/720×1280/H.264/AAC，通过全片解码、字幕像素、混音及时间戳检查。
- 证据 `G:/DevCache/Temp/pi-agent-hypite/workers-p0/execution-1792479901724`，包含 plan、revised-plan、journal、各步骤 report、artifact-manifest、verification 与 final.mp4。失败首轮保留并说明于 [执行报告](local-execution-core.md)。
- 使用技术合成素材与固定音频，不调用外部模型。未部署云端、未接入正式网页、未验证生产多租户执行/付费重试；没有把测试通过标记为 AI 复刻成功。

# 2026-10-19 Worker 存储基础验证

- `npm test`：33/33 通过；`npm run saas:build` 通过；`git diff --check` 通过。新增本地 JSON/SQLite 并发覆盖保护、旧 revision 兼容、跨空间写入拒绝及上传元数据保存失败后重试验证。
- `npm run workers:storage:test`：12/12 本地 workerd 检查通过，包含 TypeScript 检查与纯浏览器平台打包；产物不含 Node 存储、vendor/Pi CLI 或 Hypit。
- 通过真实本地 D1/R2 Binding 验证并发创建/编辑/素材登记、请求幂等、两空间隔离、只读检查、旧批次复制、文件校验与范围流、重启恢复、文档 413 及原子数量配额。传输样本为合成微型夹具，不代表视频解码或播放通过。
- 报告：G:/DevCache/Temp/pi-agent-hypite/workers-storage/run-hqF8RX/report.json；代码内 [结果摘要](../experiments/workers-storage/evidence/local-2026-10-19.json)。所有构建与实验状态在 G 盘独立目录，未修改正常账号/项目数据。
- 云端和真实模型未验收。实验固定身份不是真实认证，R2 直传/上传完成记录/配额/迁移脚本未实现，仍不开放制作。详细边界见 [实施说明](worker-storage-foundation.md)。

# 2026-10-19 本地创作准备完善验证

- 最终 `npm test` 30/30、`npm run saas:build` 通过。新增规则、快照复制、幂等/版本冲突、历史记录保留、越权检查、原 ID 素材修复的验证。
- 4321 隔离 SaaS：真实网页定位超 15 秒错误、修改保存、草稿阻止、复查、下载 JSON；复制旧批次并保存三份不同文案。API 再读取确认原批次逐字段不变、来源快照正确、产物为空。
- 对隔离合成图片截断后，经文件选择/分片上传实际恢复；素材 ID/数量和所有快照引用不变。自动测试另覆盖缺失和同大小损坏。
- 1440/390/320 px 双主题批次检查无横向溢出，320 px 编辑保存通过，已看截图。检查期间未观察到页面脚本异常；匿名 401 与显式 503 网络夹具为预期记录，503 后重试恢复。
- 证据：G:/DevCache/Temp/pi-agent-hypite/preparation-qa；含下载报告、browser-save-verification.json、截图和独立测试库。详细边界见 [本地准备完善](local-preparation-upgrade.md)。没有写入正常用户项目或调用付费服务。
- 检查不包含真实媒体解码与生成；哈希登记值不当作已验证。旧媒体 P0 基准未改动，本轮不重复运行耗时编码实验；云端关口未通过。

# 2026-10-19 升级版提交前验证

主项目 `npm test` 25/25 和 `npm run saas:build` 重新运行通过；本次提交同时包含此前前端布局/文案升级和 Workers P0 代码。P0 的 4 项专项测试、20 轮连续制作、输入矩阵及打包结果见下方记录，本次未重复耗时媒体基准。提交范围已检查，源码/配置/依赖锁/报告纳入版本管理，密钥、用户素材、数据库、依赖目录、构建缓存和大媒体产物保持排除。P0 目录固定 LF 换行，避免 Windows 检出后破坏 WSL 构建脚本。

# 2026-10-19 Workers P0 本地完善验证

- 固定源码构建精简 FFmpeg Wasm 成功，5,161,617 字节，比首轮发布核心缩小约 84%。二进制解析确认 32 MiB 初始、96 MiB 最大、非共享线性内存；实际 workerd 运行另行验收。
- 最终连续 20/20 轮、100 个媒体操作通过，固定基准成片均为 7,395,979 字节且哈希相同。输入矩阵另行通过 12 个视频用例和 5 个字幕/起点用例，归一化三镜头样片为 15.000000 秒、375 帧、720×1280/25fps H.264/AAC，字幕实际烧录，双音源/接缝/淡入淡出和全片解码检查通过。
- TypeScript、4/4 专项测试、媒体 dry-run 通过；Pi 独立 dry-run 本轮此前通过。Pi 使用真实核心和显式模拟 HTTP 模型响应，不能等同真实模型验收。既有工作台应用测试本轮未重复运行。
- 矩阵最高 Wasm 堆 66.5 MiB，已知堆和缓冲合计最高 81,681,764 字节（约 77.9 MiB）；均非整个 isolate 峰值。云端 CPU、费用与总内存仍未知。
- 修复大字体逐字重复加载、下载整文件缓冲和本机校验器线程占用；早期中断基准保留为失败，最后从头完成连续测试。没有修改正常用户数据。
- [详细报告](workers-p0-refinement.md)、[机器证据](../experiments/workers-p0/evidence/refinement-2026-10-19.json)。归档：G:/Projects/Pi-Agent-Hypite/output/workers-p0/2026-10-19-refinement；连续基准：local-1792390693299；矩阵：matrix-1792390360679，均位于 G:/DevCache/Temp/pi-agent-hypite/workers-p0。

P0 云端关口仍未通过；未部署、未调用付费模型、未开放用户制作。实验 8 MiB 文件上限不能代替规划的 100 MB 上传能力。

# 历史首轮：2026-10-19 Workers P0 验证边界

本轮新增独立实验，不以 Node 原生 FFmpeg 产生的输入样本冒充 Worker 输出。实际编码、字幕和混音由本机 workerd 内的 Wasm 完成；原生 FFmpeg 仅生成输入并检查产物。

- 连续 20 轮本地媒体流水线通过：720×1280、25 fps、375 帧，H.264/AAC，15.021016 秒（误差小于一帧），字幕区域像素、可解码、单调时间戳和两个音源/接缝/淡入淡出检查通过。最终文件 7,395,979 字节，20 轮 SHA-256 一致。已人工查看中文字幕输出帧。
- 新增 3 项 workerd 集成测试通过，覆盖 Pi 工具 schema、未注册工具、越权素材、新实例恢复、不重复执行、未知结果阻断，以及媒体鉴权、过大输入/坏 JSON、禁用云端转换和真实 Wasm 初始化。模型返回为显式 fixture，未验证真实模型。
- TypeScript 检查、两个 Worker 的 Wrangler dry-run 通过；未部署。Pi 打包不含媒体 Wasm 或 Hypit；媒体包含预编译 Wasm，不使用浏览器 Worker。
- 原工作台 25/25 测试与 SaaS 静态构建通过。前端原有未提交修改保留，本轮没有继续重做界面。
- 修复实测发现的 AAC 拼接时间戳回退；最终视频复制拼接、连续音频编码。libass 出现编码成功但未显示字幕，改固定 drawtext 烧录；新增字幕像素检查能拒绝此前失败样片。
- 最大 Wasm 堆 46.125 MiB；已追踪堆和输入/输出缓冲合计最高约 59.01 MiB。均不是总 isolate 峰值，未验证云端 128 MiB/CPU 限额。CPU、费用未知，不记为零。
- [机器可读证据](../experiments/workers-p0/evidence/local-2026-10-19.json)、[P0 报告](workers-p0-report.md)。样片在 G:/Projects/Pi-Agent-Hypite/output/workers-p0/2026-10-19；详细实验在 G:/DevCache/Temp/pi-agent-hypite/workers-p0。

P0 尚未通过云端关口。用户选择云端账号和预算稍后补；精简源码构建、Cloudflare Media Transformations、真实云端渲染与 20 次资源验收、真实配音/模型及商品复刻质量仍未完成。

# 2026-10-18 前端布局与交互升级

- `npm test`：25/25 通过；`npm run saas:build` 通过；改动 JS 语法检查通过。
- 使用 4321 隔离服务和独立测试库，真实导入 WebM/PNG、保存文案替换及两版本批次；未写入正常 4320 用户资料。
- 项目卡片/列表切换、返回保留查询和视图、14 项目的 12/2 分页、阶段筛选、无结果重置、素材类型/用途筛选、任务汇总通过。503 和延迟响应使用浏览器网络夹具，验证错误重试及骨架加载，不代表真实服务故障恢复。
- 首页缺参考校验、不支持文件保留原选择、移除后焦点恢复、快捷要求去重、场景替换时的草稿保护通过。手机导航支持关闭、Escape、继续编辑/丢弃草稿，桌面收起偏好刷新后保留。
- 首页双主题 320/390/768/1024/1440px，项目/素材/任务/方案/成品页双主题 320/1440px，无横向溢出；空白首页主按钮底部约 615px（手机）/531px（1440px）。已查看实际截图，不仅依据尺寸断言。
- 主按钮、辅助说明和快捷按钮实际计算颜色的 8 组抽样对比度最低 5.70:1；键盘焦点 2px、减少动效设置生效。此为抽样检查，不宣称全站无障碍认证。
- 本轮页面操作未观察到 pageerror；修正手机外观标签换行。截图等待主题过渡及场景图片加载后采集，避免把过渡画面作为最终外观。
- 证据：`G:/DevCache/Temp/pi-agent-hypite/frontend-refinement/evidence`；详细变更与限制见 [frontend-refinement.md](frontend-refinement.md)。没有执行模型调用或生成视频，真实制作仍未验收。

# 前端文案精简验证（2026-10-18）

本轮为展示文字与失效样式清理，没有改变制作能力。node --check 覆盖 home/app/workspace/remix；npm run saas:build 与 git diff --check 通过。未新增与文案绑定的测试。

隔离 4321 实测：空参考阻止提交、场景预填、未保存保留、流程展开、本地视频预览、注册续接导入、保存替换方案与一个批次、计划展开和成品空状态。项目/素材/任务/成品/场景页及图片/智能体旧入口的文案均检查；批次页仅一处生成暂未开放说明。1440/390px 深浅主题无水平溢出，主按钮可见，pageerror 为 0。

证据：G:/DevCache/Temp/pi-agent-hypite/copy-polish/evidence。测试素材为既有合成 WebM，未改动正常用户资料。

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
