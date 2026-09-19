# AI短视频质检评估系统 V1.0

内容中台内部使用的 AI 短视频质检与有效产出评定系统。

V1.01 本地实现、集成与发布准备见 [本地验收与发布手册](docs/V1.01-本地验收与发布手册.md) 和 [用户与管理员说明](docs/V1.01-用户与管理员说明.md)。本地通过不表示已经上线；真实云存储、付费模型、生产维护与会话切换仍需单独完成门禁。

当前实现范围：第一阶段基础系统搭建 + 第二阶段 Qwen-Omni 视频内容质量评估 + 第三阶段主管初审与返修流程 + 第四阶段运营/投放结果数据补充 + 第五阶段千问数据复盘 + 第六阶段后端规则引擎 + 第七阶段千问最终评定建议 + 第八阶段负责人最终确认、数据看板和案例库。

## 技术栈

- 前端：Next.js + React + TypeScript
- 后端：NestJS + TypeScript
- 数据库：PostgreSQL
- ORM：Prisma
- 鉴权：HttpOnly Cookie 内的 JWT + 服务端可撤销会话 + 写请求 CSRF 校验
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

### 第二阶段：Qwen-Omni 内容质量评估

- 本地视频临时上传到私有阿里云 OSS，并使用一小时短时签名 URL 调用百炼 Qwen3.5-Omni-Plus
- 模型调用结束后立即删除 OSS 临时对象；清理失败时评估任务进入失败状态
- Qwen 同时理解视频画面、字幕、口播和音效，仅输出 12 个固定维度的 0–5 观察等级、证据、风险与建议，不自行填写总分或等级
- 结构化 JSON Schema 与后端 Zod 双重校验
- 后端按版本化的 `content-score-v2` 权重和硬边界确定性计算内容总分与等级；维度评分、计算明细、版本和审计原文一并落库
- 历史内容评估保留原值并标记为 `legacy-model-score-v1`，不自动覆盖或重评；不同版本的分数不可直接用于纵向绩效比较
- HTTP 202 异步触发与 latest 状态查询
- running 任务重复触发保护与超时任务回收
- 评估成功、失败和回收操作日志
- Qwen-Omni 只承担内容质量评估，与后续的千问数据复盘、规则引擎和最终评定保持模块隔离

### 第三阶段：主管初审与返修

- 管理员、内容负责人和编导主管按对象级权限提交主管初审
- 支持通过发布、要求返修、内容无效三种决定
- 审核记录、视频状态和操作日志在同一事务中写入
- 每个视频版本仅允许一个主管初审结果，并通过视频行锁保护并发提交
- 返修文件生成新的 `Video`，通过直接 `parentVideoId` 形成 V1 → V2 → V3 版本链
- 新返修版本保持原创建者归属，状态重新进入 `submitted`
- 返修上传事务失败时清理孤儿文件，不覆盖历史视频内容评估结果或主管审核

### 第四阶段：运营/投放结果数据补充

- 按视频类型动态配置运营或投放指标字段
- 管理员和内容负责人可补充全部适用视频，运营与投放按视频类型分工
- 每次提交创建新的完整 `VideoResultMetric`，旧快照不可修改或删除
- 使用 Video 行锁和 `baseMetricId` 乐观并发校验防止覆盖他人数据
- 首次提交将视频推进至 `pending_result_data`，后续可继续追加快照
- 支持最新快照、历史快照和游标分页查询
- Decimal 统一序列化为字符串，比率按百分数数值保存，ROI 按倍数保存
- 标记为投放的商品卡视频使用投放字段，可录入 `spend`、`clicks`、`impressions`、`orders`、`gmv` 等指标
- `cpc`、`cpm`、`roi` 留空时由后端根据基础指标自动计算，也允许保存有业务依据的人工值
- 快照、视频状态和 `operation_logs` 在同一数据库事务中写入

### 第五阶段：千问数据复盘

