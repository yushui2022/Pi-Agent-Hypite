# Worker 部署清单

生产入口：`src/index.ts`（Workers fetch handler + 静态前端）。
配置：`wrangler.jsonc`。

## 部署前必须做的五件事

```powershell
# 1. 生成静态前端（wrangler 的 assets 目录指向 ../../dist/saas-web）
npm run saas:build

# 2. 建 D1 并建表，把 database_id 填进 wrangler.jsonc
npx wrangler d1 create pi-studio
npx wrangler d1 execute pi-studio --remote --file=../../packages/cloudflare-storage/schema.sql

# 3. 建 R2 桶（或复用已有桶），桶名要与 wrangler.jsonc 的 r2_buckets 和 vars.S3_BUCKET 一致
npx wrangler r2 bucket create pi-media

# 4. 写入 R2 凭证（S3 兼容密钥，不是 Cloudflare API Token）
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY

# 5. 部署
npx wrangler deploy
```

## 关键：R2 桶必须配 CORS

浏览器直传是**浏览器直接 PUT 到 R2**，不是经过 Worker。没有 CORS，上传会在浏览器里失败（前端会提示"请检查存储桶的 CORS 设置"）。

在 R2 桶 → Settings → CORS Policy 粘贴（把域名换成你的）：

```json
[
  {
    "AllowedOrigins": ["https://<你的应用域名>"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["x-amz-checksum-sha256", "content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

`x-amz-checksum-sha256` 必须在白名单里，否则浏览器预检会拦掉——它是签名头，缺了上传就被 R2 拒绝。

## 迁移本地数据（可选）

```powershell
npm run migrate:d1 -- --data-root <本地 .data/saas 路径> --out <导出目录>
npx wrangler d1 execute pi-studio --remote --file=<导出目录>/data.sql
# 素材按 <导出目录>/r2-manifest.json 上传到 R2（key 与 localPath 一一对应）
```

**注意**：本地账号用 scrypt 存密码，Workers 没有 scrypt，**迁移过来的用户必须先重设密码才能登录**（登录会返回 `password-reset-required`）。全新用户不受影响。

## 上线前已知限制

- `POST /api/remix/:id/execute` 仍返回 409：真实制作链路未接入
- 没有注册限流（本地服务按 IP 限流，Worker 版本尚未实现）
- 单项目文档上限 1.5 MiB（D1），超出返回 413
- 直传单文件上限 100 MB，超时 15 分钟失效

## 本地验证（不需要账号）

```powershell
npm run verify:worker-api    # 在本地 workerd 起真实生产入口，10 项
npm run verify:session       # 会话与上传确认，18 项
npm run verify:migration     # D1 迁移演练，9 项
npm run verify:r2            # 真实 R2 桶的签名验收，5 项（需要 .env）
```
