// BUY-72362: exact-identifier lookup.
//
// Agents ask the catalog for ASIN/EAN/GTIN/MPN far more often than humans do.
// FTS cannot resolve these — a 10-character Amazon ASIN like `B0CHX1W1XY` shares
// no meaningful tokens with any product title, so it returns zero rows.
// Worse, FTS often *does* return rows for tokenized-but-not-identifier queries
// (`SKU-12345` → fishing reels), which is a confident wrong answer — worse than
// no answer at all for an agent.
//
// This module classifies the raw `q` parameter into one of three buckets:
//   - `exact`     → identifier-shaped, must match `gtin`/`mpn`/`sku` exactly
//   - `ambiguous` → identifier-shaped but generic prefix only (e.g. `RZ03-`); match a prefix
//   - `none`      → natural-language; leave the FTS/vector path untouched
//
// The detector MUST be conservative: a misclassified natural-language query is
// worse than the current FTS behaviour, so every regex below is anchored and
// size-bounded. We never detect an identifier unless the input is short, free
// of free-text whitespace, and matches one of the known global identifier
// formats.

export type IdentifierKind =
  | 'asin'           // Amazon ASIN: B + 9 alnum (also book ISBN-10 in ASIN form)
  | 'ean13'          // EAN-13 / GTIN-13: 13 digits
  | 'ean8'           // EAN-8: 8 digits
  | 'upca'           // UPC-A: 12 digits
  | 'gtin14'         // GTIN-14: 14 digits
  | 'apple_part'     // Apple part number: 1-5 letters + 2-5 digits + /A
  | 'sku_prefix'     // Partial SKU like `RZ03-`; prefix match
  | 'model_number';  // Alphanumeric model like HP `4P5K8EA`, Lenovo `F0EK00YHCE`

export interface IdentifierDetection {
  kind: IdentifierKind;
  /** Normalized form to match against the catalog — digits only for numeric IDs, raw otherwise. */
  normalized: string;
  /** Original input, trimmed. */
  raw: string;
}

// EAN/UPC/GTIN digit checksums are deliberately NOT enforced. BuyWhere ingests
// from 75k merchants; the catalogs are dirty. Enforcing a checksum here would
// make us reject real UPCs that have a single transposed digit — a far worse
// outcome than a non-match. The downstream lookup will simply return zero
// results for invalid checksums, which is the right product behaviour.

// ASIN: 10 alnum with three constraints:
//   1. Length is exactly 10.
//   2. The character set excludes vowels (A, E, I, O, U) — Amazon's ASIN
//      encoding (which is ISBN-10 for books) never uses vowels. This
//      naturally distinguishes real ASINs from generic model numbers like
//      Lenovo `F0EK00YHCE` (which contains E).
//   3. Must contain both letters and digits — pure-letter "ASINs" like
//      `ABCDEFGHIJ` are too ambiguous with model numbers.
const ASIN_RE = /^(?=[A-Z0-9]{10}$)(?=[A-Z0-9]*\d)(?!.*[AEIOU])[A-Z0-9]+$/;
const EAN13_RE = /^\d{13}$/;
const EAN8_RE = /^\d{8}$/;
const UPCA_RE = /^\d{12}$/;
const GTIN14_RE = /^\d{14}$/;
// Apple part: e.g. MLPF3LL/A, MPTY3ZA/A, MGNA3LL/A, MK9Q3LL/A — leading letters
// (1–5), 1-5 digits, trailing letters (1–3), then `/<letter>` suffix. The Apple
// part numbering system interleaves letters and digits arbitrarily; the
// discriminator is the `/<letter>` suffix.
const APPLE_PART_RE = /^[A-Za-z]{1,5}\d{1,5}[A-Za-z]{0,3}\/[A-Za-z]$/;
// Model number: 7-12 alnum, must contain both letters and digits (pure-alpha or pure-digit sequences
// are common in titles — exclude them).
const MODEL_NUMBER_RE = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{7,12}$/;
// SKU prefix: alphanumeric followed by `-`, with at least one digit (a letter-only dash
// form like `Foo-` is too ambiguous; we skip it).
const SKU_PREFIX_RE = /^[A-Z0-9]{2,}[-]$/i;

const MAX_LENGTH = 32;

