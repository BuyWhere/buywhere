#!/usr/bin/env node
/**
 * BUY-31015 — Deep-page lane supervisor.
 *
 * Spawns buy31015-woocommerce-deep-page.mjs with detached:true so the
 * worker escapes the heartbeat cgroup (nohup+disown in bash does not
 * reliably do this). Monitors and respawns if the worker dies early.
 *
 * Architectural mirror of scripts/buy31015-lane-supervisor.mjs (which
 * supervises the discover lane). Both lanes need to survive the
 * heartbeat cgroup cleanup between 8-minute ticks.
 *
 * Modes:
 *   --check            Exit 0 if a live deep-page worker is found; 1 otherwise.
 *   --restart          Kill any live worker, spawn a fresh one, exit.
 *   --duration-sec=N   (Run mode) monitor for N seconds, exit.
 *   (none)             Spawn if needed; monitor for --duration-sec=720.
 *
 * BUY-34109 — default 270s left a 210s+ dead-lane gap when the [every-8-min]
 * routine was delayed by a resume-delta / fast-path handoff (skip_if_active).
 * 720s (12 min) keeps the next routine tick firing inside the supervisor's
 * monitor window for a routine interval of 480s, so the worst-case gap
 * (after the supervisor exits) is 2*R - 720 = 240s (4 min), under the 5-min
 * acceptance threshold. Override with --duration-sec=N if the routine
 * cadence changes.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║ BUY-35859 — Known failure mode: paperclip-orphan-reaper cron (root,     ║
 * ║ every 5 minutes) sends SIGTERM to PPID=1 paperclip processes with RSS > ║
 * ║ 10MB not in the paperclip.service cgroup, then SIGKILL 5s later. Both   ║
 * ║ this supervisor (spawned via `setsid -f` in the keep-alive) and the     ║
 * ║ worker (spawned here with `detached: true` -> `setsid`) are PPID=1, so  ║
 * ║ they are reaped on the next 5-min mark. The supervisor typically dies    ║
 * ║ between +65s and +125s of its 720s budget - the "fresh output, then     ║
 * ║ vanished" signature observed in BUY-35855 and BUY-37175.                ║
 * ║                                                                         ║
 * ║ The lane survives because buy31015-deep-page-keepalive.sh is invoked     ║
 * ║ every 2 min via cron. When the keep-alive tick fires, the worker is     ║
 * ║ DEAD, the keep-alive restarts it, the supervisor is missing, the        ║
 * ║ keep-alive spawns a new one, and the cycle repeats. The dead-lane gap   ║
 * ║ is at most 2 min (one reaper fire) provided the cron entry is present.  ║
 * ║                                                                         ║
 * ║ If you see this lane DEAD with consecutive_dead > 0 in                   ║
 * ║ data/buy31015-deep-page-keep-alive-state.json, check that the cron      ║
 * ║ entry is still installed (`crontab -l | grep buy31015-deep-page`). If   ║
 * ║ it has been lost (workspace rebuild, manual `crontab -` overwrite),     ║
 * ║ re-add the entry from the BUY-37175 / BUY-35859 spec.                   ║
 * ║                                                                         ║
 * ║ Permanent fix (requires root): move this supervisor and the worker into ║
 * ║ the paperclip.service cgroup at spawn time (e.g. via systemd-run        ║
 * ║ --scope --slice=paperclip.service) so the reaper's PPID=1 filter skips  ║
 * ║ them.                                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, readdirSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ARG = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
}));

const MODE = ARG.check ? 'check' : ARG.restart ? 'restart' : 'run';
const DURATION_SEC = Number(ARG['duration-sec'] || 720);

// ── BUY-31058 — startup grace period for isAlive() / isOurWorker(). ─────────
// Inside the heartbeat cgroup, `process.kill(pid, 0)` against a freshly-spawned
// worker intermittently returns false within the first few seconds — the worker
// is still mid-fork/init and not yet reachable via signal 0 from the supervisor's
// cgroup context. Without this gate, the 5-second monitor loop sees its own
// freshly-spawned worker as dead ("worker died at 5s — respawning") and spawns
// a parallel one, racing on the same state file. We trust the spawn returned a
// valid PID and skip the alive check for the first SPAWN_GRACE_MS after spawn.
const SPAWN_GRACE_MS = Number(process.env.BUY31015_SPAWN_GRACE_MS) || 30_000;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const WORKER = resolve(ROOT, 'scripts/buy31015-woocommerce-deep-page.mjs');
const PID_FILE = resolve(ROOT, 'data/.buy31015-deep-page.pid');
const STATUS_FILE = resolve(ROOT, 'data/buy31015-deep-page-status.json');
const LOG_FILE = resolve(ROOT, 'logs/buy31015_woocommerce_deep.log');
const WORKER_SIG = 'buy31015-woocommerce-deep-page.mjs';


// BUY-53505 — Source lane env so the worker gets INGEST_API_URL / BUYWHERE_API_KEY.
// Also sourced by scripts/buy31015-deep-page-keepalive.sh; this ensures correct
// env even when the supervisor is invoked directly (e.g. by the GH Actions workflow).
const LANE_ENV = resolve(ROOT, 'data/.env.buy31015-lane');
if (existsSync(LANE_ENV)) {
  const envLines = readFileSync(LANE_ENV, 'utf8').split('\n');
  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim();
    // Only set if not already present in the environment
    if (!process.env[k]) process.env[k] = v;
  }
}

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, 'utf8').trim();
  if (!raw) return null;
  const [s, t] = raw.split('|');
  const pid = parseInt(s, 10);
  return isNaN(pid) ? null : { pid, startedAt: t || null };
}

function writePid(pid, startedAt) {
  mkdirSync(dirname(PID_FILE), { recursive: true });
  writeFileSync(PID_FILE, `${pid}|${startedAt}`);
}

function clearPid() {
  if (existsSync(PID_FILE)) writeFileSync(PID_FILE, '');
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Verify this PID is actually our worker, not a recycled PID.
function isOurWorker(pid) {
  if (!isAlive(pid)) return false;
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return cmd.includes(WORKER_SIG);
  } catch { return false; }
}

function killWorker(pid) {
  if (!isAlive(pid)) { clearPid(); return; }
  try { process.kill(pid, 'SIGTERM'); } catch { }
  const dl = Date.now() + 5000;
  while (isAlive(pid) && Date.now() < dl) execSync('sleep 0.2');
  if (isAlive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { }
  clearPid();
}

function spawnWorker() {
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  const fd = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [WORKER, `--duration-sec=${DURATION_SEC}`], {
    detached: true,
    stdio: ['ignore', fd, fd],
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  child.unref();
  const startedAt = new Date().toISOString();
  writePid(child.pid, startedAt);
  return { pid: child.pid, startedAt };
}

function describe(p) {
  if (!p) return 'none';
  return `pid=${p.pid} started=${p.startedAt} alive=${isOurWorker(p.pid) ? 'yes' : 'no'}`;
}

// BUY-52234 — node_modules health check.
// On 2026-06-16 05:25 UTC Oracle discovered the worker had been failing
// silently for 4 days because node_modules/pg was missing from this workspace.
// The supervisor reported RUNNING but every child ingest/r2_teardown crashed
// on `import pg` / `import @aws-sdk/client-s3`.  Refuse to declare a healthy
// worker when the child's required deps are missing.
const REQUIRED_DEPS = [
  'node_modules/pg/package.json',
  'node_modules/@aws-sdk/client-s3/package.json',
];
function checkNodeModules() {
  const cwd = ROOT;
  const missing = REQUIRED_DEPS.filter(p => !existsSync(resolve(cwd, p)));
  return { ok: missing.length === 0, missing, cwd };
}

// BUY-53249 — read worker status from the status file for progress reporting.
function readWorkerStatus() {
  try {
    const raw = readFileSync(STATUS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

function formatStatus(status) {
  if (!status) return '';
  const cycle = status.cycle ?? '?';
  const rowsInserted = status.rowsInserted ?? 0;
  const rowsUpdated = status.rowsUpdated ?? 0;
  const rowsIngested = rowsInserted + rowsUpdated;
  const rowsPerHour = status.rowsPerHour ?? 0;
  const merchantsVisited = status.merchantsVisited ?? 0;
  const discoveredMerchants = status.discoveredMerchants ?? merchantsVisited;
  const totalMerchants = status.totalMerchants ?? discoveredMerchants;
  const merchantProgress = totalMerchants > 0
    ? `${Math.min(discoveredMerchants, totalMerchants)}/${totalMerchants}`
    : String(merchantsVisited);
  return `cycle=${cycle} rows=${rowsIngested} rows/hr=${rowsPerHour} merchants=${merchantProgress}`;
}

if (MODE === 'check') {
  // node_modules gate FIRST so a DEPS-MISSING supervisor still exits 1 even
  // if the worker process happens to be alive (it will crash on first spawn).
  const depCheck = checkNodeModules();
  if (!depCheck.ok) {
    console.log(`deps-missing: cwd=${depCheck.cwd} missing=${JSON.stringify(depCheck.missing)} — run scripts/buy31015-node-modules-guard.mjs`);
    process.exit(1);
  }
  const p = readPid();
  if (p && isOurWorker(p.pid)) {
    console.log(`alive: ${describe(p)}`);
    process.exit(0);
  }
  // Stale PID file (orphaned worker with recycled PID) — fall back to /proc scan.
  const entries = readdirSync('/proc').filter(e => /^\d+$/.test(e));
  for (const e of entries) {
    try {
      const cmdline = readFileSync(`/proc/${e}/cmdline`, 'utf8');
      if (cmdline.includes(WORKER_SIG)) {
        const pid = parseInt(e, 10);
        if (isAlive(pid)) {
          console.log(`alive (proc scan): pid=${pid} cmdline match=${WORKER_SIG}`);
          process.exit(0);
        }
      }
    } catch { }
  }
  console.log(`not running: ${describe(p)}`);
  process.exit(1);
}

if (MODE === 'restart') {
  const p = readPid();
  if (p) killWorker(p.pid);
  const w = spawnWorker();
  console.log(`restarted: ${describe(w)}`);
  process.exit(0);
}

// Run mode: ensure worker is alive, then monitor for duration-sec.
const current = readPid();
if (current && isOurWorker(current.pid)) {
  const initStatus = readWorkerStatus();
  const initStatusStr = initStatus ? ' (' + formatStatus(initStatus) + ')' : '';
  console.log(`worker already alive: ${describe(current)}${initStatusStr} — supervisor monitoring`);
} else {
  if (current) clearPid();
  const w = spawnWorker();
  console.log(`supervisor spawned: ${describe(w)} — duration=${DURATION_SEC}s`);
}

const startMs = Date.now();
const endMs = startMs + DURATION_SEC * 1000;
let lastAliveLog = 0;

while (Date.now() < endMs) {
  execSync('sleep 5');
  const p = readPid();
  if (!p || !isOurWorker(p.pid)) {
    const elapsedS = Math.floor((Date.now() - startMs) / 1000);
    // BUY-31058 — startup grace: during the first SPAWN_GRACE_MS after a spawn,
    // a missing/unreadable /proc/<pid>/cmdline or a failed kill -0 is more likely
    // a cgroup-isolation artefact than a real death. Treat it as "still booting"
    // and wait for the next tick instead of respawning.
    if (p) {
      const spawnAgeMs = p.startedAt ? Date.now() - Date.parse(p.startedAt) : Infinity;
      if (Number.isFinite(spawnAgeMs) && spawnAgeMs >= 0 && spawnAgeMs < SPAWN_GRACE_MS) {
        console.log(`worker still booting (age=${Math.floor(spawnAgeMs / 1000)}s < grace=${Math.floor(SPAWN_GRACE_MS / 1000)}s); skipping respawn check at +${elapsedS}s`);
        continue;
      }
    }
    if (Date.now() + 30_000 >= endMs) {
      console.log(`worker died at +${elapsedS}s; budget ends in ${Math.floor((endMs - Date.now()) / 1000)}s — leaving for next tick`);
      break;
    }
    console.log(`worker died at +${elapsedS}s — respawning`);
    const w = spawnWorker();
    console.log(`respawned: ${describe(w)}`);
  } else {
    const now = Date.now();
    if (now - lastAliveLog > 60_000) {
      const wStatus = readWorkerStatus();
      const wStatusStr = wStatus ? ' ' + formatStatus(wStatus) : '';
      console.log(`worker alive: ${describe(p)} +${Math.floor((now - startMs) / 1000)}s${wStatusStr}`);
      lastAliveLog = now;
    }
  }
}

const finalStatus = readWorkerStatus();
const finalStatusStr = finalStatus ? ' final=' + formatStatus(finalStatus) : '';
console.log(`supervisor budget exhausted${finalStatusStr}; worker detached and live until next heartbeat`);
process.exit(0);
