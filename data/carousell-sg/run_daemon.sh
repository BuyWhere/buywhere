#!/bin/bash
cd /home/paperclip/buywhere-api
while true; do
    echo "[$(date)] Starting cycle..." >> /home/paperclip/buywhere-api/data/carousell-sg/daemon.log
    venv/bin/python -c "
import sys, asyncio
sys.path.insert(0, '.')
import importlib.util, types

fake_scrapers = types.ModuleType('scrapers')
sys.modules['scrapers'] = fake_scrapers

spec = importlib.util.spec_from_file_location('carousell_sg', 'scrapers/carousell_sg.py')
mod = importlib.util.module_from_spec(spec)
sys.modules['scrapers.carousell_sg'] = mod
spec.loader.exec_module(mod)

async def run():
    scraper = mod.CarousellSGScraper(api_key='dev-key', scrape_only=True, products_per_category=5000, batch_size=500, delay=0.3)
    r = await scraper.run()
    await scraper.close()
    return r

print(asyncio.run(run()))
" >> /home/paperclip/buywhere-api/data/carousell-sg/daemon.log 2>&1
    echo "[$(date)] Cycle done, sleeping 4h..." >> /home/paperclip/buywhere-api/data/carousell-sg/daemon.log
    sleep 14400
done
