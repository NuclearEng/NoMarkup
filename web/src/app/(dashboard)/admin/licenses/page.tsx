'use client';

import { Scale } from 'lucide-react';
import Link from 'next/link';

import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageTransition } from '@/components/ui/page-transition';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ADMIN_LICENSE_FILTER,
  LICENSE_STATUS,
  LICENSE_TYPE,
  useAdminLicenses,
  useReviewLicense,
} from '@/hooks/useProviderLicenses';
import type {
  AdminLicense,
  AdminLicenseFilter,
  LicenseStatus,
  LicenseType,
} from '@/hooks/useProviderLicenses';
import type { BadgeProps } from '@/components/ui/badge';
import { useState } from 'react';

const FILTER_TABS: { value: AdminLicenseFilter; label: string }[] = [
  { value: ADMIN_LICENSE_FILTER.PENDING, label: 'Pending' },
  { value: ADMIN_LICENSE_FILTER.VERIFIED, label: 'Verified' },
  { value: ADMIN_LICENSE_FILTER.REJECTED, label: 'Rejected' },
  { value: ADMIN_LICENSE_FILTER.ALL, label: 'All' },
];

const LICENSE_TYPE_LABELS: Record<LicenseType, string> = {
  [LICENSE_TYPE.BAR]: 'Bar license',
};

const STATUS_BADGE_VARIANT: Record<LicenseStatus, BadgeProps['variant']> = {
  [LICENSE_STATUS.PENDING]: 'outline',
  [LICENSE_STATUS.VERIFIED]: 'default',
  [LICENSE_STATUS.REJECTED]: 'destructive',
};

const STATUS_LABELS: Record<LicenseStatus, string> = {
  [LICENSE_STATUS.PENDING]: 'Pending',
  [LICENSE_STATUS.VERIFIED]: 'Verified',
  [LICENSE_STATUS.REJECTED]: 'Rejected',
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function LicenseRow({ license }: { license: AdminLicense }) {
  const review = useReviewLicense();
  const isPending = license.status === LICENSE_STATUS.PENDING;

  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="px-3 py-3 align-top">
        <Link
          href={`/admin/users/${license.provider_id}`}
          className="font-mono text-xs text-[var(--brand-gold)] underline-offset-2 hover:underline focus-visible:underline"
        >
          {license.provider_id}
        </Link>
      </td>
      <td className="px-3 py-3 align-top text-zinc-100">
        {LICENSE_TYPE_LABELS[license.license_type]}
      </td>
      <td className="px-3 py-3 align-top font-mono text-zinc-100">
        {license.license_number}
      </td>
      <td className="px-3 py-3 align-top text-zinc-100">{license.jurisdiction}</td>
      <td className="px-3 py-3 align-top text-zinc-300">
        {formatDate(license.created_at)}
      </td>
      <td className="px-3 py-3 align-top">
        {isPending ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="min-h-[44px]"
              disabled={review.isPending}
              aria-label={`Verify ${license.license_type} license for provider ${license.provider_id}`}
              onClick={() => {
                review.mutate({ id: license.id, status: LICENSE_STATUS.VERIFIED });
              }}
            >
              Verify
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="min-h-[44px]"
              disabled={review.isPending}
              aria-label={`Reject ${license.license_type} license for provider ${license.provider_id}`}
              onClick={() => {
                review.mutate({ id: license.id, status: LICENSE_STATUS.REJECTED });
              }}
            >
              Reject
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Badge
              variant={STATUS_BADGE_VARIANT[license.status]}
              className="w-fit text-xs"
            >
              {STATUS_LABELS[license.status]}
            </Badge>
            {license.verified_at ? (
              <span className="text-xs text-zinc-400">
                {formatDate(license.verified_at)}
              </span>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function AdminLicensesPage() {
  const [filter, setFilter] = useState<AdminLicenseFilter>(
    ADMIN_LICENSE_FILTER.PENDING,
  );
  const { data, isLoading, isError, refetch } = useAdminLicenses(filter);
  const licenses = data?.licenses ?? [];

  return (
    <PageTransition>
      <div className="space-y-6">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">
            Professional Licenses
          </h1>
          <p className="mt-1 text-zinc-300">
            Review and verify the bar (and other professional) licenses providers
            submit for the legal services vertical.
          </p>
        </div>

        <Tabs
          value={filter}
          onValueChange={(v) => {
            setFilter(v as AdminLicenseFilter);
          }}
        >
          <TabsList aria-label="Filter licenses by status">
            {FILTER_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading ? (
          <Card className="glass border border-[var(--brand-gold)]/10">
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ) : isError ? (
          <EmptyState
            icon={<AnimatedIllustration type="error" size="sm" />}
            title="Failed to load licenses"
            description="Please try again."
            action={
              <Button
                variant="outline"
                className="min-h-[44px]"
                onClick={() => {
                  void refetch();
                }}
              >
                Retry
              </Button>
            }
          />
        ) : licenses.length === 0 ? (
          <EmptyState
            icon={<Scale className="h-10 w-10 text-zinc-500" aria-hidden="true" />}
            title="No licenses to review"
            description="There are no licenses matching this filter."
          />
        ) : (
          <Card className="glass glass-highlight border border-[var(--brand-gold)]/10">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-zinc-400">
                      <th scope="col" className="px-3 py-3 font-medium">
                        Provider
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        Type
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        License number
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        Jurisdiction
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        Submitted
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {licenses.map((license) => (
                      <LicenseRow key={license.id} license={license} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageTransition>
  );
}
