"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var config_1 = require("../../config");
var outboundLinkHealth_1 = require("../../lib/outboundLinkHealth");
var auth_1 = require("./auth");
var router = (0, express_1.Router)();
function getProbesStatus(_req, res) {
    return __awaiter(this, void 0, void 0, function () {
        var approxTotal, approxNeverChecked, neverCheckedSample, recent, runSummary, lastRunAt, rowsCheckedLastRun, _a;
        var _b, _c, _d, _e, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0: return [4 /*yield*/, config_1.db.query("SELECT reltuples::bigint AS total FROM pg_class WHERE relname = 'products'").catch(function () { return ({ rows: [{ total: '0' }] }); })];
                case 1:
                    approxTotal = _j.sent();
                    return [4 /*yield*/, config_1.db.query("SELECT ROUND(c.reltuples * COALESCE(s.null_frac, 0))::bigint AS never_checked\n       FROM pg_class c\n       LEFT JOIN pg_stats s ON s.schemaname = 'public'\n                           AND s.tablename = 'products'\n                           AND s.attname = 'url_last_checked_at'\n      WHERE c.relname = 'products'").catch(function () { return ({ rows: [{ never_checked: '0' }] }); })];
                case 2:
                    approxNeverChecked = _j.sent();
                    return [4 /*yield*/, config_1.db.query("SET LOCAL statement_timeout = '3000';\n     SELECT COUNT(*)::bigint AS count\n       FROM products\n      WHERE is_active = true\n        AND url IS NOT NULL\n        AND url_last_checked_at IS NULL\n      LIMIT 5000").catch(function () { return ({ rows: [{ count: '0' }] }); })];
                case 3:
                    neverCheckedSample = _j.sent();
                    return [4 /*yield*/, config_1.db.query("SELECT status, COUNT(*)::bigint AS count\n       FROM url_probe_log\n      WHERE checked_at >= NOW() - INTERVAL '24 hours'\n      GROUP BY status\n      ORDER BY status").catch(function () { return ({ rows: [] }); })];
                case 4:
                    recent = _j.sent();
                    return [4 /*yield*/, config_1.db.query("SET LOCAL statement_timeout = '3000';\n     SELECT MAX(checked_at) AS last_run_at,\n            MAX(checked_at) FILTER (WHERE status = 'ok') AS last_success_at\n       FROM url_probe_log").catch(function () { return ({ rows: [{ last_run_at: null, last_success_at: null }] }); })];
                case 5:
                    runSummary = _j.sent();
                    lastRunAt = ((_b = runSummary.rows[0]) === null || _b === void 0 ? void 0 : _b.last_run_at) || null;
                    if (!lastRunAt) return [3 /*break*/, 7];
                    return [4 /*yield*/, config_1.db.query("SET LOCAL statement_timeout = '3000';\n         SELECT COUNT(*)::bigint AS count\n           FROM url_probe_log\n          WHERE checked_at >= ($1::timestamptz - INTERVAL '2 minutes')\n            AND checked_at <= ($1::timestamptz + INTERVAL '2 minutes')", [lastRunAt]).catch(function () { return ({ rows: [{ count: '0' }] }); })];
                case 6:
                    _a = _j.sent();
                    return [3 /*break*/, 8];
                case 7:
                    _a = { rows: [{ count: '0' }] };
                    _j.label = 8;
                case 8:
                    rowsCheckedLastRun = _a;
                    res.json({
                        probe_enabled: (0, outboundLinkHealth_1.outboundProbeEnabled)(),
                        approx_total_products: Number(((_c = approxTotal.rows[0]) === null || _c === void 0 ? void 0 : _c.total) || '0'),
                        approx_never_checked: Number(((_d = approxNeverChecked.rows[0]) === null || _d === void 0 ? void 0 : _d.never_checked) || '0'),
                        sample_never_checked: Number(((_e = neverCheckedSample.rows[0]) === null || _e === void 0 ? void 0 : _e.count) || '0'),
                        due: {
                            never_checked: ((_f = neverCheckedSample.rows[0]) === null || _f === void 0 ? void 0 : _f.count) || '0',
                            stale_24h: 'approx_unavailable',
                            fresh_24h: 'approx_unavailable',
                            note: 'exact due counts disabled until idx_products_url_probe_due is valid (BUY-70938)',
                        },
                        probes_last_24h: recent.rows.reduce(function (acc, row) {
                            acc[row.status] = Number(row.count);
                            return acc;
                        }, {}),
                        last_run_at: lastRunAt,
                        last_success_at: ((_g = runSummary.rows[0]) === null || _g === void 0 ? void 0 : _g.last_success_at) || null,
                        rows_checked_last_run: Number(((_h = rowsCheckedLastRun.rows[0]) === null || _h === void 0 ? void 0 : _h.count) || '0'),
                    });
                    return [2 /*return*/];
            }
        });
    });
}
router.get('/v1/admin/probes/status', auth_1.adminOrMonitoringAuth, getProbesStatus);
// BUY-70988: root alias so Cart/monitoring can use the exact /admin/probes/status path.
router.get('/admin/probes/status', auth_1.adminOrMonitoringAuth, getProbesStatus);
exports.default = router;
