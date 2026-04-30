# API Healthcheck Monitor

This monitor was added for [BUY-4098](/BUY/issues/BUY-4098) to provide a lightweight synthetic check for the API's public catalog surfaces.

It calls these endpoints every minute:

- `GET /v1/search?q=test&limit=1`
- `GET /v1/products?limit=1`

Each run records:

- response time in milliseconds
- HTTP status code
- result count when available
- a daily summary line with uptime percentage and average latency

It also prints `WARN` lines when either condition is true:

- any endpoint returns `5xx`
- the endpoint's rolling same-day `p99` exceeds `500ms`

If `ALERT_WEBHOOK_URL` is configured, WARN conditions are also sent to that webhook with a cooldown to avoid minute-by-minute spam.

## Files

- Script: [scripts/healthcheck.py](/home/paperclip/buywhere-api/scripts/healthcheck.py)
- Service unit: [systemd/paperclip-healthcheck.service](/home/paperclip/buywhere-api/systemd/paperclip-healthcheck.service)
- Timer unit: [systemd/paperclip-healthcheck.timer](/home/paperclip/buywhere-api/systemd/paperclip-healthcheck.timer)

## Required environment

Create `/etc/buywhere/api-healthcheck.env` with at least:

```bash
BUYWHERE_API_URL=https://api.buywhere.ai
BUYWHERE_API_KEY=bw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Optional settings:

```bash
TARGET_P99_MS=500
HEALTHCHECK_TIMEOUT_SECONDS=20
HEALTHCHECK_ALERT_COOLDOWN_SECONDS=900
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...
BUYWHERE_HEALTHCHECK_DIR=/home/paperclip/buywhere-api/logs/healthcheck
```

## Install

```bash
sudo cp /home/paperclip/buywhere-api/systemd/paperclip-healthcheck.service /etc/systemd/system/
sudo cp /home/paperclip/buywhere-api/systemd/paperclip-healthcheck.timer /etc/systemd/system/
sudo mkdir -p /etc/buywhere
sudoeditor /etc/buywhere/api-healthcheck.env
sudo systemctl daemon-reload
sudo systemctl enable --now paperclip-healthcheck.timer
```

## Verify

Run one cycle manually:

```bash
cd /home/paperclip/buywhere-api
python3 scripts/healthcheck.py --once
```

Check timer state:

```bash
systemctl status --no-pager paperclip-healthcheck.timer
systemctl list-timers paperclip-healthcheck.timer
journalctl -u paperclip-healthcheck.service -n 50 --no-pager
```

The script also writes JSONL records and persisted state under `logs/healthcheck/`.
