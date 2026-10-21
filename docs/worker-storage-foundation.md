# Worker 存储基础升级

2026-10-19。本轮在没有 Cloudflare 账号的情况下推进可本地验证的迁移基础。实际交付是共享业务服务、存储适配器和独立 workerd 实验，不是完整云端 SaaS。

## 已实现

| 模块 | 变化与作用 |
| --- | --- |
| `packages/remix/service.mjs` | 从 Node 管理器提取创建、方案保存、批次快照/复制、准备检查和素材登记。原本地工作台与 Worker 实验使用同一份规则，业务模块不依赖文件系统、子进程或 Node SQLite。 |
| `packages/remix/revision.mjs` | 使用 Web Crypto 计算版本；紧凑 JSON 的 SHA-256 与旧版本一致，原 ID、方案、批次、指纹和 revision 不需要重写。 |
| `packages/remix/local-repository.mjs` | 本地 JSON 适配；同一进程不同管理器写入同一项目时串行比较版本并原子替换。多进程部署不使用此文件适配器。 |
| `packages/saas/store.mjs` | SQLite 项目存储接口异步化。新增仅创建/按版本更新，SQL 条件更新防止其他进程或请求覆盖已保存的版本；原账号、密码和会话保持现有存储。 |
| `packages/cloudflare-storage/d1.ts` | 真正使用 D1 Binding、参数化 SQL、空间范围查询、版本条件更新、原子项目数量限制。列表单次查询只读摘要，避免加载全部工程正文。 |
| `packages/cloudflare-storage/r2.ts` | 私有路径按空间/项目/素材组织，核对大小和 R2 原生 SHA-256；支持流式 GET、HEAD、单段 Range。读取时绑定对象 ETag，避免元数据检查后读到另一个版本。 |
| `experiments/workers-storage/worker.ts` | 独立测试入口，在本地 workerd 中连接 D1/R2 并运行相同业务逻辑；不加载 Hypit、Pi CLI 或 Node 存储。 |

存储的 `save(document, {expectedRevision})` 必须显式带版本：`null` 表示仅新建，字符串表示仅在旧版本仍匹配时更新。编辑冲突返回 409；同一创建或批次请求并发重试仍只保留一份。独立素材登记允许有界重试并重新合并最新记录，避免同时导入不同素材时丢记录。

本地素材在字节写完但元数据保存失败时会恢复到上传临时文件，允许原上传会话重试。方案和旧批次不因此变成已制作。

## 运行和证据

复用 `experiments/workers-p0` 已锁定的 TypeScript、esbuild、Miniflare 工具，不新增依赖，也不重建媒体 Wasm。首次克隆若尚未安装实验依赖，先按 P0 安装说明配置 G 盘缓存并安装；日常直接运行：

```powershell
$env:TEMP='G:\DevCache\Temp\pi-agent-hypite'
$env:TMP=$env:TEMP
npm run workers:storage:test
npm test
npm run saas:build
```

实验构建、数据库、R2 文件和完整报告位于 `G:/DevCache/Temp/pi-agent-hypite/workers-storage/run-*`，每次使用新目录，不访问 `.data/saas`。可随代码保留的结果摘要在 [实验记录](../experiments/workers-storage/evidence/local-2026-10-19.json)。报告记录构建输入 SHA-256、验证项和 `cloudVerified: false`。

最终根测试 33/33 和 SaaS 静态构建通过；未修改前端视觉，因此本轮没有重复前端截图验收。

本地 Worker 验证包括 12 组检查：类型/构建、实验默认关闭、身份边界、并发创建、R2 哈希及 Range、并发素材登记、并发编辑/只读检查/执行阻断、批次幂等与旧快照复制、文件缺失损坏、运行时重启、文档超限不发生部分更新、并发数量上限及 100 项列表。

实验视频是 16 字节等微型传输夹具，不是可播放视频；验证存储和字节一致性，不验证解码、播放质量、100 MB 上传或视频生成。并发验证使用本地 workerd 的并发请求，不是多地区生产负载或容量压测。

## 明确的边界和风险

- 正常 4320 页面继续使用 SQLite 和本地素材；没有将用户数据静默搬进本地 D1，也没有重写前端。
- 实验里的两个固定身份仅用于隔离断言，不是真实登录。实验默认返回 503，需由本地验证脚本显式开启；不要把此入口作为公网服务部署。正式会话、邀请注册、鉴权中间件仍待迁移。
- R2 适配器交付的是私有素材读取与完整性核对。直传授权、完成确认、终止上传、存储配额和历史文件迁移未实现。测试夹具写入限制 4 KiB，不能用它接收用户媒体。
- 新 D1 文档上限为 1.5 MiB，明确返回 413，不截断。现有本地 2 MiB 上限保留；超限旧工程迁移时必须报告并拆分，不能无损直迁。D1 当前单字符串/BLOB/行上限为 2,000,000 字节，因此留下其他列及序列化余量。[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)
- R2 完整性判断使用存储服务接受的原生 SHA-256，不能只相信客户端或 customMetadata 自报的哈希；没有原生校验和的历史对象标为不可用，需要迁移时重新验证。[R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- D1 与 R2 不构成跨服务事务。正式上传完成流程仍需上传记录、幂等完成与孤立对象对账；当前内部素材登记钩子不等同于这套流程。不得把存储成功当作真实媒体可解码。
- 此次没有迁移 Pi 状态或修改 Hypit；Pi 的 Worker 实验和媒体实验沿用 P0 证据。云端资源、真实模型和最终成片关口仍待实测；执行入口继续返回 409。

## 后续执行顺序

1. 在本地验证正式 Worker 会话/权限接口，保留原密码格式并约束认证内存和并发。
2. 实现可恢复的上传登记、R2 直传授权/完成确认与租户配额，补齐 D1/R2 跨服务失败对账。
3. ~~提供显式迁移演练~~ **已完成（2026-10-20）**：`packages/cloudflare-storage/schema.sql` 补齐账号、空间、成员、会话表；`scripts/migrate-to-d1.mjs` 保留 ID、核对素材大小与 SHA-256、输出 `data.sql` / `r2-manifest.json` / `report.json`，缺失、损坏与超限工程一律报告并拒绝通过；`npm run verify:migration` 在本地 workerd 的 D1/R2 完成 9 项比对。
4. 云账号与预算准备后，完成 P0 云端媒体验收，再接通项目工程、Pi 编排与制作队列。
