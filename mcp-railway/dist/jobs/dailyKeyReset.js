"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDailyKeyReset = runDailyKeyReset;
const config_1 = require("../config");
async function runDailyKeyReset() {
    const ranAt = new Date();
    const result = await config_1.db.query(`UPDATE api_keys
     SET daily_request_count = 0,
         daily_reset_at = $1
     WHERE daily_reset_at <= $1
     RETURNING id`, [ranAt]);
    const keysReset = result.rowCount ?? 0;
    console.log(`[daily-key-reset] Reset ${keysReset} API key(s) at ${ranAt.toISOString()}`);
    return { ran_at: ranAt, keys_reset: keysReset };
}
