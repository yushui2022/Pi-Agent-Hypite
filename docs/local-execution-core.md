# 本地制作执行桥接（2026-10-20）

## 目标与范围

补齐独立 P0 的“结构化工程 → 媒体操作 → 持久记录 → 失败续跑 → 产物核验”链路。使用已有片段，不调用视频供应商，不代表 AI 参考理解或正式 SaaS 制作完成。Cloudflare P0 关口保持未通过。

实现位于 `experiments/workers-p0/src/execution.ts`；实验驱动位于 `experiments/workers-p0/scripts/execution-check.mjs`。新逻辑采用 TypeScript、Web Crypto 与注入式存储/执行接口，不依赖 Node 或 Hypit。实验驱动仍使用 Node 在本机组织验证，媒体操作在真实本地 workerd 中执行。

## 当前契约

- `pi-studio.p0-project@1` 仅支持三个顺序镜头，每镜头固定五秒，主画面素材必须按 slot 明确引用。输出固定 720×1280、25 fps、硬切。
- 输入固定为三个 MP4、一条 voice.wav、一条 music.wav 和字体，六个输入均记录 SHA-256。字幕每镜头一段、最多两行，每行最多 15 字符。实际字符和字形由媒体 Worker 继续验证。
- 未声明的效果/字段、重复或缺少的输入、错帧起点在编译时拒绝。不是完整的生产 ProjectSpec，也不能直接执行当前网页的替换表。
- 编译输出四步依赖计划：三个 normalize 操作和一个 final。步骤键包含引擎版本、素材哈希、字幕和起点；final 包含镜头步骤键和两条音轨哈希。
- 输入由编译器复制；实验驱动保存 plan、revised-plan 和原始素材清单。实验使用独立 R2 状态目录，上传前后核对输入哈希。
- 执行器逐步保存 running/failed/complete 日志。恢复时重新读取并核验已归档文件的哈希和大小；全部步骤完成后仍必须通过视频检查，才写 complete。
- 缓存复用要求调用方保证素材冻结、执行串行及产物寻址正确。当前仅同一隔离实验内复用，没有跨任务缓存，也没有生产租户权限和分布式锁。

## 验证与运行

执行 `npm run workers:execution:test`。前置条件：P0 minimal 构建与已有合成 fixtures、原生 ffmpeg/ffprobe；默认所有新产物放在 G 盘缓存目录，不生成用户正式成品。

本轮成功证据：

`G:/DevCache/Temp/pi-agent-hypite/workers-p0/execution-1792479901724`

1. 第一镜头归档后人为中断，日志为 failed，保留第一步。
2. 销毁并重新启动 workerd，从磁盘读取日志，R2 保留；恢复仅调用 normalize-2、normalize-3、final。
3. 原计划重复执行，所有产物重新核验，媒体操作调用为零。
4. 修改第二镜头字幕，只调用 normalize-2、final；第一、第三镜头保持复用。
5. 最终文件：15.000 秒，375 帧，720×1280，H.264/AAC，7,654,196 字节；SHA-256 `0b146e214f8037b79a7adba87ccd70dddf7743482aab6fe2c1b39f9a48c4ac96`。
6. 原生校验器检查 Worker 输出：完整解码、时间戳、黑帧、三个镜头字幕像素、两音源比例、淡入淡出与接缝。字幕位置未做本轮人工视觉验收，声音是测试正弦波，不是真实配音。

`npm test`：36/36；P0 TypeScript 检查通过。专项单测验证非法工程拒绝、恢复、局部失效、无效产物和最终视频检查失败不能标完成。单测使用受控执行器；上面的媒体实验才是真实编码证据。

首次实验 `execution-1792479863917` 因原验收器要求的 report.json 未写入而失败；保持 failed，没有产生成功 manifest。补齐报告后完整重跑通过，未放宽视频检查。

## 尚未交付与下一步

尚未接入网页制作按钮、真实 Pi 分析、视频生成、分布式调度、多租户成品授权和云端验收。正式 execute 仍保持不可用。

网页方案到该契约的显式映射已在 2026-10-20 补齐，见 [工程映射层](single-user-closed-loop.md)：`experiments/workers-p0/src/remix-bridge.ts` 输出 `pi-studio.project@2` 并在可表达时直接产出本契约的 `pi-studio.p0-project@1`；音频角色与字体必须显式声明，画面空档、重叠、非帧边界一律拒绝，引擎表达不了的方案返回能力缺口清单而不是静默降级。

接下来接入鉴权异步任务及成品记录，并把 `engine-unsupported` 的缺口清单作为引擎扩展的排期依据。云端制作放行仍以既定 P0 实测为准。不得把本实验的重试安全性外推到付费生成 API。
