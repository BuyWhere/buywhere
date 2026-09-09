CREATE TABLE IF NOT EXISTS seo_pages (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published')),
  country VARCHAR(2) NOT NULL CHECK (country IN ('US', 'SG')),
  search_query TEXT NOT NULL,
  reviewer TEXT,
  page JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  date_modified TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_pages_slug_status ON seo_pages (slug, status);
CREATE INDEX IF NOT EXISTS idx_seo_pages_country_status ON seo_pages (country, status);
