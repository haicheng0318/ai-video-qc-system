# 内容质量评分校准 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将内容质量总分从“模型自由填写”改为“模型提供逐维度证据和原始等级，后端按版本化规则确定性计算总分与 S/A/B/C/D”，消除不同视频长期集中为 85/A 的现象。

**Architecture:** Qwen-Omni 继续负责观看视频、识别内容表现、输出 12 个固定维度的 0–5 原始等级和证据；新增纯函数评分器，根据视频类型对应的固定权重计算 0–100 总分，再由后端生成内容等级和发布建议。评分规则、Prompt 和持久化结果都带版本号；历史结果保留为 legacy，不回写、不覆盖、不自动重评。

**Tech Stack:** NestJS / TypeScript / Zod / Prisma / PostgreSQL / Qwen-Omni structured JSON / Node Test Runner / Next.js

**Spec:** `AGENTS.md` 第三、四、八、九、十一、十四、十五、十七节；现有内容评估实现 `apps/api/src/modules/ai/gemini/`

## Global Constraints

- Gemini/Qwen-Omni 只负责视频内容质量观察，不读取运营投放结果，不输出绩效结论。
- `platform_benchmarks` 继续只用于运营/投放数据复盘；内容评分使用独立的版本化 rubric，禁止混用。
- 历史 `ai_content_reviews`、`content_review_scores` 和 `raw_response` 不得覆盖或重新解释。
- 新评分结果必须能通过 `scoringVersion`、`promptVersion`、原始维度等级和证据复现。
- 总分和内容等级必须由后端代码计算，不能只写在 Prompt 中。
- V1.01 不增加管理员可编辑权重页面；首版权重写入版本化代码，降低误配置风险。
- 所有新的结构化输出继续使用 JSON Schema 和 Zod 双重校验。
- 不自动触发任何生产付费评估；生产灰度样本必须再次取得明确授权。
- 当前工作区包含大量既有修改；执行前必须使用隔离 worktree，不在现分支直接批量修改或提交。

---

## Target scoring contract

固定维度代码：

```ts
export const contentDimensionCodes = [
  'hook', 'product_exposure', 'selling_points', 'visual_quality',
  'composition', 'camera_language', 'pacing', 'subtitle_clarity',
  'voiceover_clarity', 'bgm_fit', 'platform_fit', 'purpose_fit',
] as const;
```

统一原始等级：

- `0`：完全缺失或明显不可用；
- `1`：严重不达标；
- `2`：存在明显问题；
- `3`：达到最低可用标准；
- `4`：表现良好；
- `5`：表现优秀，证据充分。

V1.01 默认权重：

| 维度 | 权重 |
|---|---:|
| 前3秒吸引力 | 15 |
| 产品露出 | 10 |
| 卖点表达 | 15 |
| 画面质感 | 10 |
| 构图 | 5 |
| 镜头语言 | 5 |
| 节奏 | 10 |
| 字幕清晰度 | 5 |
| 口播清晰度 | 5 |
| BGM匹配度 | 5 |
| 平台适配 | 7 |
| 用途适配 | 8 |
| 合计 | 100 |

确定性计算：

```ts
baseScore = Math.round(sum((rating / 5) * weight));
finalScore = Math.min(baseScore, hardCap);
grade = finalScore >= 90 ? 'S'
  : finalScore >= 80 ? 'A'
  : finalScore >= 70 ? 'B'
  : finalScore >= 60 ? 'C'
  : 'D';
```

首版硬边界：

- 任一 `high` 合规风险：总分上限 `59`，发布建议强制为 `false`；
- 商品卡、千川投放、直播间引流视频的 `product_exposure=0`：总分上限 `69`；
- `score` 证据缺失、维度缺失、维度重复或维度超出枚举：结构校验失败，不保存成功结果；
- 不因为无法读取运营数据而扣内容分，内容评估阶段不得引用 ROI、CTR、CVR。

---

### Task 1: 建立版本化纯函数评分器

**Files:**
- Create: `apps/api/src/modules/ai/gemini/content-scoring.ts`
- Create: `apps/api/src/tests/content-scoring.spec.ts`

**Interfaces:**
- Consumes: `videoType`, 12 个固定维度的 `rating`，结构化合规风险。
- Produces: `calculateContentScore(input): CalculatedContentScore`、`CONTENT_SCORING_VERSION`、`CONTENT_SCORING_PROFILES`。

