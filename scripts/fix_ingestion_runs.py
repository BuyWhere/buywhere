#!/usr/bin/env python3
"""
Control-plane fix for successful_run_missing_state legalization and stale recovery auto-resolution.

This script identifies and fixes ingestion runs with missing or inconsistent state:
1. Legalizes successful runs with missing state data
2. Recovers stale runs that are stuck in 'running' state
3. Provides auto-resolution for common edge cases
"""
import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy import text, and_, or_
from sqlalchemy.orm import sessionmaker
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

import sys as _sys
from pathlib import Path as _P
_sys.path.insert(0, str(_P(__file__).resolve().parent.parent))
import catalog_guard  # fail-fast: bulk writes only ever target maglev
DB_URL = catalog_guard.resolve_catalog_url(driver="asyncpg")

class IngestionRunFixer:
    def __init__(self):
        self.engine = create_async_engine(DB_URL)
        self.Session = sessionmaker(self.engine, class_=AsyncSession, expire_on_commit=False)
        
    async def __aenter__(self):
        await catalog_guard.assert_catalog_async_engine(self.engine)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.engine.dispose()
    
    async def analyze_runs(self):
        """Analyze current run state to identify issues"""
        logger.info("Analyzing ingestion runs for state issues...")
        
        async with self.Session() as session:
            # Check status distribution
            result = await session.execute(text("""
                SELECT 
                  status,
                  COUNT(*) as count,
                  MIN(created_at) as oldest_run,
                  MAX(created_at) as newest_run
                FROM ingestion_runs 
                GROUP BY status 
                ORDER BY status
            """))
            
            logger.info("Run status distribution:")
            for row in result.fetchall():
                logger.info(f"  Status '{row.status}': {row.count} runs (oldest: {row.oldest_run}, newest: {row.newest_run})")
            
            # Check for stale running runs
            stale_threshold = datetime.now(timezone.utc) - timedelta(hours=1)
            result = await session.execute(text("""
                SELECT 
                  id,
                  source,
                  created_at,
                  EXTRACT(EPOCH FROM (NOW() - created_at)) as running_seconds
                FROM ingestion_runs 
                WHERE status = 'running' AND created_at < :stale_threshold
                ORDER BY created_at
            """), {"stale_threshold": stale_threshold})
            
            stale_runs = result.fetchall()
            if stale_runs:
                logger.warning(f"Found {len(stale_runs)} stale runs (running > 1 hour):")
                for row in stale_runs:
                    logger.warning(f"  Run {row.id} (source: {row.source}): {row.running_seconds:.0f}s running")
            else:
                logger.info("No stale runs found")
            
            # Check for inconsistent state patterns
            result = await session.execute(text("""
                SELECT 
                  id,
                  source,
                  status,
                  created_at,
                  finished_at,
                  rows_inserted,
                  rows_updated, 
                  rows_failed,
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
                ORDER BY created_at
            """))
            
            problematic_runs = result.fetchall()
            if problematic_runs:
                logger.warning(f"Found {len(problematic_runs)} runs with inconsistent state:")
                for row in problematic_runs:
                    logger.warning(f"  Run {row.id} (status: {row.status}, anomaly: {row.anomaly_type})")
            else:
                logger.info("No inconsistent state patterns found")
                
            return {
                'stale_runs': len(stale_runs),
                'problematic_runs': len(problematic_runs),
                'total_runs': len(stale_runs) + len(problematic_runs)
            }
    
    async def legalize_successful_runs(self):
        """Fix runs marked as successful but with missing state data"""
        logger.info("Legalizing successful runs with missing state...")
        
        async with self.Session() as session:
            # Find runs completed but with missing state data
            result = await session.execute(text("""
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
                WHERE status IN ('completed', 'completed_with_errors')
                  AND (rows_inserted IS NULL OR rows_updated IS NULL OR rows_failed IS NULL)
                  AND finished_at IS NOT NULL
                ORDER BY finished_at DESC
            """))
            
            runs_to_fix = result.fetchall()
            logger.info(f"Found {len(runs_to_fix)} runs to legalize")
            
            for row in runs_to_fix:
                logger.info(f"Legalizing run {row.id} (status: {row.status})")
                
                try:
                    # Try to reconstruct state from products table if possible
                    if row.source:
                        result2 = await session.execute(text("""
                            SELECT 
                                COUNT(*) as total_products,
                                COUNT(CASE WHEN products.updated_at >= :run_finished THEN 1 END) as recent_updates
                            FROM products 
                            WHERE source = :source 
                              AND products.updated_at BETWEEN :run_start AND :run_finished
                        """), {
                            'source': row.source,
                            'run_start': row.created_at,
                            'run_finished': row.finished_at
                        })
                        
                        product_stats = result2.fetchone()
                        logger.info(f"  Product stats: {product_stats}")
                        
                        # Update run with reconstructed state
                        await session.execute(text("""
                            UPDATE ingestion_runs 
                            SET 
                                rows_inserted = GREATEST(0, :total_products - :recent_updates),
                                rows_updated = LEAST(:total_products, :recent_updates),
                                rows_failed = 0,
                                error_message = NULL
                            WHERE id = :run_id
                        """), {
                            'run_id': row.id,
                            'total_products': product_stats.total_products if product_stats else 0,
                            'recent_updates': product_stats.recent_updates if product_stats else 0
                        })
                    else:
                        # If source is missing, mark as completed with warnings
                        await session.execute(text("""
                            UPDATE ingestion_runs 
                            SET 
                                rows_inserted = 0,
                                rows_updated = 0,
                                rows_failed = 0,
                                error_message = 'Missing source - state legalized automatically'
                            WHERE id = :run_id
                        """), {'run_id': row.id})
                    
                    logger.info(f"Successfully legalized run {row.id}")
                    
                except Exception as e:
                    logger.error(f"Failed to legalize run {row.id}: {e}")
                    # Mark with error message but don't fail the whole process
                    await session.execute(text("""
                        UPDATE ingestion_runs 
                        SET error_message = 'Failed to legalize: ' || :error_msg
                        WHERE id = :run_id
                    """), {'run_id': row.id, 'error_msg': str(e)})
            
            await session.commit()
            logger.info(f"Legalized {len(runs_to_fix)} runs")
    
    async def recover_stale_runs(self):
        """Recover stale runs that are stuck in 'running' state"""
        logger.info("Recovering stale runs...")
        
        stale_threshold = datetime.now(timezone.utc) - timedelta(hours=1)
        
        async with self.Session() as session:
            # Find stale runs
            result = await session.execute(text("""
                SELECT 
                  id,
                  source,
                  created_at,
                  EXTRACT(EPOCH FROM (NOW() - created_at)) as running_seconds
                FROM ingestion_runs 
                WHERE status = 'running' AND created_at < :stale_threshold
                ORDER BY created_at
            """), {"stale_threshold": stale_threshold})
            
            stale_runs = result.fetchall()
            logger.info(f"Found {len(stale_runs)} stale runs to recover")
            
            for row in stale_runs:
                logger.info(f"Recovering stale run {row.id} (running for {row.running_seconds:.0f}s)")
                
                try:
                    # Check if there are any recent products for this source
                    if row.source:
                        result2 = await session.execute(text("""
                            SELECT COUNT(*) as recent_products
                            FROM products 
                            WHERE source = :source 
                              AND updated_at > :recent_threshold
                        """), {
                            'source': row.source,
                            'recent_threshold': datetime.now(timezone.utc) - timedelta(minutes=30)
                        })
                        
                        recent_products = result2.fetchone().recent_products
                        
                        if recent_products > 0:
                            # If recent products exist, assume run succeeded
                            status = 'completed'
                            rows_updated = recent_products
                            rows_inserted = 0
                            rows_failed = 0
                            error_message = None
                            logger.info(f"  Run {row.id}: Recent activity found, marking as completed")
                        else:
                            # No recent activity, mark as failed
                            status = 'failed'
                            rows_updated = 0
                            rows_inserted = 0
                            rows_failed = 0
                            error_message = 'Auto-recovered: stale run - no recent activity'
                            logger.warning(f"  Run {row.id}: No recent activity, marking as failed")
                    else:
                        # Missing source, mark as failed
                        status = 'failed'
                        rows_updated = 0
                        rows_inserted = 0
                        rows_failed = 0
                        error_message = 'Auto-recovered: stale run with missing source'
                        logger.warning(f"  Run {row.id}: Missing source, marking as failed")
                    
                    # Update the run
                    await session.execute(text("""
                        UPDATE ingestion_runs 
                        SET 
                            status = :status,
                            rows_inserted = :rows_inserted,
                            rows_updated = :rows_updated,
                            rows_failed = :rows_failed,
                            error_message = :error_message,
                            finished_at = NOW()
                        WHERE id = :run_id
                    """), {
                        'run_id': row.id,
                        'status': status,
                        'rows_inserted': rows_inserted,
                        'rows_updated': rows_updated,
                        'rows_failed': rows_failed,
                        'error_message': error_message
                    })
                    
                    logger.info(f"Successfully recovered run {row.id} as {status}")
                    
                except Exception as e:
                    logger.error(f"Failed to recover run {row.id}: {e}")
                    # Mark with error message but don't fail the whole process
                    await session.execute(text("""
                        UPDATE ingestion_runs 
                        SET error_message = 'Failed to recover: ' || :error_msg
                        WHERE id = :run_id
                    """), {'run_id': row.id, 'error_msg': str(e)})
            
            await session.commit()
            logger.info(f"Recovered {len(stale_runs)} stale runs")
    
    async def fix_all_issues(self):
        """Run all fix operations"""
        logger.info("Starting control-plane fix for ingestion runs...")
        
        # First analyze the current state
        analysis = await self.analyze_runs()
        
        if analysis['total_runs'] == 0:
            logger.info("No issues found - system is healthy")
            return
        
        # Legalize successful runs with missing state
        await self.legalize_successful_runs()
        
        # Recover stale runs
        await self.recover_stale_runs()
        
        # Final analysis to verify fixes
        final_analysis = await self.analyze_runs()
        logger.info(f"Fix completed. Issues reduced from {analysis['total_runs']} to {final_analysis['total_runs']}")


async def main():
    """Main entry point"""
    fixer = IngestionRunFixer()
    
    try:
        await fixer.fix_all_issues()
        logger.info("Control-plane fix completed successfully")
        return 0
    except Exception as e:
        logger.error(f"Control-plane fix failed: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))