#!/usr/bin/env node
/**
 * prepublish-guard.mjs — last gate before this package reaches npm.
 *
 * Why this exists here rather than only in CI: the package advertises its own
 * hardcoded copy of the tool schemas while proxying calls to the live /mcp
 * endpoint, and the GitHub token available to the agents that maintain this
 * repo cannot create `.github/workflows/*` files (needs `workflow` scope, has
 * only `repo`). `npm publish` is the one choke point every release passes
 * through regardless of who runs it or from where, so the guard belongs on it.
 *
 * Runs on `prepublishOnly`:
 *   1. typecheck  — blocking
 *   2. build      — blocking (check-drift needs dist/index.js)
 *   3. check-drift — blocking on REAL drift only
 *
 * check-drift exit codes: 0 = in sync, 1 = drift, 2 = could not check.
 * Exit 2 means the live endpoint or its credential was unreachable (no
 * BUYWHERE_API_KEY in the publishing shell, network egress blocked, or the
 * production key flapping — see BUY-66065). That is not evidence of drift, and
 * hard-failing on it would block a legitimate release for infra noise, so it
 * warns loudly and continues. Only a positive drift finding stops the publish.
 *
 * Escape hatch: SKIP_DRIFT_CHECK=1 npm publish
 */

import { spawnSync } from 'node:child_process';

const skip = process.env.SKIP_DRIFT_CHECK === '1';

function run(label, args, { blocking }) {
  process.stdout.write(`\nprepublish-guard: ${label}...\n`);
  const res = spawnSync('npm', args, { stdio: 'inherit', shell: false });

  if (res.error) {
    console.error(`prepublish-guard: could not run ${label} — ${res.error.message}`);
    if (blocking) process.exit(1);
    return null;
  }
  if (res.signal) {
    console.error(`prepublish-guard: ${label} killed by signal ${res.signal}`);
    if (blocking) process.exit(1);
    return null;
  }
  return res.status;
}

// 1 + 2: these must pass. A package that does not compile must never publish.
for (const [label, script] of [['typecheck', 'typecheck'], ['build', 'build']]) {
  const code = run(label, ['run', script], { blocking: true });
  if (code !== 0) {
    console.error(`\nprepublish-guard: ${label} failed (exit ${code}) — refusing to publish.`);
    process.exit(1);
  }
}

// 3: schema drift against the live contract.
if (skip) {
  console.warn(
    '\nprepublish-guard: SKIP_DRIFT_CHECK=1 set — skipping the live schema-drift check.\n' +
      'prepublish-guard: publishing WITHOUT verifying the advertised tool schemas match live.',
  );
  process.exit(0);
}

const drift = run('check-drift', ['run', '--silent', 'check-drift'], { blocking: false });

if (drift === 0) {
  console.log('\nprepublish-guard: schemas match the live contract — OK to publish.');
  process.exit(0);
}

if (drift === 1) {
  console.error(
    '\nprepublish-guard: SCHEMA DRIFT — the tool schemas this package advertises no longer\n' +
      'match the live /mcp contract. Publishing would ship clients a stale contract:\n' +
      'they would lose access to new capabilities, or call tools that fail at runtime.\n' +
      'Fix TOOLS in src/index.ts (see the diff above), or re-run with\n' +
      'SKIP_DRIFT_CHECK=1 if you are deliberately publishing a lagging package.',
  );
  process.exit(1);
}

// Exit 2, or any unexpected non-zero: could not verify. Warn, do not block.
console.warn(
  `\nprepublish-guard: could not verify schemas against live (check-drift exit ${drift}).\n` +
    'prepublish-guard: this is NOT a drift finding — the live endpoint or its credential\n' +
    'was unreachable. Set BUYWHERE_API_KEY to enable the check. Continuing with publish.',
);
process.exit(0);
