import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QwenStructuredTextClient, StructuredTextClient } from '../modules/ai/gpt/gpt.client';
import { GptService } from '../modules/ai/gpt/gpt.service';
import {
  FinalEvaluationOutputValidationError,
  TextModelConfigurationError,
  TextModelRefusalError,
  TextModelResponseError,
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
  const original = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'phase-7-test-key';
  return run().finally(() => {
    if (original === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = original;
  });
}

test('final evaluation client uses Qwen Chat Completions strict schema', async () => {
  await withKey(async () => {
    let captured: Record<string, any> = {};
    const client = new QwenStructuredTextClient(() => ({ chat: { completions: { create: async (input: any) => {
      captured = input;
      return { id: 'resp-final', model: 'qwen3.5-plus', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(valid) } }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } };
    } } } }));
    const response = await client.createFinalEvaluation({
      model: 'qwen3.5-plus', developerPrompt: 'safe', inputContext: { video: { videoType: 'organic' } },
      jsonSchema: { type: 'object' }, maxOutputTokens: 4000,
    });
    assert.equal(captured.response_format.json_schema.name, 'video_final_evaluation');
    assert.equal(captured.response_format.json_schema.strict, true);
    assert.equal(captured.response_format.type, 'json_schema');
    assert.equal(captured.enable_thinking, false);
    assert.equal('extra_body' in captured, false);
    assert.equal('tools' in captured, false);
    assert.equal('stream' in captured, false);
    assert.equal(JSON.stringify(captured).includes('video/mp4'), false);
    assert.equal(response.usage.totalTokens, 12);
  });
});

test('final evaluation Qwen API key missing fails safely', async () => {
  const original = process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  try {
    await assert.rejects(new QwenStructuredTextClient().createFinalEvaluation({
      model: 'qwen3.5-plus', developerPrompt: '', inputContext: {}, jsonSchema: {}, maxOutputTokens: 1,
    }), TextModelConfigurationError);
  } finally {
    if (original !== undefined) process.env.DASHSCOPE_API_KEY = original;
  }
});

function serviceWith(response: Record<string, unknown>) {
  const client: StructuredTextClient = {
    createResultReview: async () => response as any,
    createFinalEvaluation: async () => ({
      responseId: 'resp', responseStatus: 'completed', model: 'qwen3.5-plus', rawText: JSON.stringify(valid),
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, ...response,
    }) as any,
  };
  return new GptService(client);
}

test('GptService validates a completed final evaluation', async () => {
  const result = await serviceWith({}).generateFinalEvaluation({
    model: 'qwen3.5-plus', developerPrompt: 'safe', inputContext: {}, maxOutputTokens: 4000,
    recommendedBoundary: 'allow_final_effective',
  });
  assert.equal(result.parsedOutput.recommendedFinalGrade, 'effective');
});

for (const [name, override, error] of [
  ['non-completed response', { responseStatus: 'incomplete' }, TextModelResponseError],
  ['refusal', { refusal: 'no' }, TextModelRefusalError],
  ['empty output', { rawText: '' }, TextModelResponseError],
  ['invalid JSON', { rawText: '{bad' }, FinalEvaluationOutputValidationError],
  ['boundary violation', { rawText: JSON.stringify({ ...valid, recommendedFinalGrade: 'invalid', recommendedFinalStatus: 'final_invalid', recommendedIsEffective: false }) }, FinalEvaluationOutputValidationError],
] as const) {
  test(`GptService rejects ${name}`, async () => {
    await assert.rejects(serviceWith(override).generateFinalEvaluation({
      model: 'qwen3.5-plus', developerPrompt: 'safe', inputContext: {}, maxOutputTokens: 4000,
      recommendedBoundary: 'allow_final_effective',
    }), error);
  });
}

test('Phase 5 createResultReview remains available on the shared client', async () => {
  assert.equal(typeof new QwenStructuredTextClient().createResultReview, 'function');
});
