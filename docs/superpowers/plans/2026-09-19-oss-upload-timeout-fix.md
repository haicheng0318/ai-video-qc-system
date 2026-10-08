# OSS 视频上传超时修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复内容评估在临时视频上传阶段因 `ali-oss` 60 秒默认超时而失败的问题，并让后台正确展示“超时”错误类别。

**Architecture:** 保留现有“本地视频 → 私有 OSS 临时对象 → 签名 URL → Qwen 内容评估 → 删除临时对象”链路。第一步只增加可配置的 OSS 上传超时和递归异常分类，不更改数据库、业务状态机或 AI Prompt。分片上传作为观察后的二期增强，避免为紧急修复引入额外发布风险。

**Tech Stack:** NestJS / TypeScript / Node.js 20+ / `ali-oss` 6.23 / Node Test Runner / Docker Compose

**Spec:** `AGENTS.md` 中的 AI 输出、异常状态、原始结果保留和生产密钥安全要求；`docs/V1.01-本地验收与发布手册.md`

**Implementation status (2026-09-19):** Tasks 1–7 completed, deployed, and accepted. The single authorized paid retry (`92f2ebec-b10c-4667-b501-35c5757aaf26`) completed in 107.35 seconds; the video advanced to `pending_supervisor_review`, and its temporary OSS object was cleaned.

## Global Constraints

- 不覆盖或回退当前工作区的任何已有修改，禁止 `git reset --hard` 和 `git checkout --`。
- 只修改 OSS 上传超时、评估异常分类、测试与配置文档；不修改 Prompt、评分、权限、数据库和业务流程。
- `OSS_REQUEST_TIMEOUT_MS` 默认为 `300000`，非正整数配置回退到 `300000`。
- 不把 OSS 或 DashScope 密钥写入代码、日志、测试输出或 Git。
- 本次无 Prisma Schema 变更，无数据库迁移。
- 发布前和回退前保留原 API 镜像 ID、Worker 镜像 ID、Compose 解析结果和容器日志证据。
- 最后的单条内容评估会产生模型费用，必须在发布完成后再取得明确授权。

---

### Task 1: 保留现场并建立窄基线

**Files:**
- Inspect: `apps/api/src/modules/ai/gemini/qwen.client.ts`
- Inspect: `apps/api/src/modules/evaluation-jobs/evaluation-jobs.service.ts`
- Inspect: `apps/api/src/tests/gemini.client.spec.ts`
- Inspect: `apps/api/src/tests/evaluation-jobs.spec.ts`

**Interfaces:**
- Consumes: 当前未提交工作区和生产容器只读证据。
- Produces: 本次修复文件的 pre-image diff 和窄测试基线。

- [ ] **Step 1: 保存目标文件现有差异**

Run:

```bash
git diff -- apps/api/src/modules/ai/gemini/qwen.client.ts \
  apps/api/src/modules/evaluation-jobs/evaluation-jobs.service.ts \
  apps/api/src/tests/gemini.client.spec.ts \
  apps/api/src/tests/evaluation-jobs.spec.ts \
  .env.example README.md deploy/lighthouse/.env.example
```

Expected: 只读输出；人工标记每个已有 hunk，后续 patch 不得替换整个文件。

- [ ] **Step 2: 运行当前窄测试**

Run:

```bash
node --import tsx --test \
  apps/api/src/tests/gemini.client.spec.ts \
  apps/api/src/tests/evaluation-jobs.spec.ts
```

Expected: 记录现有 PASS/FAIL；本次只对新增断言导致的预期失败负责。

### Task 2: 用测试定义 OSS 超时行为

**Files:**
- Modify: `apps/api/src/tests/gemini.client.spec.ts`
- Modify: `apps/api/src/modules/ai/gemini/qwen.client.ts`

**Interfaces:**
- Consumes: `QwenClient.analyzeVideo(filePath, mimeType, modelName, prompt)`。
- Produces: `OSS_REQUEST_TIMEOUT_MS` 解析结果，并通过 `oss.put(..., { timeout, headers })` 生效。

- [ ] **Step 1: 增加失败测试**

在已有“uploads a private temporary video”测试中增加：

```ts
const putOptions = calls[0].options as Record<string, unknown>;
assert.equal(putOptions.timeout, 300_000);
```

另增一个配置覆盖测试：保存原 `process.env.OSS_REQUEST_TIMEOUT_MS`，设为 `180000`，构造 `QwenClient`并执行一次 mock 分析，断言 `put` 的 `options.timeout === 180_000`，在 `finally` 中恢复原环境变量。

- [ ] **Step 2: 验证新断言先失败**

Run:

```bash
node --import tsx --test apps/api/src/tests/gemini.client.spec.ts
```

