import { normalizeProductTitle } from '../src/lib/response.ts';

const cases = [
  // [input, must-NOT-contain / expectation description]
  ['LUDOS FEROX 2 Pack Wired Earbuds in-Ear Headphones, 5 Years Warranty, Wired Earbuds with Microphone, Earbuds Stereo, Noise Isolating', t => !t.endsWith(' in') && t.startsWith('LUDOS FEROX'), 'no mid-preposition cut'],
  ['Wired Earbuds Headphones 3.5mm Jack for MP3 Player MP3 Players, Crystal Clear Sound', t => t.length < 45 && !/Jack for/.test(t) || t.startsWith('Wired'), 'spec stuffing handled'],
  ['FVYAO Active Noise Cancelling Earbuds, Wireless Earbuds', t => !t.includes(', Wireless Earbuds'), 'dup tail dropped'],
  ['BOWERS & WILKINS Pi8 MCLAREN EDITION IN-EAR TRUE WIRELESS EARBUDS', t => t.includes('BOWERS & WILKINS'), 'brand kept'],
  ['BYDTOOPCBD A8 PRO Wireless Earbuds with Deep Bass Clear Call, Bluetooth Ear Buds & in-Ear Headphones, IPX7 Waterproof', t => t.length <= 60 && t.startsWith('BYDTOOPCBD'), 'original bug title'],
  ['boAt Airdopes 141 Pro Buds', t => t === 'boAt Airdopes 141 Pro Buds', 'short title untouched'],
  ['HP Omnibook 5 AI Laptop, 16" 2K (1920 x 1200), 16GB RAM, 512GB SSD, Win 11 Home', t => t.startsWith('HP Omnibook 5 AI Laptop') && t.length < 60, 'spec-sheet tail'],
  ['JLab Epic Pods ANC, True Wireless Earbuds, Active Noise Cancelling', t => !t.includes('True Wireless Earbuds'), 'dup tail'],
];
let pass = 0;
for (const [input, check, label] of cases) {
  const out = normalizeProductTitle({ title: input });
  const ok = check(out);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${label}]\n  in:  ${input}\n  out: ${out}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${cases.length} pass`);
process.exit(pass === cases.length ? 0 : 1);
