-- BUY-54078: fx_rates table for live FX rate storage
-- Primary source: frankfurter.app (ECB rates, free, keyless)
-- Fallback source: open.er-api.org (free tier, keyless)
-- Refresh cadence: every 6 hours via fxRefreshScheduler

CREATE TABLE IF NOT EXISTS fx_rates (
  id          BIGSERIAL PRIMARY KEY,
  base_currency  TEXT        NOT NULL,  -- e.g. 'EUR'
  quote_currency TEXT       NOT NULL,  -- e.g. 'USD'
  rate        NUMERIC(20, 10) NOT NULL, -- units of target per 1 base
  source      TEXT        NOT NULL,      -- 'frankfurter' | 'open.er-api'
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- unique constraint: one rate per base+target pair
  CONSTRAINT fx_rates_pair_unique UNIQUE (base_currency, quote_currency)
);

CREATE INDEX IF NOT EXISTS idx_fx_rates_currencies ON fx_rates(base_currency, quote_currency);
CREATE INDEX IF NOT EXISTS idx_fx_rates_fetched_at  ON fx_rates(fetched_at DESC);

COMMENT ON TABLE fx_rates IS
  'Live FX rates sourced from frankfurter.app (ECB) with open.er-api.org fallback. '
  'Refreshed every 6 hours by fxRefreshScheduler. Rates are "units of target per 1 base" — '
  'e.g. EUR/USD = 1.09 means 1 EUR buys 1.09 USD.';
COMMENT ON COLUMN fx_rates.rate IS
  'Number of quote_currency units per 1 base_currency unit. USD is the base: '
  'to convert MYR → USD, multiply MYR price by fx_rates.rate where base=MYR, target=USD.';
