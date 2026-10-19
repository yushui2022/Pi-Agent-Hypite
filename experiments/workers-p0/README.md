# Workers P0：媒体和 Pi 兼容性实验

此目录独立于现有 4320 工作台，不调用原有 Hypit、本地 Pi CLI 或用户项目。对应 [执行规划](../../docs/workers-execution-plan.md) 的 P0；不是已交付的 SaaS 制作入口。

用户已明确先完成本地实验，Cloudflare 账号和预算稍后补。**本地输出、模拟模型及部署 dry-run 都不能使云端 P0 通过。**

## 当前实现

新增本地完善入口：[精简源码构建](core/README.md)、[本地完善报告](../../docs/workers-p0-refinement.md)。`build:minimal` 显式选择源码核心，`matrix` 检查不同画幅/帧率/音轨及错误输入；`bench -- --remote https://测试域名/ ...` 可以使用同一 HTTP 契约进行后续云端测试。新增路径的验收与首轮通用核心基准分开记录。

- `src/media-core.ts`：直接实例化预编译的单线程 FFmpeg Wasm，不使用浏览器 Web Worker、子进程或容器。
- `src/media-worker.ts`：鉴权实验入口、受限合成输入、R2 读写、视频拼接、固定中文双行烧录、双音源混合和淡入淡出。画面按镜头编码，最终画面 remux，音频连续编码一次。
- `src/agent-worker.ts`：调用 vendor/pi 的真实 Agent 核心，显式解释型 schema 校验，白名单工具、素材范围校验、R2 检查点、重启后继续、已完成请求复用和未知结果拒绝重提。
- `src/model-transport.ts`：受限 HTTP 消息序列化/返回解析；本地测试使用模拟响应。公开入口禁用真实模型调用，真实供应商、用量和计费接入待验证。
- `scripts/verify-video.mjs`：用原生 FFmpeg/ffprobe **检查 Worker 输出**，检查规格、375 帧、可解码、时间戳、字幕区域像素、两个音源及接缝/淡入淡出；原生 FFmpeg 不用于产出被验收的成片。
- 基础 Media Transformations 的 R2 输入/输出代码已写入，但默认禁用，未做远程验证。

## 本地复现

要求 Node 24+、本地 FFmpeg/ffprobe、Python 及 fontTools（本次用现有 4.38.0）。Pi 源码基线及其 TypeBox 依赖须按仓库 source:setup 建好；类型检查使用 Pi 已有声明文件，Worker 打包使用源码。

在本目录运行，PowerShell：

```powershell
$env:npm_config_cache = 'G:\DevCache\npm'
$env:TEMP = 'G:\DevCache\Temp\pi-agent-hypite'
$env:TMP = $env:TEMP
npm ci
npm run prepare:font
npm run fixtures
npm run build
npm run check
npm test
npm run bench
npm run bench -- --repeat 20 concat render-1 render-2 render-3 final
```

仓库根目录另提供 workers:p0:build、workers:p0:test、workers:p0:bench。基准不访问真实模型或 Cloudflare。

生成物默认在 `G:/DevCache/Temp/pi-agent-hypite/workers-p0`，可用 P0_OUTPUT_DIR 覆盖。FFMPEG_PATH、FFPROBE_PATH、PYTHON_PATH 可指定工具。构建文件在本目录 dist；全部忽略提交。

`prepare:font` 下载并核对 OFL 授权的 Noto Sans SC，固定 400 字重，生成固定基准字形子集和 common-CJK 字体。源文件、许可证和哈希留在 G 盘。前者只适用于固定实验文案；归一化路径用后者，并检查实际字形覆盖。

每轮保存 report.json、各步 MP4、verification.json；整组保存 suite.json 和构建/素材 provenance.json。基准退出码非零表示失败，不应手工将其改为通过。

## 实验 API

所有路由需要 `Authorization: Bearer <P0_TOKEN>`，密钥至少 24 字符。不接受任意命令、滤镜或下载网址。

| 路由 | 用途 |
| --- | --- |
| GET /health | 查看实验标识，永远不会宣称云端关口已通过 |
| PUT /fixtures/{name} | 仅允许固定合成文件名，每个最多 8 MiB；不是用户上传接口 |
| POST /run | `{id, operation}`；version、concat、render-1/2/3、final；云端 frame/audio/transform 默认禁用 |
| POST /run：inspect | 检查 shot-1.mp4 编码、尺寸、时长、帧率；需要源码核心 |
| POST /run：normalize-1/2/3 | `{id, operation, caption?, startSeconds?}`；抽取五秒，等比缩放/补黑边为 720×1280/25fps，烧录字幕；输出为 render-1/2/3.mp4 |
| GET /artifacts/{id}/{name} | 鉴权下载固定产物名 |
| Pi POST /start、/resume | `{id, scenario}`；只允许模拟协议实验，检查点状态可恢复 |

实验只允许一个操作员顺序执行。进程内 busy 标记不提供跨 isolate 全局容量控制，R2 检查点也不是原子分布式锁；P4 需另建 Durable Object 容量/幂等控制，不能把这些实验路由暴露为多租户生产 API。

