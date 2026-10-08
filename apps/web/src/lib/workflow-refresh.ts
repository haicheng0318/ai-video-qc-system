export function workflowEvidenceKey(videoStatus: string, allowedActions?: string[], sourceIds: Array<string | null | undefined> = []) {
  return `${videoStatus}:${[...(allowedActions || [])].sort().join(',')}:${sourceIds.map((value) => value || '-').join(',')}`;
}

export function shouldApplyLatestSelection(pinnedId: string | null, incomingId?: string | null) {
  return !pinnedId || pinnedId === incomingId;
}

export function canApplySourceResponse(
  requestGeneration: number,
  currentGeneration: number,
  responseId?: string | null,
  expectedId?: string | null,
) {
  return requestGeneration === currentGeneration && (responseId || null) === (expectedId || null);
}

export function latestMetricForTrigger<T extends { id: string }>(metric: T | null, expectedId?: string | null) {
  return metric && expectedId && metric.id === expectedId ? metric : null;
}