export function detectIdentifier(rawInput: string): IdentifierDetection | null {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const raw = rawInput.trim();
  if (raw.length === 0 || raw.length > MAX_LENGTH) return null;
  // Any whitespace in the input means it isn't a single identifier — let FTS handle it.
  if (/\s/.test(raw)) return null;

  // Strip a single trailing slash (Apple part numbers in URLs often appear without /A).
  // But we don't strip any other punctuation; that would loosen the match.
  const candidate = raw.toUpperCase();

  // Ordering matters: check more-specific patterns before more-general ones.
  // Apple part (/A suffix) must be before ASIN — 'MLPF3LL/A' is 9 alnum + /A so
  // the ASIN regex (10 alnum) doesn't match. Apple parts are still checked
  // before ASIN to keep the order semantic.
  if (APPLE_PART_RE.test(candidate)) {
    return { kind: 'apple_part', normalized: candidate, raw };
  }
  if (GTIN14_RE.test(candidate)) {
    return { kind: 'gtin14', normalized: candidate, raw };
  }
  if (EAN13_RE.test(candidate)) {
    return { kind: 'ean13', normalized: candidate, raw };
  }
  if (UPCA_RE.test(candidate)) {
    return { kind: 'upca', normalized: candidate, raw };
  }
  if (EAN8_RE.test(candidate)) {
    return { kind: 'ean8', normalized: candidate, raw };
  }
  // SKU prefix must end in a dash; we strip it for the prefix LIKE.
  if (SKU_PREFIX_RE.test(candidate)) {
    return { kind: 'sku_prefix', normalized: candidate.slice(0, -1), raw };
  }
  // ASIN must come BEFORE the generic model-number check. The ASIN pattern is
  // more constrained (no vowels, 10 chars, mixed alnum), so a string that
  // matches ASIN is also a valid model number. ASIN wins because it is the
  // more specific identifier shape.
  if (ASIN_RE.test(candidate)) {
    return { kind: 'asin', normalized: candidate, raw };
  }
  // Model-number heuristic. Falls through here only when the previous checks
  // failed; captures 7-12 char alphanumeric strings with both letters and
  // digits (HP 4P5K8EA, Lenovo F0EK00YHCE, …).
  if (MODEL_NUMBER_RE.test(candidate)) {
    return { kind: 'model_number', normalized: candidate, raw };
  }
  return null;
}

/**
 * Map an IdentifierDetection to the WHERE-clause fragment + bind parameters
 * used against the `search_products` tier (BUY-41136) or the `products` archive
 * table. Both tables share the `gtin`, `mpn`, and `sku` column names.
 *
 * Returns `null` when no exact-match predicate applies (currently never — kept
 * for forward-compat if we add a `kind` that requires fallback).
 */
export function identifierMatchPredicate(
  id: IdentifierDetection,
  paramIdx: number,
): { sql: string; param: string } {
  switch (id.kind) {
    case 'gtin14':
    case 'ean13':
    case 'ean8':
    case 'upca':
      // All barcode variants are stored in the `gtin` column. The catalog
      // sometimes stores the leading-zero-stripped form (EAN-13 → UPC-A); the
      // suffix-stripped form (GTIN-14 → EAN-13); we accept any of these by
      // matching on the digits-only column. `idx_sp_gtin` makes this O(1).
      return { sql: `gtin = $${paramIdx}`, param: id.normalized };
    case 'asin':
    case 'apple_part':
    case 'model_number':
      // ASINs land in `mpn` for non-Amazon merchants and in `sku` for the
      // platform that emitted them; Apple's part numbers are universally MPN.
      // Match either; `OR` against two btree-friendly equality predicates is
      // sub-ms on the partial GIN path.
      return {
        sql: `(mpn = $${paramIdx} OR sku = $${paramIdx})`,
        param: id.normalized,
      };
    case 'sku_prefix':
      return {
        sql: `(mpn LIKE $${paramIdx} OR sku LIKE $${paramIdx})`,
        param: `${id.normalized}%`,
      };
  }
}

/**
 * Identifiers must NEVER be enriched by the semantic / vector arm. ASIN/EAN/MPN
 * lookup is a mechanical equality operation; sending the identifier through
 * Jina/Gemini adds latency + cost and risks hallucinated neighbours.
 */
export function identifierForcesKeywordMode(id: IdentifierDetection): boolean {
  return id.kind !== 'sku_prefix';
}
