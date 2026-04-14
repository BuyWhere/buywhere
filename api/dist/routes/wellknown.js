"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const router = (0, express_1.Router)();
// GET /.well-known/ai-plugin.json — MCP/OpenAI plugin discovery
router.get('/ai-plugin.json', (_req, res) => {
    res.json({
        schema_version: 'v1',
        name_for_human: 'BuyWhere Product Catalog',
        name_for_model: 'buywhere_catalog',
        description_for_human: 'Search and retrieve product data from Singapore\'s leading merchants.',
        description_for_model: 'Use this plugin to search the BuyWhere product catalog. You can search by keyword, filter by domain/merchant, price range, and currency. All prices are in SGD by default. Register for a free API key at the auth endpoint.',
        auth: {
            type: 'user_http',
            authorization_type: 'bearer',
        },
        api: {
            type: 'openapi',
            url: `${config_1.API_BASE_URL}/openapi.json`,
            is_user_authenticated: true,
        },
        logo_url: `${config_1.API_BASE_URL}/logo.png`,
        contact_email: 'api@buywhere.ai',
        legal_info_url: 'https://buywhere.ai/terms',
    });
});
// GET /openapi.json — OpenAPI 3.0 spec
router.get('/openapi.json', (_req, res) => {
    res.json({
        openapi: '3.0.0',
        info: {
            title: 'BuyWhere Product Catalog API',
            version: '1',
            description: 'Agent-native product catalog API for Singapore merchants',
        },
        servers: [{ url: `${config_1.API_BASE_URL}/v1` }],
        paths: {
            '/auth/register': {
                post: {
                    summary: 'Register an agent and receive an API key',
                    operationId: 'registerAgent',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['agent_name'],
                                    properties: {
                                        agent_name: { type: 'string', description: 'Name or identifier of your agent' },
                                        contact: { type: 'string', description: 'Contact email (optional)' },
                                        use_case: { type: 'string', description: 'Brief description of your use case' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '201': {
                            description: 'API key issued',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            api_key: { type: 'string' },
                                            tier: { type: 'string' },
                                            rate_limit: {
                                                type: 'object',
                                                properties: {
                                                    rpm: { type: 'integer' },
                                                    daily: { type: 'integer' },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/products/search': {
                get: {
                    summary: 'Search products',
                    operationId: 'searchProducts',
                    security: [{ BearerAuth: [] }],
                    parameters: [
                        { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query' },
                        { name: 'domain', in: 'query', schema: { type: 'string' }, description: 'Filter by merchant domain' },
                        { name: 'min_price', in: 'query', schema: { type: 'number' } },
                        { name: 'max_price', in: 'query', schema: { type: 'number' } },
                        { name: 'currency', in: 'query', schema: { type: 'string', default: 'SGD' } },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
                        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
                    ],
                    responses: {
                        '200': { description: 'Product list' },
                        '401': { description: 'Missing or invalid API key' },
                        '429': { description: 'Rate limit exceeded' },
                    },
                },
            },
        },
        components: {
            securitySchemes: {
                BearerAuth: { type: 'http', scheme: 'bearer' },
            },
        },
    });
});
exports.default = router;
