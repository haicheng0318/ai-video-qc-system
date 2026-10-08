# CloudBase 生产部署

本目录只用于独立的 `ai-video-qc-prod` 环境，不得指向或更改
`video-dashboard-d9f7jezmf964f443` 环境。

## 资源边界

- CloudBase Run 前端服务：`ai-video-qc-web`
- CloudBase Run 后端服务：`ai-video-qc-api`
- 独立 CloudBase PostgreSQL 环境，只通过同地域 VPC 内网访问
- 独立私有 COS Bucket，用于永久视频存储
- 独立私有阿里云 OSS Bucket，仅作 Qwen 视频评估的临时中转

## 运行约束

- API 服务必须设置最小实例数 1，不得缩容到 0。
- 生产视频由浏览器使用后端短时签名 URL 直传私有 COS，避开 CloudBase Run 20MB 请求体限制。
- 对外只发布 CloudBase HTTPS 域名；PostgreSQL 不开放公网。
- 所有真实密钥只在后端服务环境变量中配置。
- COS 和 OSS Bucket 均必须为私有，并使用独立最小权限身份。
- OSS 临时前缀设置 1 天自动清理生命周期。
- COS CORS 仅允许 Web 正式域名的 `PUT`/`HEAD` 请求和 `Content-Type` 请求头。

## 发布顺序

1. 创建独立 CloudBase 环境、VPC、PostgreSQL、COS 和 OSS。
2. V1.01 不再于 API 启动时迁移或 seed。取得维护与备份授权后，使用与 API/worker 相同的候选镜像显式运行 `node /app/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma`。仅全新库经确认后单独运行 `node /app/prisma/seed.cjs`；升级已有库不创建新管理员。
3. 先发布 API 镜像，配置环境变量并通过 `/api/health/ready` 检查；独立 worker 必须与 API 同版本。
4. 用 API HTTPS 域名构建并发布 Web 镜像。
5. 将 API `WEB_ORIGIN` 限制为 Web 正式域名。
6. 执行未登录拦截、登录、上传、播放、真实 AI 评估和结果展示冒烟测试。

## 回滚

V1.01 的 Cookie/会话与持久队列不能直接回退到旧 Bearer/API 内存任务版本。优先切换已验证兼容当前 schema 的修复镜像，保持数据库、历史 AI 返回、任务与额度账本。备份先恢复到新库并核对；不得覆盖原库或丢弃切换后的新增数据。真实云切换与对象恢复仍需外部授权，详见 [发布手册](../../docs/V1.01-本地验收与发布手册.md)。
