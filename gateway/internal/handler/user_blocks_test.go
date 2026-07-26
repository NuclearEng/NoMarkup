package handler

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

// fakeBlockRow implements pgx.Row for areUsersBlocked unit tests.
type fakeBlockRow struct {
	blocked bool
	err     error
}

func (r fakeBlockRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 1 {
		return errors.New("expected one dest")
	}
	ptr, ok := dest[0].(*bool)
	if !ok {
		return errors.New("dest[0] must be *bool")
	}
	*ptr = r.blocked
	return nil
}

// fakeBlockDB implements blockQuerier.
type fakeBlockDB struct {
	row       fakeBlockRow
	lastSQL   string
	lastArgs  []any
	callCount int
}

func (f *fakeBlockDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	_ = ctx
	f.callCount++
	f.lastSQL = sql
	f.lastArgs = args
	return f.row
}

// Ensure fakeBlockRow still satisfies pgx.Row if the interface grows
// (compile-time check via unused assignment).
var _ pgx.Row = fakeBlockRow{}

func TestAreUsersBlocked_ShortCircuit(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	t.Run("nil db", func(t *testing.T) {
		t.Parallel()
		blocked, err := areUsersBlocked(ctx, nil, "a", "b")
		if err == nil {
			t.Fatal("expected error on nil db")
		}
		if blocked {
			t.Fatal("blocked should be false when err != nil")
		}
	})

	t.Run("empty userA", func(t *testing.T) {
		t.Parallel()
		db := &fakeBlockDB{row: fakeBlockRow{blocked: true}}
		blocked, err := areUsersBlocked(ctx, db, "", "b")
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if blocked {
			t.Fatal("empty user should not be blocked")
		}
		if db.callCount != 0 {
			t.Fatalf("expected no query, got %d", db.callCount)
		}
	})

	t.Run("same user", func(t *testing.T) {
		t.Parallel()
		db := &fakeBlockDB{row: fakeBlockRow{blocked: true}}
		blocked, err := areUsersBlocked(ctx, db, "same", "same")
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if blocked {
			t.Fatal("self pair should not be blocked")
		}
		if db.callCount != 0 {
			t.Fatalf("expected no query, got %d", db.callCount)
		}
	})
}

func TestAreUsersBlocked_QueryPaths(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	const a = "11111111-1111-1111-1111-111111111111"
	const b = "22222222-2222-2222-2222-222222222222"

	t.Run("not blocked", func(t *testing.T) {
		t.Parallel()
		db := &fakeBlockDB{row: fakeBlockRow{blocked: false}}
		blocked, err := areUsersBlocked(ctx, db, a, b)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if blocked {
			t.Fatal("want not blocked")
		}
		if db.callCount != 1 {
			t.Fatalf("callCount=%d want 1", db.callCount)
		}
		if len(db.lastArgs) != 2 || db.lastArgs[0] != a || db.lastArgs[1] != b {
			t.Fatalf("args=%v want [%s %s]", db.lastArgs, a, b)
		}
	})

	t.Run("blocked either direction", func(t *testing.T) {
		t.Parallel()
		db := &fakeBlockDB{row: fakeBlockRow{blocked: true}}
		blocked, err := areUsersBlocked(ctx, db, a, b)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if !blocked {
			t.Fatal("want blocked")
		}
	})

	t.Run("query error fail closed surface", func(t *testing.T) {
		t.Parallel()
		db := &fakeBlockDB{row: fakeBlockRow{err: errors.New("db down")}}
		blocked, err := areUsersBlocked(ctx, db, a, b)
		if err == nil {
			t.Fatal("expected error")
		}
		if blocked {
			t.Fatal("blocked must be false when err != nil (caller uses err for 503)")
		}
	})
}

