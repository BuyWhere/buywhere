package buywhere

import (
	"encoding/json"
	"time"
)

type Product struct {
	ID           int               `json:"id"`
	SKU          string            `json:"sku"`
	Source       string            `json:"source"`
	MerchantID   string            `json:"merchant_id"`
	Name         string            `json:"name"`
	Description  string            `json:"description,omitempty"`
	Price        float64           `json:"price"`
	Currency     string            `json:"currency"`
	BuyURL       string            `json:"buy_url"`
	AffiliateURL string            `json:"affiliate_url,omitempty"`
	ImageURL     string            `json:"image_url,omitempty"`
	Brand        string            `json:"brand,omitempty"`
	Category     string            `json:"category,omitempty"`
	CategoryPath []string         `json:"category_path,omitempty"`
	Rating       float64           `json:"rating,omitempty"`
	Availability bool              `json:"availability"`
	Metadata     map[string]any   `json:"metadata,omitempty"`
	UpdatedAt    time.Time        `json:"updated_at,omitempty"`
}

type ProductList struct {
	Total  int       `json:"total"`
	Limit  int       `json:"limit"`
	Offset int       `json:"offset"`
	Items  []Product `json:"items"`
}

type CategoryNode struct {
	Name     string          `json:"name"`
	Count    int             `json:"count"`
	Children []CategoryNode  `json:"children,omitempty"`
}

type CategoryList struct {
	Categories []CategoryNode `json:"categories"`
	Total      int           `json:"total"`
}

type DealItem struct {
	ID            int           `json:"id"`
	Name          string        `json:"name"`
	Price         float64       `json:"price"`
	OriginalPrice float64       `json:"original_price,omitempty"`
	DiscountPct   float64       `json:"discount_pct,omitempty"`
	Currency      string        `json:"currency"`
	Source        string        `json:"source"`
	Category      string        `json:"category,omitempty"`
	BuyURL        string        `json:"buy_url"`
	AffiliateURL   string        `json:"affiliate_url,omitempty"`
	ImageURL      string        `json:"image_url,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}

type DealList struct {
	Total  int        `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
	Items  []DealItem `json:"items"`
}

type HealthStatus struct {
	Status     string `json:"status"`
	Version    string `json:"version"`
	Environment string `json:"environment,omitempty"`
}

func (p *Product) UnmarshalJSON(data []byte) error {
	type Alias Product
	aux := &struct {
		Price        json.Number `json:"price"`
		Rating       json.Number `json:"rating"`
		*Alias
	}{
		Alias: (*Alias)(p),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if aux.Price != "" {
		f, _ := aux.Price.Float64()
		p.Price = f
	}
	if aux.Rating != "" {
		f, _ := aux.Rating.Float64()
		p.Rating = f
	}
	return nil
}

func (d *DealItem) UnmarshalJSON(data []byte) error {
	type Alias DealItem
	aux := &struct {
		Price         json.Number `json:"price"`
		OriginalPrice json.Number `json:"original_price"`
		DiscountPct   json.Number `json:"discount_pct"`
		*Alias
	}{
		Alias: (*Alias)(d),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if aux.Price != "" {
		f, _ := aux.Price.Float64()
		d.Price = f
	}
	if aux.OriginalPrice != "" {
		f, _ := aux.OriginalPrice.Float64()
		d.OriginalPrice = f
	}
	if aux.DiscountPct != "" {
		f, _ := aux.DiscountPct.Float64()
		d.DiscountPct = f
	}
	return nil
}