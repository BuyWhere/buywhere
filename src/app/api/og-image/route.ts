import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const title = searchParams.get('title');

    // If no title parameter, return the static image
    if (!title) {
      const imagePath = join(process.cwd(), 'public', 'og-image.png');
      const imageBuffer = await readFile(imagePath);

      return new NextResponse(imageBuffer, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // Generate dynamic OG image with the title
    const svg = generateOgSvg(title);
    const svgBuffer = Buffer.from(svg);

    return new NextResponse(svgBuffer, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving og-image:', error);
    return new NextResponse('Image not found', { status: 404 });
  }
}

function generateOgSvg(title: string): string {
  // Clean and truncate title if too long
  const cleanTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .slice(0, 60);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#4F46E5"/>
      <stop offset="100%" style="stop-color:#7C3AED"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg-gradient)"/>
  <text x="600" y="200" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="600" fill="white" opacity="0.9" text-anchor="middle">BuyWhere Blog</text>
  <foreignObject x="100" y="250" width="1000" height="300">
    <div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; align-items: center; justify-content: center; height: 100%;">
      <h1 style="font-family: system-ui, -apple-system, sans-serif; font-size: 48px; font-weight: 700; color: white; text-align: center; margin: 0; line-height: 1.2; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">${cleanTitle}</h1>
    </div>
  </foreignObject>
  <text x="600" y="580" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="white" opacity="0.8" text-anchor="middle">buywhere.ai/blog</text>
</svg>`;
}