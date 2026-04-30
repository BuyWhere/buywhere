class BuyWhereError(Exception):
    """Base exception for all BuyWhere SDK errors."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class AuthenticationError(BuyWhereError):
    """Raised when API authentication fails (401/403)."""

    def __init__(self, message: str = "Authentication failed", *, status_code: int = 401) -> None:
        super().__init__(message, status_code=status_code)


class NotFoundError(BuyWhereError):
    """Raised when a requested resource is not found (404)."""

    def __init__(self, message: str = "Resource not found", *, status_code: int = 404) -> None:
        super().__init__(message, status_code=status_code)


class RateLimitError(BuyWhereError):
    """Raised when API rate limit is exceeded (429)."""

    def __init__(self, message: str = "Rate limit exceeded", *, status_code: int = 429) -> None:
        super().__init__(message, status_code=status_code)


class ValidationError(BuyWhereError):
    """Raised when request validation fails (422)."""

    def __init__(self, message: str = "Validation error", *, status_code: int = 422) -> None:
        super().__init__(message, status_code=status_code)


class ServerError(BuyWhereError):
    """Raised when the server encounters an error (5xx)."""

    def __init__(self, message: str = "Server error", *, status_code: int = 500) -> None:
        super().__init__(message, status_code=status_code)