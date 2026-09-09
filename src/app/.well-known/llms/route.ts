import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-static';
export const revalidate = 3600;

export function GET() {
  const filePath = join(process.cwd(), 'public', 'llms.txt');
  let body;
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
