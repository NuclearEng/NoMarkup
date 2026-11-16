'use client';

/**
 * NPSSurvey — post-transaction NPS modal.
 *
 * Mounted by a layout-level container that calls usePendingNPS(); when
 * the response includes ≥1 unanswered survey, the modal renders for the
 * first one. Submitting it dismisses the modal (the pending list
 * invalidates and the next survey, if any, takes its place).
 *
 * Accessibility:
 *   - role="dialog", aria-modal="true", labelled by the heading
 *   - radiogroup of 0..10 score buttons, each 44×44 minimum
 *   - submit/dismiss are both keyboard-reachable and have visible focus
 *   - the comment textarea uses aria-describedby for the helper line
 */

import { useState } from 'react';

import { usePendingNPS, useSubmitNPS } from '@/hooks/useNPS';
import { Button } from '@/components/ui/button';

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function NPSSurvey() {
  const { data } = usePendingNPS();
  const submit = useSubmitNPS();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const pending = data?.pending ?? [];
  const next = pending.find((p) => !dismissed.has(p.id));
  if (!next) return null;

  function dismiss() {
    if (next) {
      setDismissed((prev) => {
        const copy = new Set(prev);
        copy.add(next.id);
        return copy;
      });
      setScore(null);
      setComment('');
    }
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (score === null || !next) return;
    await submit.mutateAsync({ id: next.id, score, comment });
    setScore(null);
    setComment('');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nps-survey-title"
    >
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="w-full max-w-lg rounded-lg border border-white/10 bg-zinc-900 p-6 shadow-xl"
      >
        <h2 id="nps-survey-title" className="text-lg font-semibold text-white">
          How was your experience?
        </h2>
        <p className="mt-1 text-sm text-white/70">
          On a scale of 0–10, how likely are you to recommend NoMarkup to a friend?
        </p>

        <div
          role="radiogroup"
          aria-labelledby="nps-survey-title"
          className="mt-4 grid grid-cols-6 gap-2 md:grid-cols-11"
        >
          {SCORES.map((n) => {
            const selected = score === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setScore(n);
                }}
                className={
                  'inline-flex h-11 min-w-[44px] items-center justify-center rounded-md border text-sm font-medium transition-all ' +
                  (selected
                    ? 'border-white bg-white text-zinc-900'
                    : 'border-white/20 bg-white/5 text-white/80 hover:bg-white/10')
                }
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-xs text-white/50">
          <span>Not likely</span>
          <span>Extremely likely</span>
        </div>

        <div className="mt-4">
          <label htmlFor="nps-comment" className="text-sm text-white/80">
            Anything you'd like us to know? (optional)
          </label>
          <textarea
            id="nps-comment"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
            }}
            rows={3}
            maxLength={1000}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 p-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40"
            aria-describedby="nps-comment-help"
          />
          <p id="nps-comment-help" className="mt-1 text-xs text-white/50">
            Up to 1,000 characters.
          </p>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={dismiss}
            className="min-h-[44px]"
          >
            Maybe later
          </Button>
          <Button
            type="submit"
            disabled={score === null || submit.isPending}
            className="min-h-[44px]"
          >
            {submit.isPending ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </form>
    </div>
  );
}
