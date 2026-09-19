# 千问替代 GPT 配置与验收报告

- 日期：2026-08-27（Asia/Shanghai）
- 项目：AI短视频质检评估系统 V1.0
- 变更范围：运营/投放数据复盘、最终有效等级建议

## 1. 配置结论

两个原 GPT 环节均已切换为阿里云百炼 `qwen3.5-plus`：

| 环节 | provider | model | Schema 版本 |
| --- | --- | --- | --- |
| 数据复盘 | `aliyun_bailian` | `qwen3.5-plus` | `result-review-v2-qwen` |
| 最终评定建议 | `aliyun_bailian` | `qwen3.5-plus` | `final-evaluation-v2-qwen` |

数据库中旧的 OpenAI 启用配置会在 seed 时停用。百炼 Key 继续只从后端 `DASHSCOPE_API_KEY` 读取，未进入前端、数据库或日志。

## 2. 实现方式

- 通过百炼 OpenAI 兼容 Chat Completions 接口调用 `qwen3.5-plus`。
- `enable_thinking=false` 作为 Node.js 顶层参数传入，以兼容结构化输出。
- 请求携带 JSON Schema，并在系统提示中同步明确完整 Schema。
- 返回结果继续执行后端 JSON 解析、Zod 校验和业务语义校验。
- 模型输出不合规时保存失败记录与审计原文，不推进视频状态。
- 后端规则引擎仍为确定性代码，未改为模型 Prompt。
- 千问最终建议仍不能替代内容负责人最终确认。

## 3. 真实调用结果

### 数据复盘（真实业务记录，已落库）

- 视频：`a08c88d9-b731-4826-85a9-90fbd873a768`（弥鹿磁力片）
- 复盘记录：`7b33638c-f7f5-42b3-92db-229f13f57b78`
- provider/model：`aliyun_bailian / qwen3.5-plus`
- 状态：`succeeded`
- 数据充分性：`insufficient`
- 数据等级：`null`（符合“数据不足不得判 D”要求）
- 规则结果：`R00_DATA_INSUFFICIENT / pending_data`
- 规则记录：`cfd88cc6-b869-4d7a-9e51-f39b2aba4d29`

该记录因数据不足被后端硬规则拦截，未进入最终建议流程，行为符合 PRD。

### 最终评定建议（合成充分数据，不落库）

- 使用与生产相同的百炼客户端、Prompt、JSON Schema 和后端语义校验。
- 模型：`qwen3.5-plus`
- 接口状态：`completed`
- 建议等级：`effective`
- 建议状态：`final_effective`
- 建议有效：`true`
- 置信度：`92`
- Token：输入 `1109`，输出 `958`，总计 `2067`

该测试只验证最终建议环节可用性，没有伪造或写入业务结果，也没有执行负责人最终确认。

## 4. 回归结果

- 后端测试：798/798 通过。
- 前端测试：131/131 通过。
- API、Web、Shared 全仓 TypeScript 类型检查通过。
- 数据库 seed 成功，两个千问配置均为启用状态。

## 5. 已知边界

- 百炼当前对 `response_format.json_schema` 的实际约束表现仍需以后端校验兜底；系统已将完整 Schema 同时写入系统提示，并保留严格的后端拒绝策略。
- 当前真实视频数据不足，无法合法地通过该记录测试最终建议的落库流程；需要补充新数据快照后重新复盘。
- 代码目录 `modules/ai/gpt` 与类名 `GptService` 暂时保留，属于内部兼容命名，不代表仍调用 OpenAI。

## 6. 后续操作

为“弥鹿磁力片”补充更充分的运营/投放数据后，依次重新触发：千问数据复盘、规则引擎、千问最终建议。负责人确认仍需人工执行。