- [ ] **Step 1: 编写评分器失败测试**

覆盖：全 5 分得到 100/S；全 4 分得到 80/A；阈值 90/89/80/79/70/69/60/59；高风险封顶 59；强产品视频无产品露出封顶 69；同一输入重复计算结果一致。

```ts
test('high compliance risk caps the deterministic score at 59', () => {
  const result = calculateContentScore({
    videoType: 'product_card',
    scores: allRatings(5),
    complianceRisks: [{ severity: 'high' }],
  });
  assert.deepEqual(result, {
    scoringVersion: 'content-score-v2',
    baseScore: 100,
    totalScore: 59,
    contentGrade: 'D',
    hardCap: 59,
    reasonCodes: ['HIGH_COMPLIANCE_RISK'],
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node --import tsx --test apps/api/src/tests/content-scoring.spec.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现评分器和固定权重**

```ts
export const CONTENT_SCORING_VERSION = 'content-score-v2';

export function calculateContentScore(input: ContentScoringInput): CalculatedContentScore {
  const profile = CONTENT_SCORING_PROFILES[input.videoType] || CONTENT_SCORING_PROFILES.other;
  const baseScore = Math.round(input.scores.reduce(
    (sum, item) => sum + item.rating / 5 * profile.weights[item.dimension], 0,
  ));
  const reasons: ContentScoreReasonCode[] = [];
  let hardCap = 100;
  if (input.complianceRisks.some((risk) => risk.severity === 'high')) {
    hardCap = 59;
    reasons.push('HIGH_COMPLIANCE_RISK');
  }
  if (profile.requiresProductExposure &&
      input.scores.find((item) => item.dimension === 'product_exposure')?.rating === 0) {
    hardCap = Math.min(hardCap, 69);
    reasons.push('REQUIRED_PRODUCT_NOT_VISIBLE');
  }
  const totalScore = Math.min(baseScore, hardCap);
  return { scoringVersion: CONTENT_SCORING_VERSION, baseScore, totalScore,
    contentGrade: gradeFromScore(totalScore), hardCap, reasonCodes: reasons };
}
```

- [ ] **Step 4: 运行评分器测试**

Run: `node --import tsx --test apps/api/src/tests/content-scoring.spec.ts`

Expected: PASS。

- [ ] **Step 5: 独立评审门**

确认权重总和严格为 100，所有视频类型均映射到显式 profile，评分函数不访问数据库、不访问环境变量、不调用模型。

---

### Task 2: 收紧 Qwen 结构化输出合同

**Files:**
- Modify: `apps/api/src/modules/ai/gemini/gemini.schema.ts`
- Modify: `apps/api/src/modules/ai/gemini/gemini.types.ts`
- Modify: `apps/api/src/modules/ai/gemini/gemini.prompt.ts`
- Modify: `apps/api/src/tests/gemini.schema.spec.ts`
- Modify: `apps/api/src/tests/gemini.client.spec.ts`

**Interfaces:**
- Consumes: `contentDimensionCodes` 和 0–5 rubric。
- Produces: `ContentReviewModelOutput`，不再信任模型提供的 `totalScore` 或 `contentGrade`。

- [ ] **Step 1: 编写新合同失败测试**

增加以下断言：

```ts
assert.throws(() => validateContentReviewOutput({
  ...validOutput,
  scores: validOutput.scores.slice(0, 11),
}), ContentReviewOutputValidationError);

assert.throws(() => validateContentReviewOutput({
  ...validOutput,
  scores: validOutput.scores.map((item, index) => index === 1
    ? { ...item, dimension: 'hook' }
    : item),
}), ContentReviewOutputValidationError);
```

同时断言 JSON Schema 的 `scores.minItems`、`scores.maxItems` 均为 `12`，`dimension` 为固定 enum，`rating` 为 `0..5` 整数。

- [ ] **Step 2: 运行测试并确认旧合同失败**

Run:

```bash
node --import tsx --test \
  apps/api/src/tests/gemini.schema.spec.ts \
  apps/api/src/tests/gemini.client.spec.ts
