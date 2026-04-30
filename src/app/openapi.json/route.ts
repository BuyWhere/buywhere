const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "BuyWhere Catalog API",
    version: "1.0.0",
    description: "Product search, offer comparison, and merchant handoff API for AI shopping agents.",
  },
  servers: [
    {
      url: "https://api.buywhere.io/v1",
      description: "BuyWhere public API",
    },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    "/search": {
      get: {
        summary: "Search products",
        description: "Search normalized product records by keyword, category, merchant, and price context.",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100, default: 10 },
          },
        ],
        responses: {
          "200": {
            description: "Product search results",
          },
        },
      },
    },
    "/products/{id}": {
      get: {
        summary: "Get product detail",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Product detail",
          },
        },
      },
    },
    "/deals": {
      get: {
        summary: "List current deals",
        responses: {
          "200": {
            description: "Current catalog deals",
          },
        },
      },
    },
    "/categories": {
      get: {
        summary: "List catalog categories",
        responses: {
          "200": {
            description: "Catalog category list",
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
  },
};

export function GET() {
  return Response.json(openApiSpec, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
