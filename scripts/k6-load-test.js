import http from "k6/http";
export default function () {
  http.get(__ENV.K6_API_BASE_URL + "/health");
}
