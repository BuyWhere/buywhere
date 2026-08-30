"use strict";
// Semantic search cache (2026-08-06, Richmond directive — this time shipped, not delegated).
//
// Reuses already-cached search responses for queries that are the same after
// normalization ("Wireless  Headphones!" == "wireless headphones") or semantically
// near-identical (cosine >= SIM_THRESHOLD on the gemini-embedding-001@512 vector the
// hybrid path already computes). Entries are scoped to the full (country, filters,
// limit, mode, ...) tuple, so a hit can never leak across markets or filter sets.
//
// Storage: one Redis hash per scope — semq:<scope> -> { qNorm: {k: cacheKey, v?: vector} }.
// The referenced response lives in the EXISTING response cache under its own TTL;
// if it expired, the registry entry is dropped and the caller falls through to the DB.
// Registry TTL matches SEARCH_CACHE_TTL; capped at REGISTRY_MAX entries per scope
// (whole-hash reset on overflow — cheap, self-healing).
//
// Kill switch: set SEMANTIC_CACHE=0 on the service and redeploy.
// Guarded by api/tests/semantic-cache-contract.test.mjs (both code trees).
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeQuery = normalizeQuery;
exports.semanticEnabled = semanticEnabled;
exports.semanticLookup = semanticLookup;
exports.semanticRegister = semanticRegister;
// Threshold calibrated 2026-08-06 on gemini-embedding-001@512 live pairs:
// positives — plural 0.87, typo 0.88, close-synonym 0.89, exact-after-norm 1.0;
// worst cross-product NEGATIVE (keyboard vs mouse) 0.79. Do not raise past 0.90
// (kills all real matches) or drop below 0.80 (wrong-product territory).
const SIM_THRESHOLD = 0.86;
const REGISTRY_MAX = 300;
const REGISTRY_TTL_SECONDS = 3600;
/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeQuery(q) {
    const words = q.toLowerCase().trim().split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).sort();
    return words.join(' ') || q.toLowerCase().trim();
}
function cosine(a, b) {
    if (!a || !b || a.length !== b.length)
        return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const d = Math.sqrt(na) * Math.sqrt(nb);
    return d === 0 ? 0 : dot / d;
}
function parseVector(vectorJson) {
    if (!vectorJson)
        return null;
    try {
        const v = JSON.parse(vectorJson);
        return Array.isArray(v) && v.length > 0 ? v : null;
    }
    catch {
        return null;
    }
}
function semanticEnabled() {
    return process.env.SEMANTIC_CACHE !== '0';
}
/** Look up a cached response for qNorm (exact-normalized, then vector-similar). */
async function semanticLookup(redis, scope, qNorm, vectorJson) {
    try {
        const regKey = `semq:${scope}`;
        const reg = (await redis.hgetall(regKey)) || {};
        const exact = reg[qNorm];
        if (exact) {
            const entry = JSON.parse(exact);
            const body = await redis.get(entry.k);
            if (body) {
                // lazily backfill the vector so tier-path registrations gain similarity power
                if (!entry.v && vectorJson) {
                    const v = parseVector(vectorJson);
                    if (v)
                        redis.hset(regKey, qNorm, JSON.stringify({ k: entry.k, v })).catch(() => { });
                }
                return { body, matchedQ: qNorm, sim: 1 };
            }
            redis.hdel(regKey, qNorm).catch(() => { });
        }
        const vec = parseVector(vectorJson);
        if (!vec)
            return null;
        let best = null;
        for (const [entryQ, raw] of Object.entries(reg)) {
            if (entryQ === qNorm)
                continue;
            let entry;
            try {
                entry = JSON.parse(raw);
            }
            catch {
                continue;
            }
            if (!entry.v)
                continue;
            const sim = cosine(vec, entry.v);
            if (sim >= SIM_THRESHOLD && (!best || sim > best.sim))
                best = { q: entryQ, k: entry.k, sim };
        }
        if (!best)
            return null;
        const body = await redis.get(best.k);
        if (!body) {
            redis.hdel(regKey, best.q).catch(() => { });
            return null;
        }
        return { body, matchedQ: best.q, sim: best.sim };
    }
    catch {
        return null;
    }
}
/** Register a freshly cached response under its normalized query. Fire-and-forget. */
async function semanticRegister(redis, scope, qNorm, vectorJson, cacheKey) {
    try {
        const regKey = `semq:${scope}`;
        const n = await redis.hlen(regKey);
        if (n >= REGISTRY_MAX)
            await redis.del(regKey);
        const v = parseVector(vectorJson);
        await redis.hset(regKey, qNorm, JSON.stringify(v ? { k: cacheKey, v } : { k: cacheKey }));
        await redis.expire(regKey, REGISTRY_TTL_SECONDS);
    }
    catch { /* never block the response path */ }
}
