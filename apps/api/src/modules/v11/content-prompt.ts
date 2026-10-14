import { V11_CONTENT_ANCHORS, V11_CONTENT_DIMENSIONS } from './content-scoring';
import { V11_FACT_CLAIMS, V11_FACT_CLAIM_VERSION } from './fact-claims';
import { V11_PROMPT_VERSION, V11_RUBRIC_VERSION, V11_SCHEMA_VERSION } from './provenance';

export function buildV11ContentPrompt(
  metadata: Record<string, unknown>,
  outputSchema: Record<string, unknown>,
) {
  const dimensionText = V11_CONTENT_DIMENSIONS
    .map((item) => `- ${item.code}（weight=${item.weight}）\n${V11_CONTENT_ANCHORS[item.code].map((description, anchor) => `  anchor ${anchor}: ${description}`).join('\n')}\n  canonical facts: ${V11_FACT_CLAIMS[item.code].join(', ')}`)
    .join('\n');
  const outputContract = JSON.stringify(outputSchema);
  return `
你是电商短视频内容质量评估专家。请基于视频和冻结元数据，独立观察内容质量。
元数据：${JSON.stringify(metadata)}

八个维度：
${dimensionText}

你只输出事实、结构化事实声明、证据、0-4 anchor、观察说明和独立合规状态。证据必须提供可核验的起止秒数或 frame/segment reference；全片判断说明已检查片段与缺失事实。
每个已观察维度的 factClaims 只能使用该维度列出的 canonical facts（${V11_FACT_CLAIM_VERSION}），使用 present/absent/uncertain state，并用 evidenceReferences 指向本次输出中的时间或片段证据。同一维度内同一个 key 最多出现一次；不要自行创造 key，也不要把自然语言措辞当成事实标识。
无法可靠观察的维度必须使用 observationStatus=unknown 且 anchor=null；不能用0代替未知。
品牌叙事或自然流不强制前三秒出现产品；无口播的设计不因“没有口播”扣分。只按声明的平台、用途与受众评价，不虚构平台政策或流量结果。
不要计算总分，不要输出内容等级，不要评价运营数据、ROI、CTR、CVR、绩效或最终有效性。
合规状态 clear/suspected/confirmed 独立于质量分，不要因合规风险修改 anchor。
每个维度必须恰好出现一次。

你必须只返回一个 JSON 对象，不得返回 Markdown、代码块或解释文字。
根对象必须且只能包含：dimensions、compliance。
输出必须严格符合以下 JSON Schema：
${outputContract}
promptVersion=${V11_PROMPT_VERSION}; schemaVersion=${V11_SCHEMA_VERSION}; rubricVersion=${V11_RUBRIC_VERSION}
`.trim();
}
