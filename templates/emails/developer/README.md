# BuyWhere Developer Email Templates

HTML email templates for the developer onboarding welcome series.

## Templates

| File | Send Day | Purpose |
|------|----------|---------|
| `welcome.html` | Day 0 (immediate) | Welcome + first API call quickstart |
| `day3-checkin.html` | Day 3 | First use case — comparison endpoint |
| `week1-tips.html` | Day 7 | Top 3 patterns + office hours CTA |

## Design Guidelines

- **Target**: Gmail, Outlook, Apple Mail
- **Width**: 600px max (responsive)
- **Brand colors**:
  - Primary: `#4f46e5` (indigo)
  - Success: `#10b981` (green)
  - Warning: `#f59e0b` (amber)
  - Text: `#111827` / `#374151` / `#6b7280`
  - Background: `#f9fafb`
- **Font stack**: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
- **Code blocks**: Dark (`#1f2937`) with SF Mono / Consolas monospace

## Template Variables

| Variable | Description |
|----------|-------------|
| `{{ first_name }}` | Recipient's first name |
| `{{ api_key }}` | User's BuyWhere API key |
| `{{ current_year }}` | Current year (footer) |
| `{{ office_hours_link }}` | Link to developer office hours |
| `{{ recipient_email }}` | Recipient email (weekly roundup) |
| `{{ unsubscribe_url }}` | Unsubscribe link |

## Implementation Notes

- Uses MSO conditionals for Outlook compatibility
- Inline styles for email client resilience
- No JavaScript
- Images use absolute URLs with HTTPS
- Dark code blocks ensure readability in all clients