Expected: FAIL，当前 `putOptions.timeout` 为 `undefined`。

- [ ] **Step 3: 实现最小修复**

在 `QwenClient` 增加：

```ts
private readonly ossRequestTimeoutMs: number;
```

在构造函数中赋值：

```ts
this.ossRequestTimeoutMs = positiveInteger(
  process.env.OSS_REQUEST_TIMEOUT_MS,
  300_000,
);
```

将 OSS 上传调用改为：

```ts
await dependencies.oss.put(objectName, filePath, {
  timeout: this.ossRequestTimeoutMs,
  headers: {
    'Content-Type': mimeType,
    'x-oss-object-acl': 'private',
    'x-oss-forbid-overwrite': 'true',
  },
});
```

- [ ] **Step 4: 验证窄测试通过**

Run:

```bash
node --import tsx --test apps/api/src/tests/gemini.client.spec.ts
```

Expected: PASS，且临时对象私有 ACL、签名 URL、成功/失败后清理行为保持不变。

### Task 3: 让嵌套 OSS 超时正确分类

**Files:**
- Modify: `apps/api/src/tests/evaluation-jobs.spec.ts`
- Modify: `apps/api/src/modules/evaluation-jobs/evaluation-jobs.service.ts`

**Interfaces:**
- Consumes: `classifyEvaluationError(error: unknown)` 和嵌套 `cause`。
- Produces: 有界的异常链扫描，对 `ResponseTimeoutError`、`ETIMEDOUT` 和含 `TIMEOUT` 的 code 返回 `timeout`。

- [ ] **Step 1: 增加失败测试**

将 `classifyEvaluationError` 加入测试 import，并新增：

```ts
test('nested OSS response timeout is classified as timeout', () => {
  const timeout = Object.assign(new Error('Response timeout for 60000ms'), {
    name: 'ResponseTimeoutError',
  });
  const wrapped = Object.assign(new Error('Qwen content review request failed.'), {
    code: 'CONTENT_REVIEW_REQUEST_FAILED',
    cause: timeout,
  });

  assert.equal(classifyEvaluationError(wrapped), 'timeout');
});
```

再增加一个深两层的 `cause.code = 'ETIMEDOUT'` 测试，确保不只检查第一层。

- [ ] **Step 2: 验证测试先失败**

Run:

```bash
node --import tsx --test apps/api/src/tests/evaluation-jobs.spec.ts
```

Expected: `ResponseTimeoutError` 被现有实现错分为 `provider_or_execution`。

- [ ] **Step 3: 实现有界异常链分类**

新增一个最多遍历 6 层 `cause` 的局部 helper，每层只读 `code`、`name`、`status`；不将 `message`写入操作日志。超时条件为：

```ts
code === 'ETIMEDOUT' || code.includes('TIMEOUT') || name.includes('Timeout')
```

401/403/429 继续按现有优先级分类，其他类别语义不变。

- [ ] **Step 4: 运行分类测试**

Run:

```bash
node --import tsx --test apps/api/src/tests/evaluation-jobs.spec.ts
```

Expected: PASS；新的 OSS 超时被记为 `timeout`。

### Task 4: 补齐生产配置契约

**Files:**
- Modify: `.env.example`
- Modify: `deploy/lighthouse/.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `OSS_REQUEST_TIMEOUT_MS`。
- Produces: 本地和生产一致的配置说明。

- [ ] **Step 1: 增加非密钥配置**

在 OSS 配置组中增加：

```dotenv
OSS_REQUEST_TIMEOUT_MS="300000"
```

在 README 说明：该值只控制临时 OSS 对象上传请求的毫秒超时，不改变 `QWEN_REQUEST_TIMEOUT_MS`。

- [ ] **Step 2: 检查配置文档不包含真实密钥**

Run:

```bash
git diff --check
git diff -- .env.example deploy/lighthouse/.env.example README.md
```

Expected: 无空白错误；只有新的非敏感超时配置与说明。

### Task 5: 本地验证与发布门禁

**Files:**
- Verify: 上述全部修改文件
- Verify: `deploy/lighthouse/compose.yaml`
- Verify: `docs/V1.01-本地验收与发布手册.md`

**Interfaces:**
- Consumes: 修复后 API 源码。
- Produces: 可发布的唯一 API/Worker 镜像候选和完整测试证据。

- [ ] **Step 1: 运行窄测试、API 全测试、类型检查和构建**

Run:

```bash
node --import tsx --test \
  apps/api/src/tests/gemini.client.spec.ts \
  apps/api/src/tests/evaluation-jobs.spec.ts
