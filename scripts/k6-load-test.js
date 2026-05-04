import http from "k6/http";
export default function () {
  const base = __ENV.K6_API_BASE_URL || "http://localhost:8000";
  const headers = { "User-Agent": "k6-load-test/1.0" };
  http.get(base + "/health", { headers });
  http.get(base + "/products/search?q=headphones&country=SG&limit=10", { headers });
}
