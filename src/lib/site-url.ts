const SITE_ORIGIN = "https://buywhere.ai";

export function toCanonicalPath(path: string): string {
  const url = new URL(path, SITE_ORIGIN);

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function toSiteUrl(path: string): string {
  return new URL(toCanonicalPath(path), SITE_ORIGIN).toString();
}
