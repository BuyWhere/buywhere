export class BuyWhereError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "BuyWhereError";
  }
}

export class AuthenticationError extends BuyWhereError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends BuyWhereError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends BuyWhereError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends BuyWhereError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = "ValidationError";
  }
}

export class ServerError extends BuyWhereError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = "ServerError";
  }
}