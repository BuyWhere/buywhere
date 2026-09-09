import type {
  SearchParams,
  CompareParams,
  DealsParams,
  DealsFeedParams,
  GetPriceHistoryParams,
  GetProductReviewsParams,
  GetProductAlertsParams,
  PriceHistoryOptions,
  BatchSearchParams,
  AgentSearchParams,
} from './types';

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public value?: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

const VALID_COUNTRIES = ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'] as const;
const VALID_REGIONS = ['us', 'sea'] as const;
const VALID_PERIODS = ['7d', '30d', '90d', '1y'] as const;
const VALID_SORT_OPTIONS = ['relevance', 'price_asc', 'price_desc', 'newest', 'highest_rated', 'most_reviewed'] as const;

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function validateSearchParams(params: SearchParams): void {
  if (!isString(params.query) || params.query.trim().length === 0) {
    throw new ValidationError('query must be a non-empty string', 'query', params.query);
  }

  if (params.country !== undefined) {
    if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country as typeof VALID_COUNTRIES[number])) {
      throw new ValidationError(
        `country must be one of: ${VALID_COUNTRIES.join(', ')}`,
        'country',
        params.country
      );
    }
  }

  if (params.region !== undefined) {
    if (!isString(params.region) || !VALID_REGIONS.includes(params.region as typeof VALID_REGIONS[number])) {
      throw new ValidationError(
        `region must be one of: ${VALID_REGIONS.join(', ')}`,
        'region',
        params.region
      );
    }
  }

  if (params.limit !== undefined) {
    if (!isNumber(params.limit) || params.limit < 1 || params.limit > 50) {
      throw new ValidationError('limit must be a number between 1 and 50', 'limit', params.limit);
    }
  }

  if (params.offset !== undefined) {
    if (!isNumber(params.offset) || params.offset < 0) {
      throw new ValidationError('offset must be a non-negative number', 'offset', params.offset);
    }
  }

  if (params.price_min !== undefined) {
    if (!isNumber(params.price_min) || params.price_min < 0) {
      throw new ValidationError('price_min must be a non-negative number', 'price_min', params.price_min);
    }
  }

  if (params.price_max !== undefined) {
    if (!isNumber(params.price_max) || params.price_max < 0) {
      throw new ValidationError('price_max must be a non-negative number', 'price_max', params.price_max);
    }
  }

  if (params.price_min !== undefined && params.price_max !== undefined) {
    if (params.price_min > params.price_max) {
      throw new ValidationError('price_min cannot be greater than price_max', 'price_min', params.price_min);
    }
  }
}

export function validateCompareParams(params: CompareParams): void {
  if (params.category !== undefined) {
    if (!isString(params.category) || params.category.trim().length === 0) {
      throw new ValidationError('category must be a non-empty string', 'category', params.category);
    }
  }

  if (params.product_ids !== undefined) {
    if (!isArray(params.product_ids)) {
      throw new ValidationError('product_ids must be an array', 'product_ids', params.product_ids);
    }

    for (let i = 0; i < params.product_ids.length; i++) {
      const id = params.product_ids[i];
      if (typeof id !== 'string' && typeof id !== 'number') {
        throw new ValidationError(`product_ids[${i}] must be a string or number`, `product_ids[${i}]`, id);
      }
    }
  }

  if (params.region !== undefined) {
    if (!isString(params.region) || !VALID_REGIONS.includes(params.region as typeof VALID_REGIONS[number])) {
      throw new ValidationError(
        `region must be one of: ${VALID_REGIONS.join(', ')}`,
        'region',
        params.region
      );
    }
  }

  if (params.country !== undefined) {
    if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country as typeof VALID_COUNTRIES[number])) {
      throw new ValidationError(
        `country must be one of: ${VALID_COUNTRIES.join(', ')}`,
        'country',
        params.country
      );
    }
  }
}

