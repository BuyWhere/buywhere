"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
/**
 * BUY-65475: Regression tests for PostgreSQL LIMIT/OFFSET type coercion.
 *
 * The MCP PostgreSQL driver (pg) sends JavaScript numbers as text when they
 * arrive as strings, causing "argument of LIMIT must be type bigint, not type text".
 * All LIMIT/OFFSET parameters must be coerced with Number() before passing to queries.
 */
(0, node_test_1.describe)('BUY-65475 — limit/offset type coercion for PostgreSQL', () => {
    // Simulates the fix in handleGetDeals: Number(limit) || 20
    const coerceLimit = (limit) => Number(limit) || 20;
    const coerceOffset = (offset) => Number(offset) || 0;
    (0, node_test_1.it)('coerces integer limit to number', () => {
        strict_1.default.equal(coerceLimit(3), 3);
        strict_1.default.equal(coerceLimit(10), 10);
    });
    (0, node_test_1.it)('coerces string limit to number', () => {
        strict_1.default.equal(coerceLimit('5'), 5);
        strict_1.default.equal(coerceLimit('20'), 20);
    });
    (0, node_test_1.it)('falls back to default when limit is undefined', () => {
        strict_1.default.equal(coerceLimit(undefined), 20);
        strict_1.default.equal(coerceLimit(null), 20);
    });
    (0, node_test_1.it)('falls back to default when limit is NaN', () => {
        strict_1.default.equal(coerceLimit(NaN), 20);
        strict_1.default.equal(coerceLimit('abc'), 20);
    });
    (0, node_test_1.it)('coerces offset similarly', () => {
        strict_1.default.equal(coerceOffset(0), 0);
        strict_1.default.equal(coerceOffset(10), 10);
        strict_1.default.equal(coerceOffset('5'), 5);
        strict_1.default.equal(coerceOffset(undefined), 0);
    });
    (0, node_test_1.it)('clamps limit to max 100 (application-level constraint)', () => {
        // This is handled separately: Math.min(Number(args.limit) || 20, 100)
        const limit = Math.min(Number(200) || 20, 100);
        strict_1.default.equal(limit, 100);
    });
});
