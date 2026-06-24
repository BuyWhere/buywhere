#!/usr/bin/env node
/**
 * BUY-56172 — Node modules guard for the WooCommerce deep-page lane.
 *
 * The supervisor checks required node_modules at startup. If any are missing,
 * it prints a deps-missing message and exits 1. Running this script installs
 * the missing deps so the next supervisor tick succeeds.
 *
 * Required: pg, @aws-sdk/client-s3
 */
import { existsSync } from 'fs';
import { execSync } from 'child_process';

const REQUIRED = [
  'node_modules/pg/package.json',
  'node_modules/@aws-sdk/client-s3/package.json',
];

const missing = REQUIRED.filter(p => !existsSync(p));

if (missing.length === 0) {
  console.log('node_modules-ok');
  process.exit(0);
}

console.log(`node_modules-missing: ${JSON.stringify(missing)} — installing...`);
try {
  execSync('npm install pg @aws-sdk/client-s3 --no-save', {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  console.log('node_modules-ok');
  process.exit(0);
} catch (e) {
  console.error('node_modules-fail:', e.message);
  process.exit(1);
}
