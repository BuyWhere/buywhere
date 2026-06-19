#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const SUPERVISOR = path.join(ROOT, 'scripts', 'buy31015-deep-page-supervisor.mjs');
const STATUS_FILE = path.join(ROOT, 'data', 'buy31015-deep-page-status.json');
const TICK_MS = 8 * 60 * 1000;

let tick = 0;

function readProgress() {
  try {
    const status = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
    return {
      cycle: status.cycle ?? '?',
      discoveryProgress: status.discoveryProgress ?? '?',
      merchantsVisited: status.merchantsVisited ?? 0,
      totalMerchants: status.totalMerchants ?? 0,
    };
  } catch {
    return { cycle: '?', discoveryProgress: '?', merchantsVisited: 0, totalMerchants: 0 };
  }
}

function runCmd(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (err.stdout) return String(err.stdout);
    throw err;
  }
}

function parsePid(output) {
  const m = /pid=([0-9]+)/.exec(output || '');
  return m ? m[1] : '?';
}

function runTick() {
  tick += 1;
  const progress = readProgress();
  const prefix = `buy31015 deep-page monitor tick=${tick} cycle=${progress.cycle} discovery=${progress.discoveryProgress} merchants=${progress.merchantsVisited}/${progress.totalMerchants}`;
  const checkCmd = `node ${JSON.stringify(SUPERVISOR)} --check`;
  let checkOutput;

  try {
    checkOutput = runCmd(checkCmd);
    const pid = parsePid(checkOutput);
    console.log(`${prefix} status=running pid=${pid}`);
    return;
  } catch {
    console.log(`${prefix} status=dead, restarting`);
  }

  try {
    const restartOutput = runCmd(`node ${JSON.stringify(SUPERVISOR)} --restart`);
    const pid = parsePid(restartOutput);
    console.log(`${prefix} status=restarted pid=${pid}`);
  } catch (err) {
    console.error(`${prefix} status=restart-failed error=${(err && err.message) || err}`);
  }
}

console.log('monitor-woocommerce-deep-page.js initialized');
runTick();
setInterval(runTick, TICK_MS);
