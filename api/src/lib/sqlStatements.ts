// Statement-level execution for the boot migrations.
//
// The catalog has a DDL event trigger (guard_blocking_products_ddl) that raises on any
// non-CONCURRENT CREATE INDEX / REINDEX targeting products. It inspects current_query(),
// so when a multi-statement block is sent as ONE string, the very first statement fails
// if a products index appears ANYWHERE in the block - even one that already exists and is
// guarded by IF NOT EXISTS. Every boot since 2026-08-08 logged "Full migration block
// failed" and nothing in that block ran, including the columns query_log needs.
//
// Running one statement at a time keeps the guard exact, and lets a products index be
// checked against the catalog instead of built: present -> satisfied, absent -> reported
// for a deliberate ops-ddl CONCURRENTLY build. ADD COLUMN IF NOT EXISTS is also
// pre-checked so a no-op never waits for an AccessExclusiveLock on a 443M-row table.

export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const j = sql.indexOf('\n', i);
      const end = j < 0 ? sql.length : j;
      cur += sql.slice(i, end); i = end; continue;
    }
    if (two === '/*') {
      const j = sql.indexOf('*/', i + 2);
      const end = j < 0 ? sql.length : j + 2;
      cur += sql.slice(i, end); i = end; continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const j = sql.indexOf(tag, i + tag.length);
        const end = j < 0 ? sql.length : j + tag.length;
        cur += sql.slice(i, end); i = end; continue;
      }
    }
    if (ch === ';') {
      if (stripSqlComments(cur)) out.push(cur.trim());
      cur = ''; i++; continue;
    }
    cur += ch; i++;
  }
  if (stripSqlComments(cur)) out.push(cur.trim());
  return out;
}

export function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

// Any non-CONCURRENT index build is checked, not built, at boot. The first run of the
// statement-level block found idx_price_history_product_recorded missing and built it
// on a large table: 28s holding a ShareLock, then cancelled by lock_timeout, and it
// would have retried on every boot of every replica.
export const PRODUCTS_INDEX_RE =
  /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)\s+ON\s+(?:ONLY\s+)?(?:public\s*\.\s*)?"?\w+"?\b/i;
export const ADD_COLUMN_RE =
  /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\s*\.\s*)?"?(\w+)"?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/i;

// Statements that write to products or take an exclusive lock on it must never run at
// boot: a 443M-row UPDATE backfill, DROP TRIGGER ... ON products (AccessExclusiveLock
// queued behind live ingest), or DROP ... CASCADE that reaches such a trigger. They are
// reported so an operator can run them deliberately in a window.
export const PRODUCTS_BOOT_UNSAFE_RE =
  /^\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?\w+"?\s+ON|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?(?:\s+ONLY)?|CREATE\s+TRIGGER\s+"?\w+"?[\s\S]*?\bON)\s+(?:ONLY\s+)?(?:public\s*\.\s*)?"?products"?\b/i;
export const DROP_CASCADE_RE = /^\s*DROP\s+[\s\S]*\bCASCADE\b/i;

export type StatementPlan =
  | { kind: 'run'; sql: string }
  | { kind: 'skip_boot'; sql: string; reason: string }
  | { kind: 'products_index'; sql: string; name: string }
  | { kind: 'add_column'; sql: string; table: string; column: string };

export function planStatement(raw: string): StatementPlan {
  const stmt = stripSqlComments(raw);
  const idx = PRODUCTS_INDEX_RE.exec(stmt);
  if (idx && !/\bCONCURRENTLY\b/i.test(stmt)) {
    return { kind: 'products_index', sql: raw, name: idx[1].replace(/"/g, '').replace(/^public\./, '') };
  }
  const col = ADD_COLUMN_RE.exec(stmt);
  if (col) return { kind: 'add_column', sql: raw, table: col[1], column: col[2] };
  if (PRODUCTS_BOOT_UNSAFE_RE.test(stmt)) return { kind: 'skip_boot', sql: raw, reason: 'writes to or exclusively locks products' };
  if (DROP_CASCADE_RE.test(stmt)) return { kind: 'skip_boot', sql: raw, reason: 'DROP ... CASCADE' };
  return { kind: 'run', sql: raw };
}
