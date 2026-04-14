"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = __importDefault(require("./routes/auth"));
const products_1 = __importDefault(require("./routes/products"));
const redirect_1 = __importDefault(require("./routes/redirect"));
const wellknown_1 = __importDefault(require("./routes/wellknown"));
const config_1 = require("./config");
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: false }));
    // Health check
    app.get('/health', async (_req, res) => {
        try {
            const result = await config_1.db.query('SELECT COUNT(*) FROM products');
            res.json({
                status: 'ok',
                ts: new Date().toISOString(),
                catalog: { total_products: parseInt(result.rows[0].count, 10) },
            });
        }
        catch (err) {
            res.status(500).json({ status: 'error', error: String(err) });
        }
    });
    // MCP / OpenAI plugin discovery
    app.use('/.well-known', wellknown_1.default);
    app.get('/openapi.json', (req, res) => (0, wellknown_1.default)(req, res, () => { }));
    // v1 API
    app.use('/v1/auth', auth_1.default);
    app.use('/v1/products', products_1.default);
    // Affiliate redirect (no /v1 prefix — short URLs)
    app.use('/r', redirect_1.default);
    // 404 fallback
    app.use((_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
    return app;
}
