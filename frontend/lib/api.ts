import { ComparisonPageData } from '@/types/compare';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

export async function fetchComparisonPage(slug: string): Promise<ComparisonPageData> {
  const response = await fetch(`${API_BASE_URL}/compare/${encodeURIComponent(slug)}`, {
    next: {
      revalidate: 900,
    },
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Comparison page not found');
    }
    throw new Error(`Failed to fetch comparison page: ${response.statusText}`);
  }

  return response.json();
}

export function getComparePageUrl(slug: string): string {
  return `/compare/${slug}`;
}

export function getCanonicalUrl(slug: string, baseUrl: string = 'https://buywhere.ai'): string {
  return `${baseUrl}/compare/${slug}`;
}