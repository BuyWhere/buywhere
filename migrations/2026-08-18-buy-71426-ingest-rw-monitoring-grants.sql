-- BUY-71426: Grant ingest_rw USAGE+SELECT (+INSERT/UPDATE for sweep upserts) on monitoring schema
-- Target: catalog DB (sakura proxy), role ingest_rw
-- Applied: 2026-08-18

GRANT USAGE ON SCHEMA monitoring TO ingest_rw;
GRANT SELECT ON monitoring.v_ceo_kpis TO ingest_rw;
GRANT SELECT, INSERT, UPDATE ON monitoring.sweep_results TO ingest_rw;
GRANT SELECT ON monitoring.alert_history TO ingest_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA monitoring TO ingest_rw;
