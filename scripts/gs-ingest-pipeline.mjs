#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const dataDir = process.env.BUYWHERE_DATA_DIR || path.join(repoRoot, 'data');
const logsDir = process.env.BUYWHERE_LOG_DIR || path.join(repoRoot, 'logs');
const summaryPath = process.env.GS_PIPELINE_SUMMARY_PATH || path.join(dataDir, 'pipeline-summary.json');
const logPath = process.env.GS_PIPELINE_LOG_PATH || path.join(logsDir, 'gs-ingest-pipeline.log');
const dryRun = process.argv.includes('--dry-run') || process.env.GS_PIPELINE_DRY_RUN === '1';

const config = {
  feedsFile: process.env.GS_PIPELINE_FEEDS_FILE || path.join(repoRoot, 'feeds_gs.txt'),
  batchSize: process.env.GS_PIPELINE_BATCH_SIZE || '200',
  concurrency: process.env.GS_PIPELINE_CONCURRENCY || '4',
  scrapeOnly: process.env.GS_PIPELINE_SCRAPE_ONLY === '1',
  useProxy: process.env.GS_PIPELINE_USE_PROXY === '1',
  apiKey: process.env.BUYWHERE_API_KEY || process.env.API_KEY,
};

function timestamp() {
  return new Date().toISOString();
}

async function log(line = '') {
  const formatted = line ? `[gs-pipeline] ${line}` : '';
  console.log(formatted);
  await mkdir(path.dirname(logPath), { recursive: true });
  await import('node:fs/promises').then(({ appendFile }) => appendFile(logPath, `${formatted}\n`));
}

function runCommand(label, command, args, options = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: `${scriptDir}${path.delimiter}${process.env.PYTHONPATH || ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let output = '';
    const capture = async (chunk) => {
      const text = chunk.toString();
      output += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        await log(line);
      }
    };

    child.stdout.on('data', (chunk) => void capture(chunk));
    child.stderr.on('data', (chunk) => void capture(chunk));
    child.on('error', (error) => {
      resolve({ label, status: 'failed', exitCode: null, elapsed_seconds: (Date.now() - started) / 1000, error: error.message, output });
    });
    child.on('close', (code) => {
      resolve({
        label,
        status: code === 0 ? 'completed' : 'failed',
        exitCode: code,
        elapsed_seconds: Number(((Date.now() - started) / 1000).toFixed(3)),
        output_tail: output.split(/\r?\n/).filter(Boolean).slice(-20),
      });
    });
  });
}

function redactArgs(args) {
  const redacted = [];
  for (let index = 0; index < args.length; index += 1) {
    redacted.push(args[index]);
    if (args[index] === '--api-key' && index + 1 < args.length) {
      redacted.push('[REDACTED]');
      index += 1;
    }
  }
  return redacted;
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const started = Date.now();
  const summary = {
    started_at: timestamp(),
    dry_run: dryRun,
    steps: {},
  };

  await log(`Daily GS ingestion pipeline start (dry_run=${dryRun})`);

  const ingestArgs = [
    path.join(repoRoot, 'ingest_woo_gshopping.py'),
    '--gshopping-feeds-file', config.feedsFile,
    '--batch-size', config.batchSize,
    '--concurrency', config.concurrency,
    '--log-file', path.join(logsDir, 'gs-feed-ingest-results.log'),
  ];
  if (config.scrapeOnly || dryRun) ingestArgs.push('--scrape-only');
  if (config.useProxy) ingestArgs.push('--use-proxy');
  if (config.apiKey) ingestArgs.push('--api-key', config.apiKey);

  await log('=== Google Shopping Feed Ingestion ===');
  await log(`Running: python3 ${redactArgs(ingestArgs).join(' ')}`);
  summary.steps.gshopping_ingest = await runCommand('Google Shopping Feed Ingestion', 'python3', ingestArgs);

  summary.finished_at = timestamp();
  summary.elapsed_seconds = Number(((Date.now() - started) / 1000).toFixed(3));
  summary.status = Object.values(summary.steps).every((step) => step.status === 'completed') ? 'completed' : 'failed';

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await log(`Full pipeline ${summary.status} in ${summary.elapsed_seconds}s`);
  await log(`Summary: ${summaryPath}`);

  if (summary.status !== 'completed') return 1;
  return 0;
}

main().then((code) => process.exit(code)).catch(async (error) => {
  await log(`Fatal: ${error.stack || error.message}`);
  process.exit(1);
});
