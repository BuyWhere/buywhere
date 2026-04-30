const apiCatalog = {
  apis: [
    {
      name: "BuyWhere Catalog API",
      description: "Product search, offer comparison, and merchant handoff API for AI shopping agents.",
      documentation: "https://buywhere.ai/docs/API_DOCUMENTATION",
      specification: "https://buywhere.ai/openapi.json",
      status: "https://status.buywhere.io",
      authentication: {
        type: "apiKey",
        in: "header",
        headerName: "Authorization",
        scheme: "Bearer",
        documentation: "https://buywhere.ai/api-keys",
      },
      support: {
        contact: "https://buywhere.ai/contact",
        quickstart: "https://buywhere.ai/quickstart",
      },
    },
  ],
};

export function GET() {
  return Response.json(apiCatalog, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