## 云端后续操作（尚未执行）

1. 确认测试账号、预算和计划权限，建立专用测试 R2 桶及密钥；不要复用生产素材桶。
2. 从 wrangler.media.jsonc 复制本地配置（如 wrangler.cloud.local.json），填真实桶和仅测试可达的路由/Access。P0_TOKEN 通过 Wrangler Secret 配置，不提交。
3. 初始先仅运行 Wasm。基础转换验证时再添加 `media: { binding: "MEDIA" }` 并设置 P0_ENABLE_MEDIA=true；本地远程 binding 还需 remote=true，可能产生用量，当前没有启用。
4. Pi 的部署配置默认为 disabled。真实模型需选定供应商/模型、凭证、价格和预算，再开放 live 入口及费用记录；模拟协议通过不能替代真实模型验证。
5. 在真实平台顺序重复 20 轮，下载并运行相同输出检查，关联 Workers 请求 ID、CPU/错误、总内存证据、R2/媒体账单。至少人工查看字幕、三个镜头和接缝，加入真实配音同步验证。
6. 完成 [最新 P0 报告](../../docs/workers-p0-refinement.md) 的剩余项，才允许开始 P1–P5 产品迁移。

dry-run 只打包到本地：

```powershell
npx --no-install wrangler deploy --dry-run --config wrangler.media.jsonc --outdir G:/DevCache/Temp/pi-agent-hypite/workers-p0/package-media
npx --no-install wrangler deploy --dry-run --config wrangler.agent.jsonc --outdir G:/DevCache/Temp/pi-agent-hypite/workers-p0/package-agent
```

## 资源与实现边界

默认 `build` 保留 `@ffmpeg/core@0.12.10` 的发布二进制作为首轮比较基准，内置 FFmpeg 5.1.4、Emscripten 3.1.40。`build:minimal` 需要先运行源码构建脚本，检查构建记录中的 JS/Wasm 哈希后才接入；不会缺失时静默使用通用版。两种核心都接受 Worker 预编译模块，Wasm 堆上限 96 MiB；编译、运行、云端验收分别记录。

heapFinal 是单次 Wasm 线性内存大小；trackedBytesAtArchive 加计已知 MEMFS 输入、输出容量和归档复制。两者均不是整个 isolate 峰值，排除了 JS/代码、R2 内部和临时缓冲。elapsedMs 是本机墙钟时间，不是云端 CPU 计费。没有云端资源报告时不能宣称满足 128 MiB 或 5 分钟 CPU 关口。

音频使用两个不同频率合成音，验证混音和接缝，不代表真人配音或口型同步。人工观看固定图案成片不代表商品视频质量。新增归一化路径的输入仍限 8 MiB、8-bit H.264 MP4、最长 60 秒/60fps/1920×1080 像素预算、无旋转元数据。镜头原音轨被丢弃，最终使用指定配音/音乐混音。它不是规划的 100 MB 用户上传功能。

可修改字幕使用独立 common-CJK 字体，最多两行，每行最多 15 个字符（含空格，拉丁宽字符也按全宽预留）；实际字形存在性由 FreeType 检查，不支持 Emoji、复杂排版或所有 Unicode。源码核心的输入矩阵测试通过后才能把对应组合列为已验证；取消、队列和生产费用核算仍未实现。

## 依赖和许可证

- Pi 1.1.0：仓库 vendor/pi 基线，MIT，保留 [原许可证](../../vendor/pi/LICENSE)。新 Worker 未引用 Hypit。
- TypeBox 1.3.27：Pi 已安装依赖，MIT；关闭动态 JIT，使用解释型校验。
- @ffmpeg/core 0.12.10：包声明 GPL-2.0-or-later，包含 libx264 等组件。发布核心前需完成完整对应源码/许可证清单及构建记录；当前二进制不入 Git，未作为商用成品发布。项目后续不能把这一核心误标为 MIT。
- Noto Sans SC：OFL-1.1，来源及固定哈希在 scripts/font.mjs；许可证保存在实验数据目录。
- 开发工具版本锁定在 package-lock.json；workerd 通过 Miniflare 在本机执行。

源码构建从默认禁用所有组件开始，按 `core/build-source.sh` 显式选择 codec/容器/滤镜，禁用 pthread/network/设备；实际启用清单以 release/config_components.h 为准。当前 PNG 解码因缺少 zlib 没有启用，MJPEG 解码已编入，但图片到视频流程没有验收。

## 后续云端基准驱动

取得测试账号与预算并部署私有实验 Worker 后，本机设置 `P0_TOKEN`，运行：

```powershell
npm run bench -- --remote https://你的专用测试域名/ --repeat 20 concat render-1 render-2 render-3 final
```

默认不进行任何远程调用。驱动拒绝携带凭证的 URL、重定向和未知核心哈希；不自动重试。每轮下载成片、核对哈希并做相同媒体检查，记录请求时间和可用的 CF-Ray；云端 CPU、完整内存、账单仍需平台侧数据。即使远程脚本通过，`cloudAccepted` 也不会自动改为 true。测试令牌不写进日志。
