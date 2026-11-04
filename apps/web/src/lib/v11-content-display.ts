import type { V11ContentLatestResponse } from '@ai-video-qc/shared';

/** Presentation only: the backend remains responsible for every workflow gate. */
export function contentDecisionNotice(content: V11ContentLatestResponse | null, holds: number, appeals: number) {
  const group = content?.group;
  if (group?.pilotRun || group?.independent) return 'Pilot 独立测试结果，不作为正式内容决议。';
  if (group?.shadowMode) return 'Shadow 结果，不改变正式流程。';
  if (appeals) return '当前结果存在异议，待处理后才能继续正式流程。';
  if (holds || group?.status === 'hold') return '当前流程存在待处理事项；已有评分不代表正式流程已通过。';
  const decision = group?.decision;
  if (!decision) return '尚无有效正式内容决议；Run 分数不作为正式评分。';
  if (!decision.inputComplete || decision.totalScore === null || decision.contentRating === null) return '关键维度或输入无法判断，不能作为已批准结果。';
  if (!decision.stable) return '评估结果尚未稳定，不能作为已批准结果。';
  if (decision.complianceStatus !== 'clear') return '合规风险待处理，不能进入后续数据阶段。';
  if (['C', 'D'].includes(decision.contentRating)) return '内容需要返修；已有评分不代表可以进入数据阶段。';
  return '内容决议已保存；存在评分不代表已通过后续关卡。';
}
