"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StructuredError = exports.ErrorCode = exports.DOC_BASE = void 0;
exports.buildErrorEnvelope = buildErrorEnvelope;
exports.buildRateLimitEnvelope = buildRateLimitEnvelope;
exports.sendError = sendError;
exports.sendRateLimitError = sendRateLimitError;
exports.DOC_BASE = 'https://buywhere.ai/docs/errors';
exports.ErrorCode = {
    // 400
    INVALID_PARAMETER: 'INVALID_PARAMETER',
    MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
    INVALID_QUERY: 'INVALID_QUERY',
    INVALID_MARKET: 'INVALID_MARKET',
    INVALID_CATEGORY: 'INVALID_CATEGORY',
    INVALID_PAGINATION: 'INVALID_PAGINATION',
    INVALID_JSON: 'INVALID_JSON',
    // 401
    MISSING_API_KEY: 'MISSING_API_KEY',
    INVALID_API_KEY: 'INVALID_API_KEY',
    REVOKED_API_KEY: 'REVOKED_API_KEY',
    // 403
    INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
    ENDPOINT_DISABLED: 'ENDPOINT_DISABLED',
    FORBIDDEN: 'FORBIDDEN',
    // 404
    NOT_FOUND: 'NOT_FOUND',
    // 405
    METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
    ENDPOINT_DEPRECATED: 'ENDPOINT_DEPRECATED',
    // 409
    CONFLICT: 'CONFLICT',
    // 422
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    // 429
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    // 500
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    // 502
    UPSTREAM_ERROR: 'UPSTREAM_ERROR',
    // 503
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
};
const HTTP_STATUS_MAP = {
    INVALID_PARAMETER: 400,
    MISSING_REQUIRED_FIELD: 400,
    INVALID_QUERY: 400,
    INVALID_MARKET: 400,
    INVALID_CATEGORY: 400,
    INVALID_PAGINATION: 400,
    INVALID_JSON: 400,
    MISSING_API_KEY: 401,
    INVALID_API_KEY: 401,
    REVOKED_API_KEY: 401,
    INSUFFICIENT_SCOPE: 403,
    ENDPOINT_DISABLED: 403,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    ENDPOINT_DEPRECATED: 405,
    CONFLICT: 409,
    VALIDATION_ERROR: 422,
    RATE_LIMIT_EXCEEDED: 429,
    INTERNAL_ERROR: 500,
    UPSTREAM_ERROR: 502,
    SERVICE_UNAVAILABLE: 503,
};
const DEFAULT_MESSAGES = {
    INVALID_PARAMETER: 'Invalid parameter provided.',
    MISSING_REQUIRED_FIELD: 'A required field is missing.',
    INVALID_QUERY: 'Query parameter is missing or empty.',
    INVALID_MARKET: 'Invalid or unsupported market region.',
    INVALID_CATEGORY: 'Invalid or unrecognized category.',
    INVALID_PAGINATION: 'Invalid pagination parameters.',
    INVALID_JSON: 'Request body is not valid JSON.',
    MISSING_API_KEY: 'API key is required. Pass as Authorization: Bearer <key>.',
    INVALID_API_KEY: 'API key is invalid.',
    REVOKED_API_KEY: 'API key has been revoked.',
    INSUFFICIENT_SCOPE: 'API key does not have the required scope for this endpoint.',
    ENDPOINT_DISABLED: 'This endpoint is currently disabled.',
    FORBIDDEN: 'Access denied.',
    NOT_FOUND: 'The requested resource was not found.',
    METHOD_NOT_ALLOWED: 'HTTP method not allowed for this endpoint.',
    ENDPOINT_DEPRECATED: 'This endpoint is deprecated. See docs for replacement.',
    CONFLICT: 'Resource conflict.',
    VALIDATION_ERROR: 'Validation failed.',
    RATE_LIMIT_EXCEEDED: 'Rate limit exceeded. Please reduce request volume.',
    INTERNAL_ERROR: 'An unexpected error occurred. Please try again later.',
    UPSTREAM_ERROR: 'An upstream service error occurred.',
    SERVICE_UNAVAILABLE: 'Service temporarily unavailable. Please try again later.',
};
function buildErrorEnvelope(code, message, detail) {
    return {
        error: {
            code,
            message: message || DEFAULT_MESSAGES[code] || 'Unknown error.',
            ...(detail ? { detail } : {}),
            doc_url: `${exports.DOC_BASE}#${code}`,
        },
    };
}
function buildRateLimitEnvelope(retryAfter, limit, remaining, resetAt, message) {
    return {
        ...buildErrorEnvelope(exports.ErrorCode.RATE_LIMIT_EXCEEDED, message),
        rate_limit: {
            retry_after: retryAfter,
            limit,
            remaining,
            reset_at: resetAt,
        },
    };
}
function sendError(res, code, message, detail, statusCode) {
    const status = statusCode || HTTP_STATUS_MAP[code] || 500;
    res.status(status).json(buildErrorEnvelope(code, message, detail));
}
function sendRateLimitError(res, retryAfter, limit, remaining, message) {
    const resetAt = new Date(Date.now() + retryAfter * 1000).toISOString();
    res.set('Retry-After', String(retryAfter));
    res.status(429).json(buildRateLimitEnvelope(retryAfter, limit, remaining, resetAt, message));
}
class StructuredError extends Error {
    constructor(code, message, detail) {
        super(message || DEFAULT_MESSAGES[code] || code);
        this.name = 'StructuredError';
        this.code = code;
        this.statusCode = HTTP_STATUS_MAP[code] || 500;
        this.detail = detail;
    }
    toEnvelope() {
        return buildErrorEnvelope(this.code, this.message, this.detail);
    }
}
exports.StructuredError = StructuredError;
