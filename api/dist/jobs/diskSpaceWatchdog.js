"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWatchdogEnv = buildWatchdogEnv;
exports.resolveWatchdogEntrypointPathForTests = resolveWatchdogEntrypointPathForTests;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_STATE_FILE = '/tmp/buy-48198-disk-state.json';
function buildWatchdogEnv(baseEnv = process.env) {
    const env = { ...baseEnv };
    if (!env.DISK_STATE_FILE) {
        env.DISK_STATE_FILE = DEFAULT_STATE_FILE;
    }
    if (!baseEnv.DISK_MOUNT_PATH) {
        delete env.DISK_MOUNT_PATH;
    }
    return env;
}
function resolveWatchdogEntrypointPathForTests(cwd = process.cwd()) {
    const candidates = [
        node_path_1.default.join(cwd, 'scripts', 'run-buy-48198-disk-watchdog-cron.sh'),
        node_path_1.default.join(cwd, 'scripts', 'run-buy-48198-disk-watchdog.sh'),
        node_path_1.default.join(cwd, 'scripts', 'run-buy-52997-disk-watchdog-cron.sh'),
    ];
    for (const candidate of candidates) {
        if (node_fs_1.default.existsSync(candidate)) {
            return candidate;
        }
    }
    return candidates[0];
}
