import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Route } from 'next';

import { PriceHeatMap } from '@/components/maps/PriceHeatMap';
import { Button } from '@/components/ui/button';
import type { PricingData } from '@/hooks/usePricing';
import { serverFetch } from '@/lib/server-fetch';
import { formatCents } from '@/lib/utils';

const API_URL =
  process.env['API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8081';
const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://no-markup.com';

async function fetchCategoryPrices(slug: string): Promise<PricingData[] | null> {
  try {
    const res = await serverFetch(`${API_URL}/api/v1/pricing/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { prices?: PricingData[] | null };
    return body.prices ?? [];
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const prices = await fetchCategoryPrices(slug);
  const name = prices?.[0]?.category_name ?? slug.replace(/-/g, ' ');
  const title = `${name} prices by ZIP — Fair Price Index | NoMarkup`;
  const description = `Completed-job median prices for ${name} by ZIP code. Post a job and let providers compete.`;
  return {
    title,
    description,
    alternates: { canonical: `/pricing/${slug}` },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${SITE_URL}/pricing/${slug}`,
    },
  };
}

export default async function PricingCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const prices = await fetchCategoryPrices(slug);
  if (prices === null) {
    notFound();
  }

  const name = prices[0]?.category_name ?? slug.replace(/-/g, ' ');

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-muted-foreground mb-6 text-sm">
        <Link href={'/pricing' as Route} className="hover:text-foreground min-h-[44px] inline-flex items-center">
          Fair Price Index
        </Link>
        <span className="px-2" aria-hidden="true">
          /
        </span>
        <span className="text-foreground">{name}</span>
      </nav>

      <h1 className="text-3xl font-bold tracking-tight">{name} prices by ZIP</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Completed jobs by ZIP (where we have coordinates).
      </p>

      <div className="mt-8 overflow-hidden rounded-2xl border">
        <PriceHeatMap categorySlug={slug} className="h-[360px]" />
      </div>

      {prices.length === 0 ? (
        <p className="text-muted-foreground mt-8 text-sm">
          No completed-job pricing for this category yet.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Median completed-job prices for {name} by ZIP
            </caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-3 pr-4 font-medium">
                  ZIP
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Median
                </th>
                <th scope="col" className="py-3 pr-4 font-medium">
                  Completed jobs
                </th>
              </tr>
            </thead>
            <tbody>
              {prices.map((row) => (
                <tr key={`${row.category_slug}-${row.zip_code}`} className="border-b last:border-0">
                  <td className="py-3 pr-4 font-mono">{row.zip_code}</td>
                  <td className="py-3 pr-4 tabular-nums">{formatCents(row.median_price_cents)}</td>
                  <td className="py-3 pr-4 tabular-nums">{String(row.completed_jobs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-12">
        <Button asChild className="min-h-[44px]">
          <Link href={'/jobs/new' as Route}>Post a job</Link>
        </Button>
      </div>
    </div>
  );
}
