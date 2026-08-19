import { describe, it, expect } from "vitest";

// BUY-71735: Replicate withAgentAuthHeader from src/middleware.ts so we can
// unit-test it without booting Next.js. Keep this in sync with the middleware.
//
// NOTE: only the X-Agent-* header logic is mirrored here. Bot-classification
// and pathname-normalization are tested in their own dedicated suites (owned
// by the responsible agent for those modules) — co-locating them in this file
// caused conflict with BUY-71746 (Hex) which removed several bot patterns
// from src/middleware.ts.

function withAgentAuthHeader(
  response: { status: number; headers: { get(k: string): string | null; set(k: string, v: string): void } }
): void {
  const status = response.status;
  if (status === 401 || status === 403) {
    response.headers.set(
      "X-Agent-Auth",
      "Bearer; register=https://buywhere.ai/api-keys"
    );
  }

  const existingExpose = response.headers.get("Access-Control-Expose-Headers");
  const allFive = "X-Agent-Protocol, X-Agent-Card, X-LLMs-Txt, X-Agent-Index, X-Agent-Auth";
  if (existingExpose) {
    if (!existingExpose.includes("X-Agent-Protocol")) {
      response.headers.set(
        "Access-Control-Expose-Headers",
        `${existingExpose}, ${allFive}`
      );
    }
  } else {
    response.headers.set("Access-Control-Expose-Headers", allFive);
  }
}

function makeResponse(status: number, initHeaders: Record<string, string> = {}) {
  const map = new Map(Object.entries(initHeaders));
  return {
    status,
    headers: {
      get(k: string) {
        return map.get(k) ?? null;
      },
      set(k: string, v: string) {
        map.set(k, v);
      },
      _dump() {
        return Object.fromEntries(map.entries());
      },
    },
  };
}

describe("withAgentAuthHeader (P2.3 / BUY-71735)", () => {
  it("adds X-Agent-Auth on 401", () => {
    const r = makeResponse(401);
    withAgentAuthHeader(r);
    expect(r.headers.get("X-Agent-Auth")).toBe(
      "Bearer; register=https://buywhere.ai/api-keys"
    );
  });

  it("adds X-Agent-Auth on 403", () => {
    const r = makeResponse(403);
    withAgentAuthHeader(r);
    expect(r.headers.get("X-Agent-Auth")).toBe(
      "Bearer; register=https://buywhere.ai/api-keys"
    );
  });

  it("does NOT add X-Agent-Auth on 200", () => {
    const r = makeResponse(200);
    withAgentAuthHeader(r);
    expect(r.headers.get("X-Agent-Auth")).toBeNull();
  });

  it("adds Access-Control-Expose-Headers listing all 5 headers when missing", () => {
    const r = makeResponse(200);
    withAgentAuthHeader(r);
    const expose = r.headers.get("Access-Control-Expose-Headers");
    expect(expose).toBe(
      "X-Agent-Protocol, X-Agent-Card, X-LLMs-Txt, X-Agent-Index, X-Agent-Auth"
    );
    for (const h of [
      "X-Agent-Protocol",
      "X-Agent-Card",
      "X-LLMs-Txt",
      "X-Agent-Index",
      "X-Agent-Auth",
    ]) {
      expect(expose!.includes(h)).toBe(true);
    }
  });

  it("appends to existing Access-Control-Expose-Headers without duplicating", () => {
    const r = makeResponse(200, {
      "Access-Control-Expose-Headers": "Content-Type, X-Custom-Foo",
    });
    withAgentAuthHeader(r);
    const expose = r.headers.get("Access-Control-Expose-Headers")!;
    // Existing entries preserved
    expect(expose.includes("Content-Type")).toBe(true);
    expect(expose.includes("X-Custom-Foo")).toBe(true);
    // All 5 agent headers added
    for (const h of [
      "X-Agent-Protocol",
      "X-Agent-Card",
      "X-LLMs-Txt",
      "X-Agent-Index",
      "X-Agent-Auth",
    ]) {
      expect(expose.includes(h)).toBe(true);
    }
  });
});