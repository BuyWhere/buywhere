import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __buywhere_newsletter_pool: Pool | undefined;
}

function getDatabaseUrl() {
  const raw =
    process.env.BUYWHERE_FEEDBACK_DATABASE_URL ??
    process.env.BUYWHERE_CATALOG_DATABASE_URL ??
    process.env.CATALOG_DATABASE_URL ??
    "postgresql://buywhere:buywhere@127.0.0.1:5432/catalog";
  if (raw.startsWith("postgresql+asyncpg://")) {
    return `postgresql://${raw.slice("postgresql+asyncpg://".length)}`;
  }
  return raw.includes("@postgres:") ? raw.replace("@postgres:", "@127.0.0.1:") : raw;
}

function getPool() {
  if (!global.__buywhere_newsletter_pool) {
    global.__buywhere_newsletter_pool = new Pool({ connectionString: getDatabaseUrl(), max: 3 });
  }
  return global.__buywhere_newsletter_pool;
}

async function ensureTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(email)
    )
  `);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { email, honeypot, source } = body as {
    email?: string;
    honeypot?: string;
    source?: string;
  };

  // Honeypot check — bot prevention
  if (honeypot) {
    return NextResponse.json({ success: true });
  }

  const trimmed = (email ?? "").trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return NextResponse.json({ error: "Valid email required." }, { status: 400 });
  }

  try {
    await ensureTable();
    await getPool().query(
      `INSERT INTO newsletter_subscribers (email, source) VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING`,
      [trimmed, source ?? "homepage_banner"]
    );
  } catch (err) {
    console.error("Newsletter subscribe error:", err);
    return NextResponse.json({ error: "Subscription failed. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: "You're subscribed!" });
}
