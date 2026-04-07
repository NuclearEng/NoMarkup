'use client';

import { Plus, Rocket, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import { JobCard } from '@/components/jobs/JobCard';
import { AnimatedIllustration } from '@/components/ui/animated-illustration';
import { Button } from '@/components/ui/button';
import { ContentLoader } from '@/components/ui/content-loader';
import { PageTransition } from '@/components/ui/page-transition';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCustomerJobs, usePublishJob, useDeleteDraft } from '@/hooks/useJobs';
import { JOB_STATUS } from '@/types';

const TABS = [
  { value: 'all', label: 'All', status: undefined },
  { value: 'active', label: 'Active', status: 'active' },
  { value: 'draft', label: 'Drafts', status: 'draft' },
  { value: 'completed', label: 'Completed', status: 'completed' },
  { value: 'cancelled', label: 'Cancelled', status: 'cancelled' },
] as const;

export default function MyJobsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);

  const currentTab = TABS.find((t) => t.value === activeTab);
  const statusFilter = currentTab?.status;

  const { data, isLoading, isError } = useCustomerJobs({
    status: statusFilter,
    page,
    page_size: 12,
  });

  const publishJob = usePublishJob();
  const deleteDraft = useDeleteDraft();

  const totalPages = data?.pagination.totalPages ?? 1;

  function handleTabChange(value: string) {
    setActiveTab(value);
    setPage(1);
  }

  return (
    <PageTransition>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="gold-text text-2xl font-bold tracking-tight">My Jobs</h1>
          <p className="text-sm text-zinc-300">Manage your job postings</p>
        </div>
        <Link href={'/jobs/new' as Route}>
          <Button className="min-h-[44px]">
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Post New Job
          </Button>
        </Link>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="flex-wrap">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="min-h-[44px]"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <ContentLoader preset="job-card" count={6} className="contents" />
              </div>
            ) : isError ? (
              <div className="glass rounded-lg border border-destructive/50 p-8 text-center">
                <p className="text-destructive">Failed to load jobs. Please try again.</p>
              </div>
            ) : !data?.jobs.length ? (
              <div className="glass-empty-state flex flex-col items-center p-8 text-center">
                <AnimatedIllustration
                  type={tab.value === 'all' ? 'no-jobs' : 'search-empty'}
                  size="md"
                />
                <p className="mt-4 text-zinc-300">
                  {tab.value === 'draft'
                    ? 'No drafts yet. Start posting a job to save drafts.'
                    : tab.value === 'all'
                      ? 'You haven\'t posted any jobs yet.'
                      : `No ${tab.label.toLowerCase()} jobs.`}
                </p>
                {tab.value === 'all' || tab.value === 'draft' ? (
                  <Link href={'/jobs/new' as Route}>
                    <Button variant="outline" className="mt-4 min-h-[44px]">
                      <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                      Post Your First Job
                    </Button>
                  </Link>
                ) : null}
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {data.jobs.map((job) => (
                    <div key={job.id} className="flex flex-col">
                      <JobCard job={job} />
                      {job.status === JOB_STATUS.DRAFT ? (
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            className="min-h-[44px] flex-1"
                            disabled={publishJob.isPending}
                            onClick={() => { publishJob.mutate(job.id); }}
                          >
                            <Rocket className="mr-1 h-4 w-4" aria-hidden="true" />
                            {publishJob.isPending ? 'Publishing...' : 'Go Live'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[44px]"
                            disabled={deleteDraft.isPending}
                            onClick={() => { deleteDraft.mutate(job.id); }}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                            <span className="sr-only">Delete draft</span>
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 ? (
                  <nav
                    aria-label="Jobs pagination"
                    className="mt-8 flex items-center justify-center gap-2"
                  >
                    <Button
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => { setPage(page - 1); }}
                      className="min-h-[44px]"
                    >
                      Previous
                    </Button>
                    <span className="px-4 text-sm text-zinc-300">
                      Page {String(page)} of {String(totalPages)}
                    </span>
                    <Button
                      variant="outline"
                      disabled={!data.pagination.hasNext}
                      onClick={() => { setPage(page + 1); }}
                      className="min-h-[44px]"
                    >
                      Next
                    </Button>
                  </nav>
                ) : null}
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
    </PageTransition>
  );
}
