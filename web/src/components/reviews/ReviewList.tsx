'use client';

import { Loader2, MessageSquareOff } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useReviewsForUser } from '@/hooks/useReviews';
import { REVIEW_DIRECTION } from '@/types';

import { ReviewCard } from './ReviewCard';
import { StarRatingDisplay } from './StarRating';

interface ReviewListProps {
  userId: string;
}

type DirectionFilter = 'all' | 'from_customers' | 'from_providers';

export function ReviewList({ userId }: ReviewListProps) {
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [page, setPage] = useState(1);

  const directionParam =
    directionFilter === 'from_customers'
      ? REVIEW_DIRECTION.CUSTOMER_TO_PROVIDER
      : directionFilter === 'from_providers'
        ? REVIEW_DIRECTION.PROVIDER_TO_CUSTOMER
        : undefined;

  const { data, isLoading, isError } = useReviewsForUser(userId, {
    direction: directionParam,
    page,
    per_page: 10,
  });

  function handleTabChange(value: string) {
    setDirectionFilter(value as DirectionFilter);
    setPage(1);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load reviews. Please try again.
      </div>
    );
  }

  const reviews = data?.reviews ?? [];
  const averageRating = data?.average_rating ?? 0;
  const totalReviews = data?.total_reviews ?? 0;
  const pagination = data?.pagination;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center gap-4">
        <StarRatingDisplay rating={averageRating} size="lg" showValue />
        <span className="text-sm text-muted-foreground">
          {String(totalReviews)} review{totalReviews !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Direction filter tabs */}
      <Tabs value={directionFilter} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="all" className="min-h-[44px]">
            All
          </TabsTrigger>
          <TabsTrigger value="from_customers" className="min-h-[44px]">
            From Customers
          </TabsTrigger>
          <TabsTrigger value="from_providers" className="min-h-[44px]">
            From Providers
          </TabsTrigger>
        </TabsList>

        <TabsContent value={directionFilter} className="mt-4">
          {reviews.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <MessageSquareOff className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
                <p className="mt-4 text-muted-foreground">No reviews yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={() => { setPage(page - 1); }}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {String(page)} of {String(pagination.totalPages)}
          </span>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={() => { setPage(page + 1); }}
            disabled={!pagination.hasNext}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
