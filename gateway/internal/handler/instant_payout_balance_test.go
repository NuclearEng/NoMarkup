package handler

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

// TestNetInstantPayoutAvailableCents pins the money-critical formula: a
// provider's withdrawable balance is gross cleared earnings MINUS everything
// already instant-paid-out. This is the bug under repair — the old code used the
// gross sum and never subtracted prior payouts, so a provider could withdraw the
// same cleared earnings repeatedly.
func TestNetInstantPayoutAvailableCents(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		grossEligible int64
		priorPaidOut  int64
		want          int64
	}{
		{
			// The PROVEN production case: provider 0003 earned $1,620 and has
			// already instant-paid-out $200 → only $1,420 is withdrawable.
			name:          "proven case provider 0003",
			grossEligible: 162_000,
			priorPaidOut:  20_000,
			want:          142_000,
		},
		{name: "nothing paid out yet", grossEligible: 50_000, priorPaidOut: 0, want: 50_000},
		{name: "fully withdrawn", grossEligible: 50_000, priorPaidOut: 50_000, want: 0},
		{name: "over-withdrawn goes negative", grossEligible: 50_000, priorPaidOut: 60_000, want: -10_000},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := netInstantPayoutAvailableCents(tc.grossEligible, tc.priorPaidOut)
			if got != tc.want {
				t.Fatalf("netInstantPayoutAvailableCents(%d, %d) = %d, want %d",
					tc.grossEligible, tc.priorPaidOut, got, tc.want)
			}
		})
	}
}

// TestInstantPayoutWithdrawalCap proves the core invariant the fix enforces: a
// provider with gross-eligible E and prior paid-out P can withdraw AT MOST E−P.
// A request for exactly E−P is allowed; anything above is rejected.
//
// It also proves the test FAILS without the subtraction: the gross-only check
// (the old buggy logic) would wrongly ALLOW a request that exceeds E−P, letting
// the provider be paid more than they earned.
func TestInstantPayoutWithdrawalCap(t *testing.T) {
	t.Parallel()

	const (
		grossEligible int64 = 162_000 // $1,620 earned
		priorPaidOut  int64 = 20_000  // $200 already taken out
	)
	available := netInstantPayoutAvailableCents(grossEligible, priorPaidOut) // $1,420

	// rejects reports whether the AUTHORITATIVE (net) eligibility check rejects
	// a request — i.e. mirrors `if net < amount → errInsufficientBalance`.
	rejects := func(amount int64) bool {
		return netInstantPayoutAvailableCents(grossEligible, priorPaidOut) < amount
	}
	// buggyRejects is the OLD gross-only logic that never subtracted priorPaidOut.
	buggyRejects := func(amount int64) bool {
		return grossEligible < amount
	}

	t.Run("at most E-P is withdrawable", func(t *testing.T) {
		t.Parallel()
		if rejects(available) {
			t.Fatalf("withdrawing exactly E-P=%d must be allowed", available)
		}
		if !rejects(available + 1) {
			t.Fatalf("withdrawing more than E-P (%d) must be rejected", available+1)
		}
	})

	t.Run("fix rejects what the bug allowed", func(t *testing.T) {
		t.Parallel()
		// A request between E-P and E: the provider would be paid more than they
		// earned because they already took out P. The fix MUST reject it.
		overdraw := available + priorPaidOut/2 // 142_000 + 10_000 = 152_000 (< 162_000)
		if !rejects(overdraw) {
			t.Fatalf("net check must reject %d (> available %d)", overdraw, available)
		}
		// And prove this is a real regression guard: the old gross-only check
		// would have WRONGLY allowed it. If this assertion ever fails it means
		// the test no longer distinguishes the buggy behavior.
		if buggyRejects(overdraw) {
			t.Fatalf("precondition: gross-only logic should allow %d (<= gross %d) — "+
				"test would not prove the fix", overdraw, grossEligible)
		}
	})
}

// --- fake pgx querier, exercises sumAllInstantPayouts end-to-end ---

type fakeRow struct {
	val int64
	err error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) > 0 {
		if p, ok := dest[0].(*int64); ok {
			*p = r.val
		}
	}
	return nil
}

type fakeQuerier struct {
	row     pgx.Row
	gotSQL  string
	gotArgs []any
}

func (q *fakeQuerier) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	q.gotSQL = sql
	q.gotArgs = args
	return q.row
}

// TestSumAllInstantPayouts confirms the all-time prior-payout sum reads through
// the querier seam and returns the SQL-computed total used by the net-balance
// check. (The SQL itself — SUM over status <> 'failed' — is verified live in the
// reviewer's psql step; here we pin the plumbing and error propagation.)
func TestSumAllInstantPayouts(t *testing.T) {
	t.Parallel()

	h := &PaymentHandler{}

	t.Run("returns summed total", func(t *testing.T) {
		t.Parallel()
		q := &fakeQuerier{row: fakeRow{val: 20_000}}
		got, err := h.sumAllInstantPayouts(context.Background(), q, "provider-0003")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != 20_000 {
			t.Fatalf("sumAllInstantPayouts = %d, want 20000", got)
		}
		if len(q.gotArgs) != 1 || q.gotArgs[0] != "provider-0003" {
			t.Fatalf("expected provider id arg, got %v", q.gotArgs)
		}
	})

	t.Run("propagates db error", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("db down")
		q := &fakeQuerier{row: fakeRow{err: sentinel}}
		if _, err := h.sumAllInstantPayouts(context.Background(), q, "p"); !errors.Is(err, sentinel) {
			t.Fatalf("expected db error to propagate, got %v", err)
		}
	})
}
