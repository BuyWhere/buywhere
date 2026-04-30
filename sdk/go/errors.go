package buywhere

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound         = errors.New("product not found")
	ErrAuthentication   = errors.New("authentication failed: invalid API key")
	ErrRateLimit        = errors.New("rate limit exceeded")
	ErrValidation       = errors.New("validation error")
	ErrServer           = errors.New("internal server error")
)

type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e ErrorResponse) Error() string {
	return fmt.Sprintf("buywhere error: %s (code: %d)", e.Message, e.Code)
}

type BuyWhereError struct {
	Message string
	Code    int
}

func (e BuyWhereError) Error() string {
	return fmt.Sprintf("buywhere error: %s (code: %d)", e.Message, e.Code)
}

func IsNotFound(err error) bool {
	return errors.Is(err, ErrNotFound)
}

func IsAuthenticationError(err error) bool {
	return errors.Is(err, ErrAuthentication)
}

func IsRateLimitError(err error) bool {
	return errors.Is(err, ErrRateLimit)
}