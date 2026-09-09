import assert from "node:assert/strict";
import test from "node:test";
import { isInternalPageview } from "@/lib/pageview-internal";

const baseline = {
  pathname: "/best-laptop-deals-singapore",
  isBot: false,
  ip: "203.0.113.24",
  cookieHeader: null,
  referrer: "https://www.google.com/",
};

test("external browser pageview_server traffic is not internal", () => {
  assert.equal(isInternalPageview(baseline), false);
});

test("health pageviews remain internal", () => {
  assert.equal(isInternalPageview({ ...baseline, pathname: "/health" }), true);
});

test("bot pageviews remain internal", () => {
  assert.equal(isInternalPageview({ ...baseline, isBot: true }), true);
});

test("private and loopback IP pageviews remain internal", () => {
  assert.equal(isInternalPageview({ ...baseline, ip: "127.0.0.1" }), true);
  assert.equal(isInternalPageview({ ...baseline, ip: "10.1.2.3" }), true);
  assert.equal(isInternalPageview({ ...baseline, ip: "192.168.0.9" }), true);
  assert.equal(isInternalPageview({ ...baseline, ip: "172.20.1.9" }), true);
});

test("internal cookie pageviews remain internal", () => {
  assert.equal(
    isInternalPageview({ ...baseline, cookieHeader: "session=abc; buywhere_internal=true" }),
    true,
  );
});

test("internal local referrer pageviews remain internal", () => {
  assert.equal(isInternalPageview({ ...baseline, referrer: "http://localhost:3000/admin" }), true);
});
