import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedFinalGrades, deriveFinalStatus, deriveIsEffectiveFinal, isAdjustment } from '@ai-video-qc/shared';

const boundaries = {
  allow_final_effective: ['effective'],
  allow_final_effective_or_low_effective: ['effective', 'low_effective'],
  allow_final_low_effective_or_invalid: ['low_effective', 'invalid'],
  require_manual_confirmation: ['effective', 'low_effective', 'invalid'],
  require_final_invalid: ['invalid'],
  pending_data: [],
} as const;

for (const [boundary, expected] of Object.entries(boundaries)) {
  test(`${boundary} exposes exact formal grade choices`, () => {
    assert.deepEqual(allowedFinalGrades(boundary as keyof typeof boundaries), expected);
  });
  for (const grade of ['effective', 'low_effective', 'invalid'] as const) {
    test(`${boundary} ${grade} boundary decision is deterministic`, () => {
      assert.equal(allowedFinalGrades(boundary as keyof typeof boundaries).includes(grade as never), expected.includes(grade as never));
    });
  }
}

for (const [grade, status, effective] of [
  ['effective', 'final_effective', true], ['low_effective', 'final_low_effective', true], ['invalid', 'final_invalid', false],
] as const) {
  test(`${grade} derives ${status} and effective=${effective}`, () => {
    assert.equal(deriveFinalStatus(grade), status); assert.equal(deriveIsEffectiveFinal(grade), effective);
  });
}

for (const recommendation of ['effective', 'low_effective', 'invalid'] as const) {
  for (const grade of ['effective', 'low_effective', 'invalid'] as const) {
    test(`${recommendation} to ${grade} adjustment flag`, () => assert.equal(isAdjustment(grade, recommendation), grade !== recommendation));
  }
}
