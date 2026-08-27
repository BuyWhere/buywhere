const AI_PLUGIN_JSON = {
  schema_version: 'v1',
  name_for_human: 'BuyWhere Product Catalog',
  name_for_model: 'buywhere_catalog',
  description_for_human:
    'Product catalog for AI agents: 300M+ products from 950,000+ merchants worldwide, normalized into one schema. Location-aware search: pass deliver_to and every result carries an availability label (local | ships_to_you | unavailable | unknown).',
  description_for_model:
    'Use this plugin to search the BuyWhere product catalog for AI agents and LLM applications. Search by keyword, filter by merchant/retailer, price range, category, country, currency, and deliver_to (the end user ISO country). Results rank deliverable-first and include availability labels: local, ships_to_you, unavailable, or unknown. Coverage includes 300M+ products from 950,000+ merchants worldwide, with deepest coverage in the United States and Singapore and growing coverage across the UK, EU, SEA, and AU. Register for a free API key at https://api.buywhere.ai/v1/auth/register.',
  auth: {
    type: 'user_http',
    authorization_type: 'bearer',
  },
  api: {
    type: 'openapi',
    url: 'https://api.buywhere.ai/openapi.json',
    is_user_authenticated: true,
  },
  logo_url: 'https://buywhere.ai/favicon.svg',
  contact_email: 'api@buywhere.ai',
  legal_info_url: 'https://buywhere.ai/terms',
};

export function GET() {
  return Response.json(AI_PLUGIN_JSON, {
    headers: {
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
