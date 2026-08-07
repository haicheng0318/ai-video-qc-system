export class OpenAiConfigurationError extends Error {
  readonly code = 'OPENAI_NOT_CONFIGURED';
}

export class OpenAiRequestTimeoutError extends Error {
  readonly code = 'OPENAI_REQUEST_TIMEOUT';
}

export class OpenAiRequestError extends Error {
  readonly code = 'OPENAI_REQUEST_FAILED';
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OpenAiRequestError';
    this.cause = cause;
  }
}

export class OpenAiResponseError extends Error {
  readonly code = 'OPENAI_RESPONSE_FAILED';
  constructor(message: string, readonly audit?: OpenAiResponseAudit) {
    super(message);
  }
}

export class OpenAiRefusalError extends Error {
  readonly code = 'OPENAI_RESPONSE_REFUSED';
  constructor(message: string, readonly audit?: OpenAiResponseAudit) {
    super(message);
  }
}

export class ResultReviewOutputValidationError extends Error {
  readonly code = 'OPENAI_OUTPUT_INVALID';
  constructor(message: string, readonly audit?: OpenAiResponseAudit) {
    super(message);
  }
}

export class ResultReviewSnapshotBindingError extends Error {
  readonly code = 'RESULT_METRIC_BINDING_INVALID';
}

export class FinalEvaluationOutputValidationError extends Error {
  readonly code = 'FINAL_EVALUATION_OUTPUT_INVALID';
  constructor(message: string, readonly audit?: OpenAiResponseAudit) {
    super(message);
  }
}

export class FinalEvaluationSourceBindingError extends Error {
  readonly code = 'FINAL_EVALUATION_SOURCE_INVALID';
}
export type OpenAiResponseAudit = {
  responseId: string;
  responseStatus: string;
  model: string;
  rawText: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};
