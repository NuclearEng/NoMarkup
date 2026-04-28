'use client';

// FollowButton — the Whatnot-style follow toggle. Used on the seller-profile
// page (and reusable inside listing cards / scoreboard rows). Idle state
// is "Follow"; following state is "Following" with a check; on hover the
// label flips to "Unfollow" so the next click feels intentional.
//
// Always stops click propagation so dropping this button into a Link-wrapped
// card row doesn't navigate when the user actually meant to toggle.

import { Check, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useFollow } from '@/hooks/useFollows';
import { cn } from '@/lib/utils';

export interface FollowButtonProps {
  sellerId: string;
  /** Initial follow state — typically pulled from a hydrated profile query. */
  initialFollowing?: boolean;
  /**
   * The currently authenticated user's ID. When equal to `sellerId`, the
   * button renders as disabled with a "This is you" tooltip — the API
   * rejects self-follow at the DB layer, but the UX should never get
   * there in the first place.
   */
  currentUserId?: string;
  /** Optional follower count rendered as a subtle suffix ("Follow · 42"). */
  followerCount?: number;
  /** Tailwind classes merged onto the button. */
  className?: string;
  /** Compact mode renders just the icon + count, no label. */
  compact?: boolean;
}

export function FollowButton({
  sellerId,
  initialFollowing = false,
  currentUserId,
  followerCount,
  className,
  compact = false,
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [hovering, setHovering] = useState(false);
  const { mutate, isPending } = useFollow(sellerId);

  const isSelf = Boolean(currentUserId && currentUserId === sellerId);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    // Defensive: stop propagation so we don't trigger a parent <Link>.
    e.stopPropagation();
    e.preventDefault();
    if (isSelf || isPending) {
      return;
    }
    const next = !following;
    // Optimistic update — server is idempotent so we revert only on error.
    setFollowing(next);
    mutate(
      { following: next },
      {
        onError: () => {
          setFollowing(!next);
        },
      },
    );
  }

  // Label resolution. Idle states:
  //   not following  → "Follow"
  //   following      → "Following" (or "Unfollow" on hover)
  let label: string;
  let icon: React.ReactNode;
  if (!following) {
    label = compact ? '' : 'Follow';
    icon = <UserPlus aria-hidden="true" />;
  } else if (hovering) {
    label = compact ? '' : 'Unfollow';
    icon = <UserMinus aria-hidden="true" />;
  } else {
    label = compact ? '' : 'Following';
    icon = <Check aria-hidden="true" />;
  }

  const count =
    followerCount !== undefined ? (
      <span className="ml-1 text-xs text-zinc-500">{String(followerCount)}</span>
    ) : null;

  if (isSelf) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled
        aria-label="This is your profile"
        className={cn('min-h-[44px]', className)}
      >
        <UserPlus aria-hidden="true" /> {compact ? '' : 'You'}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={following ? 'outline' : 'default'}
      onClick={handleClick}
      onMouseEnter={() => {
        setHovering(true);
      }}
      onMouseLeave={() => {
        setHovering(false);
      }}
      onFocus={() => {
        setHovering(true);
      }}
      onBlur={() => {
        setHovering(false);
      }}
      disabled={isPending}
      aria-pressed={following}
      aria-label={following ? `Unfollow seller` : `Follow seller`}
      className={cn('min-h-[44px]', className)}
    >
      {icon}
      {label ? <span>{label}</span> : null}
      {count}
    </Button>
  );
}
