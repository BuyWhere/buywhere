// BUY-65154: deterministic fallback for catalog rows with a confirmed broken
// merchant destination. Keep this list small and remove entries after re-ingest
// fixes the source URL. The redirect route checks these before exposing the
// merchant response to the user. Fallbacks stay on BuyWhere so another merchant
// cannot expose the same rate-limit failure before health checks are available.
export const BROKEN_DESTINATION_FALLBACKS: ReadonlyMap<string, string> = new Map([
  [
    'https://compumarts.com/products/asus-rog-strix-g16-g614pw-ts161w-ryzen-9-8940hx-rtx-5080-16gb-gddr7-1tb-pcie-4-0-nvme-ssd-16-inch-2-5k-300hz-gaming-laptop',
    'https://buywhere.ai/search?q=ASUS%20ROG%20Strix%20G16%20G614PW',
  ],
]);

export function fallbackForBrokenDestination(destinationUrl: string): string | null {
  return BROKEN_DESTINATION_FALLBACKS.get(destinationUrl) || null;
}