export function validateDealsParams(params?: DealsParams): void {
  if (params === undefined) return;

  if (params.country !== undefined) {
    if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country as typeof VALID_COUNTRIES[number])) {
      throw new ValidationError(
        `country must be one of: ${VALID_COUNTRIES.join(', ')}`,
        'country',
        params.country
      );
    }
  }

  if (params.category !== undefined) {
    if (!isString(params.category) || params.category.trim().length === 0) {
      throw new ValidationError('category must be a non-empty string', 'category', params.category);
    }
  }

  if (params.limit !== undefined) {
    if (!isNumber(params.limit) || params.limit < 1 || params.limit > 100) {
      throw new ValidationError('limit must be a number between 1 and 100', 'limit', params.limit);
    }
  }

  if (params.offset !== undefined) {
    if (!isNumber(params.offset) || params.offset < 0) {
      throw new ValidationError('offset must be a non-negative number', 'offset', params.offset);
    }
  }
}

export function validateDealsFeedParams(params?: DealsFeedParams): void {
  if (params === undefined) return;

  if (params.country !== undefined) {
    if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country as typeof VALID_COUNTRIES[number])) {
      throw new ValidationError(
        `country must be one of: ${VALID_COUNTRIES.join(', ')}`,
        'country',
        params.country
      );
    }
  }

  if (params.category !== undefined) {
    if (!isString(params.category) || params.category.trim().length === 0) {
      throw new ValidationError('category must be a non-empty string', 'category', params.category);
    }
  }

  if (params.limit !== undefined) {
    if (!isNumber(params.limit) || params.limit < 1 || params.limit > 100) {
      throw new ValidationError('limit must be a number between 1 and 100', 'limit', params.limit);
    }
  }

  if (params.offset !== undefined) {
    if (!isNumber(params.offset) || params.offset < 0) {
      throw new ValidationError('offset must be a non-negative number', 'offset', params.offset);
    }
  }

  if (params.min_discount_pct !== undefined) {
    if (!isNumber(params.min_discount_pct) || params.min_discount_pct < 0 || params.min_discount_pct > 100) {
      throw new ValidationError('min_discount_pct must be a number between 0 and 100', 'min_discount_pct', params.min_discount_pct);
    }
  }
}

export function validateGetPriceHistoryParams(params: GetPriceHistoryParams): void {
  if (params.product_id === undefined) {
    throw new ValidationError('product_id is required', 'product_id', params.product_id);
  }

  if (typeof params.product_id !== 'string' && typeof params.product_id !== 'number') {
    throw new ValidationError('product_id must be a string or number', 'product_id', params.product_id);
  }

  if (params.country !== undefined) {
    if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country as typeof VALID_COUNTRIES[number])) {
      throw new ValidationError(
        `country must be one of: ${VALID_COUNTRIES.join(', ')}`,
        'country',
        params.country
      );
    }
  }

  if (params.period !== undefined) {
    if (!isString(params.period) || !VALID_PERIODS.includes(params.period as typeof VALID_PERIODS[number])) {
      throw new ValidationError(
        `period must be one of: ${VALID_PERIODS.join(', ')}`,
        'period',
        params.period
      );
    }
  }
}

export function validateGetProductReviewsParams(params: GetProductReviewsParams): void {
  if (params.product_id === undefined) {
    throw new ValidationError('product_id is required', 'product_id', params.product_id);
  }

  if (typeof params.product_id !== 'number') {
    throw new ValidationError('product_id must be a number', 'product_id', params.product_id);
  }

  if (params.country !== undefined) {
    if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country as typeof VALID_COUNTRIES[number])) {
      throw new ValidationError(
        `country must be one of: ${VALID_COUNTRIES.join(', ')}`,
        'country',
        params.country
      );
    }
  }
}

export function validateGetProductAlertsParams(params: GetProductAlertsParams): void {
  if (params.product_id === undefined) {
    throw new ValidationError('product_id is required', 'product_id', params.product_id);
  }

  if (typeof params.product_id !== 'number') {
    throw new ValidationError('product_id must be a number', 'product_id', params.product_id);
  }

  if (params.country !== undefined) {
    if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country as typeof VALID_COUNTRIES[number])) {
      throw new ValidationError(
        `country must be one of: ${VALID_COUNTRIES.join(', ')}`,
        'country',
        params.country
      );
    }
  }
}

