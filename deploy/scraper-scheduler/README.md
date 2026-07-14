# Scraper Scheduler

Keeps BuyWhere product data fresh by running scrapers on a schedule.

## Deployment

### Prerequisites

- Python 3.10+ with scraper dependencies installed
- Access to the BuyWhere API (local or production)
- A BuyWhere API key with ingest permissions

### Install

```bash
# Install Python dependencies
cd /opt/buywhere
pip install -r scrapers/requirements.txt
playwright install chromium

# Set up systemd service
sudo cp deploy/scraper-scheduler/scraper-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable scraper-scheduler
sudo systemctl start scraper-scheduler

# Check status
sudo systemctl status scraper-scheduler
```

### Configuration

Set environment variables in the systemd service file or in `/etc/default/scraper-scheduler`:

| Variable | Default | Description |
|---|---|---|
| `BUYWHERE_API_URL` | `http://localhost:3000` | Ingest API base URL |
| `BUYWHERE_API_KEY` | _(required)_ | API key with ingest permissions |
| `SCRAPER_SCHEDULE` | _(optional)_ | JSON override: `{"amazon_us": 24}` |
| `SCRAPER_DATA_DIR` | `./data` | Directory for scraper output |

### Manual Run

```bash
# Run all scrapers once
python scripts/scraper_scheduler.py --run-once

# Run specific scrapers
python scripts/scraper_scheduler.py --run-once --scrapers amazon_us,bestbuy_us_sitemap
```

## How It Works

1. The scheduler runs as a daemon, checking each scraper's last run time
2. When a scraper is due (based on its `interval_hours`), it's launched as a subprocess
3. The scraper scrapes merchant sites and pushes data through the local API's `/v1/ingest/products` endpoint
4. The ingest endpoint upserts products, setting `products.updated_at = NOW()`
5. The nightly `priceRefresh` job also updates `products.updated_at` as a secondary freshness signal

## Monitoring

Check scheduler health:
```bash
journalctl -u scraper-scheduler -f
```
