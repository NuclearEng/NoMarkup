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
import { reviewDimensionsForDirection } from '@/lib/review-dimensions';
import { reviewSchema, type ReviewFormValues } from '@/lib/validations';
import type { CreateReviewInput } from '@/types';

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

  // FR-6.2: real wire fields by persona (see review-dimensions).
  const dimensions = reviewDimensionsForDirection(direction);

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
      paymentPromptnessRating: undefined,
      scopeAccuracyRating: undefined,
      accessRating: undefined,
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
    // Build POST body from persona dimensions only — never map labels onto
    // shared keys. Customer dims and provider dims are distinct wire fields.
    const input: CreateReviewInput = {
      overall_rating: values.overallRating,
      comment: values.comment,
      photo_urls: photoUrls.length > 0 ? photoUrls : undefined,
    };

    for (const dim of dimensions) {
      const formValue = values[dim.formField];
      if (typeof formValue === 'number' && formValue >= 1) {
        input[dim.wireField] = formValue;
      }
    }

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

            {/* FR-6.2 category sub-ratings — real fields by persona. */}
            <div className="grid gap-4 sm:grid-cols-2">
              {dimensions.map((dim) => (
                <FormField
                  key={dim.key}
                  control={form.control}
                  name={dim.formField}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{dim.label}</FormLabel>
                      <FormControl>
                        <StarRatingInput
                          value={field.value ?? 0}
                          onChange={field.onChange}
                          size="sm"
                          label={dim.a11yLabel}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

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