- 使用 OpenAI 兼容 Node SDK 调用阿里云百炼 Chat Completions API，模型为 `qwen3.5-plus`
- 千问只分析指定的结构化 `VideoResultMetric` 快照，不读取视频或本地文件
- Structured Outputs strict JSON Schema 与 Zod 二次校验共同约束输出
- 每条 `AiResultReview` 强制绑定 `resultMetricId`，且只允许复盘视频的最新快照
- 异步触发立即返回 HTTP 202，支持 running 防重和超时任务回收
- 数据充分时生成数据分数与 S/A/B/C/D 等级；数据不足时分数、等级和业务效果建议必须为 `null`
- `PlatformBenchmark` 只使用已启用且匹配平台、视频类型和品牌的真实业务基准；无基准时不虚构相对优劣，也不再仅因缺少基准就把数据判为不充分
- 管理员和内容负责人可在 `/settings/benchmarks` 维护平台/品牌、视频类型、指标、S/A/B/C 阈值、评价方向和启停状态
- 触发、回收、成功和失败都写入 `operation_logs`

### 第六阶段：后端规则引擎

- 规则引擎是同步、确定性的纯后端 TypeScript 代码，不调用 OpenAI、Qwen 或其他 AI
- `rule-engine-v1` 只读取 `contentGrade`、`dataGrade`、`dataSufficiency`，不读取原始运营指标、AI 原文、归因文本或用户备注
- `RuleEngineResult` 强制绑定主管审核时可用的 `contentReviewId` 和最新成功复盘的 `resultReviewId`
- 每次成功只创建不可变结果；同一 `resultReviewId + ruleVersion` 不允许重复执行
- 执行事务使用 Video 行锁，并原子写入规则结果、视频状态和 `operation_logs`
- 数据不足命中 R00 并进入 `pending_data`；数据充分命中 R11-R33 并进入 `pending_final_evaluation`
- 只有 `admin` 和 `content_owner` 可以执行；其他拥有视频对象读取权限的角色只读
- 支持 latest 和 history 游标分页查询，接口不返回 AI `rawResponse`

规则候选不是最终有效等级。第七阶段只生成千问最终评定建议；负责人确认、正式最终状态、绩效判断、看板和案例库属于第八阶段。

#### rule-engine-v1 规则矩阵

| 规则 | 内容等级 | 数据等级/充分性 | 候选结果 | 硬边界 |
| --- | --- | --- | --- | --- |
| R00 | S/A/B/C/D | 数据不足，等级为空 | `pending_data` | `pending_data` |
| R11 | S/A | S/A | `excellent_effective_candidate` | `allow_final_effective` |
| R12 | S/A | B | `effective_candidate` | `allow_final_effective` |
| R13 | S/A | C/D | `content_good_result_poor` | `allow_final_low_effective_or_invalid` |
| R21 | B | S/A | `potential_effective_candidate` | `allow_final_effective_or_low_effective` |
| R22 | B | B | `basic_effective_candidate` | `allow_final_effective_or_low_effective` |
| R23 | B | C/D | `content_good_result_poor` | `allow_final_low_effective_or_invalid` |
| R31 | C/D | S/A | `abnormal_need_confirmation` | `require_manual_confirmation` |
| R32 | C/D | B | `abnormal_need_confirmation` | `require_manual_confirmation` |
| R33 | C/D | C/D | `invalid_candidate` | `require_final_invalid` |

R23 和 R32 是对原始规则矩阵缺口的显式保守补全。规则结果只限定第七阶段的候选边界，不直接生成最终有效结论。

### 第七阶段：千问最终评定建议

- 使用百炼 Chat Completions API、strict JSON Schema 和后端 Zod 二次校验
- 只读取规则结果绑定的 Qwen 内容评估、主管审核、结果数据快照和千问数据复盘，不读取视频、URL、用户身份或 AI 原始响应
- 千问只能在 `recommendedBoundary` 允许范围内建议 `effective`、`low_effective` 或 `invalid`
- 千问建议字段与人工确认字段分开保存；本阶段不填写 `finalGrade`、`finalStatus`、`isEffectiveFinal`、确认人或确认时间
- HTTP 202 异步触发，支持 running 防重、stale 回收、失败重试和不可变历史记录
- 成功进入 `pending_final_confirmation`，失败进入 `final_evaluation_failed`
- 千问建议不是最终业务结论；正式业务结论由第八阶段负责人确认产生

### 第八阶段：正式确认、看板与案例库

