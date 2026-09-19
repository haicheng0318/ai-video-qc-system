# 持久化评估任务（V1.01）

API 触发内容评估、数据复盘、最终建议时，只在同一 PostgreSQL 事务中创建评估记录、业务状态、操作日志和任务；响应保留 reviewId/evaluationId/status，新增 jobId。三个业务等级和负责人确认规则不变。

## 启动与发布顺序

1. 备份数据库并停止旧版本 API/内存任务执行器，等待已知在途请求结束。旧进程不能与新 worker 混跑。
2. 由一个发布进程执行 `npx prisma migrate deploy`，不要让多个 API/worker 同时执行迁移。
3. `npm run db:generate && npm run build:shared && npm --workspace @ai-video-qc/api run build`。
4. 按原方式启动 API。独立进程执行 `npm --workspace @ai-video-qc/api run start:worker`，实际入口是 `node dist/worker.js`，生产环境不依赖 tsx。
5. 开发环境可运行 `npm --workspace @ai-video-qc/api run worker:dev`。worker 与 API 使用同一数据库、COS 配置；本地文件模式必须挂载相同视频卷。worker 还需要后端模型和 OSS 凭据，绝不写入任务表。

Lighthouse compose 已增加 worker，复用 API 镜像/环境/存储卷、无公开端口，退出宽限 6 分钟。worker 不执行迁移或种子脚本。现有 API 镜像启动脚本仍包含原有迁移行为，单实例部署时务必在 worker 启动前完成迁移；多副本发布应统一使用独立 migration job。其他部署模板需在发布阶段同步加独立 worker，不能仅升级 API。

## 调度、重试及恢复

- 初始全局并发固定为 1，多个 worker 通过 PostgreSQL advisory 事务锁共享容量；视频先于任务加锁，候选视频使用 `FOR UPDATE SKIP LOCKED`。
- `EVALUATION_JOB_LEASE_MS` 默认 90000，范围 15000–600000；worker 每 5 秒续租。领取/续租/结果写入均使用数据库时间与唯一 fencing token；旧 token 或过期 worker 无权写入成功或失败结果。
- 调度状态：queued、running、retry_wait、succeeded、failed、needs_attention。业务状态仍按原流程独立保存。
- 每次领取产生 evaluation_job_attempts，执行前可能发生的进程中断最多领取 3 次，按 2/4 秒退避；超过上限失败。已知配置/解析失败可直接失败，由用户修复后手动新建评估。
- 在可能收费的模型调用前先持久化 externalStartedAt。调用后失联、超时或无法确定外部结果时转 needs_attention，不自动再请求模型。这里不承诺“最多计费一次”：旧外部请求可能仍在处理，人工重试也可能产生重复费用；需核对服务商请求/账单后再重试。
- 每次轮询最多恢复 100 个过期任务和 100 个旧 running 孤儿。旧系统 running 记录无 job 时，保留 rawResponse，新增 needs_attention 任务及恢复日志，把仍对应的业务状态转失败；不会直接再次调用模型。
- 恢复/失败保留原始评估、attempt 历史和审计日志。手动重试由原业务触发接口创建新评估和新 job，不覆写旧结果。队列没有自动清理历史的任务。

## 数据与访问

新增 evaluation_jobs / evaluation_job_attempts / evaluation_input_snapshots，不删除或合并任何核心表。活跃任务使用 `(video_id, stage)` 部分唯一索引；同阶段重复触发返回冲突。

任务只保存数据库 ID 引用、触发人、token 上限等执行元数据，不接受签名 URL、密钥、视频本体或原始模型输出。模型名称从持久化评估记录读取。内容任务每次执行从 COS 重新物化文件，再由已有 Qwen 客户端处理临时 OSS 文件并清理。数据复盘绑定提交时的指标、内容、主管，最终建议绑定规则和来源链。

数据复盘触发时，在同一事务中创建 evaluation_input_snapshots，保存白名单基准业务字段及原始 benchmark IDs；job.inputRefs 只保存 benchmarkSnapshotId。worker 仅读取不可变快照，之后基准被修改或删除都不会改变排队任务的判断标准。数据库触发器拒绝 UPDATE，应用无快照更新接口，快照不保存凭据/签名链接。

`GET /api/evaluation-jobs/:id` 要求 JWT，并复用视频可见性权限；只返回 id/videoId/stage/status/reviewId/evaluationId/attempts/maxAttempts/failureCode/availableAt/createdAt/completedAt，不返回内部引用、worker ID、lease token、原始响应或异常堆栈。

## 本地测试

隔离数据库库名必须为 queue_test，使用显式 `EVALUATION_JOBS_TEST_DATABASE_URL`，不能使用生产 DATABASE_URL 运行测试。

```sh
cd apps/api
EVALUATION_JOBS_TEST_DATABASE_URL=postgresql://queue_test:queue_test_local@127.0.0.1:55439/queue_test node --import tsx --test src/tests/evaluation-jobs*.spec.ts
npm run typecheck
npm test
```

集成测试调用真实 PostgreSQL；provider/storage 使用受控本地替身，不访问模型/COS/OSS、不产生费用。覆盖入队回滚、重复任务、并发领取、续租/旧 token、过期恢复、重试上限、旧记录接管、三个阶段成功链、权限白名单和迟到结果防护。

回滚应用前须停止 worker；不要删除新增表或审计历史。已入队任务若不再运行新 worker 将暂停，恢复新 worker 后继续。回滚旧内存执行器前应人工核对所有 queued/running/needs_attention，避免重复外部调用。
