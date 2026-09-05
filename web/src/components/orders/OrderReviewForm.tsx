'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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
import { Textarea } from '@/components/ui/textarea';
import { useCreateListingOrderReview } from '@/hooks/useOrderReviews';

const orderReviewSchema = z.object({
  overallRating: z.number().int().min(1, 'Select a rating').max(5),
  comment: z
    .string()
    .max(2000, 'Comment must be at most 2000 characters')
    .optional()
    .default(''),
});

type OrderReviewFormValues = z.infer<typeof orderReviewSchema>;

interface OrderReviewFormProps {
  orderId: string;
  /** Who the current user is reviewing (other party). */
  revieweeLabel: string;
  reviewWindowClosesAt?: string;
  onSuccess?: () => void;
}

export function OrderReviewForm({
  orderId,
  revieweeLabel,
  reviewWindowClosesAt,
  onSuccess,
}: OrderReviewFormProps) {
  const createReview = useCreateListingOrderReview();

  let daysRemaining: number | null = null;
  if (reviewWindowClosesAt) {
    const closesAt = new Date(reviewWindowClosesAt);
    daysRemaining = Math.max(
      0,
      Math.ceil((closesAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
  }

  const form = useForm<OrderReviewFormValues>({
    resolver: zodResolver(orderReviewSchema),
    defaultValues: {
      overallRating: 0,
      comment: '',
    },
    mode: 'onTouched',
  });

  function handleSubmit(values: OrderReviewFormValues) {
    createReview.mutate(
      {
        orderId,
        input: {
          overall_rating: values.overallRating,
          comment: values.comment?.trim() ?? '',
        },
      },
      { onSuccess },
    );
  }

  return (
    <Card variant="glass">
      <CardHeader>
        <h2 className="text-lg font-semibold text-zinc-100">Leave a review</h2>
        <p className="text-sm text-muted-foreground">
          Rate your experience with {revieweeLabel}. Overall rating only (1–5).
        </p>
        {daysRemaining !== null && daysRemaining > 0 ? (
          <p className="text-sm text-muted-foreground">
            {String(daysRemaining)} day{daysRemaining !== 1 ? 's' : ''} remaining to submit
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
            <FormField
              control={form.control}
              name="overallRating"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Overall rating *</FormLabel>
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

            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comment (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      maxLength={2000}
                      placeholder="What went well or what could be better?"
                      className="min-h-[100px]"
                      aria-label="Review comment"
                    />
                  </FormControl>
                  <FormDescription>Optional, up to 2000 characters.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={createReview.isPending || form.watch('overallRating') < 1}
              className="min-h-[48px] w-full"
            >
              {createReview.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Submitting…
                </>
              ) : (
                'Submit review'
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
