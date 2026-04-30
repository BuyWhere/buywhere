import { Metadata } from 'next';
import { ComparisonPageData, SEOMetadata } from '@/types/compare';
import { fetchComparisonPage, getCanonicalUrl } from '@/lib/api';
import { generateComparePageJSONLD } from '@/lib/jsonld';
import ComparePageClient from './ComparePageClient';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import styles from './page.module.css';

interface ComparePageProps {
  params: Promise<{ slug: string }>;
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://buywhere.ai';

function generateSEOMetadata(data: ComparisonPageData, baseUrl: string): SEOMetadata {
  const retailerNames = data.retailers.slice(0, 3).map((r) => r.retailer_name).join(', ');
  const updatedDate = new Date(data.metadata.updated_at).toISOString().split('T')[0];
  const description = `Find the best price for ${data.product.title}. Compare live prices from ${retailerNames}… updated ${updatedDate}.`;

  return {
    title: `Compare ${data.product.brand} ${data.product.title} prices — BuyWhere`,
    description: description.length > 155 ? description.substring(0, 152) + '...' : description,
    canonical_url: getCanonicalUrl(data.slug, baseUrl),
    og_title: `Compare ${data.product.title} prices — From $${data.lowest_price} across ${data.retailers.length} retailers`,
    og_description: `Compare prices for ${data.product.title} from top retailers. Lowest price: $${data.lowest_price} at ${data.lowest_price_retailer}.`,
    og_image: data.product.image_url,
    twitter_title: `Compare ${data.product.title} prices`,
    twitter_description: `Lowest price: $${data.lowest_price} at ${data.lowest_price_retailer}. Compare prices across ${data.retailers.length} retailers.`,
    twitter_image: data.product.image_url,
  };
}

export async function generateMetadata({ params }: ComparePageProps): Promise<Metadata> {
  const { slug } = await params;

  let data: ComparisonPageData;
  try {
    data = await fetchComparisonPage(slug);
  } catch {
    return {
      title: 'Comparison Page Not Found — BuyWhere',
    };
  }

  const seo = generateSEOMetadata(data, BASE_URL);

  return {
    title: seo.title,
    description: seo.description,
    openGraph: {
      title: seo.og_title,
      description: seo.og_description,
      images: [{ url: seo.og_image, width: 1200, height: 630 }],
      type: 'website',
      url: seo.canonical_url,
      siteName: 'BuyWhere',
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.twitter_title,
      description: seo.twitter_description,
      images: [seo.twitter_image],
    },
    alternates: {
      canonical: seo.canonical_url,
      languages: {
        'en-US': seo.canonical_url,
      },
    },
  };
}

export const revalidate = 900;

export default async function ComparePage({ params }: ComparePageProps) {
  const { slug } = await params;

  let data: ComparisonPageData;
  try {
    data = await fetchComparisonPage(slug);
  } catch (error) {
    return (
      <div className={styles.page}>
        <ErrorState
          title="Failed to load comparison"
          message="We couldn't load the price comparison. Please try again."
        />
      </div>
    );
  }

  if (!data.retailers || data.retailers.length === 0) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="No retailers available"
          message="We don't have price data from any retailers for this product yet. Check back soon!"
        />
      </div>
    );
  }

  const jsonld = generateComparePageJSONLD(data, BASE_URL);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonld) }}
      />

      <ComparePageClient data={data} slug={slug} />
    </>
  );
}