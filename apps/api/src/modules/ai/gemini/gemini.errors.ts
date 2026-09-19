export class ContentReviewConfigurationError extends Error {
  readonly code = 'CONTENT_REVIEW_NOT_CONFIGURED';
}

export class ContentReviewFileProcessingError extends Error {
  readonly code = 'CONTENT_REVIEW_FILE_PROCESSING_FAILED';

  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ContentReviewFileProcessingError';
  }
}

export class ContentReviewTimeoutError extends Error {
  readonly code = 'CONTENT_REVIEW_TIMEOUT';
}

export class ContentReviewOutputValidationError extends Error {
  readonly code = 'CONTENT_REVIEW_OUTPUT_INVALID';
}

export class ContentReviewRequestError extends Error {
  readonly code = 'CONTENT_REVIEW_REQUEST_FAILED';
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ContentReviewRequestError';
    this.cause = cause;
  }
}
