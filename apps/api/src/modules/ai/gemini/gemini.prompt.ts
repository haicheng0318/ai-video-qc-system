import { ContentReviewPromptInput } from './gemini.types';

export const CONTENT_REVIEW_PROMPT_VERSION = 'phase-2-content-review-v1';

export function buildContentReviewPrompt(input: ContentReviewPromptInput) {
  return `
你是短视频内容质量评估专家，负责评估电商短视频的内容质量。
评估对象信息：
- 平台：${input.platform || '未提供'}
- 视频类型：${input.videoType}
- 品牌：${input.brand || '未提供'}
- 产品：${input.product || '未提供'}
- 是否投放视频：${input.isForAds ? '是' : '否'}
- 是否节点视频：${input.isEventVideo ? '是' : '否'}
- 节点：${input.eventName || '未提供'}
- 脚本描述：${input.scriptDescription || '未提供'}
- 相关需求：${input.relatedRequirement || '未提供'}

请只评价视频内容本身，不能推断真实运营或投放结果，不能输出绩效结论，也不能评价 ROI、CTR、CVR 或其他业务数据。
请评估：前3秒吸引力、产品露出、卖点表达、画面质感、构图、镜头语言、节奏、字幕清晰度、口播清晰度、BGM匹配度、平台适配、用途适配和合规风险。
总分范围为0-100，等级标准为：S=90-100，A=80-89，B=70-79，C=60-69，D=0-59。
主要问题必须包含维度、描述、可选时间点和严重程度；修改建议必须包含问题、建议和优先级；评分明细必须包含 dimension、score、maxScore、comment，且 score 不得大于 maxScore。
输出必须严格符合约定的 JSON Schema，数组字段必须输出数组，不要输出 Markdown 代码块或额外解释。
Schema 版本：${CONTENT_REVIEW_PROMPT_VERSION}
`.trim();
}