```

Expected: 至少在维度数量、重复维度或固定 enum 断言上 FAIL。

- [ ] **Step 3: 修改模型输出 Schema**

模型维度结构统一为：

```ts
const scoreItemSchema = z.object({
  dimension: z.enum(contentDimensionCodes),
  rating: z.number().int().min(0).max(5),
  evidence: z.string().min(1).max(1000),
  timestamp: z.string().max(30).nullable(),
}).strict();
```

`scores` 必须 `.length(12)` 且全部唯一；`complianceRisks` 增加 `severity: high | medium | low`。从模型响应的 required 字段中移除 `totalScore`、`contentGrade`，发布建议保留为模型观察值供审计。

- [ ] **Step 4: 将 Prompt 更新为固定量表**

Prompt 必须逐字包含：

```text
每个维度只能使用0、1、2、3、4、5六个整数等级：
0=完全缺失或明显不可用；1=严重不达标；2=存在明显问题；
3=达到最低可用标准；4=表现良好；5=表现优秀且证据充分。
必须输出全部12个维度，每个维度恰好一次。
你只提供逐维度观察和证据，不计算总分，不输出S/A/B/C/D等级。
```

将 `CONTENT_REVIEW_PROMPT_VERSION` 更新为 `content-review-v3-deterministic-score`。

- [ ] **Step 5: 运行合同测试**

Run:

```bash
node --import tsx --test \
  apps/api/src/tests/gemini.schema.spec.ts \
  apps/api/src/tests/gemini.client.spec.ts
```

Expected: PASS；JSON Schema 和 Zod 使用相同字段、枚举和边界。

---

### Task 3: 版本化持久化且不覆盖历史结果

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260919_add_content_scoring_version/migration.sql`
- Modify: `apps/api/src/modules/ai/gemini/gemini.service.ts`
- Modify: `apps/api/src/tests/gemini.service.spec.ts`
- Modify: `apps/api/src/tests/gemini-migration.spec.ts`（不存在则创建）

**Interfaces:**
- Consumes: `ContentReviewModelOutput` 和 `calculateContentScore()`。
- Produces: 带 `scoringVersion`、`promptVersion`、确定性总分/等级的 `AiContentReview`。

- [ ] **Step 1: 编写迁移和服务失败测试**

服务测试必须证明：即使模拟模型曾给出 85，也只使用维度等级计算结果；原始模型响应仍保存在 `raw_response.rawText` 和 `raw_response.parsedModelOutput` 中。

```ts
assert.equal(saved.totalScore, 80);
assert.equal(saved.contentGrade, 'A');
assert.equal(saved.scoringVersion, 'content-score-v2');
assert.equal(saved.promptVersion, 'content-review-v3-deterministic-score');
assert.equal(saved.rawResponse.calculated.totalScore, 80);
```

- [ ] **Step 2: 增加可空版本字段**

Prisma：

```prisma
scoringVersion String? @map("scoring_version") @db.VarChar(80)
promptVersion  String? @map("prompt_version") @db.VarChar(80)
```

迁移 SQL：

```sql
ALTER TABLE "ai_content_reviews"
  ADD COLUMN "scoring_version" VARCHAR(80),
  ADD COLUMN "prompt_version" VARCHAR(80);

UPDATE "ai_content_reviews"
SET "scoring_version" = 'legacy-model-score-v1',
    "prompt_version" = 'phase-2-content-review-v2-qwen-omni'
WHERE "status" = 'succeeded' AND "scoring_version" IS NULL;
```

字段保持可空，避免运行中/失败记录伪装为完整评分结果。

- [ ] **Step 3: 接入后端计算并保存原因**

`processContentReview()` 在 Zod 校验后调用评分器：

```ts
const calculated = calculateContentScore({
  videoType: video.videoType,
  scores: output.scores,
  complianceRisks: output.complianceRisks,
});
```

保存：

```ts
totalScore: calculated.totalScore,
contentGrade: calculated.contentGrade,
isPublishableRecommendation:
  output.isPublishableRecommendation && calculated.hardCap === 100,
scoringVersion: calculated.scoringVersion,
promptVersion: CONTENT_REVIEW_PROMPT_VERSION,
rawResponse: {
  rawText: sanitizedRawText,
  parsedModelOutput: output,
  calculated,
  usage: result.usage || null,
  usageCollectionStatus: result.usageCollectionStatus || 'unknown',
},
```

