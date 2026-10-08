export class TextModelConfigurationError extends Error {
  readonly code = 'TEXT_MODEL_NOT_CONFIGURED';
}

export class TextModelRequestTimeoutError extends Error {
  readonly code = 'TEXT_MODEL_REQUEST_TIMEOUT';
}

export class TextModelRequestError extends Error {
  readonly code = 'TEXT_MODEL_REQUEST_FAILED';
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'TextModelRequestError';
    this.cause = cause;
  }
}

export class TextModelResponseError extends Error {
  readonly code = 'TEXT_MODEL_RESPONSE_FAILED';
  constructor(message: string, readonly audit?: TextModelResponseAudit) {
    super(message);
  }
}

export class TextModelRefusalError extends Error {
  readonly code = 'TEXT_MODEL_RESPONSE_REFUSED';
  constructor(message: string, readonly audit?: TextModelResponseAudit) {
    super(message);
  }
}

export class ResultReviewOutputValidationError extends Error {
  readonly code = 'TEXT_MODEL_OUTPUT_INVALID';
  constructor(message: string, readonly audit?: TextModelResponseAudit) {
    super(message);
  }
}

export class ResultReviewSnapshotBindingError extends Error {
  readonly code = 'RESULT_METRIC_BINDING_INVALID';
}

export class FinalEvaluationOutputValidationError extends Error {
  readonly code = 'FINAL_EVALUATION_OUTPUT_INVALID';
  constructor(message: string, readonly audit?: TextModelResponseAudit) {
    super(message);
  }
}

export class FinalEvaluationSourceBindingError extends Error {
  readonly code = 'FINAL_EVALUATION_SOURCE_INVALID';
}
export type TextModelResponseAudit = {
  usageCollectionStatus?: string;
  responseId: string;
  responseStatus: string;
  model: string;
  rawText: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};
