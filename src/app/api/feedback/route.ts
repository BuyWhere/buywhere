import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

declare global {
  // eslint-disable-next-line no-var
  var __buywhereFeedbackPool: Pool | undefined;
}

const FALLBACK_FILE = "/tmp/bw-feedback.json";

function normalizeDatabaseUrl(rawValue: string) {
  if (rawValue.startsWith("postgresql+asyncpg://")) {
    return `postgresql://${rawValue.slice("postgresql+asyncpg://".length)}`;
  }
  return rawValue;
}

function getDatabaseUrl() {
  const rawValue =
    process.env.BUYWHERE_FEEDBACK_DATABASE_URL
    ?? process.env.BUYWHERE_CATALOG_DATABASE_URL
    ?? process.env.CATALOG_DATABASE_URL
    ?? "postgresql://buywhere:buywhere@127.0.0.1:5432/catalog";

  const normalized = normalizeDatabaseUrl(rawValue);
  if (normalized.includes("@postgres:")) {
    return normalized.replace("@postgres:", "@127.0.0.1:");
  }
  return normalized;
}

function getPool() {
  if (!global.__buywhereFeedbackPool) {
    global.__buywhereFeedbackPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 5,
    });
  }
  return global.__buywhereFeedbackPool;
}

async function ensureFeedbackTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id BIGSERIAL PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

type FeedbackData = {
  name: string | null;
  email: string;
  message: string;
  category: string;
};

function persistFallback(data: FeedbackData) {
  let existing: FeedbackData[] = [];
  if (existsSync(FALLBACK_FILE)) {
    try {
      existing = JSON.parse(readFileSync(FALLBACK_FILE, "utf-8"));
    } catch {
      existing = [];
    }
  }
  existing.push(data);
  writeFileSync(FALLBACK_FILE, JSON.stringify(existing, null, 2));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { name, email, message, category } = body as {
    name?: string | null;
    email?: string | null;
    message?: string | null;
    category?: string | null;
  };

  const trimmedName = (name ?? "").trim() || null;
  const trimmedEmail = (email ?? "").trim().toLowerCase() ?? "";
  const trimmedMessage = (message ?? "").trim() ?? "";
  const trimmedCategory = (category ?? "").trim() || "Other";

  if (!trimmedEmail) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }
  if (!trimmedMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  const validCategories = ["Bug report", "Feature request", "Partnership", "Other"];
  if (!validCategories.includes(trimmedCategory)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  let storage: "database" | "file" = "file";

  try {
    await ensureFeedbackTable();
    const pool = getPool();
    await pool.query(
      `INSERT INTO feedback (name, email, message, category, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [trimmedName, trimmedEmail, trimmedMessage, trimmedCategory, createdAt]
    );
    storage = "database";
  } catch (error) {
    console.error("Feedback DB persistence failed, falling back to file:", error);
    persistFallback({ name: trimmedName, email: trimmedEmail, message: trimmedMessage, category: trimmedCategory });
  }

  return NextResponse.json({
    success: true,
    storage,
    message: "Thank you for your feedback!",
  });
}