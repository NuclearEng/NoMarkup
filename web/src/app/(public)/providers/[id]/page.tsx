'use client';

import { useParams } from 'next/navigation';

import { ResponseTimeBadge } from '@/components/providers/ResponseTimeBadge';
import { VerifiedBarBadge } from '@/components/providers/VerifiedBarBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FollowButton } from '@/components/users/FollowButton';
import { usePublicProviderProfile } from '@/hooks/useProviders';
import { useReviewsForUser } from '@/hooks/useReviews';
import { useAuthStore } from '@/stores/auth-store';

export default function ProviderProfilePage() {
  const params = useParams<{ id: string }>();
  const { data: provider, isLoading, isError, refetch } = usePublicProviderProfile(params.id);
  // Resolve the signed-in user (client-side store, no network) so
  // FollowButton's self-guard can fire. Logged-out visitors get undefined.
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data: reviewsData } = useReviewsForUser(provider?.user_id ?? '', {
    direction: 'customer_to_provider',
    per_page: 5,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="glass glass-highlight h-32 animate-pulse rounded-xl border border-[var(--brand-gold)]/10" />
          <div className="glass glass-highlight h-24 animate-pulse rounded-xl border border-[var(--brand-gold)]/10" />
          <div className="glass glass-highlight h-64 animate-pulse rounded-xl border border-[var(--brand-gold)]/10" />
        </div>
      </div>
    );
  }

  if (isError || !provider) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="glass glass-highlight rounded-xl border border-red-500/20 p-8 text-center">
          <p className="text-red-400">Failed to load provider profile.</p>
          <Button
            variant="outline"
            className="mt-4 min-h-[44px] border-[var(--brand-gold)]/15 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
            onClick={() => { void refetch(); }}
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
      {/* Hero / header */}
      <div className="glass glass-highlight mb-6 rounded-xl border border-[var(--brand-gold)]/10 p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* Avatar */}
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--brand-gold)]/10 text-2xl font-bold text-[var(--brand-gold)]">
            {(provider.business_name ?? provider.display_name).charAt(0).toUpperCase()}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="gold-text text-2xl font-bold">
                {provider.business_name ?? provider.display_name}
              </h1>
              {provider.verified ? (
                <Badge className="border-[var(--brand-gold)]/20 bg-[var(--brand-gold)]/10 text-xs text-[var(--brand-gold)]">
                  Verified
                </Badge>
              ) : null}
              <VerifiedBarBadge providerId={provider.id} />
            </div>
            {provider.business_name ? (
              <p className="text-zinc-400">{provider.display_name}</p>
            ) : null}
            {provider.bio ? (
              <p className="mt-2 text-sm text-zinc-300">{provider.bio}</p>
            ) : null}
            <p className="mt-1 text-xs text-zinc-500">
              Member since{' '}
              {new Date(provider.member_since).toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </p>
            {provider.response_time_label ? (
              <div className="mt-2">
                <ResponseTimeBadge label={provider.response_time_label} />
              </div>
            ) : null}
            {provider.user_id ? (
              <div className="mt-3">
                <FollowButton
                  sellerId={provider.user_id}
                  initialFollowing={provider.is_following ?? false}
                  followerCount={provider.follower_count}
                  currentUserId={currentUserId}
                />
              </div>
            ) : null}
          </div>

          {/* Trust score — prominent gold accent. overall_score is 0.0-1.0;
              display as a 0-100 composite (matches BidCard / TrustScoreBadge). */}
          {provider.trust_score ? (
            <div className="flex flex-col items-center gap-1 rounded-xl border border-[var(--brand-gold)]/15 bg-[var(--brand-gold)]/5 px-5 py-3 text-center">
              <p className="text-3xl font-bold text-[var(--brand-gold)]">
                {Math.round(provider.trust_score.overall_score * 100)}
              </p>
              <p className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">Trust Score</p>
              <Badge className="mt-0.5 border-[var(--brand-gold)]/20 bg-[var(--brand-gold)]/10 text-xs text-[var(--brand-gold)]">
                {provider.trust_score.tier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </Badge>
            </div>
          ) : null}
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass glass-highlight rounded-xl border border-[var(--brand-gold)]/10 p-4 text-center">
          <p className="text-2xl font-bold text-zinc-100">{String(provider.jobs_completed)}</p>
          <p className="text-xs text-zinc-500">Jobs Completed</p>
        </div>
        {provider.review_summary ? (
          <>
            <div className="glass glass-highlight rounded-xl border border-[var(--brand-gold)]/10 p-4 text-center">
              <p className="text-2xl font-bold text-zinc-100">
                {provider.review_summary.average_rating.toFixed(1)}
              </p>
              <p className="text-xs text-zinc-500">
                Rating ({String(provider.review_summary.review_count)})
              </p>
            </div>
            <div className="glass glass-highlight rounded-xl border border-[var(--brand-gold)]/10 p-4 text-center">
              <p className="text-2xl font-bold text-zinc-100">
                {Math.round(provider.review_summary.on_time_rate * 100)}%
              </p>
              <p className="text-xs text-zinc-500">On-Time Rate</p>
            </div>
          </>
        ) : null}
        <div className="glass glass-highlight rounded-xl border border-[var(--brand-gold)]/10 p-4 text-center">
          <p className="text-2xl font-bold text-[var(--brand-gold)]">
            {provider.trust_score ? Math.round(provider.trust_score.overall_score * 100) : '--'}
          </p>
          <p className="text-xs text-zinc-500">Trust Score</p>
        </div>
      </div>

      {/* Service Categories */}
      {provider.service_categories.length > 0 ? (
        <div className="glass glass-highlight mb-6 rounded-xl border border-[var(--brand-gold)]/10 p-5">
          <h2 className="mb-3 text-base font-semibold text-zinc-200">Service Categories</h2>
          <div className="flex flex-wrap gap-2">
            {provider.service_categories.map((cat) => (
              <Badge key={cat.id} className="border-white/10 bg-white/[0.06] text-zinc-300">
                {cat.name}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {/* Reviews */}
      <div className="glass glass-highlight rounded-xl border border-[var(--brand-gold)]/10 p-5">
        <h2 className="mb-4 text-base font-semibold text-zinc-200">Reviews</h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-zinc-500">No reviews yet.</p>
        ) : (
          <div className="space-y-5">
            {reviews.map((review, idx) => (
              <div key={review.id}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--brand-gold)]">
                      {review.overall_rating.toFixed(1)} ★
                    </span>
                    <span className="text-xs text-zinc-500">
                      {new Date(review.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 text-sm text-zinc-300">{review.comment}</p>
                {review.response ? (
                  <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-sm">
                    <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                      Provider Response
                    </p>
                    <p className="text-zinc-400">{review.response.comment}</p>
                  </div>
                ) : null}
                {idx < reviews.length - 1 ? (
                  <div className="glass-divider mt-4" />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
