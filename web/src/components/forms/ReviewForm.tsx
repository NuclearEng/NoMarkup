'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { StarRatingInput } from '@/components/reviews/StarRating';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCreateReview } from '@/hooks/useReviews';
import { reviewSchema, type ReviewFormValues } from '@/lib/validations';
import type { CreateReviewInput } from '@/types';
import { REVIEW_DIRECTION } from '@/types';

interface ReviewFormProps {
  contractId: string;
  direction: string;
  reviewWindowClosesAt: string;
  onSuccess: () => void;
}

export function ReviewForm({
  contractId,
  direction,
  reviewWindowClosesAt,
  onSuccess,
}: ReviewFormProps) {
  const createReview = useCreateReview();
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState('');

  const isCustomerToProvider = direction === REVIEW_DIRECTION.CUSTOMER_TO_PROVIDER;

  const closesAt = new Date(reviewWindowClosesAt);
  const now = new Date();
  const daysRemaining = Math.max(0, Math.ceil((closesAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  const form = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      overallRating: 0,
      qualityRating: undefined,
      communicationRating: undefined,
      timelinessRating: undefined,
      valueRating: undefined,
      comment: '',
    },
    mode: 'onTouched',
  });

  function handleAddPhoto() {
    const trimmed = newPhotoUrl.trim();
    if (trimmed && !photoUrls.includes(trimmed)) {
      setPhotoUrls([...photoUrls, trimmed]);
      setNewPhotoUrl('');
    }
  }

  function handleRemovePhoto(url: string) {
    setPhotoUrls(photoUrls.filter((u) => u !== url));
  }

  function handleSubmit(values: ReviewFormValues) {
    const input: CreateReviewInput = {
      overall_rating: values.overallRating,
      quality_rating: values.qualityRating,
      communication_rating: values.communicationRating,
      timeliness_rating: values.timelinessRating,
      value_rating: values.valueRating,
      comment: values.comment,
      photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
    };

    createReview.mutate(
      { contractId, input },
      { onSuccess },
    );
  }

  const commentValue = form.watch('comment');

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Leave a Review</h2>
        {daysRemaining > 0 ? (
          <p className="text-sm text-muted-foreground">
            {String(daysRemaining)} day{daysRemaining !== 1 ? 's' : ''} remaining to submit your review
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit(handleSubmit)(e);
            }}
            className="space-y-6"
          >
            {/* Overall Rating */}
            <FormField
              control={form.control}
              name="overallRating"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Overall Rating *</FormLabel>
                  <FormControl>
                    <StarRatingInput
                      value={field.value}
                      onChange={field.onChange}
                      size="lg"
                      label="Overall rating"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Sub-ratings: only shown for customer_to_provider */}
            {isCustomerToProvider ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="qualityRating"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quality</FormLabel>
                      <FormControl>
                        <StarRatingInput
                          value={field.value ?? 0}
                          onChange={field.onChange}
                          size="sm"
                          label="Quality rating"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="communicationRating"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Communication</FormLabel>
                      <FormControl>
                        <StarRatingInput
                          value={field.value ?? 0}
                          onChange={field.onChange}
                          size="sm"
                          label="Communication rating"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="timelinessRating"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timeliness</FormLabel>
                      <FormControl>
                        <StarRatingInput
                          value={field.value ?? 0}
                          onChange={field.onChange}
                          size="sm"
                          label="Timeliness rating"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="valueRating"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Value</FormLabel>
                      <FormControl>
                        <StarRatingInput
                          value={field.value ?? 0}
                          onChange={field.onChange}
                          size="sm"
                          label="Value rating"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : null}

            {/* Comment */}
            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comment *</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={5}
                      maxLength={2000}
                      placeholder="Share your experience working with this person..."
                    />
                  </FormControl>
                  <FormDescription>
                    {String(commentValue.length)}/2000 characters (minimum 50)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Photo URLs */}
            <div className="space-y-3">
              <p className="text-sm font-medium">Photos (optional)</p>
              {photoUrls.length > 0 ? (
                <div className="space-y-2">
                  {photoUrls.map((url) => (
                    <div key={url} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate rounded border bg-muted px-3 py-2 text-sm">
                        {url}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="min-h-[44px] min-w-[44px] shrink-0"
                        onClick={() => { handleRemovePhoto(url); }}
                        aria-label="Remove photo URL"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <Input
                  value={newPhotoUrl}
                  onChange={(e) => { setNewPhotoUrl(e.target.value); }}
                  placeholder="https://example.com/photo.jpg"
                  className="min-h-[44px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px] shrink-0"
                  onClick={handleAddPhoto}
                  disabled={!newPhotoUrl.trim()}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add
                </Button>
              </div>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              className="min-h-[44px] w-full"
              disabled={createReview.isPending}
            >
              {createReview.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Submit Review
            </Button>
            {createReview.isError ? (
              <p className="text-sm text-destructive">
                Failed to submit review. Please try again.
              </p>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
