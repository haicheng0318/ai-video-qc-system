import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  calculateContentScore,
  contentDimensionCodes,
  type ContentDimensionCode,
} from '../modules/ai/gemini/content-scoring';

type CalibrationCase = {
  id: string;
  videoType: string;
  ratings: Record<ContentDimensionCode, number>;
  complianceRisks: Array<{ severity: 'high' | 'medium' | 'low' }>;
  expectedGrade: 'S' | 'A' | 'B' | 'C' | 'D';
};

async function fixture() {
  return JSON.parse(await readFile(resolve(__dirname, 'fixtures/content-score-calibration.json'), 'utf8')) as {
    fixtureVersion: string;
    cases: CalibrationCase[];
  };
}

function calculate(item: CalibrationCase) {
  return calculateContentScore({
    videoType: item.videoType,
    scores: contentDimensionCodes.map((dimension) => ({
      dimension,
      rating: item.ratings[dimension],
    })),
    complianceRisks: item.complianceRisks,
  });
}

test('calibration fixture covers multiple grades and does not collapse to 85', async () => {
  const data = await fixture();
  assert.equal(data.fixtureVersion, 'content-calibration-v1');
  assert.ok(data.cases.length >= 5);
  const results = data.cases.map(calculate);
  const uniqueScores = new Set(results.map((item) => item.totalScore));
  const score85Ratio = results.filter((item) => item.totalScore === 85).length / results.length;
  assert.ok(uniqueScores.size >= Math.min(5, data.cases.length));
  assert.ok(score85Ratio < 0.3);
});

test('calibration fixture records every dimension and matches reviewed grades', async () => {
  const data = await fixture();
  for (const item of data.cases) {
    assert.deepEqual(Object.keys(item.ratings).sort(), [...contentDimensionCodes].sort());
  }
  const matching = data.cases.filter((item) => calculate(item).contentGrade === item.expectedGrade).length;
  const gradeAgreement = matching / data.cases.length;
  assert.equal(gradeAgreement, 1, 'seed fixtures must match their reviewed expected grade');
  if (data.cases.length >= 20) assert.ok(gradeAgreement >= 0.8);
});
