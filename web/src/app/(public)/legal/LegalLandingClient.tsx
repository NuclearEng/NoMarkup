'use client';

import { ArrowRight, Gavel, Scale, ShieldCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useId, useMemo, useState } from 'react';

import { JobCard } from '@/components/jobs/JobCard';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCategoryTree } from '@/hooks/useCategories';
import { useSearchJobs } from '@/hooks/useJobs';
import type { JobsResponse } from '@/types';

// Sentinel value for the "all practice areas" option. The shadcn Select can't
// use an empty-string value, so we use an explicit token and translate it back
// to "no practice-area filter" (browse the whole legal subtree) on change.
const ALL_PRACTICE_AREAS = 'all';

interface LegalLandingClientProps {
  /** Server-fetched first page of open legal jobs — seeds the browse list so
   *  first paint renders real data (no skeleton). */
  initialJobs: JobsResponse;
  /** The resolved legal category id (subtree root), if found. Drives both the
   *  browse query and the pre-filtered post-job CTA. */
  legalCategoryId: string | null;
}

const HOW_IT_WORKS = [
  {
    title: 'Describe your case',
    body: 'Post the legal help you need — contracts, an LLC, a will, a dispute. It takes a minute.',
  },
  {
    title: 'Lawyers compete',
    body: 'Licensed attorneys place competing reverse-auction bids. The market sets the price — you watch it live.',
  },
  {
    title: 'Pick your lawyer',
    body: 'Compare bids, bar verification, and reviews. Hire with funds held safely in escrow.',
  },
] as const;

export function LegalLandingClient({ initialJobs, legalCategoryId }: LegalLandingClientProps) {
  const practiceAreaSelectId = useId();

  // The practice-area dropdown is sourced from the canonical legal subcategories
  // (level-2 children of the `legal` root) — the same set the intake form posts
  // jobs under, so every selectable area maps to jobs that can actually exist.
  // We deliberately don't invent areas of law that have no category, which would
  // filter to an empty list. Because the jobs search expands a category to its
  // whole subtree, selecting a matter type also surfaces its level-3 jobs.
  const { data: tree } = useCategoryTree();
  const practiceAreas = useMemo(() => {
    const legalRoot = tree?.find((c) => c.slug === 'legal');
    return legalRoot?.children ?? [];
  }, [tree]);

  // Selected practice area (a legal subcategory id), or the ALL sentinel.
  const [practiceArea, setPracticeArea] = useState<string>(ALL_PRACTICE_AREAS);

  // The effective category filter: a specific subcategory when chosen, otherwise
  // the legal subtree root (browse all open legal cases).
  const filterCategoryId =
    practiceArea === ALL_PRACTICE_AREAS ? legalCategoryId : practiceArea;

  // Only the unfiltered (root) view matches the server-seeded first page, so we
  // gate initialData on that to avoid showing root results under a narrowed
  // filter. Distinct params key a distinct cache entry, so the filtered query
  // fetches fresh and the root view stays instant.
  const isRootView = practiceArea === ALL_PRACTICE_AREAS;

  // Browse the open legal jobs. Seeded from the server fetch so the first paint
  // is real content. Only enabled query params the legal vertical needs.
  const { data, isLoading, isError, refetch } = useSearchJobs(
    {
      page: 1,
      page_size: 12,
      ...(filterCategoryId ? { category_id: filterCategoryId } : {}),
    },
    // Seed the cache with the server-fetched first page so SSR and the client's
    // first paint render identical data (no skeleton flash, no immediate
    // refetch). Mirrors the marketplace browse island. Only seed the root view.
    isRootView ? { initialData: initialJobs } : undefined,
  );

  const jobs = data?.jobs ?? (isRootView ? initialJobs.jobs : []);

  // The post-job CTA goes to the dedicated, legal-tailored intake form (not the
  // generic 3-level service-category wizard). The form picks the legal matter
  // type itself, so no category_id needs to be passed.
  const postJobHref = '/jobs/new/legal' as Route;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="animate-fade-in-up mb-14 text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-gold)]/10 text-[var(--brand-gold)]">
          <Scale className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-100 sm:text-5xl">
          Lawyers compete for <span className="gold-text">your case</span>
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-300">
          Post your legal need and let licensed attorneys compete. Fair market rates — not the
          markup, not inflated retainers. Prices go down as they bid.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="min-h-[44px]">
            <Link href={postJobHref}>
              Post a legal job
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="min-h-[44px]">
            <Link href="#open-cases">Browse open cases</Link>
          </Button>
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-zinc-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          Every attorney&apos;s bar license is verified before they can bid.
        </p>
      </section>

      {/* How it works */}
      <section className="mb-16" aria-labelledby="how-it-works-heading">
        <h2
          id="how-it-works-heading"
          className="mb-6 text-center text-2xl font-bold text-zinc-100"
        >
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step, idx) => (
            <li
              key={step.title}
              className="glass glass-highlight rounded-xl border border-[var(--brand-gold)]/10 p-6"
            >
              <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-gold)]/10 text-sm font-bold text-[var(--brand-gold)]">
                {idx + 1}
              </span>
              <h3 className="text-base font-semibold text-zinc-100">{step.title}</h3>
              <p className="mt-1.5 text-sm text-zinc-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Open legal cases */}
      <section id="open-cases" aria-labelledby="open-cases-heading" className="scroll-mt-20">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="open-cases-heading" className="text-2xl font-bold text-zinc-100">
            Open legal cases
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            {practiceAreas.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={practiceAreaSelectId}
                  className="text-sm font-medium text-zinc-300"
                >
                  Practice area
                </label>
                <Select value={practiceArea} onValueChange={setPracticeArea}>
                  <SelectTrigger
                    id={practiceAreaSelectId}
                    className="min-h-[44px] w-56"
                    aria-label="Filter open legal cases by practice area"
                  >
                    <SelectValue placeholder="All practice areas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_PRACTICE_AREAS}>All practice areas</SelectItem>
                    {practiceAreas.map((area) => (
                      <SelectItem key={area.id} value={area.id}>
                        {area.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <Button asChild variant="ghost" className="min-h-[44px]">
              <Link href={'/jobs' as Route}>
                See all jobs
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        {isLoading && jobs.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={`skeleton-${String(i)}`}
                className="glass glass-highlight h-48 animate-pulse rounded-xl border border-[var(--brand-gold)]/10"
              />
            ))}
          </div>
        ) : isError && jobs.length === 0 ? (
          <EmptyState
            icon={<Gavel className="h-8 w-8" aria-hidden="true" />}
            title="Couldn't load legal cases"
            description="Something went wrong fetching open legal jobs. Try again."
            action={
              <Button
                className="min-h-[44px]"
                onClick={() => {
                  void refetch();
                }}
              >
                Retry
              </Button>
            }
          />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<Scale className="h-8 w-8" aria-hidden="true" />}
            title="No open legal cases right now"
            description="Be the first — post a legal job and let attorneys compete for it."
            action={
              <Button asChild className="min-h-[44px]">
                <Link href={postJobHref}>Post a legal job</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
