import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/routes/mcp.ts', import.meta.url), 'utf8');
const searchStart = source.indexOf('async function handleSearchProducts');
const searchEnd = source.indexOf('async function handleGetProduct', searchStart);
const searchBlock = source.slice(searchStart, searchEnd);
const matches = searchBlock.match(/SELECT sp\.id FROM \$\{ftsTable\} sp \$\{tierWhere\} LIMIT 1000/g) || [];
assert.equal(matches.length, 2, 'both keyword FTS paths must use id-only GIN scans');