export function validatePriceHistoryOptions(options?: PriceHistoryOptions): void {
  if (options === undefined) return;

  if (options.country !== undefined) {
    if (!isString(options.country) || !VALID_COUNTRIES.includes(options.country as typeof VALID_COUNTRIES[number])) {
      throw new ValidationError(
        `country must be one of: ${VALID_COUNTRIES.join(', ')}`,
        'country',
        options.country
      );
    }
  }

  if (options.period !== undefined) {
    if (!isString(options.period) || !VALID_PERIODS.includes(options.period as typeof VALID_PERIODS[number])) {
      throw new ValidationError(
        `period must be one of: ${VALID_PERIODS.join(', ')}`,
        'period',
        options.period
      );
    }
  }

  if (options.limit !== undefined) {
    if (!isNumber(options.limit) || options.limit < 1) {
      throw new ValidationError('limit must be a positive number', 'limit', options.limit);
    }
  }

  if (options.since !== undefined) {
    if (!isString(options.since)) {
      throw new ValidationError('since must be an ISO date string', 'since', options.since);
    }
    const date = new Date(options.since);
    if (isNaN(date.getTime())) {
      throw new ValidationError('since must be a valid ISO date string', 'since', options.since);
    }
  }
}

export function validateBatchSearchParams(params: BatchSearchParams): void {
  if (!isArray(params.queries)) {
    throw new ValidationError('queries must be an array', 'queries', params.queries);
  }

  if (params.queries.length === 0) {
    throw new ValidationError('queries array cannot be empty', 'queries', params.queries);
  }

  if (params.queries.length > 20) {
    throw new ValidationError('queries array cannot exceed 20 items', 'queries', params.queries);
  }

  for (let i = 0; i < params.queries.length; i++) {
    const query = params.queries[i];
    if (!isString(query.query) || query.query.trim().length === 0) {
      throw new ValidationError(`queries[${i}].query must be a non-empty string`, `queries[${i}].query`, query.query);
    }

    if (query.country !== undefined) {
      if (!isString(query.country) || !VALID_COUNTRIES.includes(query.country as typeof VALID_COUNTRIES[number])) {
        throw new ValidationError(
          `queries[${i}].country must be one of: ${VALID_COUNTRIES.join(', ')}`,
          `queries[${i}].country`,
          query.country
        );
      }
    }

    if (query.limit !== undefined) {
      if (!isNumber(query.limit) || query.limit < 1 || query.limit > 50) {
        throw new ValidationError(
          `queries[${i}].limit must be a number between 1 and 50`,
          `queries[${i}].limit`,
          query.limit
        );
      }
    }

    if (query.price_min !== undefined && (!isNumber(query.price_min) || query.price_min < 0)) {
      throw new ValidationError(
        `queries[${i}].price_min must be a non-negative number`,
        `queries[${i}].price_min`,
        query.price_min
      );
    }

    if (query.price_max !== undefined && (!isNumber(query.price_max) || query.price_max < 0)) {
      throw new ValidationError(
        `queries[${i}].price_max must be a non-negative number`,
        `queries[${i}].price_max`,
        query.price_max
      );
    }

    if (query.price_min !== undefined && query.price_max !== undefined) {
      if (query.price_min > query.price_max) {
        throw new ValidationError(
          `queries[${i}].price_min cannot be greater than price_max`,
          `queries[${i}].price_min`,
          query.price_min
        );
      }
    }
  }
}

