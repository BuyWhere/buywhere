export type UrlProbeStatus = 'ok' | 'dead' | 'transient';

export interface UrlProbeClassification {
  status: UrlProbeStatus;
  reason: string;
}

export function outboundProbeEnabled(): boolean {
  return process.env.PROBE_OUTBOUND_LINKS === '1' || process.env.PROBE_OUTBOUND_LINKS === 'true';
}

export function liveUrlCondition(alias = 'products'): string {
  return `(${alias}.url_status IS NULL OR ${alias}.url_status <> 'dead')`;
}

export function classifyProbeResult(input: {
  statusCode?: number;
  headers?: Headers | Record<string, string | string[] | undefined>;
  error?: Error;
  timedOut?: boolean;
}): UrlProbeClassification {
  if (input.timedOut) return { status: 'transient', reason: 'timeout' };
  if (input.error) return { status: 'transient', reason: `network_error:${input.error.message.slice(0, 120)}` };

  const code = input.statusCode ?? 0;
  if (code >= 200 && code < 400) return { status: 'ok', reason: `http_${code}` };
  if (code === 408 || code === 409 || code === 425 || code === 429 || code >= 500) {
    return { status: 'transient', reason: `http_${code}` };
  }

  const server = headerValue(input.headers, 'server').toLowerCase();
  const cfRay = headerValue(input.headers, 'cf-ray');
  const akamaiRequestId = headerValue(input.headers, 'akamai-request-id') || headerValue(input.headers, 'x-akamai-request-id');

  if (code === 400 && (server.includes('akamai') || akamaiRequestId)) {
    return { status: 'transient', reason: 'akamai_400' };
  }
  if (code === 403 && (server.includes('cloudflare') || cfRay)) {
    return { status: 'transient', reason: 'cloudflare_403' };
  }
  if (code === 403) return { status: 'transient', reason: 'http_403' };
  if (code === 404 || code === 410) return { status: 'dead', reason: `http_${code}` };
  if (code >= 400 && code < 500) return { status: 'dead', reason: `http_${code}` };

  return { status: 'transient', reason: code ? `http_${code}` : 'unknown' };
}

function headerValue(headers: Headers | Record<string, string | string[] | undefined> | undefined, name: string): string {
  if (!headers) return '';
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) || '';
  const direct = (headers as Record<string, string | string[] | undefined>)[name]
    || (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
  return Array.isArray(direct) ? direct.join(',') : (direct || '');
}
