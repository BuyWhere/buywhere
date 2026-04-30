# BuyWhere Telegram Bot

A Telegram bot example that searches the BuyWhere API from chat.

## Features

- `/search <query>` searches the product catalog
- `/deals [min_discount] [limit]` shows current deals
- `/compare <id1,id2,...>` compares products by BuyWhere product ID

## Files

- `../telegram_bot.py` — runnable Telegram bot example
- `requirements.txt` — minimal dependencies for this example

## Setup

### 1. Create a Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Run `/newbot`
3. Choose a bot name and username
4. Copy the bot token into `TELEGRAM_BOT_TOKEN`

### 2. Install dependencies

```bash
pip install -r examples/telegram_bot/requirements.txt
```

### 3. Set environment variables

```bash
export TELEGRAM_BOT_TOKEN=your_bot_token_here
export BUYWHERE_API_KEY=your_buywhere_api_key_here
export BUYWHERE_API_URL=https://api.buywhere.ai
```

### 4. Run the bot

```bash
python examples/telegram_bot.py
```

## Commands

| Command | Description | Example |
| --- | --- | --- |
| `/search <query>` | Search products | `/search iphone 15 pro` |
| `/deals [min_discount] [limit]` | Fetch deals | `/deals 25 5` |
| `/compare <id1,id2,...>` | Compare product IDs | `/compare 12345,67890` |

## Notes

- The bot uses long polling, so it can run locally without webhook setup.
- Search and deals responses include direct listing links when BuyWhere returns a buy or affiliate URL.
- `/compare` expects BuyWhere product IDs, not free-form product names.
