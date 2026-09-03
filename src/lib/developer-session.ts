"use client";

export async function persistDeveloperSession(apiKey: string) {
  window.localStorage.setItem("bw_api_key", apiKey);

  await fetch("/api/dashboard/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
  });
}

export async function clearDeveloperSession() {
  window.localStorage.removeItem("bw_api_key");

  await fetch("/api/dashboard/session", {
    method: "DELETE",
  });
}