- 仅管理员和内容负责人可以执行最终确认，后端根据规则硬边界限制可选等级
- 正式等级映射为 `final_effective`、`final_low_effective`、`final_invalid`，确认后不可再次修改
- 人工偏离 AI 建议必须填写调整原因；人工确认边界必须填写确认说明
- 绩效参考资格是人工参考标记，不自动计算工资或绩效
- 优秀案例只允许来自正式有效视频，反面案例只允许来自正式无效视频，低有效视频不进入案例库
- 案例标记不改变视频正式终态，支持保留原因的标记移除操作
- 看板只统计 `confirmedAt` 范围内已确认的正式结论，流程积压与正式指标分开统计
- 看板和案例列表在数据库查询层应用角色对象级可见范围，不返回 AI `rawResponse`

Phase 8 不新增 AI 调用。Qwen 内容评估、千问建议、规则候选和负责人正式结论继续独立保存。

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
DASHSCOPE_API_KEY=""
QWEN_MODEL="qwen3.5-omni-plus"
QWEN_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
QWEN_REQUEST_TIMEOUT_MS="300000"
QWEN_RUNNING_STALE_MINUTES="15"
OSS_REGION="oss-cn-beijing"
OSS_BUCKET=""
OSS_ACCESS_KEY_ID=""
OSS_ACCESS_KEY_SECRET=""
OSS_REQUEST_TIMEOUT_MS="300000"
OSS_SIGNED_URL_TTL_SECONDS="3600"
OSS_TEMP_PREFIX="ai-video-qc/content-review"
QWEN_TEXT_REQUEST_TIMEOUT_MS="120000"
QWEN_RESULT_REVIEW_MODEL="qwen3.5-plus"
QWEN_RESULT_REVIEW_MAX_OUTPUT_TOKENS="4000"
QWEN_RESULT_REVIEW_RUNNING_STALE_MINUTES="10"
QWEN_FINAL_EVALUATION_MODEL="qwen3.5-plus"
QWEN_FINAL_EVALUATION_MAX_OUTPUT_TOKENS="4000"
QWEN_FINAL_EVALUATION_RUNNING_STALE_MINUTES="10"
```

Qwen 视频评估以及两个文本评定环节需要配置百炼；只有视频内容评估需要私有 OSS：

- 在百炼控制台创建 API Key，填入 `DASHSCOPE_API_KEY`；账号需已开通模型服务，并确保 `qwen3.5-omni-plus` 在所在地域可用。
- 创建私有 OSS Bucket，并填写 `OSS_REGION`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`。建议使用单独的 RAM 用户，仅授予该 Bucket 下临时前缀的 `PutObject`、`GetObject`、`DeleteObject` 权限。
- `OSS_REQUEST_TIMEOUT_MS` 只控制视频临时上传到 OSS 的请求超时（毫秒），与控制模型调用的 `QWEN_REQUEST_TIMEOUT_MS` 相互独立。

本地存储模式下，视频永久保存在本地；已配置 COS 的环境使用私有 COS 作为正式存储。评估时只创建私有 OSS 临时对象，通过短时签名 URL 供模型读取，并在调用结束后立即删除。建议同时给临时前缀配置一天内自动清理的生命周期规则，作为异常退出时的兜底。

3. 启动 PostgreSQL

```bash
docker compose up -d postgres
```

4. 创建数据表并初始化默认管理员

