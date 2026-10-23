import { V11_CONTENT_DIMENSIONS } from './content-scoring';

type Run = { id: string; runNumber: number; status: string; totalScore: unknown; structuredOutput: unknown };
type ModelDimension = {
  dimension: string;
  observationStatus: 'observed' | 'unknown';
  anchor: number | null;
  observation: string;
  facts: string[];
  factClaims: unknown[];
  evidence: unknown[];
  improvementSuggestions?: string[];
};

function dimensionsOf(run: Run): ModelDimension[] {
  const output = run.structuredOutput as { dimensions?: ModelDimension[] } | null;
  return Array.isArray(output?.dimensions) ? output.dimensions : [];
}

export function buildAdoptedContentDiagnostics(input: {
  runs: Run[];
  sourceRunIds: string[];
  adoptedDimensions: unknown;
  decisionTotalScore: unknown;
}) {
  const adopted = Array.isArray(input.adoptedDimensions)
    ? input.adoptedDimensions as Array<{ dimension?: string; anchor?: number | null }>
    : [];
  const sourceIds = new Set(input.sourceRunIds);
  const sourceRuns = input.runs.filter((run) => sourceIds.has(run.id) && run.status === 'succeeded');
  const dimensions = V11_CONTENT_DIMENSIONS.map((definition) => {
    const adoptedAnchor = adopted.find((item) => item.dimension === definition.code)?.anchor ?? null;
    const candidates = sourceRuns.flatMap((run) => {
      const dimension = dimensionsOf(run).find((item) => item.dimension === definition.code);
      if (!dimension) return [];
      const anchor = dimension.observationStatus === 'unknown' ? null : dimension.anchor;
      const distance = adoptedAnchor === anchor ? 0 : adoptedAnchor === null || anchor === null
        ? Number.POSITIVE_INFINITY : Math.abs(anchor - adoptedAnchor);
      return [{ run, dimension, distance, scoreDistance: Math.abs(Number(run.totalScore) - Number(input.decisionTotalScore)) }];
    }).sort((a, b) => a.distance - b.distance || a.scoreDistance - b.scoreDistance || a.run.runNumber - b.run.runNumber);
    const representative = candidates[0];
    const score = adoptedAnchor === null ? null : Math.round((definition.weight * adoptedAnchor / 4) * 10) / 10;
    return {
      dimension: definition.code,
      weight: definition.weight,
      adoptedAnchor,
      score,
      status: adoptedAnchor === null ? '无法判断' : adoptedAnchor >= 3.5 ? '优秀' : adoptedAnchor >= 2.5 ? '良好' : adoptedAnchor >= 1.5 ? '可优化' : '需重点优化',
      representativeRunId: representative?.run.id ?? null,
      observation: representative?.dimension.observation ?? null,
      facts: representative?.dimension.facts ?? [],
      factClaims: representative?.dimension.factClaims ?? [],
      evidence: representative?.dimension.evidence ?? [],
      improvementSuggestions: representative?.dimension.improvementSuggestions ?? null,
    };
  });
  const ranked = dimensions.filter((item) => item.adoptedAnchor !== null);
  const strengths = [...ranked].sort((a, b) => Number(b.adoptedAnchor) - Number(a.adoptedAnchor)).slice(0, 3);
  const priorities = ranked.filter((item) => (item.improvementSuggestions?.length ?? 0) > 0)
    .sort((a, b) => Number(a.adoptedAnchor) - Number(b.adoptedAnchor)).slice(0, 3)
    .map((item, index) => ({ ...item, priority: `P${index + 1}` }));
  return {
    dimensions,
    directorSummary: {
      strengths: strengths.map(({ dimension, score, observation }) => ({ dimension, score, observation })),
      priorities,
      stableMessage: ranked.length > 0 && ranked.every((item) => Number(item.adoptedAnchor) >= 3.5)
        ? '当前内容整体稳定，优先保持高分结构，仅进行细节优化。'
        : '当前结果暂无可展示的明确修改建议。',
    },
  };
}
