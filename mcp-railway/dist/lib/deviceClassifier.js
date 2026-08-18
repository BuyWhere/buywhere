"use strict";
// BUY-67522 / BUY-66859: device-query classifier for find_best_price.
// Distinguishes exact device-family queries (phone / console / laptop / tablet)
// from accessories, parts, cases, protectors, controllers, games, software, etc.
// Used to add positive / negative SQL predicates and price floors without
// requiring a fully populated product_type column.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDeviceFilter = buildDeviceFilter;
const ACCESSORY_NEGATIVE_TERMS = [
    'case', 'cover', 'protector', 'screen protector', 'tempered glass',
    'adapter', 'cable', 'charger', 'battery', 'strap', 'band', 'holder',
    'mount', 'stand', 'skin', 'sticker', 'bumper', 'wallet', 'pouch',
    'sleeve', 'bag', 'controller', 'game', 'juego', 'kryt', 'capa',
    'funda', 'coque', 'hülle', 'cover', '保護', 'ケース', 'カバー',
    'compatible', 'replacement', 'part', 'spare', 'repair', 'tool',
    'carcasa', 'étui', 'pouzdro', 'obal', 'etui',
    // Vietnamese common accessory terms in Tiki/Lazada titles.
    'ốp', 'ốp lưng', 'bao da', 'dây cáp', 'cáp sạc', 'sạc nhanh', 'giá đỡ',
    'kính cường lực', 'miếng bảo vệ', 'vòng nam châm',
];
// BUY-70592: Common typos that should map to device types
const TYPO_CORRECTIONS = {
    'lapotp': 'laptop',
    'lapto': 'laptop',
    'laptp': 'laptop',
    'phoen': 'phone',
    'phon': 'phone',
    'mackbook': 'macbook',
    'mackbook pro': 'macbook pro',
    'mackbook air': 'macbook air',
    'iphon': 'iphone',
    'iphoe': 'iphone',
    'galay': 'galaxy',
    'galxy': 'galaxy',
    'samnsung': 'samsung',
    'samgung': 'samsung',
    'dyson': 'dyson',
    'airpods': 'airpods',
    'airpod': 'airpods',
    'ultrabook': 'laptop',
};
function applyTypoCorrection(input) {
    const lower = input.toLowerCase().trim();
    const correctToken = (token) => {
        if (TYPO_CORRECTIONS[token])
            return TYPO_CORRECTIONS[token];
        for (const [typo, correction] of Object.entries(TYPO_CORRECTIONS)) {
            // Only check if lengths are similar enough (typo should be within 2 chars of original)
            if (typo.length >= 4 && Math.abs(token.length - typo.length) <= 2 && levenshtein(token, typo) <= 2) {
                return correction;
            }
        }
        return token;
    };
    return lower.split(/\s+/).map(correctToken).join(' ');
}
// Simple Levenshtein distance for fuzzy typo matching
function levenshtein(a, b) {
    if (a.length === 0)
        return b.length;
    if (b.length === 0)
        return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++)
        matrix[i] = [i];
    for (let j = 0; j <= a.length; j++)
        matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            }
            else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[b.length][a.length];
}
function inferDevice(productName) {
    // BUY-70592: Apply typo correction before matching
    const corrected = applyTypoCorrection(productName);
    const p = corrected.toLowerCase();
    // BUY-70661: explicit accessory intent wins over device-family detection.
    // Queries like "iPhone 15 case" and "laptop stand" are accessory searches;
    // classifying them as phone/laptop applied a device price floor and then
    // filtered the desired accessory rows out, producing false-empty FBP results.
    if (ACCESSORY_NEGATIVE_TERMS.some(term => p.includes(term))) {
        return { type: null, negativeTerms: [], minPriceUsd: 0 };
    }
    // Phones
    if (/\b(iphone\b|smartphone\b|smart\s*phone\b|mobile\s*phone\b|samsung galaxy s|google pixel\b|xiaomi\b|redmi\b|oppo\b|vivo\b|nothing phone|oneplus\b)/.test(p)) {
        return { type: 'phone', negativeTerms: ACCESSORY_NEGATIVE_TERMS, minPriceUsd: 400 };
    }
    // Consoles / controllers
    if (/\b(ps5\b|playstation\s*5|xbox\s*series\s*(s|x)\b|nintendo\s*switch\b)/.test(p)) {
        return { type: 'console', negativeTerms: [...ACCESSORY_NEGATIVE_TERMS, 'juego', 'game', 'controller'], minPriceUsd: 150 };
    }
    // Laptops
    if (/\b(macbook\b|thinkpad\b|dell\s*xps|hp\s*pavilion|asus\s*zenbook|lenovo\s*thinkpad|laptop\b|notebook\b)/.test(p)) {
        return { type: 'laptop', negativeTerms: [...ACCESSORY_NEGATIVE_TERMS, 'sticker', 'sleeve', 'bag'], minPriceUsd: 200 };
    }
    // Tablets
    if (/\b(ipad\b|galaxy\s*tab\b|surface\s*pro\b|tablet\b)/.test(p)) {
        return { type: 'tablet', negativeTerms: ACCESSORY_NEGATIVE_TERMS, minPriceUsd: 100 };
    }
    // Wearables
    if (/\b(apple\s*watch\b|galaxy\s*watch\b|fitbit\b|garmin\s*(fenix|forerunner))\b/.test(p)) {
        return { type: 'wearable', negativeTerms: ACCESSORY_NEGATIVE_TERMS, minPriceUsd: 50 };
    }
    return { type: null, negativeTerms: [], minPriceUsd: 0 };
}
function buildDeviceFilter(productName, country) {
    const device = inferDevice(productName);
    const countryCurrency = {
        SG: 'SGD', MY: 'MYR', TH: 'THB', VN: 'VND', US: 'USD', PH: 'PHP', ID: 'IDR',
    };
    const currency = countryCurrency[country] || country;
    const toUsd = {
        SGD: 0.74, MYR: 0.22, THB: 0.028, VND: 0.000041, USD: 1, PHP: 0.017, IDR: 0.000061,
    }[currency] || 1;
    const minLocal = device.minPriceUsd > 0 ? device.minPriceUsd / toUsd : 0;
    return { ...device, minLocal };
}
