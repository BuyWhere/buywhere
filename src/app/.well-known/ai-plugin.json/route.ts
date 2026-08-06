const AI_PLUGIN_JSON = {
  schema_version: 'v1',
  name_for_human: 'BuyWhere Product Catalog',
  name_for_model: 'buywhere_catalog',
  description_for_human:
    'Product catalog for AI agents: 288M+ products from 158,000+ storefronts worldwide, normalized into one schema. Location-aware: pass deliver_to and every result carries an availability label (local | ships_to_you | unavailable).',
  description_for_model:
    'Use this plugin to search the BuyWhere global product catalog for AI agents and LLM apps. Search 288M+ products across 158,000+ storefronts worldwide; pass deliver_to=<ISO country> for the end user\'s delivery location so results rank deliverable-first and include availability labels (local | ships_to_you | unavailable | unknown). Filter by merchant/retailer, price range, country, currency, availability, and include_unshippable. Register for a free API key at the auth endpoint.',
  auth: {
    type: 'user_http',
    authorization_type: 'bearer',
  },
  api: {
    type: 'openapi',
    url: 'https://api.buywhere.ai/openapi.json',
    is_user_authenticated: true,
  },
  logo_url: 'https://api.buywhere.ai/logo.png',
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