'use client';

import { AlertTriangle, Flag, Loader2, MessageSquare } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useFlagReview, useRespondToReview } from '@/hooks/useReviews';
import { formatRelativeTime } from '@/lib/utils';
import { reviewResponseSchema } from '@/lib/validations';
import { useAuthStore } from '@/stores/auth-store';
import type { Review } from '@/types';
import { FLAG_REASON, REVIEW_DIRECTION } from '@/types';

import { StarRatingDisplay } from './StarRating';

interface ReviewCardProps {
  review: Review;
}

const FLAG_REASON_LABELS: Record<string, string> = {
  [FLAG_REASON.INAPPROPRIATE]: 'Inappropriate',
  [FLAG_REASON.FAKE]: 'Fake',
  [FLAG_REASON.HARASSMENT]: 'Harassment',
  [FLAG_REASON.SPAM]: 'Spam',
  [FLAG_REASON.IRRELEVANT]: 'Irrelevant',
};

export function ReviewCard({ review }: ReviewCardProps) {
  const user = useAuthStore((state) => state.user);
  const isReviewee = user?.id === review.reviewee_id;
  const canRespond = isReviewee && !review.response;

  const [showResponseForm, setShowResponseForm] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [responseError, setResponseError] = useState<string | null>(null);

  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagReason, setFlagReason] = useState('');

  const respondToReview = useRespondToReview();
  const flagReview = useFlagReview();

  function handleSubmitResponse() {
    const result = reviewResponseSchema.safeParse(responseText);
    if (!result.success) {
      setResponseError(result.error.errors[0]?.message ?? 'Invalid response');
      return;
    }
    setResponseError(null);
    respondToReview.mutate(
      { reviewId: review.id, comment: responseText },
      {
        onSuccess: () => {
          setShowResponseForm(false);
          setResponseText('');
        },
      },
    );
  }

  function handleFlag() {
    if (!flagReason) return;
    flagReview.mutate(
      { reviewId: review.id, reason: flagReason },
      {
        onSuccess: () => {
          setShowFlagForm(false);
          setFlagReason('');
        },
      },
    );
  }

  const directionLabel =
    review.direction === REVIEW_DIRECTION.CUSTOMER_TO_PROVIDER
      ? 'Customer to Provider'
      : 'Provider to Customer';

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Header: reviewer info and timestamp */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {review.reviewer_id.slice(0, 8)}...
            </p>
            <p className="text-xs text-muted-foreground">{directionLabel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {review.is_flagged ? (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                Flagged
              </Badge>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(new Date(review.created_at))}
            </span>
          </div>
        </div>

        {/* Overall rating */}
        <StarRatingDisplay rating={review.overall_rating} size="md" showValue />

        {/* Sub-ratings */}
        {(review.quality_rating ?? review.communication_rating ?? review.timeliness_rating ?? review.value_rating) ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {review.quality_rating ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Quality</span>
                <StarRatingDisplay rating={review.quality_rating} size="sm" />
              </div>
            ) : null}
            {review.communication_rating ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Communication</span>
                <StarRatingDisplay rating={review.communication_rating} size="sm" />
              </div>
            ) : null}
            {review.timeliness_rating ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Timeliness</span>
                <StarRatingDisplay rating={review.timeliness_rating} size="sm" />
              </div>
            ) : null}
            {review.value_rating ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Value</span>
                <StarRatingDisplay rating={review.value_rating} size="sm" />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Comment */}
        <p className="whitespace-pre-wrap text-sm">{review.comment}</p>

        {/* Photo URLs */}
        {review.photo_urls.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {review.photo_urls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline"
              >
                {url.split('/').pop() ?? 'Photo'}
              </a>
            ))}
          </div>
        ) : null}

        {/* Response */}
        {review.response ? (
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              Response from {review.response.responder_id.slice(0, 8)}...
              <span className="ml-auto">
                {formatRelativeTime(new Date(review.response.created_at))}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{review.response.comment}</p>
          </div>
        ) : null}

        {/* Response form */}
        {canRespond ? (
          showResponseForm ? (
            <div className="space-y-3 border-t pt-3">
              <Textarea
                placeholder="Write your response (minimum 10 characters)..."
                value={responseText}
                onChange={(e) => {
                  setResponseText(e.target.value);
                  setResponseError(null);
                }}
                className="min-h-[80px]"
              />
              {responseError ? (
                <p className="text-sm text-destructive">{responseError}</p>
              ) : null}
              <div className="flex gap-3">
                <Button
                  className="min-h-[44px] flex-1"
                  onClick={handleSubmitResponse}
                  disabled={respondToReview.isPending}
                >
                  {respondToReview.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Submit Response
                </Button>
                <Button
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => {
                    setShowResponseForm(false);
                    setResponseText('');
                    setResponseError(null);
                  }}
                  disabled={respondToReview.isPending}
                >
                  Cancel
                </Button>
              </div>
              {respondToReview.isError ? (
                <p className="text-sm text-destructive">
                  Failed to submit response. Please try again.
                </p>
              ) : null}
            </div>
          ) : (
            <Button
              variant="outline"
              className="min-h-[44px]"
              onClick={() => { setShowResponseForm(true); }}
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Respond
            </Button>
          )
        ) : null}

        {/* Flag button */}
        {user && !review.is_flagged && user.id !== review.reviewer_id ? (
          showFlagForm ? (
            <div className="space-y-3 border-t pt-3">
              <div className="flex items-center gap-3">
                <Select value={flagReason} onValueChange={setFlagReason}>
                  <SelectTrigger className="min-h-[44px] flex-1">
                    <SelectValue placeholder="Select reason for flagging" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FLAG_REASON_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="destructive"
                  className="min-h-[44px] shrink-0"
                  onClick={handleFlag}
                  disabled={!flagReason || flagReview.isPending}
                >
                  {flagReview.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Flag
                </Button>
                <Button
                  variant="outline"
                  className="min-h-[44px] shrink-0"
                  onClick={() => {
                    setShowFlagForm(false);
                    setFlagReason('');
                  }}
                  disabled={flagReview.isPending}
                >
                  Cancel
                </Button>
              </div>
              {flagReview.isError ? (
                <p className="text-sm text-destructive">
                  Failed to flag review. Please try again.
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className="flex min-h-[44px] items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => { setShowFlagForm(true); }}
            >
              <Flag className="h-3 w-3" aria-hidden="true" />
              Report
            </button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
