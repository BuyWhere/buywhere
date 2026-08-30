"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.latencyMiddleware = latencyMiddleware;
exports.computeP95ForAllMarkets = computeP95ForAllMarkets;
const p95_1 = require("./p95");
const TRACKED_ENDPOINTS = [
    '/mcp',
    '/api/mcp',
    '/v1/products',
    '/v2/products',
    '/v1/categories',
    '/v1/search',
];
function extractMarketFromRequest(req) {
    const marketFromQuery = req.query.market;
    if (marketFromQuery && ['sg', 'us', 'my', 'vn', 'th'].includes(marketFromQuery.toLowerCase())) {
        return marketFromQuery.toLowerCase();
    }
    const marketFromHeader = req.headers['x-market'];
    if (marketFromHeader && ['sg', 'us', 'my', 'vn', 'th'].includes(marketFromHeader.toLowerCase())) {
        return marketFromHeader.toLowerCase();
    }
    const marketFromPath = req.path.match(/\/(?:sg|us|my|vn|th)(?:\/|$)/i);
    if (marketFromPath) {
        return marketFromPath[0].replace(/[^a-z]/g, '').toLowerCase();
    }
    if (req.path.startsWith('/mcp') || req.path.startsWith('/api/mcp')) {
        const body = req.body;
        if (body?.params?.country_code) {
            const countryCode = body.params.country_code.toLowerCase();
            if (['sg', 'us', 'my', 'vn', 'th'].includes(countryCode)) {
                return countryCode;
            }
        }
    }
    return null;
}
function shouldTrackEndpoint(req) {
    const path = req.path;
    return TRACKED_ENDPOINTS.some(endpoint => path.startsWith(endpoint));
}
/**
 * Map a request path to the short endpoint discriminator used by the
 * buywhere-monitoring-api /api/monitoring/p95/history?endpoint= query.
 *
 * BUY-54722: without this normalization the rows in monitoring.p95_latency
 * store the full path ('/v1/products/search', '/v1/products/:id/similar')
 * but the monitoring-api filter expects the short discriminator ('search',
 * 'similar'). Without this, the embedding-alerts p95 check would always
 * see no data for search/similar.
 */
function normalizeEndpoint(path) {
    if (path.includes('/similar'))
        return 'similar';
    if (path.includes('/search'))
        return 'search';
    return path;
}
function latencyMiddleware(req, res, next) {
    if (!shouldTrackEndpoint(req)) {
        return next();
    }
    const startTime = Date.now();
    const market = extractMarketFromRequest(req);
    const endpoint = normalizeEndpoint(req.path);
    const originalSend = res.send.bind(res);
    res.send = function (body) {
        const endTime = Date.now();
        const latencyMs = endTime - startTime;
        if (market) {
            (0, p95_1.recordLatencySample)(market, endpoint, latencyMs);
        }
        return originalSend(body);
    };
    next();
}
async function computeP95ForAllMarkets() {
    const { computeAndStoreP95 } = await Promise.resolve().then(() => __importStar(require('./p95')));
    const markets = ['sg', 'us', 'my', 'vn', 'th'];
    // BUY-54722: short endpoint discriminators (must match what latencyMiddleware
    // writes via normalizeEndpoint). Using 'mcp' for /mcp + /api/mcp, 'products'
    // for /v1/products list+deals, 'search' for /v1/products/search,
    // 'similar' for /v1/products/:id/similar, 'categories' for /v1/categories.
    const endpoints = ['mcp', 'products', 'categories', 'search', 'similar'];
    for (const market of markets) {
        for (const endpoint of endpoints) {
            try {
                await computeAndStoreP95(market, endpoint);
            }
            catch (error) {
                console.error(`[P95] Error computing P95 for ${market}:${endpoint}:`, error);
            }
        }
    }
}
