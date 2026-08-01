# AI短视频质检评估系统 V1.0

内容中台内部使用的 AI 短视频质检与有效产出评定系统。

当前实现范围：第一阶段基础系统搭建 + 第二阶段 Gemini 视频内容质量评估 + 第三阶段主管初审与返修流程 + 第四阶段运营/投放结果数据补充 + 第五阶段 GPT 数据复盘。

## 技术栈

- 前端：Next.js + React + TypeScript
- 后端：NestJS + TypeScript
- 数据库：PostgreSQL
- ORM：Prisma
- 鉴权：JWT
- 本地数据库：Docker Compose PostgreSQL

## 已实现功能

### 第一阶段：基础系统

- 初始化前后端项目结构
- 配置 PostgreSQL 与 Prisma
- 创建 PRD/AGENTS 要求的 12 张核心表
- 通过 seed 创建默认管理员
- 登录、JWT、当前用户信息
- 后端角色权限与视频访问权限校验
- 视频上传、视频列表、视频详情
- 通过后端鉴权接口访问视频文件
- `operation_logs` 记录登录成功/失败、视频上传、查看详情、访问文件、权限拒绝

### 第二阶段：Gemini 内容质量评估

- Gemini Files API 上传与有界状态轮询
- 结构化 JSON Schema 与后端 Zod 双重校验
- 内容总分、内容等级、维度评分和审计原文落库
- HTTP 202 异步触发与 latest 状态查询
- running 任务重复触发保护与超时任务回收
- 评估成功、失败和回收操作日志
- GPT、规则引擎和后续业务模块仍只保留边界，不在本阶段执行

### 第三阶段：主管初审与返修

- 管理员、内容负责人和编导主管按对象级权限提交主管初审
- 支持通过发布、要求返修、内容无效三种决定
- 审核记录、视频状态和操作日志在同一事务中写入
- 每个视频版本仅允许一个主管初审结果，并通过视频行锁保护并发提交
- 返修文件生成新的 `Video`，通过直接 `parentVideoId` 形成 V1 → V2 → V3 版本链
- 新返修版本保持原创建者归属，状态重新进入 `submitted`
- 返修上传事务失败时清理孤儿文件，不覆盖历史视频、Gemini 结果或主管审核

### 第四阶段：运营/投放结果数据补充

- 按视频类型动态配置运营或投放指标字段
- 管理员和内容负责人可补充全部适用视频，运营与投放按视频类型分工
- 每次提交创建新的完整 `VideoResultMetric`，旧快照不可修改或删除
- 使用 Video 行锁和 `baseMetricId` 乐观并发校验防止覆盖他人数据
- 首次提交将视频推进至 `pending_result_data`，后续可继续追加快照
- 支持最新快照、历史快照和游标分页查询
- Decimal 统一序列化为字符串，比率按百分数数值保存，ROI 按倍数保存
- 快照、视频状态和 `operation_logs` 在同一数据库事务中写入

### 第五阶段：GPT 数据复盘

- 使用 OpenAI 官方 Node SDK 和 Responses API，请求启用 `store: false`
- GPT 只分析指定的结构化 `VideoResultMetric` 快照，不读取视频或本地文件
- Structured Outputs strict JSON Schema 与 Zod 二次校验共同约束输出
- 每条 `AiResultReview` 强制绑定 `resultMetricId`，且只允许复盘视频的最新快照
- 异步触发立即返回 HTTP 202，支持 running 防重和超时任务回收
- 数据充分时生成数据分数与 S/A/B/C/D 等级；数据不足时分数、等级和业务效果建议必须为 `null`
- `PlatformBenchmark` 只使用已启用且匹配平台、视频类型和品牌的真实业务基准；无基准时不虚构等级
- 触发、回收、成功和失败都写入 `operation_logs`

当前不执行规则引擎、最终评定、负责人确认、绩效判断、看板或案例库。第六阶段才执行后端规则引擎，当前没有最终有效等级。

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
JWT_SECRET="replace-with-a-random-secret-at-least-32-characters"
JWT_EXPIRES_IN="2h"
DEFAULT_ADMIN_USERNAME="admin"
DEFAULT_ADMIN_PASSWORD="change-me-before-seeding"
MAX_VIDEO_SIZE_MB="500"
VIDEO_STORAGE_DIR="./storage/videos"
API_PORT="3001"
API_HOST="127.0.0.1"
NEXT_PUBLIC_API_BASE_URL="http://localhost:3001"
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"
GEMINI_FILE_POLL_INTERVAL_MS="5000"
GEMINI_FILE_POLL_MAX_ATTEMPTS="24"
GEMINI_REQUEST_TIMEOUT_MS="120000"
GEMINI_RUNNING_STALE_MINUTES="10"
OPENAI_API_KEY=""
OPENAI_RESULT_REVIEW_MODEL="gpt-5-mini"
OPENAI_RESULT_REVIEW_MAX_OUTPUT_TOKENS="4000"
OPENAI_REQUEST_TIMEOUT_MS="120000"
OPENAI_RESULT_REVIEW_RUNNING_STALE_MINUTES="10"
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

