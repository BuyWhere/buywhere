export type ErrorCode =
  | 'INVALID_API_KEY'
  | 'MISSING_API_KEY'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_COUNTRY'
  | 'INVALID_REGION'
  | 'INVALID_PERIOD'
  | 'INVALID_SORT'
  | 'INVALID_LIMIT'
  | 'INVALID_OFFSET'
  | 'INVALID_PRICE_RANGE'
  | 'MISSING_REQUIRED_FIELD'
  | 'PRODUCT_NOT_FOUND'
  | 'CATEGORY_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'SERVER_ERROR'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN_ERROR';

export interface ErrorResponse {
  error: string;
  code: ErrorCode;
  details?: Record<string, unknown>;
  request_id?: string;
  retry_after?: number;
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
  value?: unknown;
}

export interface ApiErrorResponse {
  error: string;
  message?: string;
  code?: string;
  details?: unknown;
  request_id?: string;
  retry_after?: number;
}

export function createErrorResponse(
  message: string,
  code: ErrorCode,
  options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    retryAfter?: number;
  }
): ErrorResponse {
  const response: ErrorResponse = {
    error: message,
    code,
  };

  if (options?.details) {
    response.details = options.details;
  }

  if (options?.requestId) {
    response.request_id = options.requestId;
  }

  if (options?.retryAfter !== undefined) {
    response.retry_after = options.retryAfter;
  }

  return response;
}

export function createValidationErrorResponse(
  errors: ValidationErrorDetail[],
  requestId?: string
): ErrorResponse & { details: { validation_errors: ValidationErrorDetail[] } } {
  return {
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: { validation_errors: errors },
    request_id: requestId,
  };
}

export function createRateLimitErrorResponse(
  retryAfter: number,
  requestId?: string
): ErrorResponse {
  return createErrorResponse(
    'Rate limit exceeded. Please retry after the specified time.',
    'RATE_LIMIT_EXCEEDED',
    { retryAfter, requestId }
  );
}

export function createProductNotFoundResponse(
  productId: number | string,
  requestId?: string
): ErrorResponse {
  return {
    error: `Product with ID ${productId} not found`,
    code: 'PRODUCT_NOT_FOUND',
    details: { product_id: productId },
    request_id: requestId,
  };
}

export function createCategoryNotFoundResponse(
  category: string,
  requestId?: string
): ErrorResponse {
  return {
    error: `Category '${category}' not found`,
    code: 'CATEGORY_NOT_FOUND',
    details: { category },
    request_id: requestId,
  };
}

export function createCircuitBreakerErrorResponse(
  state: 'closed' | 'open' | 'half-open',
  requestId?: string
): ErrorResponse {
  const messages: Record<string, string> = {
    open: 'Service temporarily unavailable. The circuit breaker is open.',
    'half-open': 'Service availability is limited. Testing connection.',
    closed: 'Service is operating normally.',
  };

  return {
    error: messages[state] || 'Circuit breaker error',
    code: 'CIRCUIT_BREAKER_OPEN',
    details: { circuit_state: state },
    request_id: requestId,
  };
}

export function parseApiErrorResponse(response: Response, bodyText: string): ErrorResponse {
  let parsed: ApiErrorResponse | undefined;

  try {
    parsed = JSON.parse(bodyText) as ApiErrorResponse;
  } catch {
    return {
      error: `HTTP ${response.status}: ${response.statusText}`,
      code: 'UNKNOWN_ERROR',
    };
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;
  const retryAfter = response.headers.get('retry-after')
    ? parseInt(response.headers.get('retry-after')!, 10)
    : undefined;

  const code = mapHttpStatusToErrorCode(response.status);
  const errorMessage = parsed.error ?? parsed.message ?? `HTTP ${response.status}`;

  return {
    error: errorMessage,
    code,
    details: parsed.details as Record<string, unknown> | undefined,
    request_id: requestId,
    retry_after: retryAfter,
  };
}

export function mapHttpStatusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'INVALID_API_KEY';
    case 403:
      return 'INVALID_API_KEY';
    case 404:
      return 'PRODUCT_NOT_FOUND';
    case 429:
      return 'RATE_LIMIT_EXCEEDED';
    case 500:
      return 'SERVER_ERROR';
    case 502:
      return 'SERVER_ERROR';
    case 503:
      return 'SERVER_ERROR';
    default:
      return 'UNKNOWN_ERROR';
  }
}

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly requestId?: string;
  public readonly retryAfter?: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 500,
    options?: {
      requestId?: string;
      retryAfter?: number;
      details?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = options?.requestId;
    this.retryAfter = options?.retryAfter;
    this.details = options?.details;
  }

  toJSON(): ErrorResponse {
    return createErrorResponse(this.message, this.code, {
      details: this.details,
      requestId: this.requestId,
      retryAfter: this.retryAfter,
    });
  }

  static fromResponse(response: Response, body: string): ApiError {
    const parsed = parseApiErrorResponse(response, body);
    return new ApiError(
      parsed.error,
      parsed.code,
      response.status,
      {
        requestId: parsed.request_id,
        retryAfter: parsed.retry_after,
        details: parsed.details,
      }
    );
  }
}

export function isRetryableError(error: Error): boolean {
  if (error instanceof ApiError) {
    return (
      error.code === 'RATE_LIMIT_EXCEEDED' ||
      error.code === 'SERVER_ERROR' ||
      error.code === 'NETWORK_ERROR' ||
      error.code === 'TIMEOUT_ERROR'
    );
  }
  return false;
}

export function isAuthError(error: Error): boolean {
  if (error instanceof ApiError) {
    return error.code === 'INVALID_API_KEY' || error.code === 'MISSING_API_KEY';
  }
  return false;
}