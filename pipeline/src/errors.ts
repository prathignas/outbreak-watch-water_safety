/**
 * Custom error class for pipeline input validation and normalization failures.
 */
export class PipelineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineValidationError";
  }
}

/**
 * Custom error class for external weather API network or HTTP status failures.
 */
export class RainFetchError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly causeError?: unknown) {
    super(message);
    this.name = "RainFetchError";
  }
}

/**
 * Custom error class for failures when invoking the synthetic live-day generator.
 */
export class LiveDayGeneratorError extends Error {
  constructor(message: string, public readonly causeError?: unknown) {
    super(message, causeError !== undefined ? { cause: causeError } : undefined);
    this.name = "LiveDayGeneratorError";
    if (causeError !== undefined && (this as { cause?: unknown }).cause === undefined) {
      (this as { cause?: unknown }).cause = causeError;
    }
  }
}