## 角色映射与权限

| Prisma UserRole | 业务角色 | 视频查看权限 | 结果数据写入与 GPT 复盘触发 |
| --- | --- | --- | --- |
| `admin` | 管理员 | 查看全部视频 | 全部适用视频类型 |
| `content_owner` | 内容负责人 | 查看全部视频 | 全部适用视频类型 |
| `supervisor` | 编导主管 | 查看本人及直属团队视频 | 只读 |
| `director` | 编导 | 只能查看自己提交的视频 | 只读 |
| `operator` | 运营 | 查看全部视频 | `product_card`、`organic`、`brand_seeding`、非投放 `other` |
| `advertiser` | 投放 | 查看全部视频 | `qianchuan_ad`、`live_room_traffic`、投放 `other` |

角色权限由后端校验，前端隐藏按钮不构成安全边界。

## 结果数据快照

`VideoResultMetric` 按不可变快照使用：

- 每次提交都创建新记录，不更新或删除历史记录。
- 未提交字段继承最新快照；具体值覆盖；明确传入 `null` 清空可选字段。
- `videoType`、`videoId`、`submittedBy` 和时间字段由后端管理。
- 已有快照时必须携带当前最新 `baseMetricId`，过期提交返回 `409`。
- 比率字段直接保存百分数数值，例如 `CTR 2.35%` 保存为 `2.35`。
- ROI 保存为倍数，例如 `ROI 2.5` 保存为 `2.5`。
- 金额、比率与 ROI 在 API 响应中统一返回字符串，避免 Decimal 精度丢失。

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

触发 Gemini 内容评估（仅限有权限的管理员、内容负责人或视频提交编导，返回 HTTP 202）：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/content-review \
  -H "Authorization: Bearer <accessToken>"
```

查询最近一次内容评估（响应不会返回 `rawResponse`）：

```bash
curl http://localhost:3001/api/videos/<video-id>/content-review/latest \
  -H "Authorization: Bearer <accessToken>"
```

提交主管初审：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/supervisor-review \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"decision":"revision_required","comment":"请提前产品露出","revisionRequirements":["产品在前2秒出现"]}'
```

查询主管初审：

```bash
curl http://localhost:3001/api/videos/<video-id>/supervisor-review/latest \
  -H "Authorization: Bearer <accessToken>"
```

上传返修版本：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/revisions \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@/path/to/revision.mp4" \
  -F "title=返修版本"
```

创建运营/投放结果数据快照：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/result-metrics \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"baseMetricId":null,"dataStartDate":"2026-07-31","dataEndDate":"2026-08-02","views":1000}'
```

查询最新和历史快照：

```bash
curl http://localhost:3001/api/videos/<video-id>/result-metrics/latest \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3001/api/videos/<video-id>/result-metrics/history?limit=20" \
  -H "Authorization: Bearer <accessToken>"
```

触发 GPT 数据复盘（只允许最新快照，返回 HTTP 202）：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/result-review \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"resultMetricId":"<latest-result-metric-id>"}'
```

查询最新复盘和历史复盘（均不返回 `rawResponse`）：

```bash
curl http://localhost:3001/api/videos/<video-id>/result-review/latest \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3001/api/videos/<video-id>/result-reviews/history?limit=20" \
  -H "Authorization: Bearer <accessToken>"
```

`pending_data` 需先通过第四阶段接口补充新快照并回到 `pending_result_data`，不能直接触发 GPT 复盘。

## 安全边界

- 视频文件保存在 `storage/videos/`，该目录已加入 `.gitignore`。
- 视频文件不通过静态目录公开。
- 访问视频文件必须调用 `GET /api/videos/:id/file` 并携带 JWT。
- Gemini / OpenAI API Key 只允许放在后端环境变量；前端、seed 和数据库不保存 API Key。
- Gemini 只负责视频内容理解和内容质量等级，不负责运营/投放数据、最终有效等级或绩效判断。
- GPT 只读取结构化结果数据和经过筛选的上下文，不读取视频、URL、本地路径、用户账号、AI 原始响应或操作日志。
- `JWT_EXPIRES_IN` 必须带 `s`、`m` 或 `h` 后缀，例如 `7200s`、`120m` 或 `2h`；裸数字会被拒绝。

## 后续阶段

- 第六阶段：后端规则引擎。
- 第七阶段：GPT 最终评定。
- 第八阶段：负责人确认、看板和案例库。
