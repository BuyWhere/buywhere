import { headers } from "next/headers";
import type { NextRequest } from "next/server";

const ADMIN_TOKEN_ENV_KEYS = ["BUYWHERE_ADMIN_TOKEN", "ADMIN_TOKEN"] as const;

function getConfiguredAdminToken() {
  for (const key of ADMIN_TOKEN_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function normalizeIp(value: string | null) {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  if (!first) {
    return null;
  }

  if (first.startsWith("::ffff:")) {
    return first.slice(7);
  }

  return first;
}

function isPrivateIpv4(value: string) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127) {
    return true;
  }

  if (a === 192 && b === 168) {
    return true;
  }

  return a === 172 && b >= 16 && b <= 31;
}

function isLocalIp(value: string | null) {
  const ip = normalizeIp(value);
  if (!ip) {
    return false;
  }

  if (ip === "::1" || ip === "localhost") {
    return true;
  }

  return isPrivateIpv4(ip);
}

function readBearerToken(authHeader: string | null) {
  if (!authHeader) {
    return null;
  }

  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authHeader.slice(7).trim() || null;
}

function isAllowedWithoutToken({
  host,
  forwardedFor,
  realIp,
}: {
  host: string | null;
  forwardedFor: string | null;
  realIp: string | null;
}) {
  const normalizedHost = host?.toLowerCase() ?? "";
  if (
    normalizedHost.startsWith("localhost:")
    || normalizedHost === "localhost"
    || normalizedHost.startsWith("127.0.0.1:")
    || normalizedHost === "127.0.0.1"
  ) {
    return true;
  }

  return isLocalIp(forwardedFor) || isLocalIp(realIp);
}

function isValidAdminToken(candidate: string | null) {
  const configuredToken = getConfiguredAdminToken();
  if (!configuredToken) {
    return false;
  }

  return candidate === configuredToken;
}

export function assertAdminRequest(request: NextRequest) {
  const url = new URL(request.url);

  if (
    isAllowedWithoutToken({
      host: request.headers.get("host"),
      forwardedFor: request.headers.get("x-forwarded-for"),
      realIp: request.headers.get("x-real-ip"),
    })
  ) {
    return;
  }

  const token =
    request.nextUrl.searchParams.get("token")
    ?? request.cookies.get("bw_admin_token")?.value
    ?? request.headers.get("x-admin-key")
    ?? readBearerToken(request.headers.get("authorization"));

  if (isValidAdminToken(token)) {
    return;
  }

  const configuredToken = getConfiguredAdminToken();
  if (!configuredToken) {
    throw new Error(
      "Admin access is restricted to local requests until BUYWHERE_ADMIN_TOKEN or ADMIN_TOKEN is configured.",
    );
  }

  throw new Error(`Missing or invalid admin token for ${url.pathname}.`);
}

export async function assertAdminPageAccess(searchParams?: Record<string, string | string[] | undefined>) {
  const headerStore = await headers();
  const host = headerStore.get("host");
  const forwardedFor = headerStore.get("x-forwarded-for");
  const realIp = headerStore.get("x-real-ip");

  if (isAllowedWithoutToken({ host, forwardedFor, realIp })) {
    return null;
  }

  const rawToken = searchParams?.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  if (isValidAdminToken(token ?? null)) {
    return token ?? null;
  }

  const configuredToken = getConfiguredAdminToken();
  if (!configuredToken) {
    throw new Error(
      "Admin access is restricted to local requests until BUYWHERE_ADMIN_TOKEN or ADMIN_TOKEN is configured.",
    );
  }

  throw new Error("Missing or invalid admin token.");
}
