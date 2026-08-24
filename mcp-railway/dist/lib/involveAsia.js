"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateShopeeSgDeeplink = generateShopeeSgDeeplink;
exports.isAffiliateWrapped = isAffiliateWrapped;
// Involve Asia deeplink client (2026-08-24) — click-time generation for shopee.sg
// at the /r redirect, cached into affiliate_links by the caller. Fails soft: any
// error returns null and the redirect proceeds with the raw URL.
const url_1 = require("url");
const IA_BASE = 'https://api.involve.asia/api';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
let cachedToken = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000;
async function iaPost(path, form, token, timeoutMs = 2500) {
    const key = process.env.IA_KEY, secret = process.env.IA_SECRET;
    if (!key || !secret)
        return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(IA_BASE + path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': UA,
                Accept: 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: new url_1.URLSearchParams(form).toString(),
            signal: ctrl.signal,
        });
        if (!res.ok)
            return null;
        return (await res.json());
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(t);
    }
}
async function getToken() {
    if (cachedToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS)
        return cachedToken;
    const r = await iaPost('/authenticate', {
        key: process.env.IA_KEY || '',
        secret: process.env.IA_SECRET || '',
    });
    const tok = r?.data?.token;
    if (typeof tok === 'string' && tok) {
        cachedToken = tok;
        tokenFetchedAt = Date.now();
        return tok;
    }
    return null;
}
/** Generate an IA tracking link for a shopee.sg URL. affSub rides along for click attribution. */
async function generateShopeeSgDeeplink(rawUrl, affSub) {
    const offerId = process.env.IA_SHOPEE_SG_OFFER_ID || '5035';
    const token = await getToken();
    if (!token)
        return null;
    const form = { offer_id: offerId, url: rawUrl };
    if (affSub)
        form.aff_sub = affSub.slice(0, 64);
    const r = await iaPost('/deeplink/generate', form, token);
    const link = r?.data?.tracking_link;
    return typeof link === 'string' && link.startsWith('http') ? link : null;
}
/** True if the URL is already an affiliate/tracking link (never double-wrap). */
function isAffiliateWrapped(url) {
    return /invl\.me|invol\.co|s\.shopee\.sg/.test(url);
}
