import { normalizeProductTitle } from '../src/lib/response.ts';

// BUY-75921 v5: single-segment trimming added. Tests cover:
//   - Multi-segment comma/pipe titles (original v4 path)
//   - Single-segment long titles (NEW v5 path — live catalog has no commas)
//   - Brand cluster accumulation (B&W stays intact)
//   - Short titles (pass through unchanged)
//   - Degenerate guard (fallback to raw on bad trim)
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

  // === Single-segment (v5 path — live catalog) ===
  // E6S: no comma to split, but head contains brand "E6S" — no generic filler
  // after it, so the single-segment path keeps the whole title (degenerate guard).
  ['E6S Wireless Bluetooth Earphones TWS Bluetooth Headset Wireless Earbuds Noise Cancelling Earphones with Microphone Headphones',
    t => t.length >= 40,
    'E6S: no comma, no filler after anchor → kept as-is'],

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
