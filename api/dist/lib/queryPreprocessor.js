"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectRetailerSources = detectRetailerSources;
exports.preprocessSearchQuery = preprocessSearchQuery;
/**
 * SG retailer brand → source slug mapping.
 * When a user searches for a retailer name, we need to filter by source field
 * because the retailer name is not in individual product titles/brands.
 * Covers BUY-42589 canonicalization pattern (cf. BUY-28453 Dyson Airwrap fix).
 */
const SG_RETAILER_SOURCE_MAP = {
    'harvey norman': 'harvey_norman_sg',
    'harvey norman sg': 'harvey_norman_sg',
    'harveynorman': 'harvey_norman_sg',
    'harvey_norman': 'harvey_norman_sg',
    'courts': 'courts_sg',
    'courts sg': 'courts_sg',
    'gaincity': 'gaincity_sg',
    'gain city': 'gaincity_sg',
    'gaincity.com': 'gaincity_sg',
    'gaincity.sg': 'gaincity_sg',
    'audiohouse': 'audiohouse_sg',
    'audio house': 'audiohouse_sg',
    'best denki': 'bestdenki_sg',
    'bestdenki': 'bestdenki_sg',
    'best denki sg': 'bestdenki_sg',
};
/**
 * Detects SG retailer brand names in the query and returns the corresponding
 * source slug(s). Used to expand FTS with a source= filter so searching
 * "harvey norman" returns all products from that retailer regardless of
 * whether the retailer name appears in the product title/brand.
 *
 * Returns { canonicalSources, remainingQuery } where canonicalSources may be empty.
 */
function detectRetailerSources(q) {
    const lower = q.toLowerCase().trim();
    const matchedSources = [];
    let remaining = lower;
    for (const [retailerName, sourceSlug] of Object.entries(SG_RETAILER_SOURCE_MAP)) {
        // Match whole-word retailer name (handles "harvey norman fridge" → match on "harvey norman")
        const pattern = new RegExp(`\\b${retailerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (pattern.test(lower)) {
            if (!matchedSources.includes(sourceSlug)) {
                matchedSources.push(sourceSlug);
            }
            remaining = remaining.replace(pattern, '').replace(/\s+/g, ' ').trim();
        }
    }
    return { canonicalSources: matchedSources, remainingQuery: remaining };
}
const NOISE_WORDS = new Set([
    'buy', 'purchase', 'order', 'get', 'find', 'show', 'give',
    'want', 'need', 'looking',
    'cheap', 'cheaper', 'cheapest', 'affordable', 'expensive',
    'price', 'prices', 'cost', 'costs',
    'deal', 'deals', 'discount', 'sale',
]);
function preprocessSearchQuery(q, existingMinPrice, existingMaxPrice) {
    if (!q || !q.trim())
        return { cleanedQuery: q };
    // Detect SG retailer brand names and extract source filters before price/query cleaning
    const { canonicalSources, remainingQuery } = detectRetailerSources(q);
    const hasRetailerMatch = canonicalSources.length > 0;
    const result = {
        cleanedQuery: remainingQuery || q.trim(),
        canonicalSources: canonicalSources.length > 0 ? canonicalSources : undefined,
    };
    let workingQuery = (hasRetailerMatch ? remainingQuery : q.trim()) || q.trim();
    // 1. Extract sort intent from original query (before cleaning removes signal words)
    const lower = workingQuery.toLowerCase();
    if (/\bcheapest?\b|\blowest\s+price\b|\bleast\s+expensive\b/.test(lower)) {
        result.sortIntent = 'price_asc';
    }
    if (/\bmost\s+expensive\b|\bhighest\s+price\b/.test(lower)) {
        result.sortIntent = 'price_desc';
    }
    if (/\bbest\b|\btop(?:\s+rated)?\b|\bhighest\s+rated\b|\bpopular\b/.test(lower)) {
        result.sortIntent = 'rating_desc';
    }
    // 2. Extract price constraints from natural language
    // Most specific first: "between X and Y" / "from X to Y" (range)
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
    // Max price: "under|below|less than|cheaper than|at most|budget|max $? NUM"
    const maxMatch = workingQuery.match(/(?:under|below|less\s+than|cheaper\s+than|at\s+most|budget|max(?:imum)?)\s+\$?\s*(\d+[.,]?\d*)/i);
    if (maxMatch && existingMaxPrice === undefined) {
        const val = parseFloat(maxMatch[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
            result.extractedMaxPrice = val;
            workingQuery = workingQuery.replace(maxMatch[0], '').trim();
        }
    }
    // Min price: "above|over|more than|at least|min $? NUM"
    const minMatch = workingQuery.match(/(?:above|over|more\s+than|at\s+least|min(?:imum)?)\s+\$?\s*(\d+[.,]?\d*)/i);
    if (minMatch && existingMinPrice === undefined) {
        const val = parseFloat(minMatch[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
            result.extractedMinPrice = val;
            workingQuery = workingQuery.replace(minMatch[0], '').trim();
        }
    }
    // 3. Clean query text for FTS
    result.cleanedQuery = cleanQueryText(workingQuery);
    return result;
}
function cleanQueryText(text) {
    let cleaned = text;
    // Remove price literals: "$50", "50 dollars", "50 sgd"
    cleaned = cleaned.replace(/\$\s*(\d+[.,]?\d*)\b/g, '');
    cleaned = cleaned.replace(/\b(\d+[.,]?\d*)\s*(dollars|sgd|usd|gbp|eur)\b/gi, '');
    // Remove noise words that don't help FTS relevance
    cleaned = cleaned
        .split(/\s+/)
        .filter(word => !NOISE_WORDS.has(word.toLowerCase()))
        .join(' ');
    // Strip leftover standalone punctuation and collapse whitespace
    cleaned = cleaned.replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned;
}
