export interface Product {
  id: number;
  sku: string;
  source: string;
  merchant_id: string;
  title: string;
  description: string | null;
  price: number;
  currency: string;
  url: string;
  brand: string | null;
  category: string | null;
  category_path: string[] | null;
  image_url: string | null;
  is_active: boolean;
  is_available: boolean;
  rating: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  category?: string;
  min_price?: number;
  max_price?: number;
  source?: string;
}

export interface SearchResponse {
  total: number;
  items: Product[];
  took_ms: number;
}

export interface Category {
  id: string;
  name: string;
  path: string;
  product_count: number;
}

export interface Deal {
  product: Product;
  original_price: number;
  current_price: number;
  discount_pct: number;
  price_history: PricePoint[];
}

export interface PricePoint {
  price: number;
  recorded_at: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ApiError extends Error {
  code: string;
  details?: Record<string, unknown>;
  statusCode: number;

  constructor(message: string, code: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}