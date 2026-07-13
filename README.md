# AI短视频质检评估系统 V1.0

内容中台内部使用的 AI 短视频质检与有效产出评定系统。

当前实现范围：第一阶段基础系统搭建。

## 技术栈

- 前端：Next.js + React + TypeScript
- 后端：NestJS + TypeScript
- 数据库：PostgreSQL
- ORM：Prisma
- 鉴权：JWT
- 本地数据库：Docker Compose PostgreSQL

## 第一阶段已覆盖

- 初始化前后端项目结构
- 配置 PostgreSQL 与 Prisma
- 创建 PRD/AGENTS 要求的 12 张核心表
- 通过 seed 创建默认管理员
- 登录、JWT、当前用户信息
- 后端角色权限与视频访问权限校验
- 视频上传、视频列表、视频详情
- 通过后端鉴权接口访问视频文件
- `operation_logs` 记录登录成功/失败、视频上传、查看详情、访问文件、权限拒绝
- 预留 Gemini、GPT、规则引擎模块目录、数据表和服务边界

第一阶段不接入 Gemini API / OpenAI GPT API，不写真实 Prompt，不写任何真实 API Key。

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 准备环境变量

```bash
cp .env.example .env
```

确认 `.env` 至少包含：

```bash
DATABASE_URL="postgresql://DB_USER:DB_PASSWORD@localhost:5432/DB_NAME?schema=public"
JWT_SECRET="replace-with-a-long-random-secret"
DEFAULT_ADMIN_USERNAME="admin"
DEFAULT_ADMIN_PASSWORD="change-me-before-seeding"
MAX_VIDEO_SIZE_MB="500"
VIDEO_STORAGE_DIR="./storage/videos"
API_PORT="3001"
API_HOST="127.0.0.1"
NEXT_PUBLIC_API_BASE_URL="http://localhost:3001"
```

3. 启动 PostgreSQL

```bash
docker compose up -d postgres
```

4. 创建数据表并初始化默认管理员

```bash
npm run db:migrate -- --name init
npm run db:seed
```

5. 启动后端

```bash
npm run dev:api
```

6. 启动前端

```bash
npm run dev:web
```

访问：

- 前端：http://localhost:3000
- 后端健康检查：http://localhost:3001/api/health

## 默认管理员

默认管理员由环境变量控制：

- `DEFAULT_ADMIN_USERNAME`
- `DEFAULT_ADMIN_PASSWORD`
- `DEFAULT_ADMIN_NAME`

本地示例账号：

- 账号：`admin`
- 密码：由本地 `.env` 中的 `DEFAULT_ADMIN_PASSWORD` 决定

密码只以哈希形式写入数据库。

## 测试方式

基础接口测试：

```bash
curl http://localhost:3001/api/health
```

登录测试：

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"admin","password":"<DEFAULT_ADMIN_PASSWORD>"}'
```

拿到 `accessToken` 后，可调用：

```bash
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

上传视频使用前端页面 `/videos/new`，或使用 multipart 请求调用：

```bash
curl -X POST http://localhost:3001/api/videos \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@/path/to/video.mp4" \
  -F "title=测试视频" \
  -F "videoType=product_card"
```

## 安全边界

- 视频文件保存在 `storage/videos/`，该目录已加入 `.gitignore`。
- 视频文件不通过静态目录公开。
- 访问视频文件必须调用 `GET /api/videos/:id/file` 并携带 JWT。
- Gemini / GPT API Key 只允许放在后端环境变量，第一阶段不使用。

## 后续阶段

- 第二阶段：接入 Gemini 内容质量评估。
- 第三阶段：主管初审与返修流程。
- 第四阶段：运营/投放数据补充。
- 第五阶段：GPT 数据复盘。
- 第六阶段：后端规则引擎。
- 第七阶段：GPT 最终评定。
- 第八阶段：负责人确认、看板和案例库。
