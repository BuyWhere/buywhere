import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-static';
export const revalidate = 3600;

// BUY-66281: canonical /.well-known/llms-full.txt per the LLMs-Full-Txt
// proposal (https://llmstxt.org/llms-full-txt/). Both this path and the
// apex /llms-full.txt return 200 with identical bodies (apex is the
// pre-existing fallback kept for back-compat with crawlers that don't
// know the well-known path yet). robots.txt declares this canonical path.
export function GET() {
  const filePath = join(process.cwd(), 'public', 'llms-full.txt');
  let body: string;
  try {
    body = readFileSync(filePath, 'utf-8');
  } catch {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
