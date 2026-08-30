-- Script to analyze ingestion_runs table for missing state issues
-- This helps identify runs that might be stuck or have missing state

-- Check current run status distribution
SELECT 
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest_run,
  MAX(created_at) as newest_run
FROM ingestion_runs 
GROUP BY status 
ORDER BY status;

-- Check for potentially stale runs (running for more than 1 hour)
SELECT 
  id,
  source,
  status,
  created_at,
  finished_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) as running_seconds,
  EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - created_at)) as total_seconds
FROM ingestion_runs 
WHERE status = 'running' 
  AND (NOW() - created_at) > INTERVAL '1 hour'
ORDER BY created_at;

-- Check for runs with missing but expected final state
SELECT 
  id,
  source,
  status,
  created_at,
  finished_at,
  rows_inserted,
  rows_updated, 
  rows_failed
FROM ingestion_runs 
WHERE status = 'running' 
  AND finished_at IS NOT NULL
  AND (NOW() - finished_at) < INTERVAL '1 hour'
ORDER BY finished_at;

-- Check for inconsistent state patterns
SELECT 
  id,
  source,
  status,
  created_at,
  finished_at,
  CASE 
    WHEN status = 'completed' AND (rows_inserted IS NULL OR rows_updated IS NULL OR rows_failed IS NULL) THEN 'incomplete_success'
    WHEN status = 'completed_with_errors' AND (rows_inserted IS NULL OR rows_updated IS NULL OR rows_failed IS NULL) THEN 'incomplete_error'
    WHEN status = 'running' AND finished_at IS NOT NULL THEN 'orphaned_running'
    ELSE 'normal'
  END as anomaly_type
FROM ingestion_runs 
WHERE 
  (status = 'completed' AND (rows_inserted IS NULL OR rows_updated IS NULL OR rows_failed IS NULL))
  OR (status = 'completed_with_errors' AND (rows_inserted IS NULL OR rows_updated IS NULL OR rows_failed IS NULL))
  OR (status = 'running' AND finished_at IS NOT NULL)
ORDER BY created_at;

-- Check the most recent runs to understand current patterns
SELECT 
  id,
  source,
  status,
  created_at,
  finished_at,
  rows_inserted,
  rows_updated,
  rows_failed,
  error_message,
  EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - created_at)) as duration_seconds
FROM ingestion_runs 
ORDER BY created_at DESC 
LIMIT 20;