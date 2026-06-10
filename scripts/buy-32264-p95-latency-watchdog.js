#!/usr/bin/env node
/**
 * buy-32264-p95-latency-watchdog.js — BUY-32397 P95 Latency Watchdog
 *
 * Polls the BuyWhere P95 monitoring endpoint, tracks per-market consecutive
 * breach count against a 300ms threshold, and returns a verdict:
 *   - PASS  : all markets under threshold (or recovered)
 *   - WARN  : at least one market over threshold for 1-2 consecutive rotations
 *   - ALERT : at least one market over threshold for >=3 consecutive rotations
 *   - BLOCK : upstream probes failed / no live alert decision possible
 *
 * Usage:
 *   P95_STATE_FILE=/tmp/buy-32264-p95-state.json \
 *   P95_EXECUTION_ISSUE=BUY-38871 \
 *   P95_SNAPSHOT_DIR=data/buy-38871-p95-monitor-<ts> \
 *     node scripts/buy-32264-p95-latency-watchdog.js
 *
 * Exit codes:
 *   0 = PASS, 1 = WARN, 2 = ALERT, 3 = BLOCK
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const STATE_FILE = process.env.P95_STATE_FILE || '/tmp/buy-32264-p95-state.json';
const EXECUTION_ISSUE = process.env.P95_EXECUTION_ISSUE || 'BUY-38871';
const SNAPSHOT_DIR = process.env.P95_SNAPSHOT_DIR;
const THRESHOLD_MS = parseInt(process.env.P95_THRESHOLD_MS || '300', 10);
const CONSECUTIVE_REQUIRED = parseInt(process.env.P95_CONSECUTIVE_REQUIRED || '3', 10);
const COOLDOWN_MS = parseInt(process.env.P95_ALERT_COOLDOWN_MS || String(60 * 60 * 1000), 10);
const MONITORING_URL =
  process.env.P95_MONITORING_URL || 'https://api.buywhere.ai/api/monitoring/p95/all';
const ALERT_SINK = process.env.P95_ALERT_SINK || 'BUY-31463';
const MONITORING_API_KEY = process.env.P95_MONITORING_API_KEY || process.env.MONITORING_API_KEY || '';
const REQUEST_TIMEOUT_MS = 10_000;
const MARKETS = ['sg', 'us', 'my', 'vn', 'th'];

function fetchMonitoring() {
  return new Promise((resolve) => {
    const url = new URL(MONITORING_URL);
    const opts = {
      method: 'GET',
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'buy-32397-p95-watchdog/1.0',
        ...(MONITORING_API_KEY ? { Authorization: `Bearer ${MONITORING_API_KEY}` } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : null;
          resolve({ statusCode: res.statusCode, body: json, rawBody: body });
        } catch (err) {
          resolve({ statusCode: res.statusCode, body: null, rawBody: body, parseError: err.message });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => {
      resolve({ statusCode: 0, body: null, rawBody: '', error: err.message });
    });
    req.end();
  });
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.markets) return parsed;
  } catch (err) {
    // Missing or invalid; start fresh
  }
  const markets = {};
  for (const m of MARKETS) {
    markets[m] = {
      consecutiveBreaches: 0,
      lastAlertedAt: null,
      lastWindowEnd: null,
      lastP95Ms: null,
      lastStatus: 'unknown',
    };
  }
  return { markets, updatedAt: null };
}

function writeState(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function classifyStatus(marketEntry, threshold) {
  if (!marketEntry || marketEntry.p95Ms === null || marketEntry.p95Ms === undefined) {
    return 'unknown';
  }
  return marketEntry.p95Ms > threshold ? 'over_threshold' : 'healthy';
}

function buildResult({ fetchResult, state, threshold, consecutiveRequired, generatedAt }) {
  const notes = [];
  const markets = [];
  let verdict = 'PASS';
  let blockedReason = null;
  let alert = null;

  if (!fetchResult || fetchResult.statusCode === 0 || !fetchResult.body) {
    verdict = 'BLOCK';
    blockedReason =
      fetchResult?.error
        ? `Upstream probe error: ${fetchResult.error}`
        : 'Upstream monitoring endpoint did not respond.';
    notes.push(blockedReason);
  } else if (fetchResult.statusCode !== 200 || !fetchResult.body.markets) {
    verdict = 'BLOCK';
    blockedReason = `Monitoring endpoint returned HTTP ${fetchResult.statusCode} without a markets object.`;
    notes.push(blockedReason);
  } else {
    let anyFresh = false;
    let anyStale = false;
    for (const market of MARKETS) {
      const m = fetchResult.body.markets[market];
      if (!m) {
        markets.push({
          market,
          p95_ms: null,
          sample_size: 0,
          window_end: null,
          fresh: false,
          over_threshold: false,
          consecutiveBreaches: state.markets[market]?.consecutiveBreaches || 0,
          status: 'stale',
        });
        notes.push(`Missing data for market ${market.toUpperCase()}`);
        anyStale = true;
        continue;
      }
      const windowEnd = m.window_end || null;
      const windowEndMs = windowEnd ? Date.parse(windowEnd) : null;
      const ageMin = windowEndMs ? (Date.now() - windowEndMs) / 60000 : Infinity;
      const fresh = Number.isFinite(ageMin) && ageMin <= 15;
      if (fresh) anyFresh = true;
      else anyStale = true;

      const over = typeof m.p95_ms === 'number' && m.p95_ms > threshold;
      const prev = state.markets[market] || { consecutiveBreaches: 0, lastAlertedAt: null };
      let nextCount;
      if (over && fresh) {
        nextCount = (prev.consecutiveBreaches || 0) + 1;
      } else {
        nextCount = 0;
      }

      state.markets[market] = {
        consecutiveBreaches: nextCount,
        lastAlertedAt: prev.lastAlertedAt || null,
        lastWindowEnd: windowEnd,
        lastP95Ms: m.p95_ms,
        lastStatus: fresh ? (over ? 'over_threshold' : 'healthy') : 'stale',
      };

      markets.push({
        market,
        p95_ms: m.p95_ms,
        sample_size: m.sample_size ?? 0,
        window_end: windowEnd,
        fresh,
        over_threshold: over,
        consecutiveBreaches: nextCount,
        status: fresh ? (over ? 'over_threshold' : 'healthy') : 'stale',
      });

      if (over && fresh) {
        if (nextCount >= consecutiveRequired) {
          verdict = 'ALERT';
        } else if (verdict === 'PASS') {
          verdict = 'WARN';
        }
      }
    }

    if (!anyFresh) {
      verdict = 'BLOCK';
      blockedReason = 'All markets reported stale windows; cannot make a live alert decision.';
      notes.push(blockedReason);
    } else if (verdict === 'ALERT') {
      const now = Date.now();
      const eligible = MARKETS.filter((market) => {
        const m = state.markets[market];
        return m && m.consecutiveBreaches >= consecutiveRequired;
      });
      const withinCooldown = eligible.every((market) => {
        const last = state.markets[market]?.lastAlertedAt;
        return last && now - Date.parse(last) < COOLDOWN_MS;
      });
      if (withinCooldown) {
        verdict = 'PASS';
        notes.push(
          `Eligible markets already alerted within cooldown (${COOLDOWN_MS / 1000}s); suppressing duplicate alert.`
        );
      } else {
        const alertedAt = new Date(now).toISOString();
        for (const market of eligible) {
          state.markets[market].lastAlertedAt = alertedAt;
        }
        alert = {
          triggeredAt: alertedAt,
          eligibleMarkets: eligible,
          sink: ALERT_SINK,
          message: `P95 exceeded ${threshold}ms for ${consecutiveRequired}+ consecutive rotations in: ${eligible
            .map((m) => m.toUpperCase())
            .join(', ')}`,
        };
      }
    }
  }

  return {
    generated_at: generatedAt,
    status: verdict,
    notes,
    markets,
    alert,
    source_identifier: 'BUY-32397',
    execution_identifier: EXECUTION_ISSUE,
    alert_issue_identifier: ALERT_SINK,
    threshold_ms: threshold,
    consecutive_required: consecutiveRequired,
    monitoring_url: MONITORING_URL,
    blocked_reason: blockedReason,
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const state = readState();
  const fetchResult = await fetchMonitoring();
  const result = buildResult({
    fetchResult,
    state,
    threshold: THRESHOLD_MS,
    consecutiveRequired: CONSECUTIVE_REQUIRED,
    generatedAt,
  });

  writeState(state);

  const resultJson = JSON.stringify(result, null, 2);
  const stateJson = JSON.stringify(state, null, 2);
  process.stdout.write(resultJson + '\n');

  if (SNAPSHOT_DIR) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'result.json'), resultJson);
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'state.json'), stateJson);
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'status.txt'), `${result.status}\n`);
    const summaryLines = [
      `# BUY-32397 P95 watchdog`,
      ``,
      `- Generated at: \`${generatedAt}\``,
      `- Execution issue: \`${EXECUTION_ISSUE}\``,
      `- Result: \`${result.status}\``,
      `- Monitoring endpoint: \`${MONITORING_URL}\``,
      `- Monitoring auth: \`${MONITORING_API_KEY ? 'configured' : 'not configured'}\``,
      `- Alert sink: \`${ALERT_SINK}\``,
      `- Threshold: \`${THRESHOLD_MS}ms\` for \`${CONSECUTIVE_REQUIRED}\` consecutive rotations`,
      ``,
      `| Market | P95 | Samples | Window End | Fresh | Consecutive | Status |`,
      `|--------|-----|---------|------------|-------|-------------|--------|`,
    ];
    for (const m of result.markets) {
      const win = m.window_end || 'n/a';
      const fresh = m.fresh ? 'yes' : 'no';
      summaryLines.push(
        `| ${m.market.toUpperCase()} | ${m.p95_ms ?? 'n/a'}ms | ${m.sample_size} | ${win} | ${fresh} | ${m.consecutiveBreaches} | ${m.status} |`
      );
    }
    if (result.alert) {
      summaryLines.push(
        ``,
        `## Alert`,
        ``,
        `- Triggered at: \`${result.alert.triggeredAt}\``,
        `- Markets: ${result.alert.eligibleMarkets.map((m) => '`' + m.toUpperCase() + '`').join(', ')}`,
        `- Sink: \`${result.alert.sink}\``,
        `- Message: ${result.alert.message}`,
      );
    }
    if (result.notes && result.notes.length) {
      summaryLines.push(``, `## Notes`, ``);
      for (const n of result.notes) summaryLines.push(`- ${n}`);
    }
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'summary.md'), summaryLines.join('\n') + '\n');
  }

  if (result.status === 'PASS') process.exit(0);
  if (result.status === 'WARN') process.exit(1);
  if (result.status === 'ALERT') process.exit(2);
  process.exit(3);
}

main().catch((err) => {
  console.error('FATAL', err && err.stack ? err.stack : err);
  process.exit(3);
});