```bash
npx prisma migrate deploy
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

7. 在独立终端启动评估 worker

```bash
npm --workspace @ai-video-qc/api run worker:dev
```

API、Web、worker 是三个独立进程。评估接口的 `202` 仅表示任务已持久入队，不表示模型评估完成；未启动 worker 时任务会保持排队。页面通过返回的任务/评估 ID 查询进度，不能靠重复触发来代替 worker。

访问：

- 前端：http://localhost:3000
- 后端健康检查：http://localhost:3001/api/health

## 角色映射与权限

| Prisma UserRole | 业务角色 | 视频查看权限 | 结果数据写入与千问复盘触发 | 最终确认/案例标记 |
| --- | --- | --- | --- | --- |
| `admin` | 管理员 | 查看全部视频 | 全部适用视频类型 | 全部 |
| `content_owner` | 内容负责人 | 查看全部视频 | 全部适用视频类型 | 全部 |
| `supervisor` | 编导主管 | 查看本人及直属团队视频 | 只读 | 只读可见数据 |
| `director` | 编导 | 只能查看自己提交的视频 | 只读 | 只读本人数据 |
| `operator` | 运营 | 查看全部视频 | `product_card`、`organic`、`brand_seeding`、非投放 `other` | 只读 |
| `advertiser` | 投放 | 查看全部视频 | `qianchuan_ad`、`live_room_traffic`、投放 `other` | 只读 |

角色权限由后端校验，前端隐藏按钮不构成安全边界。

千问最终评定建议、负责人最终确认和案例标记仅允许 `admin` 和 `content_owner` 执行；其他角色只能按现有视频对象级权限读取正式结果、看板和案例。

## 第八阶段接口

- `POST /api/videos/:id/final-confirmation`：确认正式等级和绩效参考资格
- `PUT /api/videos/:id/case-marking`：标记优秀案例、反面案例或移除标记
- `GET /api/cases`：按类型、品牌、平台、视频类型、创建人和时间筛选案例
- `GET /api/dashboard/summary`：正式结果汇总与流程积压
- `GET /api/dashboard/trend`：按日或周统计确认趋势
- `GET /api/dashboard/breakdown`：按品牌、平台、视频类型或编导分组

最终确认是不可逆业务操作。接口只接收正式等级、绩效参考资格和必要说明；`finalStatus` 与最终有效性由后端推导，前端不能直接提交。

## 结果数据快照

`VideoResultMetric` 按不可变快照使用：

- 每次提交都创建新记录，不更新或删除历史记录。
- 未提交字段继承最新快照；具体值覆盖；明确传入 `null` 清空可选字段。
- `videoType`、`videoId`、`submittedBy` 和时间字段由后端管理。
- 已有快照时必须携带当前最新 `baseMetricId`，过期提交返回 `409`。
- 比率字段直接保存百分数数值，例如 `CTR 2.35%` 保存为 `2.35`。
- ROI 保存为倍数，例如 `ROI 2.5` 保存为 `2.5`。
- 金额、比率与 ROI 在 API 响应中统一返回字符串，避免 Decimal 精度丢失。
- 默认指标口径：广告点击率（CTR）=`广告总点击量 ÷ 曝光量 × 100%`，商品点击转化率=`订单量 ÷ 商品点击量 × 100%`，广告点击转化率（CVR）=`订单量 ÷ 广告总点击量 × 100%`，投产比（ROI）=`成交金额 ÷ 投放消耗金额`。
- 平台采用不同的播放、点击或转化归因口径时，必须在投放备注中说明，并以公司确认的平台口径为准。

界面面向业务用户统一展示中文状态、角色、规则候选、归因类型和操作日志；数据库与 API 仍保留稳定的英文枚举值，便于程序校验和兼容既有数据。AI 新生成的自然语言字段要求使用简体中文，历史原始返回内容继续按审计要求保留，不做覆盖改写。

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

V1.01 使用 HttpOnly Cookie 和服务端会话，登录不返回 Bearer Token。以下命令仅演示本机测试，先创建临时 Cookie 文件：

```bash
QC_COOKIE_FILE=$(mktemp -t ai-video-qc-cookie.XXXXXX)
```

登录测试：

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -c "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1" \
  -H "Content-Type: application/json" \
  -d '{"account":"admin","password":"<DEFAULT_ADMIN_PASSWORD>"}'
```

保存登录 Cookie 后，可调用（需要首次改密的账号应先在页面完成改密，再重新登录）：

```bash
curl http://localhost:3001/api/auth/me \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"
```

上传视频使用前端页面 `/videos/new`，或使用 multipart 请求调用：

```bash
curl -X POST http://localhost:3001/api/videos \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1" \
  -H "Idempotency-Key: $(uuidgen)" \
  -F "file=@/path/to/video.mp4" \
  -F "title=测试视频" \
  -F "videoType=product_card"
```

触发 Qwen-Omni 内容评估（仅限有权限的管理员、内容负责人或视频提交编导，返回 HTTP 202）：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/content-review \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"
```

查询最近一次内容评估（响应不会返回 `rawResponse`）：

```bash
curl http://localhost:3001/api/videos/<video-id>/content-review/latest \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"
```

提交主管初审：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/supervisor-review \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1" \
  -H "Content-Type: application/json" \
  -d '{"decision":"revision_required","comment":"请提前产品露出","revisionRequirements":["产品在前2秒出现"]}'
```

