const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  singapore: 'SG', sg: 'SG',
  malaysia: 'MY', my: 'MY',
  vietnam: 'VN', vn: 'VN',
  thailand: 'TH', th: 'TH',
  'united states': 'US', 'united states of america': 'US', usa: 'US', us: 'US',
  indonesia: 'ID', id: 'ID',
  philippines: 'PH', ph: 'PH',
};

const COUNTRY_ABBREVIATIONS: [string, string][] = [
  ['US', 'US'], ['USA', 'US'], ['SG', 'SG'], ['MY', 'MY'],
  ['VN', 'VN'], ['TH', 'TH'], ['ID', 'ID'], ['PH', 'PH'],
];

const COMMON_CATEGORIES = [
  'laptops', 'smartphones', 'phones', 'headphones', 'earbuds', 'cameras',
  'televisions', 'tvs', 'tablets', 'monitors', 'keyboards', 'mice',
  'watches', 'shoes', 'clothing', 'bags', 'books', 'groceries',
  'electronics', 'home appliances', 'furniture', 'toys', 'sports',
  'fashion', 'beauty', 'health', 'food', 'beverages',
];

export interface ParsedQuery {
  cleanedQuery: string;
  extractedMaxPrice?: number;
  extractedMinPrice?: number;
  extractedCountryCode?: string;
  extractedCategory?: string;
  sortIntent?: 'price_asc' | 'price_desc' | 'rating_desc';
}

function preprocessSearchQuery(rawQuery: string): ParsedQuery {
  let q = rawQuery.trim();
  if (!q) return { cleanedQuery: '' };

  const result: ParsedQuery = { cleanedQuery: q };

  q = extractPriceRange(q, result);
  q = extractPriceConstraint(q, result);
  q = extractCountry(q, result);
  q = extractSort(q, result);
  q = extractCategory(q, result);
  q = cleanNoise(q);

  result.cleanedQuery = q.trim().replace(/\s+/g, ' ');
  return result;
}

function extractPriceConstraint(q: string, result: ParsedQuery): string {
  const maxPatterns = [
    /under\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /below\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /less\s+than\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /cheaper\s+than\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /at\s+most\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /budget\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /max\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /\bunder\s+\$?(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
  ];

  for (const pattern of maxPatterns) {
    const match = pattern.exec(q);
    if (match) {
      const value = parseFloat(match[0].replace(/[^\d.]/g, ''));
      if (!isNaN(value)) {
        result.extractedMaxPrice = value;
        return q.replace(match[0], '').trim();
      }
    }
  }

  const minPatterns = [
    /over\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /above\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /more\s+than\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /at\s+least\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /minimum\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /min\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /\bover\s+\$?(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
  ];

  for (const pattern of minPatterns) {
    const match = pattern.exec(q);
    if (match) {
      const value = parseFloat(match[0].replace(/[^\d.]/g, ''));
      if (!isNaN(value)) {
        result.extractedMinPrice = value;
        return q.replace(match[0], '').trim();
      }
    }
  }

  return q;
}

function extractPriceRange(q: string, result: ParsedQuery): string {
  const rangePatterns = [
    /between\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:and|to|\-)\s*\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
    /from\s+\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:to|\-)\s*\$?\s*(\d+(?:[,.]?\d+)?)\s*(?:dollars?|sgd?|usd?|myr?|vnd?|thb?|bucks?)?\b/gi,
  ];

  for (const pattern of rangePatterns) {
    const match = pattern.exec(q);
    if (match && match[1] && match[2]) {
      const low = parseFloat(match[1].replace(/[^\d.]/g, ''));
      const high = parseFloat(match[2].replace(/[^\d.]/g, ''));
      if (!isNaN(low) && !isNaN(high)) {
        result.extractedMinPrice = low;
        result.extractedMaxPrice = high;
        return q.replace(match[0], '').trim();
      }
    }
  }

  return q;
}

