# 阿里云 ECS 独立部署

此目录用于将“AI短视频质检评估系统 V1.0”独立部署到阿里云 ECS，不与“视频需求数据看板”共享代码、数据库或运行环境。

- Caddy：HTTPS 入口及同源反向代理
- Next.js：前端
- NestJS：后端 API
- PostgreSQL：独立数据库
- ECS Docker Volume：视频、封面和数据库持久化
- 阿里云 OSS：仅作为 Qwen-Omni 读取视频时的临时中转

V1.01 API 入口不再自动迁移或 seed；先按 [发布手册](../../docs/V1.01-本地验收与发布手册.md) 完成维护确认、备份、显式迁移和 API 验证，再更新 Web。以下旧版启动命令本身不完成数据库升级，不能作为 V1.01 一键发布步骤：

```bash
docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env up -d --build
```

生产密钥只允许写入服务器端 `deploy/aliyun/.env`。该文件已由仓库根目录 `.dockerignore` 排除，且不应提交到 Git。