export function validateAgentSearchParams(params: AgentSearchParams): void {
  if (!isString(params.q) || params.q.trim().length === 0) {
    throw new ValidationError('q must be a non-empty string', 'q', params.q);
  }

  if (params.limit !== undefined) {
    if (!isNumber(params.limit) || params.limit < 1 || params.limit > 100) {
      throw new ValidationError('limit must be a number between 1 and 100', 'limit', params.limit);
    }
  }

  if (params.offset !== undefined) {
    if (!isNumber(params.offset) || params.offset < 0) {
      throw new ValidationError('offset must be a non-negative number', 'offset', params.offset);
    }
  }

  if (params.sort_by !== undefined) {
    if (!isString(params.sort_by) || !VALID_SORT_OPTIONS.includes(params.sort_by as typeof VALID_SORT_OPTIONS[number])) {
      throw new ValidationError(
        `sort_by must be one of: ${VALID_SORT_OPTIONS.join(', ')}`,
        'sort_by',
        params.sort_by
      );
    }
  }

  if (params.min_price !== undefined) {
    if (!isNumber(params.min_price) || params.min_price < 0) {
      throw new ValidationError('min_price must be a non-negative number', 'min_price', params.min_price);
    }
  }

  if (params.max_price !== undefined) {
    if (!isNumber(params.max_price) || params.max_price < 0) {
      throw new ValidationError('max_price must be a non-negative number', 'max_price', params.max_price);
    }
  }

  if (params.price_min !== undefined) {
    if (!isNumber(params.price_min) || params.price_min < 0) {
      throw new ValidationError('price_min must be a non-negative number', 'price_min', params.price_min);
    }
  }

  if (params.price_max !== undefined) {
    if (!isNumber(params.price_max) || params.price_max < 0) {
      throw new ValidationError('price_max must be a non-negative number', 'price_max', params.price_max);
    }
  }

  if (params.availability !== undefined) {
    if (typeof params.availability !== 'boolean') {
      throw new ValidationError('availability must be a boolean', 'availability', params.availability);
    }
  }

  if (params.include_agent_insights !== undefined) {
    if (typeof params.include_agent_insights !== 'boolean') {
      throw new ValidationError('include_agent_insights must be a boolean', 'include_agent_insights', params.include_agent_insights);
    }
  }

  if (params.include_availability_prediction !== undefined) {
    if (typeof params.include_availability_prediction !== 'boolean') {
      throw new ValidationError('include_availability_prediction must be a boolean', 'include_availability_prediction', params.include_availability_prediction);
    }
  }

  if (params.include_price_history !== undefined) {
    if (typeof params.include_price_history !== 'boolean') {
      throw new ValidationError('include_price_history must be a boolean', 'include_price_history', params.include_price_history);
    }
  }

  if (params.min_price !== undefined && params.max_price !== undefined) {
    if (params.min_price > params.max_price) {
      throw new ValidationError('min_price cannot be greater than max_price', 'min_price', params.min_price);
    }
  }

  if (params.price_min !== undefined && params.price_max !== undefined) {
    if (params.price_min > params.price_max) {
      throw new ValidationError('price_min cannot be greater than price_max', 'price_min', params.price_min);
    }
  }
}

export function validateProductId(productId: number | string, fieldName: string = 'productId'): void {
  if (typeof productId !== 'string' && typeof productId !== 'number') {
    throw new ValidationError(`${fieldName} must be a string or number`, fieldName, productId);
  }

  if (typeof productId === 'string' && productId.trim().length === 0) {
    throw new ValidationError(`${fieldName} cannot be empty`, fieldName, productId);
  }

  if (typeof productId === 'number' && (isNaN(productId) || productId < 0)) {
    throw new ValidationError(`${fieldName} must be a positive number`, fieldName, productId);
  }
}

export function validateWebhookUrl(url: string): void {
  if (!isString(url) || url.trim().length === 0) {
    throw new ValidationError('webhook URL must be a non-empty string', 'url', url);
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError('webhook URL must use HTTP or HTTPS protocol', 'url', url);
    }
  } catch {
    throw new ValidationError('webhook URL must be a valid URL', 'url', url);
  }
}

export function validateWebhookEvents(events: string[]): void {
  if (!isArray(events)) {
    throw new ValidationError('events must be an array', 'events', events);
  }

  if (events.length === 0) {
    throw new ValidationError('events array cannot be empty', 'events', events);
  }

  const VALID_EVENTS = ['price_drop', 'stock_change', 'new_product', 'deal_expiry'];

  for (let i = 0; i < events.length; i++) {
    if (!isString(events[i])) {
      throw new ValidationError(`events[${i}] must be a string`, `events[${i}]`, events[i]);
    }

    if (!VALID_EVENTS.includes(events[i])) {
      throw new ValidationError(
        `events[${i}] must be one of: ${VALID_EVENTS.join(', ')}`,
        `events[${i}]`,
        events[i]
      );
    }
  }
}