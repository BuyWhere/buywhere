import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __buywhereAffiliatePool: Pool | undefined;
}

function normalizeDatabaseUrl(rawValue: string) {
  if (rawValue.startsWith("postgresql+asyncpg://")) {
    return `postgresql://${rawValue.slice("postgresql+asyncpg://".length)}`;
  }

  return rawValue;
}

function getDatabaseUrl() {
  const rawValue =
    process.env.BUYWHERE_CATALOG_DATABASE_URL
    ?? process.env.CATALOG_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? "postgresql://buywhere:buywhere@127.0.0.1:5432/catalog";

  const normalized = normalizeDatabaseUrl(rawValue);
  if (normalized.includes("@postgres:")) {
    return normalized.replace("@postgres:", "@127.0.0.1:");
  }

  return normalized;
}

export function getAffiliateAnalyticsPool() {
  if (!global.__buywhereAffiliatePool) {
    global.__buywhereAffiliatePool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 5,
    });
  }

  return global.__buywhereAffiliatePool;
}
