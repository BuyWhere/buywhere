const AI_PLUGIN_JSON = {
  schema_version: 'v1',
  name_for_human: 'BuyWhere Product Catalog',
  name_for_model: 'buywhere_catalog',
  description_for_human:
    'Search and retrieve product data from 7 merchants across Singapore and the United States.',
  description_for_model:
    'Use this plugin to search the BuyWhere product catalog. You can search by keyword, filter by domain/merchant, price range, currency, and country (SG or US). Merchants covered: Shopee, Lazada, Amazon SG, Amazon US, Walmart, FairPrice, Carousell. Currencies: SGD and USD. Register for a free API key at the auth endpoint.',
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