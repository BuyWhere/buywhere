import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";

export interface ContactInquiryRecord {
  company_name: string;
  contact_name: string;
  email: string;
  website: string | null;
  message: string;
  source: string | null;
  created_at: string;
}

type PersistResult = {
  storage: "database" | "file";
  record: ContactInquiryRecord;
};

declare global {
  // eslint-disable-next-line no-var
  var __buywhereContactInquiryPool: Pool | undefined;
}

const FALLBACK_FILE = "/tmp/bw-contact-inquiries.json";
const FALLBACK_CSV_FILE = "/tmp/bw-contact-inquiries.csv";

function normalizeDatabaseUrl(rawValue: string) {
  if (rawValue.startsWith("postgresql+asyncpg://")) {
    return `postgresql://${rawValue.slice("postgresql+asyncpg://".length)}`;
  }

  return rawValue;
}

function getDatabaseUrl() {
  const rawValue =
    process.env.BUYWHERE_CONTACT_DATABASE_URL
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
  if (!global.__buywhereContactInquiryPool) {
    global.__buywhereContactInquiryPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 5,
    });
  }

  return global.__buywhereContactInquiryPool;
}

async function ensureContactsTable() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id BIGSERIAL PRIMARY KEY,
      company_name TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      email TEXT NOT NULL,
      website TEXT,
      message TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function loadFallbackRecords() {
  if (!existsSync(FALLBACK_FILE)) {
    return [] as ContactInquiryRecord[];
  }

  try {
    return JSON.parse(readFileSync(FALLBACK_FILE, "utf-8")) as ContactInquiryRecord[];
  } catch {
    return [];
  }
}

function csvValue(value: string | null) {
  const escaped = (value ?? "").replaceAll('"', '""');
  return `"${escaped}"`;
}

function persistFallbackRecord(record: ContactInquiryRecord) {
  const existing = loadFallbackRecords();
  existing.push(record);

  writeFileSync(FALLBACK_FILE, JSON.stringify(existing, null, 2));
  appendFileSync(
    FALLBACK_CSV_FILE,
    [
      csvValue(record.company_name),
      csvValue(record.contact_name),
      csvValue(record.email),
      csvValue(record.website),
      csvValue(record.message),
      csvValue(record.source),
      csvValue(record.created_at),
    ].join(",") + "\n"
  );
}

export async function persistContactInquiry(
  record: ContactInquiryRecord
): Promise<PersistResult> {
  try {
    await ensureContactsTable();
    const pool = getPool();

    await pool.query(
      `
        INSERT INTO contacts (
          company_name,
          contact_name,
          email,
          website,
          message,
          source,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        record.company_name,
        record.contact_name,
        record.email,
        record.website,
        record.message,
        record.source,
        record.created_at,
      ]
    );

    return {
      storage: "database",
      record,
    };
  } catch (error) {
    console.error("Contact inquiry DB persistence failed, falling back to file storage:", error);
    persistFallbackRecord(record);

    return {
      storage: "file",
      record,
    };
  }
}
