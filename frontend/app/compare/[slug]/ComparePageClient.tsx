'use client';

import { useEffect } from 'react';
import { ComparisonPageData } from '@/types/compare';
import { trackComparePageView } from '@/lib/analytics';
import Breadcrumb from '@/components/Breadcrumb';
import HeroBlock from '@/components/HeroBlock';
import PriceTable from '@/components/PriceTable';
import PriceHistorySection from '@/components/PriceHistorySection';
import ExpertSummary from '@/components/ExpertSummary';
import SpecsSection from '@/components/SpecsSection';
import FAQSection from '@/components/FAQSection';
import RelatedComparisons from '@/components/RelatedComparisons';
import Disclosure from '@/components/Disclosure';
import TrustSignals from '@/components/TrustSignals';
import OutOfStockState from '@/components/OutOfStockState';
import LowCoverageState from '@/components/LowCoverageState';
import styles from './page.module.css';

interface ComparePageClientProps {
  data: ComparisonPageData;
  slug: string;
}

export default function ComparePageClient({ data, slug }: ComparePageClientProps) {
  useEffect(() => {
    trackComparePageView({
      slug,
      productId: data.product_id,
      retailerCount: data.retailers.length,
      lowestPrice: data.lowest_price,
    });
  }, [slug, data.product_id, data.retailers.length, data.lowest_price]);

  const inStockCount = data.retailers.filter(r => r.availability === 'in_stock' || r.availability === 'low_stock').length;
  const allOutOfStock = data.retailers.every(r => r.availability === 'out_of_stock');
  const isLowCoverage = data.retailers.length < 3 && !allOutOfStock;

  return (
    <div className={styles.page}>
      <Breadcrumb items={data.breadcrumb} />
      <HeroBlock
        product={data.product}
        lowestPrice={data.lowest_price}
        lowestPriceFormatted={data.lowest_price_formatted}
        lowestPriceRetailer={data.lowest_price_retailer}
        retailerCount={data.retailers.length}
      />
      <TrustSignals
        competitorCount={data.retailers.length - 1}
        lastUpdated={data.metadata.updated_at}
      />
      {allOutOfStock && (
        <OutOfStockState
          productName={data.product.title}
          retailerCount={data.retailers.length}
        />
      )}
      {!allOutOfStock && isLowCoverage && (
        <LowCoverageState
          retailerCount={data.retailers.length}
          productName={data.product.title}
        />
      )}
      <PriceHistorySection productId={parseInt(data.product_id, 10)} />
      <PriceTable
        retailers={data.retailers}
        lowestPrice={data.lowest_price}
        lastUpdated={data.metadata.updated_at}
        slug={slug}
        productId={data.product_id}
      />
      {data.expert_summary && <ExpertSummary summary={data.expert_summary} />}
      <SpecsSection specs={data.product.specs} />
      {data.faq && data.faq.length > 0 && <FAQSection faq={data.faq} />}
      <RelatedComparisons comparisons={data.related_comparisons} />
      <Disclosure updatedAt={data.metadata.updated_at} />
    </div>
  );
}