查询主管初审：

```bash
curl http://localhost:3001/api/videos/<video-id>/supervisor-review/latest \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"
```

上传返修版本：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/revisions \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1" \
  -H "Idempotency-Key: $(uuidgen)" \
  -F "file=@/path/to/revision.mp4" \
  -F "title=返修版本"
```

创建运营/投放结果数据快照：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/result-metrics \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1" \
  -H "Content-Type: application/json" \
  -d '{"baseMetricId":null,"dataStartDate":"2026-07-31","dataEndDate":"2026-08-02","views":1000}'
```

查询最新和历史快照：

```bash
curl http://localhost:3001/api/videos/<video-id>/result-metrics/latest \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"

curl "http://localhost:3001/api/videos/<video-id>/result-metrics/history?limit=20" \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"
```

平台基准配置（仅管理员和内容负责人）：

```bash
curl http://localhost:3001/api/platform-benchmarks \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"

curl -X POST http://localhost:3001/api/platform-benchmarks \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1" \
  -H "Content-Type: application/json" \
  -d '{"platform":"抖音","brand":null,"videoType":"product_card","metricName":"roi","sThreshold":3,"aThreshold":2.5,"bThreshold":2,"cThreshold":1,"direction":"higher_is_better","enabled":true}'
```

上述阈值仅演示接口格式；试运行时必须替换为公司已确认的真实业务基准。

触发千问数据复盘（只允许最新快照，返回 HTTP 202）：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/result-review \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1" \
  -H "Content-Type: application/json" \
  -d '{"resultMetricId":"<latest-result-metric-id>"}'
```

查询最新复盘和历史复盘（均不返回 `rawResponse`）：

```bash
curl http://localhost:3001/api/videos/<video-id>/result-review/latest \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"

curl "http://localhost:3001/api/videos/<video-id>/result-reviews/history?limit=20" \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"
```

执行后端规则引擎（仅管理员和内容负责人，返回 HTTP 201）：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/rule-engine \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1" \
  -H "Content-Type: application/json" \
  -d '{"resultReviewId":"<latest-succeeded-result-review-id>"}'
```

查询最新和历史规则结果：

```bash
curl http://localhost:3001/api/videos/<video-id>/rule-engine/latest \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"

curl "http://localhost:3001/api/videos/<video-id>/rule-engine/history?limit=20" \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"
```

生成千问最终评定建议（仅管理员和内容负责人，返回 HTTP 202）：

```bash
curl -X POST http://localhost:3001/api/videos/<video-id>/final-evaluation \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1" \
  -H "Content-Type: application/json" \
  -d '{"ruleEngineResultId":"<latest-rule-engine-result-id>"}'
```

查询最新和历史最终评定建议（不返回 `rawResponse` 或人工确认结论）：

```bash
curl http://localhost:3001/api/videos/<video-id>/final-evaluation/latest \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"

curl "http://localhost:3001/api/videos/<video-id>/final-evaluations/history?limit=20" \
  -b "$QC_COOKIE_FILE" \
  -H "Origin: http://localhost:3000" \
  -H "X-QC-CSRF: 1"
```

V1.01 隔离 HTTP 验收（先按发布手册准备本机四个专库；拒绝默认业务库和非本机目标）：

```bash
QC_LOCAL_REHEARSAL=1 node deploy/lighthouse/verify-local.mjs
```

`pending_data` 回流路径：通过第四阶段接口创建新的数据快照并回到 `pending_result_data`，重新执行第五阶段千问数据复盘；成功后再次进入 `pending_rule_engine`，由新的 `resultReviewId` 创建新的不可变规则结果。

## 安全边界