`content_review_scores` 继续使用现表：`dimension=dimension code`、`score=rating`、`max_score=5`、`comment=evidence`。不删除旧记录。

- [ ] **Step 4: 运行迁移和服务测试**

Run:

```bash
node --import tsx --test \
  apps/api/src/tests/gemini.service.spec.ts \
  apps/api/src/tests/gemini-migration.spec.ts
npx prisma validate
```

Expected: PASS；历史行只获得 legacy 版本标记，原总分和等级不变化。

---

### Task 4: API 与页面解释评分来源

**Files:**
- Modify: `apps/api/src/modules/ai/gemini/gemini.service.ts`
- Modify: `apps/web/app/videos/[id]/page.tsx`
- Modify: `apps/web/src/lib/api.ts`（仅在共享类型需要时）
- Modify: `apps/web/src/tests/phase-2-ui.spec.ts`（不存在则创建）

**Interfaces:**
- Consumes: `scoringVersion`、`promptVersion`、0–5 维度原始等级。
- Produces: 可解释的内容评分 UI，不把历史模型分与新规则分混为一类。

- [ ] **Step 1: 编写 UI 失败测试**

断言新结果显示：

```text
评分规则：content-score-v2
维度等级：4 / 5
总分由后端规则计算
```

断言历史结果显示：

```text
历史模型评分（legacy-model-score-v1）
```

- [ ] **Step 2: 扩展 latest API 响应**

在 review DTO 中增加：

```ts
scoringVersion: review.scoringVersion,
promptVersion: review.promptVersion,
scoreCalculation: review.scoringVersion === 'content-score-v2'
  ? 'backend_deterministic'
  : 'legacy_model_reported',
```

- [ ] **Step 3: 更新页面文案与维度标签**

前端用固定 label map 将 `hook` 显示为“前3秒吸引力”等中文名称；新结果显示 `rating / 5`，历史结果保留数据库中的原 `score / maxScore`。

- [ ] **Step 4: 运行 API/UI 测试**

Run:

```bash
node --import tsx --test apps/web/src/tests/phase-2-ui.spec.ts
npm run typecheck
```

Expected: PASS；历史详情页继续可读，新详情页能说明分数来源。

---

### Task 5: 建立离线校准样本和分布门槛

**Files:**
- Create: `apps/api/src/tests/fixtures/content-score-calibration.json`
- Create: `apps/api/src/tests/content-score-calibration.spec.ts`
- Create: `docs/content-score-calibration-guide.md`

**Interfaces:**
- Consumes: 人工给出的 20–30 条匿名化视频标注或已确认的结构化维度等级。
- Produces: 阈值一致性、等级一致率、分数分布和“85集中度”回归门槛。

- [ ] **Step 1: 定义固定校准数据格式**

```json
{
  "fixtureVersion": "content-calibration-v1",
  "cases": [{
    "id": "case-001",
    "videoType": "product_card",
    "ratings": {
      "hook": 2,
      "product_exposure": 4,
      "selling_points": 3,
      "visual_quality": 4,
      "composition": 3,
      "camera_language": 3,
      "pacing": 2,
      "subtitle_clarity": 4,
      "voiceover_clarity": 4,
      "bgm_fit": 3,
      "platform_fit": 3,
      "purpose_fit": 4
    },
    "complianceRisks": [],
    "expectedGrade": "B"
  }]
}
```

仓库首批只放不含视频文件、不含用户信息的结构化匿名样本。

- [ ] **Step 2: 增加分布回归测试**

```ts
assert.ok(uniqueScores.size >= Math.min(5, cases.length));
assert.ok(cases.filter((item) => calculate(item).totalScore === 85).length / cases.length < 0.3);
assert.ok(gradeAgreement >= 0.8);
```

当样本不足 20 条时，测试只验证计算和边界，不宣称业务准确率；达到 20 条后启用一致率门槛。

- [ ] **Step 3: 编写人工标注规范**

文档明确：每条样本由至少 2 名业务审核人独立标注；分歧超过 1 个等级时由内容负责人复核；只记录最终共识等级和12维度等级；不使用真实运营数据影响内容评分。

- [ ] **Step 4: 运行校准测试**

Run:

```bash
node --import tsx --test apps/api/src/tests/content-score-calibration.spec.ts
```

Expected: PASS，并打印样本数、唯一分数数、85分占比和人工等级一致率。

