import assert from 'node:assert/strict';
import { test } from 'node:test';
import OpenAI from 'openai';
import { OpenAiClient, OpenAiResponsesClient } from '../modules/ai/gpt/gpt.client';
import { GptService } from '../modules/ai/gpt/gpt.service';
import {
  FinalEvaluationOutputValidationError,
  OpenAiConfigurationError,
  OpenAiRefusalError,
  OpenAiResponseError,
} from '../modules/ai/gpt/gpt.errors';

const valid = {
  recommendedFinalGrade: 'effective', recommendedFinalStatus: 'final_effective', recommendedIsEffective: true,
  recommendationConfidence: 80, decisionSummary: '证据支持该建议，等待负责人确认。',
  evidenceAssessment: [
    { source: 'content_review', strength: 'high', evidence: ['内容证据'], conclusion: '内容可用' },
    { source: 'result_review', strength: 'high', evidence: ['数据证据'], conclusion: '数据可用' },
    { source: 'rule_engine', strength: 'high', evidence: ['规则证据'], conclusion: '边界允许' },
  ],
  finalAttribution: [{ type: 'mixed', confidence: 70, evidence: ['综合证据'], conclusion: '综合因素' }],
  finalSuggestion: '建议负责人复核。', confirmationFocus: ['复核证据'], riskFlags: [],
};

function withKey(run: () => Promise<void>) {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'phase-7-test-key';
  return run().finally(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });
}

test('final evaluation client uses Responses API strict schema and store false', async () => {
  await withKey(async () => {
    let captured: Record<string, any> = {};
    const client = new OpenAiResponsesClient(() => ({ responses: { create: async (input: any) => {
      captured = input;
      return { id: 'resp-final', status: 'completed', model: 'gpt-5-mini', output_text: JSON.stringify(valid), output: [], usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 } };
    } } }) as unknown as OpenAI);
    const response = await client.createFinalEvaluation({
      model: 'gpt-5-mini', developerPrompt: 'safe', inputContext: { video: { videoType: 'organic' } },
      jsonSchema: { type: 'object' }, maxOutputTokens: 4000,
    });
    assert.equal(captured.store, false);
    assert.equal(captured.text.format.name, 'video_final_evaluation');
    assert.equal(captured.text.format.strict, true);
    assert.equal(captured.text.format.type, 'json_schema');
    assert.equal('tools' in captured, false);
    assert.equal('temperature' in captured, false);
    assert.equal('stream' in captured, false);
    assert.equal(JSON.stringify(captured).includes('video/mp4'), false);
    assert.equal(response.usage.totalTokens, 12);
  });
});

test('final evaluation API key missing fails safely', async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(new OpenAiResponsesClient().createFinalEvaluation({
      model: 'gpt', developerPrompt: '', inputContext: {}, jsonSchema: {}, maxOutputTokens: 1,
    }), OpenAiConfigurationError);
  } finally {
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
  }
});

function serviceWith(response: Record<string, unknown>) {
  const client: OpenAiClient = {
    createResultReview: async () => response as any,
    createFinalEvaluation: async () => ({
      responseId: 'resp', responseStatus: 'completed', model: 'gpt-5-mini', rawText: JSON.stringify(valid),
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, ...response,
    }) as any,
  };
  return new GptService(client);
}

test('GptService validates a completed final evaluation', async () => {
  const result = await serviceWith({}).generateFinalEvaluation({
    model: 'gpt', developerPrompt: 'safe', inputContext: {}, maxOutputTokens: 4000,
    recommendedBoundary: 'allow_final_effective',
  });
  assert.equal(result.parsedOutput.recommendedFinalGrade, 'effective');
});

for (const [name, override, error] of [
  ['non-completed response', { responseStatus: 'incomplete' }, OpenAiResponseError],
  ['refusal', { refusal: 'no' }, OpenAiRefusalError],
  ['empty output', { rawText: '' }, OpenAiResponseError],
  ['invalid JSON', { rawText: '{bad' }, FinalEvaluationOutputValidationError],
  ['boundary violation', { rawText: JSON.stringify({ ...valid, recommendedFinalGrade: 'invalid', recommendedFinalStatus: 'final_invalid', recommendedIsEffective: false }) }, FinalEvaluationOutputValidationError],
] as const) {
  test(`GptService rejects ${name}`, async () => {
    await assert.rejects(serviceWith(override).generateFinalEvaluation({
      model: 'gpt', developerPrompt: 'safe', inputContext: {}, maxOutputTokens: 4000,
      recommendedBoundary: 'allow_final_effective',
    }), error);
  });
}

test('Phase 5 createResultReview remains available on the shared client', async () => {
  assert.equal(typeof new OpenAiResponsesClient().createResultReview, 'function');
});