- 视频文件保存在 `storage/videos/`，该目录已加入 `.gitignore`。
- 视频文件不通过静态目录公开。
- 访问视频文件必须调用 `GET /api/videos/:id/file` 并携带有效会话 Cookie；旧 Bearer Token 不再受理。
- 百炼和 OSS 密钥只允许放在后端环境变量；前端、seed 和数据库不保存任何密钥。
- Qwen-Omni 只负责视频内容理解和内容质量等级，不负责运营/投放数据、最终有效等级或绩效判断。
- `platform_benchmarks` 只用于运营/投放数据复盘，不参与内容质量总分；内容评分规则及人工校准方法见 `docs/content-score-calibration-guide.md`。
- 内容评估使用私有 OSS 临时对象和短时签名 URL；任务完成后立即删除，并建议为临时前缀配置生命周期兜底清理。
- 千问文本模型只读取结构化结果数据和经过筛选的上下文，不读取视频、URL、本地路径、用户账号、AI 原始响应或操作日志。
- `JWT_EXPIRES_IN` 必须带 `s`、`m` 或 `h` 后缀，例如 `7200s`、`120m` 或 `2h`；裸数字会被拒绝。

## 后续建议

- 使用公司已确认的投放口径录入平台基准，并在试运行后按平台、品牌和视频类型逐步校准。

## V1.01 管理运行中心（本地实现，待上线验收）

管理员从 `/admin` 或 `/admin/operations` 进入运行总览、任务尝试记录、AI 配置状态、存储清理、调用费用、白名单设置、配置版本、日志、安全事件、会话及依赖状态。使用现有 Cookie 会话与 CSRF 校验；管理接口只允许管理员访问。

- 部署前执行正常数据库迁移，新增 `20260910000100_admin_operations`，再构建 API、Web 并重启独立评估 worker。迁移先在隔离数据库验收，生产维护仍需批准。
- 任务重试要求填写原因并确认，会新建评估和任务、关联原任务并原子记录审计；保留原始 AI 结果，重新校验原提交人身份和额度。已重试或被替代的旧任务不可再次重试。
- 调用采集从迁移启用后开始，以任务、attempt、提交人、阶段关联。估算采用请求开始时的费率快照；缺少供应商用量或匹配费率时显示未知。实际云账单未接入，绝不以估算代替实付金额。当前费率白名单支持一组模型费率，修改仅影响之后匹配该模型的请求。
- COS 清理统计来自本系统上传票据；OSS 临时对象状态从新采集台账读取。应用登记容量不代表远端总容量；历史孤儿对象、生命周期设置及云端清单仍需外部核验。
- `/api/health/live` 仅报告 API 存活；`/api/health/ready` 检查数据库连接，失败返回 503。管理员依赖页单独展示 worker 心跳；AI 连通、云账单、服务器资源、备份、证书未接入时均明确标注。没有自动付费诊断。
- `GET /api/admin/operations/usage-summary` 提供按阶段、模型、币种和调用状态分类的汇总与采集覆盖数；受控 CSV 导出最多 1000 条，并记录导出原因。未知值保持空值。
- 平台基准修改保留不可变版本；首次修改旧基准时先保存修改前基线。既有评估任务继续使用原输入快照。

审查修复新增迁移 `20260910000200_admin_review_observability`：调用记录保存正式/试用分类与采集状态，任务和attempt保存有限错误分类。总览的日期任务与当前积压分别展示；`job-statistics` 返回等待/处理分位数与终态成功率。调用支持 `scope`、`modelName` 筛选，日志支持操作者/对象/动作/结果/时间检索与受控导出。白名单配置扩展到站点、平台/视频类型选项、访客授权模板、保留复核阈值、站内告警阈值、后续文本评估参数；不保存密钥、不改写已排队快照、不自动删除原始历史。独立worker进程每15秒维护心跳，管理授权在入口或事务中被拒绝均追加脱敏安全事件。

验证方式：`npm test`、`npm run typecheck`、`npm run build`；专用 PostgreSQL 测试使用 `OPS_TEST_DATABASE_URL` 指向 `127.0.0.1:55439/ops_test`，在 API 目录运行 `node --import tsx --test src/tests/admin-operations.integration.spec.ts`（先构建 API）。本机 Web 启动在 3044 后运行 `QC_LOCAL_REHEARSAL=1 OPS_BROWSER_BASE_URL=http://127.0.0.1:3044 node apps/web/scripts/admin-operations-browser-acceptance.mjs`，只模拟本地请求，不发起模型调用；验收进程拒绝 production 模式和远端目标。