function extractCountry(q: string, result: ParsedQuery): string {
  const countryPatterns = [
    /\bin\s+(?:the\s+)?(Singapore|Malaysia|Vietnam|Thailand|United\s+States|USA|Indonesia|Philippines|US)\b/gi,
    /\bfor\s+(?:the\s+)?(Singapore|Malaysia|Vietnam|Thailand|United\s+States|USA|Indonesia|Philippines|US)\b/gi,
    /\b(Singapore|Malaysia|Vietnam|Thailand|USA|Indonesia|Philippines|US)\s+(?:market|catalog|store|prices?|region)\b/gi,
  ];

  for (const pattern of countryPatterns) {
    const match = pattern.exec(q);
    if (match) {
      const countryName = (match[1] || match[2] || match[3]).toLowerCase();
      const iso = COUNTRY_NAME_TO_ISO[countryName];
      if (iso) {
        result.extractedCountryCode = iso;
        return q.replace(match[0], '').trim();
      }
    }
  }

  const countryNames = ['singapore', 'malaysia', 'vietnam', 'thailand'];
  for (const name of countryNames) {
    const re = new RegExp(`\\b${name}\\b`, 'gi');
    const m = re.exec(q);
    if (m) {
      const iso = COUNTRY_NAME_TO_ISO[name];
      if (iso) {
        result.extractedCountryCode = iso;
        return q.replace(m[0], '').trim();
      }
    }
  }

  // Handle standalone country abbreviations (US, SG, MY, VN, TH)
  for (const [abbr, iso] of COUNTRY_ABBREVIATIONS) {
    const re = new RegExp(`\\b${abbr}\\b`, 'g');
    const m = re.exec(q);
    if (m) {
      result.extractedCountryCode = iso;
      return q.replace(m[0], '').trim();
    }
  }

  return q;
}

function extractSort(q: string, result: ParsedQuery): string {
  const cheapPatterns = /\bcheapest\b|\bcheap\b|\blowest\s+price\b|\bbest\s+value\b|\baffordable\b/gi;
  const expensivePatterns = /\bmost\s+expensive\b|\bhighest\s+price\b|\bpremium\b|\bluxury\b/gi;
  const ratingPatterns = /\bbest\b|\btop\s+rated\b|\bhighest\s+rated\b|\bpopular\b|\bhighly\s+rated\b|\brecommended\b/gi;

  if (cheapPatterns.test(q)) {
    result.sortIntent = 'price_asc';
    q = q.replace(cheapPatterns, '');
  } else if (expensivePatterns.test(q)) {
    result.sortIntent = 'price_desc';
    q = q.replace(expensivePatterns, '');
  } else if (ratingPatterns.test(q)) {
    result.sortIntent = 'rating_desc';
    q = q.replace(ratingPatterns, '');
  }

  return q;
}

function extractCategory(q: string, result: ParsedQuery): string {
  const lowerQ = q.toLowerCase();

  let bestMatch = '';
  let bestLen = 0;

  for (const cat of COMMON_CATEGORIES) {
    if (lowerQ.includes(cat) && cat.length > bestLen) {
      bestMatch = cat;
      bestLen = cat.length;
    }
  }

  if (bestMatch) {
    result.extractedCategory = bestMatch;
  }

  return q;
}

const NOISE_PATTERNS = [
  /\bbuy\b/gi, /\bpurchase\b/gi, /\bget\b/gi, /\bfind\b/gi,
  /\blooking\s+for\b/gi, /\bwant\b/gi, /\bneed\b/gi, /\bshow\s+me\b/gi,
  /\bsearch\s+for\b/gi, /\bcheap\b/gi, /\bdeal(s)?\b/gi, /\bsale\b/gi,
  /\bdiscount(ed)?\b/gi, /\bgood\b/gi, /\bgreat\b/gi, /\bawesome\b/gi,
  /\bamazing\b/gi, /\bin\b/gi, /\bfor\b/gi, /\bthe\b/gi, /\ba\b/gi,
  /\ban\b/gi, /\bdollars?\b/gi, /\bsgd?\b/gi, /\busd?\b/gi, /\bbucks?\b/gi,
  /\bprice\b/gi, /\bprices\b/gi, /\bme\b/gi,
];

function cleanNoise(q: string): string {
  let cleaned = q;
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned
    .replace(/[^a-zA-Z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export { preprocessSearchQuery };