npm run test:api
npm run typecheck:api
npm run build --workspace @ai-video-qc/api
```

Expected: 全部 PASS；不触发真实 OSS 上传或模型调用。

- [ ] **Step 2: 运行发布脚本的本地门禁**

Run:

```bash
node --test deploy/lighthouse/tests/*.spec.mjs
QC_LOCAL_REHEARSAL=1 node deploy/lighthouse/local-release.mjs rehearse
QC_LOCAL_REHEARSAL=1 node deploy/lighthouse/verify-local.mjs
```

Expected: PASS；只创建独立的本地演练产物，不连接或改动生产。

- [ ] **Step 3: 审查最终差异**

Run:

```bash
git diff --check
git diff --stat
git diff -- apps/api/src/modules/ai/gemini/qwen.client.ts \
  apps/api/src/modules/evaluation-jobs/evaluation-jobs.service.ts \
  apps/api/src/tests/gemini.client.spec.ts \
  apps/api/src/tests/evaluation-jobs.spec.ts \
  .env.example deploy/lighthouse/.env.example README.md
```

Expected: 差异只包含本计划的超时、错误分类、测试和文档 hunk。

### Task 6: 小范围生产发布与回退准备

**Files:**
- Operate: `deploy/lighthouse/compose.yaml`
- Configure on server only: `deploy/lighthouse/.env`

**Interfaces:**
- Consumes: 经测试的不可变 API 镜像，API 和 Worker 使用同一个 image ID。
- Produces: 运行修复版的 API/Worker，可用原 image ID 立即回退。

- [ ] **Step 1: 发布前只读取证**

记录当前 API/Worker 容器的完整 image ID、健康状态、Worker 心跳、队列数和最近错误。保留原 `API_IMAGE` 值作为回退点，不打印其他 `.env` 内容。

- [ ] **Step 2: 构建一次候选镜像并登记不可变 ID**

候选 API 镜像只构建一次；将目标主机的完整 `sha256:` image ID 写入 `API_IMAGE`。本次无迁移，但仍按发布手册完成 Compose 解析与镜像一致性检查。

- [ ] **Step 3: 先 API，后 Worker**

使用已核准 Compose 项目执行：

```bash
docker compose --env-file deploy/lighthouse/.env \
  -f deploy/lighthouse/compose.yaml up -d --no-build --no-deps api
docker compose --env-file deploy/lighthouse/.env \
  -f deploy/lighthouse/compose.yaml up -d --no-build --no-deps worker
```

API 切换后先验证 `/api/health/live` 和 `/api/health/ready`；Worker 切换前验证它与 API 的完整 image ID 完全一致。

- [ ] **Step 4: 无付费生产观察**

验证 API 健康、Worker 心跳、无循环重启、无新的配置错误。不点击“重试”，不发起真实 AI 评估。

- [ ] **Step 5: 定义回退触发条件**

如 API 不就绪、Worker 无心跳、容器循环重启或新错误率上升，将 `API_IMAGE` 恢复为已记录的原完整 image ID，按同样的 API → Worker 顺序重建容器，再验证健康与心跳。

### Task 7: 单条付费验证与验收

**Files:**
- No source changes
- Observe: 管理后台、Worker 日志、`evaluation_jobs`、`temporary_storage_records`、`ai_content_reviews`

**Interfaces:**
- Consumes: 用户对一次付费评估的明确授权。
- Produces: 修复成功或回退/二期的验收结论。

- [ ] **Step 1: 只选一条已失败视频**

优先选择 32.2 MB 的“新婚礼物”，以便与原 61 秒超时记录直接对比。不批量重试其他 8 条。

- [ ] **Step 2: 取得付费调用授权后重试一次**

只点击一次重试，记录 job ID、开始时间、OSS 上传完成时间、Qwen 返回时间和最终状态。

- [ ] **Step 3: 核对验收条件**

PASS 必须同时满足：

- 任务不再于 60–63 秒因 OSS 响应超时失败。
- `temporary_storage_records` 状态经过 `uploading` / `uploaded` 并最终为 `cleaned`。
- `ai_content_reviews` 保存结构化结果、`raw_response`、模型名和状态。
- 视频流转到 `pending_supervisor_review`，没有跳过主管初审。
- 操作日志中有新评估记录，不更改或覆盖旧失败记录。

- [ ] **Step 4: 处理仍失败的情况**

如仍为 OSS 上传超时，停止重试，不继续产生费用；进入二期：将 20 MB 以上文件切换为 `multipartUpload`，增加分片大小、并发数、checkpoint 和分片失败测试。如失败原因变为 Qwen 限流、配额或输出解析，则按新的准确异常类别单独诊断，不将其与 OSS 修复混合。

## Completion Report

完成后按项目交付格式输出：已完成内容、修改文件、新增接口（预期无）、数据表/字段（预期无）、启动方式、测试方式、已知问题、与 PRD 差异（预期无）、下一步建议。
