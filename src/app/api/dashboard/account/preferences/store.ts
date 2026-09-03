import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type EmailAlertFrequency = "instant" | "daily" | "off";

export interface NotificationPreferences {
  email_alert_frequency: EmailAlertFrequency;
  deal_digest: boolean;
}

export const defaultPreferences: NotificationPreferences = {
  email_alert_frequency: "instant",
  deal_digest: false,
};

interface PreferencesStore {
  [developerId: string]: NotificationPreferences;
}

const PREFERENCES_STORE_FILE = "/tmp/bw-developer-preferences.json";

export function getDeveloperPreferencesId(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function readPreferencesStore() {
  if (!existsSync(PREFERENCES_STORE_FILE)) {
    return null;
  }

  try {
    const store = JSON.parse(readFileSync(PREFERENCES_STORE_FILE, "utf-8")) as PreferencesStore;
    return store;
  } catch {
    return null;
  }
}

export function writePreferencesStore(store: PreferencesStore) {
  writeFileSync(PREFERENCES_STORE_FILE, JSON.stringify(store, null, 2));
}

export function getDeveloperPreferences(apiKey: string): NotificationPreferences {
  const developerId = getDeveloperPreferencesId(apiKey);
  const store = readPreferencesStore();

  if (!store || !store[developerId]) {
    return defaultPreferences;
  }

  return store[developerId];
}

export function updateDeveloperPreferences(
  apiKey: string,
  preferences: NotificationPreferences
): NotificationPreferences {
  const developerId = getDeveloperPreferencesId(apiKey);
  const store = readPreferencesStore() ?? {};

  store[developerId] = preferences;
  writePreferencesStore(store);

  return preferences;
}