import { normalizeProductTitle } from '../src/lib/response.ts';

// BUY-75921 v7: layered normalization. Tests cover:
//   - Multi-segment comma/pipe titles (v4 path) + v6 long-stuffing segment drop
//   - Single-segment long titles: forward trim + backward trim take the shorter
//   - v7: hard 50-char cap for single-segment titles >50 chars (laptop spec-dumps)
//   - Brand cluster accumulation (B&W stays intact)
//   - Short titles (pass through unchanged)
//   - Degenerate guard (fallback to raw on bad trim)
//   - Live QA-titled strings (BUSFUIVA, Xmenha Sleep live, etc.)
const cases = [
  // === Multi-segment (v4 path) ===
  ['LUDOS FEROX 2 Pack Wired Earbuds in-Ear Headphones, 5 Years Warranty, Wired Earbuds with Microphone, Earbuds Stereo, Noise Isolating',
    t => !t.endsWith(' in') && t.startsWith('LUDOS FEROX'),
    'no mid-preposition cut'],

  ['Wired Earbuds Headphones 3.5mm Jack for MP3 Player MP3 Players, Crystal Clear Sound',
    t => (t.length < 45 && !/Jack for/.test(t)) || t.startsWith('Wired'),
    'spec stuffing dropped from comma head'],

  ['FVYAO Active Noise Cancelling Earbuds, Wireless Earbuds',
    t => !t.includes(', Wireless Earbuds'),
    'dup trailing segment dropped'],

  // B&W: brand cluster "BOWERS & WILKINS Pi8 MCLAREN EDITION" kept intact
  ['BOWERS & WILKINS Pi8 MCLAREN EDITION IN-EAR TRUE WIRELESS EARBUDS',
    t => t.includes('BOWERS & WILKINS'),
    'B&W brand cluster kept — stops at first generic filler (TRUE)'],

  // BYDTOOPCBD: head trimmed to "BYDTOOPCBD A8" (no brandish in head after trim)
  ['BYDTOOPCBD A8 PRO Wireless Earbuds with Deep Bass Clear Call, Bluetooth Ear Buds & in-Ear Headphones, IPX7 Waterproof',
    t => t.length <= 60 && t.startsWith('BYDTOOPCBD'),
    'bug title from QA repro'],

  // HP Omnibook: head already clean, comma segments stripped
  ['HP Omnibook 5 AI Laptop, 16" 2K (1920 x 1200), 16GB RAM, 512GB SSD, Win 11 Home',
    t => t.startsWith('HP Omnibook 5 AI Laptop'),
    'spec-sheet head passes through, tail segments dropped'],

  ['JLab Epic Pods ANC, True Wireless Earbuds, Active Noise Cancelling',
    t => !t.includes('True Wireless Earbuds'),
    'dup trailing segment dropped'],

  // === Short titles (pass through) ===
  ['boAt Airdopes 141 Pro Buds',
    t => t === 'boAt Airdopes 141 Pro Buds',
    'short title untouched (<= 40 chars)'],

  ['Sony WH-1000XM5',
    t => t === 'Sony WH-1000XM5',
    'model-only title untouched'],

  // === Single-segment (v5 + v6 path — live catalog) ===
  // E6S: no comma to split. Forward trim stops at "Wireless" (generic).
  // Backward trim (v6) drops the trailing 8-generic tail
  // ("Earbuds Noise Cancelling Earphones with Microphone Headphones") but
  // caps at "Headset" to preserve the brand+model anchor.
  ['E6S Wireless Bluetooth Earphones TWS Bluetooth Headset Wireless Earbuds Noise Cancelling Earphones with Microphone Headphones',
    t => t.startsWith('E6S') && t.length < 70,
    'E6S: backward trim drops trailing generics, preserves anchor'],

  // TOZO: comma exists → multi-segment path → head trimmed to TOZO T10 True
  ['TOZO T10 True Wireless Bluetooth 5.3 Earbuds, IPX8 Waterproof, Stereo Call, USB-C, 40H Playtime',
    t => t.startsWith('TOZO T10'),
    'TOZO comma title: head trimmed, tail segments dropped'],

  // Bone Conduction: comma exists → multi-segment → kept as-is (head=bone conduction)
  ['Bone Conduction Headphones 15H Playtime, IPX6 Waterproof, Open-Ear Design, Bluetooth 5.2, for Running Cycling',
    t => t.startsWith('Bone Conduction'),
    'Bone Conduction comma title: head kept, dup segments dropped'],

  // M110: comma exists → head "M110 Mini Projector" already clean
  ['M110 Mini Projector 1080P Supported, 12000L WiFi Bluetooth 5.1',
    t => t.startsWith('M110'),
    'M110 comma title: head passes through'],

  // Xmenha: comma → kept as-is (head has brandish "Xmenha Sleep Ear")
  ['Xmenha Sleep Ear Buds Mini Flat Invisible Earbuds Sleeping, 32dB Noise Isolation, Comfortable',
    t => t.startsWith('Xmenha'),
    'Xmenha comma title'],

  // === Degenerate guard ===
  // Title where trim would produce < 12 chars falls back to raw
  ['ABC Wireless Earbuds',
    t => t.length >= 12,
    'degenerate guard: result < 12 chars → fallback to raw'],

  // === v6 NEW: live-catalog stuffed titles from QA re-verification ===
  // Xmenha Sleep live (115 chars, comma split, mid-stuffing segment).
  // v6 long-stuffing drop: 11-word "Comfortable Low Profile...Bluetooth"
  // segment with ≥2 generics → dropped.
  ['Xmenha Sleep, Comfortable Low Profile Small Tiny Discreet Micro Hidden Earbuds Wireless Bluetooth, Small Ear Canals',
    t => t.startsWith('Xmenha Sleep') && t.length < 50,
    'live Xmenha Sleep (2026-09-18 QA): long stuffing segment dropped'],

  // BUSFUIVA Beats: single-segment 109 chars, backward trim drops
  // "Wireless Headset" from the end, preserving "PA-BT05" model anchor.
  ['BUSFUIVA Beats Studio 3.0 Updated AEC643333 Battery Compatible with Beats Studio 2.0 PA-BT05 Wireless Headset',
    t => t.length < 110 && t.startsWith('BUSFUIVA'),
    'live BUSFUIVA Beats (2026-09-18 QA): backward trim drops tail'],

  // Long "(Red)" tail: backward trim strips parenthetical then drops trailing
  // generics.
  ['Ear buds Wireless Earbuds Bluetooth 5.3 Headphones 60hrs Playtime with Digital Display Sports Wireless Headphones with Earhook Deep Bass IPX7 Waterproof Over-Ear Earbuds for Android iOS Workout (Red)',
    t => t.length < 200 && !t.includes('(Red)') && t.startsWith('Ear buds'),
    'live "(Red)" tail: parenthetical stripped + generics dropped'],

  // Two Pairs: comma → head trim → "Two Pairs Wireless Earbuds" (26 chars).
  ['Two Pairs Wireless Earbuds, Bluetooth 5.5 Headphones HIFI Bass Stereo Ear Buds, LED Display Power in Ear Earphones Waterproof 120H Playtime',
    t => t.startsWith('Two Pairs Wireless Earbuds'),
    'live Two Pairs (2026-09-18 QA): head trim only'],

  // === v7: laptop single-segment spec-dumps (BUY-75921 re-regression 2026-09-18) ===
  // No commas → multi-segment path bypassed. Forward trim stops at "Laptop" (generic).
  // Backward trim finds no trailing generics. Both trims return same ~21-char result →
  // function returns it unchanged. v7 hard cap drops from end until prefix ≤50.
  ['HP Omnibook 5 AI Laptop 16 inch 2K WUXGA 16GB RAM 512GB SSD Win 11 Home',
    t => t.startsWith('HP Omnibook 5 AI Laptop') && t.length <= 50,
    'HP Omnibook single-seg: v7 hard cap at 50'],

  // Live API result: single-segment 119-char spec dump. v7 drops to 44 chars.
  ['HP DK4Q5AT laptop Intel Core Ultra 7 33.8 cm (13.3") WUXGA 16 GB LPDDR5x-SDRAM 512 GB SSD Wi-Fi 7 (802.11be) Windows 11',
    t => t.startsWith('HP DK4Q5AT') && t.length <= 50,
    'HP DK4Q5AT live API: v7 hard cap at 50'],

  // Victus: single-segment gaming laptop. v7 drops the spec tail.
  ['Victus 15-FA2728TX Gaming 15.6" FHD (1920x1080) IPS 144Hz Intel Core i5-13420H NVIDIA RTX 4050',
    t => t.startsWith('Victus') && t.length <= 50,
    'Victus gaming single-seg: v7 hard cap'],

  // Samsung Galaxy Book 4: single-segment 69 chars. v7 caps at 50.
  ['Samsung Galaxy Book 4 NP750XGK-KG2US 15.6" FHD Intel Core 7 256GB SSD',
    t => t.startsWith('Samsung Galaxy Book 4') && t.length <= 50,
    'Samsung Galaxy Book 4 single-seg: v7 hard cap'],

  // Boundary: exactly 49 chars — should NOT be capped (v7 triggers at >50)
  ['HP Omnibook 5 AI Laptop 16 inch 2K WUXGA 16GB RAM',
    t => t.length === 49,
    '49-char boundary: unchanged (v7 triggers at >50 only)'],
];

let pass = 0;
for (const [input, check, label] of cases) {
  const out = normalizeProductTitle({ title: input });
  const ok = check(out);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${label}]`);
  console.log(`  ${input.length}→${out.length} chars`);
  console.log(`  out: ${out}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${cases.length} pass`);
process.exit(pass === cases.length ? 0 : 1);
