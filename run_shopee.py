import asyncio
import os
import sys
import importlib.util

sys.path.insert(0, '/home/paperclip/buywhere-api')

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

scraper_logging = load_module('scrapers.scraper_logging', 'scrapers/scraper_logging.py')
shopee = load_module('scrapers.shopee_sg', 'scrapers/shopee_sg.py')

async def main():
    scraper = shopee.ShopeeScraper(
        api_key="test",
        scrape_only=True,
    )
    print(f"Output: {scraper.products_outfile}")
    result = await scraper.run()
    print(f"Done: {result}")
    await scraper.close()

asyncio.run(main())
