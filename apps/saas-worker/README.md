# Worker 部署清单

生产入口：`src/index.ts`。配置：`wrangler.jsonc`（`account_id`、桶名 `pi-media-test`、S3 endpoint 已填好）。

## 你需要在 Cloudflare 侧做的四件事

### 1. 开通 Workers 付费计划（$5/月起）

Dashboard → **Workers & Pages** → 右侧 **Plans** → 选 **Workers Paid**。

免费计划不能建 D1、CPU 也只有 10 ms/请求，不够用。开通后先跑 `npm run cf:whoami` 确认本地能连上：

```powershell
npm run cf:login      # 浏览器里授权，只需一次
npm run cf:whoami     # 应显示你的账号
```

### 2. 建 D1 数据库并把 ID 填进配置

```powershell
npm run cf:d1:create
```

输出会给一个 `database_id`，把它替换掉 `wrangler.jsonc` 里的 `REPLACE_WITH_CF_D1_CREATE_OUTPUT`，然后建表：

```powershell
npm run cf:d1:schema
```

### 3. 给 R2 桶配 CORS（不做浏览器上传必然失败）

R2 → `pi-media-test` → **Settings** → **CORS Policy**，粘贴（域名换成部署后的地址）：

```json
[
  {
    "AllowedOrigins": ["https://pi-studio-saas.<你的子域>.workers.dev"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["x-amz-checksum-sha256", "content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

**`x-amz-checksum-sha256` 必须在白名单**：它是签名头，浏览器预检不认就会被拦下，上传直接失败。

### 4. 写入 R2 凭证并部署

```powershell
npm run saas:build
npx wrangler secret put S3_ACCESS_KEY_ID  -c apps/saas-worker/wrangler.jsonc
npx wrangler secret put S3_SECRET_ACCESS_KEY -c apps/saas-worker/wrangler.jsonc
npm run cf:deploy
```

两个 secret 的值就是 `.env` 里那对 R2 密钥（Access Key ID / Secret Access Key）。

## 部署后立刻做的一件事

打开页面 → 登录 → 新建项目 → 传一个小文件。

- 成功：直传链路在真实环境成立
- 失败且提示"CORS"：回到第 3 步检查白名单
- 失败且 403：检查 secret 是否成对写入、桶名是否一致

日志：`npm run cf:tail`。

## 迁移本地数据（可选，全新部署可跳过）

```powershell
npm run migrate:d1 -- --data-root <本地 .data/saas> --out <导出目录>
npx wrangler d1 execute pi-studio --remote --file=<导出目录>/data.sql -c apps/saas-worker/wrangler.jsonc
```

素材按 `<导出目录>/r2-manifest.json` 上传到 R2。

**注意**：本地账号用 scrypt 存密码，Workers 没有 scrypt，**迁移过来的用户必须先重设密码**（登录返回 `password-reset-required`）。全新用户不受影响。

## 生成服务配置（已接入）

| 用途 | 服务 | 配置 |
|---|---|---|
| pi-agent 对话模型 + 图片生成 | TokensFactory 中转 | `TOKENSFACTORY_API_KEY`（secret）、`TOKENSFACTORY_BASE_URL`、`TOKENSFACTORY_MODEL` |
| 视频生成 | AutoDL 工作流 | `AUTODL_API_KEY`（secret）、`AUTODL_API_BASE`、`AUTODL_WORKFLOW_DEFAULT`/`_FAST` |

默认值：对话模型 `gemini-3.8-flash`，图片 `gpt-image-2`，视频 `minimax_h3_zm_u24`（高速版 `minimax_h3_zm_u08`）。

**两个服务的鉴权格式不同，不能互相套用**：TokensFactory 用 `Authorization: Bearer <key>`，AutoDL 用**裸 token**（无 Bearer）。

`GET /api/providers` 返回配置状态（不含密钥）；`POST /api/providers/probe` 做零成本连通性探测（列模型 + 查询一个不存在的任务）。

更新密钥：

```powershell
npx wrangler secret put TOKENSFACTORY_API_KEY -c apps/saas-worker/wrangler.jsonc
npx wrangler secret put AUTODL_API_KEY -c apps/saas-worker/wrangler.jsonc
```

## 已知限制

- `POST /api/remix/:id/execute` 仍返回 409：真实制作链路未接入
- 注册没有限流（本地服务按 IP 限流，Worker 版本未实现）
- 单项目文档上限 1.5 MiB（D1），超出 413
- 直传单文件上限 100 MB，签名 URL 15 分钟失效

## 本地验证（不需要账号）

```powershell
npm run verify:worker-api    # 本地 workerd 启动真实生产入口，10 项
npm run verify:session       # 会话与上传确认，18 项
npm run verify:migration     # D1 迁移演练，9 项
npm run verify:r2            # 真实 R2 桶签名验收，5 项（读 .env）
```
