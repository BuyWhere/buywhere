-- BUY-70932: merchant-adapter recheck queue for dead->ok URL flips.
--
-- When an outbound-link probe (or any writer) flips products.url_status from
-- 'dead' back to 'ok', this queue captures the event so Oracle can re-ingest /
-- re-map the merchant URL. The queue is intentionally decoupled from the probe
-- worker: a trigger on products.url_status performs the INSERT, so Cart does
-- not need to know Oracle's queue schema.
--
-- Acceptance:
--   - Queue table with product_id, merchant_id, old_status, new_status,
--     detected_at, processed_at.
--   - Trigger inserts on dead->ok flips.
--   - Oracle consumer reads unprocessed rows, re-ingests, marks processed.
--   - Quarantine: 3+ dead->ok flips for the same product in 24h.
--
-- Applied: 2026-08-17 against sakura catalog DB.
-- application_name: ops-ddl

BEGIN;

SET LOCAL application_name = 'ops-ddl';

-- ---------------------------------------------------------------------------
-- 1. Queue table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchant_adapter_recheck_queue (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id        BIGINT NOT NULL,
    merchant_id       TEXT NOT NULL,
    old_status        TEXT NOT NULL,
    new_status        TEXT NOT NULL,
    url               TEXT,                    -- working URL discovered by probe
    detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at      TIMESTAMPTZ,             -- set by Oracle consumer
    processed_by      TEXT,                    -- agent / run id
    result            TEXT,                    -- success | no_adapter | quarantined | failed
    retry_count       INTEGER NOT NULL DEFAULT 0,
    quarantined_at    TIMESTAMPTZ,             -- set when 3+ flips in 24h
    quarantine_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_merchant_adapter_recheck_queue_unprocessed
    ON merchant_adapter_recheck_queue (detected_at ASC)
    WHERE processed_at IS NULL AND quarantined_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_merchant_adapter_recheck_queue_product
    ON merchant_adapter_recheck_queue (product_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_merchant_adapter_recheck_queue_merchant
    ON merchant_adapter_recheck_queue (merchant_id, detected_at DESC)
    WHERE processed_at IS NULL AND quarantined_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Trigger function: enqueue dead->ok flips
--    Guarded so the migration can run before BUY-70780 adds url_status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_products_url_status_dead_to_ok_queue()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.url_status IS DISTINCT FROM NEW.url_status
       AND OLD.url_status = 'dead'
       AND NEW.url_status = 'ok' THEN
        INSERT INTO merchant_adapter_recheck_queue (
            product_id,
            merchant_id,
            old_status,
            new_status,
            url,
            detected_at
        ) VALUES (
            NEW.id,
            NEW.merchant_id,
            OLD.url_status,
            NEW.url_status,
            NEW.url,
            COALESCE(NEW.url_last_checked_at, NOW())
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger only when the column exists (idempotent install guard).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'products'
          AND column_name  = 'url_status'
    ) THEN
        DROP TRIGGER IF EXISTS products_url_status_dead_to_ok_queue ON products;
        CREATE TRIGGER products_url_status_dead_to_ok_queue
            AFTER UPDATE OF url_status ON products
            FOR EACH ROW
            EXECUTE FUNCTION trg_products_url_status_dead_to_ok_queue();
    END IF;
END$$;

COMMIT;
