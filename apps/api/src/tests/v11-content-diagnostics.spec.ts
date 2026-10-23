import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAdoptedContentDiagnostics } from '../modules/v11/content-diagnostics';
import { V11_CONTENT_DIMENSIONS } from '../modules/v11/content-scoring';

function run(id: string, runNumber: number, anchors: number[], totalScore: number) {
  return {
    id, runNumber, status: 'succeeded', totalScore,
    structuredOutput: { dimensions: V11_CONTENT_DIMENSIONS.map((item, index) => ({
      dimension: item.code, observationStatus: 'observed', anchor: anchors[index],
      observation: `${id}:${item.code}`, facts: [`fact-${id}`], factClaims: [], evidence: [],
      improvementSuggestions: [`建议-${id}`],
    })) },
  };
}

test('representative observations use adopted-anchor distance, score distance, then run number', () => {
  const first = run('first', 1, Array(8).fill(3), 75);
  const second = run('second', 2, Array(8).fill(4), 90);
  const result = buildAdoptedContentDiagnostics({
    runs: [second, first], sourceRunIds: ['first', 'second'],
    adoptedDimensions: V11_CONTENT_DIMENSIONS.map(({ code }) => ({ dimension: code, anchor: 3 })),
    decisionTotalScore: 75,
  });
  assert.equal(result.dimensions[0].representativeRunId, 'first');
  assert.equal(result.dimensions[0].score, 15);
  assert.equal(result.dimensions[0].status, '良好');
  assert.equal(result.directorSummary.priorities[0].priority, 'P1');
});

test('runs outside the decision sourceRunIds cannot supply diagnostics', () => {
  const result = buildAdoptedContentDiagnostics({
    runs: [run('not-source', 1, Array(8).fill(3), 75)], sourceRunIds: [],
    adoptedDimensions: V11_CONTENT_DIMENSIONS.map(({ code }) => ({ dimension: code, anchor: 3 })),
    decisionTotalScore: 75,
  });
  assert.equal(result.dimensions[0].representativeRunId, null);
  assert.deepEqual(result.dimensions[0].facts, []);
});

test('director priorities sort by adopted anchor, not dimension weight', () => {
  const anchors = V11_CONTENT_DIMENSIONS.map((item) => item.code === 'action_logic' ? 1 : 4);
  const result = buildAdoptedContentDiagnostics({
    runs: [run('only', 1, anchors, 80)], sourceRunIds: ['only'],
    adoptedDimensions: V11_CONTENT_DIMENSIONS.map(({ code }, index) => ({ dimension: code, anchor: anchors[index] })),
    decisionTotalScore: 80,
  });
  assert.equal(result.directorSummary.priorities[0].dimension, 'action_logic');
  assert.equal(result.directorSummary.priorities[0].priority, 'P1');
});

test('stable message is reserved for all-excellent adopted dimensions', () => {
  const build = (anchor: number) => buildAdoptedContentDiagnostics({
    runs: [run('only', 1, Array(8).fill(anchor), 100)], sourceRunIds: ['only'],
    adoptedDimensions: V11_CONTENT_DIMENSIONS.map(({ code }) => ({ dimension: code, anchor })),
    decisionTotalScore: 100,
  });
  assert.equal(build(4).directorSummary.stableMessage, '当前内容整体稳定，优先保持高分结构，仅进行细节优化。');
  assert.equal(build(3).directorSummary.stableMessage, '当前结果暂无可展示的明确修改建议。');
});