---

### Task 6: 完整验证与兼容性回归

**Files:**
- Modify: `.env.example`（仅当新增非密钥开关）
- Modify: `README.md`
- Modify: `docs/V1.01-本地验收与发布手册.md`

**Interfaces:**
- Consumes: Tasks 1–5 的实现。
- Produces: 可重复的本地验收证据和发布说明。

- [ ] **Step 1: 运行窄测试**

Run:

```bash
node --import tsx --test \
  apps/api/src/tests/content-scoring.spec.ts \
  apps/api/src/tests/gemini.schema.spec.ts \
  apps/api/src/tests/gemini.client.spec.ts \
  apps/api/src/tests/gemini.service.spec.ts \
  apps/api/src/tests/content-score-calibration.spec.ts
```

Expected: 0 FAIL。

- [ ] **Step 2: 运行全量测试、类型检查和构建**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: 全部退出码 0。

- [ ] **Step 3: 本地数据库迁移演练**

在临时 PostgreSQL 数据库执行全部迁移，验证旧成功记录的 `total_score`、`content_grade`、`raw_response` 未变化，只新增 legacy 版本标记。

- [ ] **Step 4: 文档化差异**

README 明确：内容质量总分由后端评分器计算；平台业务基准只参与数据表现复盘；旧结果标记为 legacy，不与 v2 分数直接做趋势比较。

---

### Task 7: 生产灰度发布与付费验收

**Files:**
- Modify: `docs/V1.01-本地验收与发布手册.md`
- Evidence only: `.superpowers/sdd/<run-id>/content-score-v2/`

**Interfaces:**
- Consumes: 已通过全部验证的镜像、迁移和回退镜像 ID。
- Produces: 不覆盖历史记录的生产灰度证据。

- [ ] **Step 1: 发布前备份和回退点**

保存 API/Worker 原镜像 ID、数据库备份、Compose 解析结果、迁移前 `ai_content_reviews` 成功记录数量和 legacy 分数摘要。

- [ ] **Step 2: 先执行迁移，再滚动 API/Worker**

迁移必须先完成；API 和 Worker 使用同一新镜像；确认 `/api/health/live`、`/api/health/ready` 和 Worker 心跳正常。

- [ ] **Step 3: 无付费的生产只读检查**

确认旧的三条 85/A 仍显示为历史模型评分；确认管理后台、视频列表、主管审核和结果数据流程没有回归。

- [ ] **Step 4: 取得明确授权后灰度 3–5 条视频**

样本至少覆盖两个视频类型，并包含一条业务认为明显较弱的视频。每条均生成新 `ai_content_review`，不修改历史 review。

- [ ] **Step 5: 验收门槛**

必须同时满足：

- 新结果全部标记 `content-score-v2`；
- 12 个固定维度完整且唯一，统一为 0–5；
- 后端复算结果与数据库总分完全一致；
- 至少出现两个不同总分，除非人工确认样本确实同质；
- 合规高风险和产品未露出硬边界按测试预期生效；
- OSS 临时对象全部清理；
- 原始响应、模型用量、操作日志和历史失败记录保留。

- [ ] **Step 6: 灰度失败时回退**

回退 API/Worker 到保存的旧镜像；新增字段保持向后兼容，不回滚或删除数据库列；保留失败的新 review 及审计记录，禁止覆盖成旧分数。

---

## Out of scope

- 本次不开发可视化权重编辑器；如需由管理员调整权重，另立 V1.1 方案并增加版本发布、双人确认和回滚能力。
- 本次不重评历史视频，不将旧 85 分批量改写成新分数。
- 本次不改变运营/投放数据基准、数据表现等级、最终有效等级或既有规则引擎边界。
- 本次不通过调高 temperature 解决评分集中；随机性不能替代确定性评分规则。

## Self-review result

- Spec coverage: 保留三等级独立存储、结构化 JSON、raw response、失败状态、操作审计和后端确定性规则。
- Data integrity: 历史结果只标记 legacy，不覆盖、不自动重算。
- Type consistency: `content-score-v2`、`content-review-v3-deterministic-score`、12 个维度代码在 Schema、评分器、服务和 UI 中一致。
- Acceptance: 同输入同版本必得同结果；页面可解释分数来源；生产付费调用必须单独授权。
