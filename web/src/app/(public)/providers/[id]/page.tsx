'use client';

import { useParams } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { usePublicProviderProfile } from '@/hooks/useProviders';
import { useReviewsForUser } from '@/hooks/useReviews';

export default function ProviderProfilePage() {
  const params = useParams<{ id: string }>();
  const { data: provider, isLoading, isError } = usePublicProviderProfile(params.id);
  const { data: reviewsData } = useReviewsForUser(provider?.user_id ?? '', {
    direction: 'customer_to_provider',
    per_page: 5,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="h-32 animate-pulse rounded-xl border bg-muted" />
          <div className="h-48 animate-pulse rounded-xl border bg-muted" />
          <div className="h-64 animate-pulse rounded-xl border bg-muted" />
        </div>
      </div>
    );
  }

  if (isError || !provider) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-destructive/50 p-8 text-center">
          <p className="text-destructive">Failed to load provider profile.</p>
          <Button
            variant="outline"
            className="mt-4 min-h-[44px]"
            onClick={() => { window.location.reload(); }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const reviews = reviewsData?.reviews ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-bold">
              {(provider.business_name ?? provider.display_name).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold">
                  {provider.business_name ?? provider.display_name}
                </h1>
                {provider.verified ? (
                  <Badge variant="default">Verified</Badge>
                ) : null}
              </div>
              {provider.business_name ? (
                <p className="text-muted-foreground">{provider.display_name}</p>
              ) : null}
              {provider.bio ? (
                <p className="mt-2 text-sm text-muted-foreground">{provider.bio}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                Member since{' '}
                {new Date(provider.member_since).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>
            {provider.trust_score ? (
              <div className="text-center">
                <p className="text-3xl font-bold">{String(provider.trust_score.overall_score)}</p>
                <Badge variant="outline" className="mt-1">
                  {provider.trust_score.tier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </Badge>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{String(provider.jobs_completed)}</p>
            <p className="text-xs text-muted-foreground">Jobs Completed</p>
          </CardContent>
        </Card>
        {provider.review_summary ? (
          <>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">
                  {provider.review_summary.average_rating.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Rating ({String(provider.review_summary.review_count)} reviews)
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">
                  {Math.round(provider.review_summary.on_time_rate * 100)}%
                </p>
                <p className="text-xs text-muted-foreground">On-Time Rate</p>
              </CardContent>
            </Card>
          </>
        ) : null}
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">
              {provider.trust_score ? String(provider.trust_score.overall_score) : '--'}
            </p>
            <p className="text-xs text-muted-foreground">Trust Score</p>
          </CardContent>
        </Card>
      </div>

      {/* Service Categories */}
      {provider.service_categories.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Service Categories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {provider.service_categories.map((cat) => (
                <Badge key={cat.id} variant="secondary">
                  {cat.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Reviews */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Reviews</CardTitle>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => (
                <div key={review.id}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {review.overall_rating.toFixed(1)} stars
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(review.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-sm">{review.comment}</p>
                  {review.response ? (
                    <div className="mt-2 rounded-md bg-muted p-3 text-sm">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Provider Response
                      </p>
                      <p>{review.response.comment}</p>
                    </div>
                  ) : null}
                  <Separator className="mt-4" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
