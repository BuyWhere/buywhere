import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { Pool } from "pg";
import {
  type UpgradeIntentUseCase,
} from "@/lib/upgrade-intent-schema";

export interface UpgradeIntentRecord {
  email: string;
  name: string;
  company: string | null;
  use_case: UpgradeIntentUseCase;
  created_at: string;
}

type PersistResult = {
  storage: "database" | "file";
  record: UpgradeIntentRecord;
};

declare global {
  // eslint-disable-next-line no-var
  var __buywhereUpgradeIntentPool: Pool | undefined;
}

const FALLBACK_FILE = "/tmp/bw-upgrade-intents.json";
const FALLBACK_CSV_FILE = "/tmp/bw-upgrade-intents.csv";

function normalizeDatabaseUrl(rawValue: string) {
  if (rawValue.startsWith("postgresql+asyncpg://")) {
    return `postgresql://${rawValue.slice("postgresql+asyncpg://".length)}`;
  }

  return rawValue;
}

function getDatabaseUrl() {
  const rawValue =
    process.env.BUYWHERE_UPGRADE_INTENT_DATABASE_URL
    ?? process.env.BUYWHERE_CATALOG_DATABASE_URL
    ?? process.env.CATALOG_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? "postgresql://buywhere:buywhere@127.0.0.1:5432/catalog";

  const normalized = normalizeDatabaseUrl(rawValue);
  if (normalized.includes("@postgres:")) {
    return normalized.replace("@postgres:", "@127.0.0.1:");
  }

  return normalized;
}

function getPool() {
  if (!global.__buywhereUpgradeIntentPool) {
    global.__buywhereUpgradeIntentPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 5,
    });
  }

  return global.__buywhereUpgradeIntentPool;
}

async function ensureUpgradeIntentsTable() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS upgrade_intents (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT,
      use_case TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function loadFallbackRecords() {
  if (!existsSync(FALLBACK_FILE)) {
    return [] as UpgradeIntentRecord[];
  }

  try {
    return JSON.parse(readFileSync(FALLBACK_FILE, "utf-8")) as UpgradeIntentRecord[];
  } catch {
    return [];
  }
}

function persistFallbackRecord(record: UpgradeIntentRecord) {
  const existing = loadFallbackRecords();
  const next = existing.filter((entry) => entry.email !== record.email);
  next.push(record);

  writeFileSync(FALLBACK_FILE, JSON.stringify(next, null, 2));
  appendFileSync(
    FALLBACK_CSV_FILE,
    `${record.email},${record.name},${record.company ?? ""},${record.use_case},${record.created_at}\n`
  );
}

export async function persistUpgradeIntent(
  record: UpgradeIntentRecord
): Promise<PersistResult> {
  try {
    await ensureUpgradeIntentsTable();
    const pool = getPool();

    await pool.query(
      `
        INSERT INTO upgrade_intents (email, name, company, use_case, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (email)
        DO UPDATE SET
          name = EXCLUDED.name,
          company = EXCLUDED.company,
          use_case = EXCLUDED.use_case,
          created_at = EXCLUDED.created_at
      `,
      [
        record.email,
        record.name,
        record.company,
        record.use_case,
        record.created_at,
      ]
    );

    return {
      storage: "database",
      record,
    };
  } catch (error) {
    console.error("Upgrade intent DB persistence failed, falling back to file storage:", error);
    persistFallbackRecord(record);

    return {
      storage: "file",
      record,
    };
  }
}
