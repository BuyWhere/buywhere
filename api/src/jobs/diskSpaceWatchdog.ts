import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STATE_FILE = '/tmp/buy-48198-disk-state.json';
const DEFAULT_WARN_BYTES = String(20 * 1024 * 1024 * 1024);

export function buildWatchdogEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  if (!env.DISK_STATE_FILE) {
    env.DISK_STATE_FILE = DEFAULT_STATE_FILE;
  }

  if (!env.DISK_WARN_BYTES) {
    env.DISK_WARN_BYTES = DEFAULT_WARN_BYTES;
  }

  if (!baseEnv.DISK_MOUNT_PATH) {
    delete env.DISK_MOUNT_PATH;
  }

  return env;
}

export function resolveWatchdogEntrypointPathForTests(cwd: string = process.cwd()): string {
  const candidates = [
    path.join(cwd, 'scripts', 'run-buy-48198-disk-watchdog-cron.sh'),
    path.join(cwd, 'scripts', 'run-buy-48198-disk-watchdog.sh'),
    path.join(cwd, 'scripts', 'run-buy-52997-disk-watchdog-cron.sh'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}
