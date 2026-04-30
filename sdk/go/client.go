package buywhere

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const DefaultBaseURL = "https://api.buywhere.ai"

type Client struct {
	baseURL   string
	apiKey    string
	httpClient *http.Client
}

type ClientOption func(*Client)

func WithBaseURL(url string) ClientOption {
	return func(c *Client) {
		c.baseURL = url
	}
}

func WithHTTPClient(client *http.Client) ClientOption {
	return func(c *Client) {
		c.httpClient = client
	}
}

func NewClient(apiKey string, opts ...ClientOption) *Client {
	c := &Client{
		baseURL: DefaultBaseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

func (c *Client) doRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	url := c.baseURL + path
	var req *http.Request
	var err error

	if body != nil {
		req, err = http.NewRequestWithContext(ctx, method, url, nil)
	} else {
		req, err = http.NewRequestWithContext(ctx, method, url, nil)
	}
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	return c.httpClient.Do(req)
}

func (c *Client) doRequestWithQuery(ctx context.Context, method, path string, queryParams map[string]string) (*http.Response, error) {
	url := c.baseURL + path
	if len(queryParams) > 0 {
		url += "?"
		for k, v := range queryParams {
			url += fmt.Sprintf("%s=%s&", k, v)
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	return c.httpClient.Do(req)
}

func (c *Client) Search(ctx context.Context, query string, limit int) (*ProductList, error) {
	params := map[string]string{
		"q":     query,
		"limit": fmt.Sprintf("%d", limit),
	}
	resp, err := c.doRequestWithQuery(ctx, http.MethodGet, "/v1/products/search", params)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrAuthentication
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrRateLimit
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error: %d", resp.StatusCode)
	}

	var result ProductList
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) GetProduct(ctx context.Context, id int) (*Product, error) {
	path := fmt.Sprintf("/v1/products/%d", id)
	resp, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrAuthentication
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrRateLimit
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error: %d", resp.StatusCode)
	}

	var product Product
	if err := json.NewDecoder(resp.Body).Decode(&product); err != nil {
		return nil, err
	}
	return &product, nil
}

func (c *Client) BestPrice(ctx context.Context, query string) (*Product, error) {
	params := map[string]string{
		"q": query,
	}
	resp, err := c.doRequestWithQuery(ctx, http.MethodGet, "/v1/products/best-price", params)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrAuthentication
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrRateLimit
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error: %d", resp.StatusCode)
	}

	var product Product
	if err := json.NewDecoder(resp.Body).Decode(&product); err != nil {
		return nil, err
	}
	return &product, nil
}

func (c *Client) ComparePrices(ctx context.Context, query string) (*Product, error) {
	return c.BestPrice(ctx, query)
}

func (c *Client) ListCategories(ctx context.Context) (*CategoryList, error) {
	resp, err := c.doRequest(ctx, http.MethodGet, "/v1/categories", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrAuthentication
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrRateLimit
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error: %d", resp.StatusCode)
	}

	var categories CategoryList
	if err := json.NewDecoder(resp.Body).Decode(&categories); err != nil {
		return nil, err
	}
	return &categories, nil
}

func (c *Client) GetDeals(ctx context.Context, minDiscount float64, limit int) (*DealList, error) {
	params := map[string]string{
		"min_discount": fmt.Sprintf("%f", minDiscount),
		"limit":        fmt.Sprintf("%d", limit),
	}
	resp, err := c.doRequestWithQuery(ctx, http.MethodGet, "/v1/deals", params)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrAuthentication
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrRateLimit
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error: %d", resp.StatusCode)
	}

	var deals DealList
	if err := json.NewDecoder(resp.Body).Decode(&deals); err != nil {
		return nil, err
	}
	return &deals, nil
}

func (c *Client) Health(ctx context.Context) (*HealthStatus, error) {
	resp, err := c.doRequest(ctx, http.MethodGet, "/health", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error: %d", resp.StatusCode)
	}

	var health HealthStatus
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return nil, err
	}
	return &health, nil
}