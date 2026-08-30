import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  try {
    const imagePath = join(process.cwd(), 'public', 'og-image.png');
    const imageBuffer = await readFile(imagePath);
    
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving og-image:', error);
    return new NextResponse('Image not found', { status: 404 });
}
}