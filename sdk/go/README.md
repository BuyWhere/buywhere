# BuyWhere Go SDK

> Go client library for the BuyWhere product catalog API — the infrastructure layer for AI agent commerce in Singapore and globally.

## Install

```bash
go get github.com/buywhere/buywhere-go
```

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"

    buywhere "github.com/buywhere/buywhere-go"
)

func main() {
    client := buywhere.NewClient("bw_live_xxxxx")

    ctx := context.Background()

    // Search for products
    results, err := client.Search(ctx, "dyson vacuum cleaner", 10)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Found %d products\n", results.Total)

    // Find the cheapest listing across all platforms
    cheapest, err := client.BestPrice(ctx, "Nintendo Switch OLED")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Best price: %.2f %s at %s\n", cheapest.Price, cheapest.Currency, cheapest.Source)

    // List all categories
    categories, err := client.ListCategories(ctx)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("%d categories available\n", categories.Total)
}
```

## API Reference

| Method | Description |
|--------|-------------|
| `client.Search(ctx, query, limit)` | Full-text product search with filters |
| `client.GetProduct(ctx, id)` | Get a product by BuyWhere ID |
| `client.BestPrice(ctx, query)` | Find cheapest listing for a product |
| `client.ComparePrices(ctx, query)` | Alias for `BestPrice()` |
| `client.ListCategories(ctx)` | List all available categories |
| `client.GetDeals(ctx, minDiscount, limit)` | Get discounted products |
| `client.Health(ctx)` | Check API health status |

## Error Handling

```go
package main

import (
    "context"
    "errors"
    "fmt"

    buywhere "github.com/buywhere/buywhere-go"
)

func main() {
    client := buywhere.NewClient("bw_live_xxxxx")
    ctx := context.Background()

    product, err := client.GetProduct(ctx, 999999)
    if err != nil {
        switch {
        case errors.Is(err, buywhere.ErrNotFound):
            fmt.Println("Product not found")
        case errors.Is(err, buywhere.ErrRateLimit):
            fmt.Println("Rate limited — wait and retry")
        case errors.Is(err, buywhere.ErrAuthentication):
            fmt.Println("Invalid API key")
        default:
            fmt.Printf("Error: %v\n", err)
        }
        return
    }
    fmt.Printf("Product: %s\n", product.Name)
}
```

## Using Custom Options

```go
client := buywhere.NewClient(
    "bw_live_xxxxx",
    buywhere.WithBaseURL("https://api.buywhere.ai"),
)

// Or with custom HTTP client
client := buywhere.NewClient(
    "bw_live_xxxxx",
    buywhere.WithHTTPClient(&http.Client{Timeout: 60 * time.Second}),
)
```

## Authentication

Get your API key from the BuyWhere developer portal at [https://developers.buywhere.com](https://developers.buywhere.com).

## License

MIT