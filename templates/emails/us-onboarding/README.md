# Southeast Asia User Onboarding Email Templates

This directory contains email templates for the Southeast Asia user onboarding sequence:

## Templates

1. **welcome.html** - Welcome email sent immediately after sign-up
   - Includes API key and getting started guide
   - Clear CTA to documentation
   - Basic account information

2. **deal_alert.html** - Personalized deal alerts based on user interests
   - Product-focused layout with image
   - Price comparison (original vs. current)
   - Retailer information and availability
   - Shop now CTA button

3. **weekly_roundup.html** - Weekly summary of trending products and insights
   - Trending products section
   - Significant price drops
   - Shopping insights and tips
   - Explore trends CTA

## Usage

These templates are designed to work with the BuyWhere transactional email system. They use Jinja2 templating syntax for dynamic content injection.

### Common Template Variables

- `first_name` - User's first name
- `recipient_email` - User's email address
- `current_year` - Current year for copyright
- `api_key` - User's API key (welcome email only)
- `unsubscribe_url` - Link to manage email preferences

### Template-Specific Variables

See each HTML file for specific variable requirements.

## Design Notes

- Follows BuyWhere design system tokens and principles
- Mobile-responsive layouts
- Email client compatible (Outlook, Gmail, Apple Mail)
- Uses brand colors: Indigo (primary), Emerald (success), Amber (warning)
- Includes proper MSO conditional styling for Outlook buttons
- Accessible with proper color contrast and semantic structure