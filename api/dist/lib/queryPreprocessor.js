"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preprocessSearchQuery = preprocessSearchQuery;
const NOISE_WORDS = new Set([
    'buy', 'purchase', 'order', 'get', 'find', 'show', 'give',
    'want', 'need', 'looking',
    'cheap', 'cheaper', 'cheapest', 'affordable',
    'best', 'most', 'expensive',
    'price', 'prices', 'cost', 'costs',
    'deal', 'deals', 'discount', 'sale',
    'dollars', 'sgd', 'usd', 'gbp', 'eur',
    'on', 'the', 'a', 'an', 'in', 'at',
    'to', 'for', 'with', 'and', 'or', 'is', 'of',
    'it', 'this', 'that',
    'singapore', 'malaysia', 'vietnam', 'thailand',
    'india', 'indonesia', 'philippines',
]);
const COUNTRY_MAP = {
    sg: 'SG', sgp: 'SG', singapore: 'SG',
    my: 'MY', mys: 'MY', malaysia: 'MY',
    vn: 'VN', vnm: 'VN', vietnam: 'VN',
    th: 'TH', tha: 'TH', thailand: 'TH',
    us: 'US', usa: 'US', 'united states': 'US',
    gb: 'GB', uk: 'GB', gbr: 'GB', 'united kingdom': 'GB',
    id: 'ID', idn: 'ID', indonesia: 'ID',
    ph: 'PH', phl: 'PH', philippines: 'PH',
    in: 'IN', ind: 'IN', india: 'IN',
    jp: 'JP', japan: 'JP',
    kr: 'KR', korea: 'KR', 'south korea': 'KR',
};
function buildCountryPattern() {
    const names = Object.keys(COUNTRY_MAP)
        .filter(k => k.includes(' '))
        .map(k => k.replace(/\s+/g, '\\s+'));
    const codes = Object.keys(COUNTRY_MAP).filter(k => !k.includes(' '));
    const all = [...names, ...codes].sort((a, b) => b.length - a.length);
    return new RegExp(`\\b(?:in|for)\\s+(${all.join('|')})\\b`, 'i');
}
const COUNTRY_PATTERN = buildCountryPattern();
function preprocessSearchQuery(q, existingMinPrice, existingMaxPrice, existingCountryCode) {
    if (!q || !q.trim())
        return { cleanedQuery: q };
    const result = { cleanedQuery: q };
    let workingQuery = q.trim();
    // 1. Extract sort intent from original query
    const lower = workingQuery.toLowerCase();
    if (/\bcheap(?:er|est)?\b|\blowest\s+price\b|\bleast\s+expensive\b/.test(lower)) {
        result.sortIntent = 'price_asc';
    }
    if (/\bmost\s+expensive\b|\bhighest\s+price\b/.test(lower)) {
        result.sortIntent = 'price_desc';
    }
    if (/\bbest\b|\btop(?:\s+rated)?\b|\bhighest\s+rated\b|\bpopular\b/.test(lower)) {
        result.sortIntent = 'rating_desc';
    }
    // 2. Extract price constraints (most specific first)
    const rangeMatch = workingQuery.match(/(?:between|from)\s+\$?\s*(\d+[.,]?\d*)\s*(?:and|to|-)\s*\$?\s*(\d+[.,]?\d*)/i);
    if (rangeMatch) {
        const a = parseFloat(rangeMatch[1].replace(/,/g, ''));
        const b = parseFloat(rangeMatch[2].replace(/,/g, ''));
        if (!isNaN(a) && !isNaN(b) && a > 0 && b > 0 && b >= a) {
            if (existingMinPrice === undefined)
                result.extractedMinPrice = a;
            if (existingMaxPrice === undefined)
                result.extractedMaxPrice = b;
            workingQuery = workingQuery.replace(rangeMatch[0], '').trim();
        }
    }
    const maxMatch = workingQuery.match(/(?:under|below|less\s+than|cheaper\s+than|at\s+most|budget|max(?:imum)?)\s+\$?\s*(\d+[.,]?\d*)/i);
    if (maxMatch) {
        const val = parseFloat(maxMatch[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
            if (existingMaxPrice === undefined)
                result.extractedMaxPrice = val;
            workingQuery = workingQuery.replace(maxMatch[0], '').trim();
        }
    }
    const minMatch = workingQuery.match(/(?:above|over|more\s+than|at\s+least|min(?:imum)?)\s+\$?\s*(\d+[.,]?\d*)/i);
    if (minMatch) {
        const val = parseFloat(minMatch[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
            if (existingMinPrice === undefined)
                result.extractedMinPrice = val;
            workingQuery = workingQuery.replace(minMatch[0], '').trim();
        }
    }
    // 3. Extract country from NL
    if (!existingCountryCode) {
        const countryMatch = workingQuery.match(COUNTRY_PATTERN);
        if (countryMatch) {
            const raw = countryMatch[1].toLowerCase().replace(/\s+/g, ' ');
            const code = COUNTRY_MAP[raw];
            if (code) {
                result.extractedCountryCode = code;
                workingQuery = workingQuery.replace(countryMatch[0], '').trim();
            }
        }
    }
    // 4. Clean query text for FTS
    result.cleanedQuery = cleanQueryText(workingQuery);
    return result;
}
function cleanQueryText(text) {
    let cleaned = text;
    cleaned = cleaned.replace(/\$\s*(\d+[.,]?\d*)\b/g, '');
    cleaned = cleaned.replace(/\b(\d+[.,]?\d*)\s*(dollars|sgd|usd|gbp|eur)\b/gi, '');
    cleaned = cleaned
        .split(/\s+/)
        .filter(word => !NOISE_WORDS.has(word.toLowerCase()))
        .join(' ');
    cleaned = cleaned.replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned;
}
