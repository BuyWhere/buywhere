# BuyWhere Slack Bot Example

A Slack bot that lets you search products directly from Slack using the `/search` slash command.

## Setup

### 1. Create a Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From an app manifest**
3. Select your workspace
4. Paste this manifest:

```yaml
display_information:
  name: BuyWhere Product Search
  description: Search products across Singapore e-commerce platforms
  background_color: "#4A154B"
  long_description: |
    BuyWhere lets you search millions of products across Lazada,
    Shopee, Carousell, Qoo10, and more — directly from Slack.

features:
  slash_commands:
    - command: /search
      url: https://your-app-url.slack.com
      description: Search for products
      usage_hint: "[product name]"
      should_escape: false

oauth_config:
  redirect_urls:
    - https://your-app-url.slack.com/oauth_redirect
  scopes:
    bot:
      - commands
      - chat:write
      - app_mentions:read

settings:
  event_subscriptions:
    request_url: https://your-app-url.slack.com/events
    bot_events:
      - app_mention
  interactivity:
    is_enabled: true
    request_url: https://your-app-url.slack.com/events
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

### 2. Install the app to your workspace

Copy the Bot User OAuth Token (`xoxb-...`) from the **OAuth & Permissions** page.

### 3. Set environment variables

```bash
export SLACK_BOT_TOKEN=xoxb-your-token-here
export SLACK_SIGNING_SECRET=your-signing-secret
export BUYWHERE_API_KEY=bw_live_your-api-key
```

Get your BuyWhere API key from [https://developers.buywhere.com](https://developers.buywhere.com).

### 4. Run the bot

```bash
cd examples/slack-bot
pip install -r requirements.txt
python app.py
```

The bot uses Socket Mode so you don't need a public URL.

## Usage

### Slash Command

```
/search dyson vacuum
```

Response shows product results as Slack blocks with images, prices, and discount info:

```
🔍 Search results for 'dyson vacuum' — 1,523 found
──────────────────────────────
[Dyson V15 Detect Vacuum]
$899.00 (was $1,199.00, 25% off)
_shopee_sg
──────────────────────────────
[Dyson Ball Multi Floor 2]
$549.00
_lazada_sg
```

### App Mention

You can also mention the bot in a channel:

```
@buywhere /search playstation 5
```

## Project Structure

```
slack-bot/
├── app.py              # Main bot application
├── requirements.txt    # Python dependencies
└── README.md          # This file
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (xoxb-...) |
| `SLACK_SIGNING_SECRET` | Signing secret from Basic Information |
| `BUYWHERE_API_KEY` | BuyWhere API key |
| `BUYWHERE_BASE_URL` | BuyWhere API base URL (optional, defaults to api.buywhere.ai) |