type PilotRunRow = {
  id: string;
  status: string;
  totalScore: unknown;
  contentRating: string | null;
  complianceStatus: string | null;
  structuredOutput: unknown;
  group: {
    videoId: string;
    status: string;
    pilotRun: boolean;
    independent: boolean;
    inputRevision: { evaluationFingerprint: string };
  };
};

type PilotRunReader = {
  v11EvaluationRun: {
    findMany(args: unknown): Promise<PilotRunRow[]>;
  };
};

function anchorsFrom(row: PilotRunRow) {
  const dimensions = (row.structuredOutput as { dimensions?: Array<{ dimension?: unknown; anchor?: unknown }> } | null)?.dimensions ?? [];
  return Object.fromEntries(dimensions
    .filter((item): item is { dimension: string; anchor: number } => typeof item.dimension === 'string' && typeof item.anchor === 'number')
    .map((item) => [item.dimension, item.anchor]));
}

export function assemblePilotRunReport(rows: PilotRunRow[]) {
  const groups = new Map<string, PilotRunRow[]>();
  for (const row of rows) {
    const key = `${row.group.videoId}:${row.group.inputRevision.evaluationFingerprint}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((runs) => {
    const failedRuns = runs.filter((run) => run.status === 'failed' || run.group.status === 'failed');
    const validRuns = runs.filter((run) => {
      const score = Number(run.totalScore);
      return run.status === 'succeeded'
        && run.group.status === 'pilot_completed'
        && run.totalScore !== null
        && Number.isFinite(score)
        && Boolean(run.contentRating);
    });
    const incompleteRuns = runs.filter((run) => !failedRuns.includes(run) && !validRuns.includes(run));
    const scores = validRuns.map((run) => Number(run.totalScore));
    const ratings = validRuns.map((run) => run.contentRating).filter((value): value is string => Boolean(value));
    const complianceDifferences = [...new Set(validRuns.map((run) => run.complianceStatus).filter((value): value is string => Boolean(value)))];
    const anchors = validRuns.map(anchorsFrom);
    const dimensions = [...new Set(anchors.flatMap((item) => Object.keys(item)))];
    const anchorDifferences = Object.fromEntries(dimensions.map((dimension) => {
      const values = anchors.map((item) => item[dimension]).filter((value): value is number => typeof value === 'number');
      return [dimension, values.length ? Math.max(...values) - Math.min(...values) : 0];
    }));
    return {
      videoId: runs[0].group.videoId,
      fingerprint: runs[0].group.inputRevision.evaluationFingerprint,
      runIds: validRuns.map((run) => run.id),
      scores,
      ratings,
      maxDiff: scores.length ? Math.max(...scores) - Math.min(...scores) : null,
      gradeConsistent: ratings.length > 0 && new Set(ratings).size === 1,
      complianceDifferences,
      anchorDifferences,
      validRunCount: validRuns.length,
      incompleteRunCount: incompleteRuns.length,
      failedRunCount: failedRuns.length,
    };
  });
}

export async function loadPilotRunReport(
  db: PilotRunReader,
  filter: { videoId?: string; fingerprint?: string } = {},
) {
  const rows = await db.v11EvaluationRun.findMany({
    where: {
      status: { in: ['succeeded', 'failed'] },
      group: {
        pilotRun: true,
        independent: true,
        status: { in: ['pilot_completed', 'pilot_incomplete', 'failed'] },
        ...(filter.videoId ? { videoId: filter.videoId } : {}),
        ...(filter.fingerprint ? { inputRevision: { evaluationFingerprint: filter.fingerprint } } : {}),
      },
    },
    include: { group: { include: { inputRevision: { select: { evaluationFingerprint: true } } } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return assemblePilotRunReport(rows);
}
