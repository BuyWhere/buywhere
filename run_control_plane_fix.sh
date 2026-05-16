#!/bin/bash

# Control-plane fix runner for successful_run_missing_state legalization and stale recovery

set -e

echo "Starting control-plane fix for ingestion runs..."

# Navigate to the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtual environment if exists
if [ -f "venv/bin/activate" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
fi

# Run the fix script
echo "Executing ingestion run fix..."
python3 scripts/fix_ingestion_runs.py

echo "Control-plane fix completed."

# Optional: Run a quick verification
echo "Running quick verification..."
python3 -c "
import asyncio
import sys
sys.path.append('/home/paperclip/buywhere-api')

from scripts.fix_ingestion_runs import IngestionRunFixer

async def verify_fix():
    async with IngestionRunFixer() as fixer:
        await fixer.analyze_runs()

asyncio.run(verify_fix())
"