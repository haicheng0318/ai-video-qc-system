export class GeminiConfigurationError extends Error {
  readonly code = 'GEMINI_NOT_CONFIGURED';
}

export class GeminiFileProcessingError extends Error {
  readonly code = 'GEMINI_FILE_PROCESSING_FAILED';
}

export class GeminiFileProcessingTimeoutError extends Error {
  readonly code = 'GEMINI_FILE_PROCESSING_TIMEOUT';
}

export class GeminiOutputValidationError extends Error {
  readonly code = 'GEMINI_OUTPUT_INVALID';
}

export class GeminiRequestError extends Error {
  readonly code = 'GEMINI_REQUEST_FAILED';
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'GeminiRequestError';
    this.cause = cause;
  }
}
