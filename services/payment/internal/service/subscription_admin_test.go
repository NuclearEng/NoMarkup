package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Simple proxies ---

func TestSubscriptionService_GetTier(t *testing.T) {
	t.Parallel()
	expected := proTier()
	repo := &mockSubRepo{
		getTierFn: func(_ context.Context, tierID string) (*domain.SubscriptionTier, error) {
			assert.Equal(t, "tier-pro", tierID)
			return expected, nil
		},
	}
	svc := newTestSubService(repo)
	got, err := svc.GetTier(context.Background(), "tier-pro")
	require.NoError(t, err)
	assert.Equal(t, expected, got)
}

func TestSubscriptionService_GetSubscription(t *testing.T) {
	t.Parallel()
	expected := &domain.Subscription{ID: "sub-1", UserID: "user-1"}
	repo := &mockSubRepo{
		getSubscriptionFn: func(_ context.Context, userID string) (*domain.Subscription, error) {
			assert.Equal(t, "user-1", userID)
			return expected, nil
		},
	}
	svc := newTestSubService(repo)
	got, err := svc.GetSubscription(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Equal(t, expected, got)
}

// --- ListInvoices ---

func TestSubscriptionService_ListInvoices(t *testing.T) {
	t.Parallel()

	t.Run("happy_path_via_dev_stripe", func(t *testing.T) {
		t.Parallel()
		repo := &mockSubRepo{
			getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return &domain.Subscription{ID: "sub-1", StripeSubscriptionID: "sub_xyz"}, nil
			},
		}
		svc := newTestSubService(repo)
		invoices, err := svc.ListInvoices(context.Background(), "user-1")
		require.NoError(t, err)
		// Dev-mode stripe returns empty list, not nil; assert no error.
		_ = invoices
	})

	t.Run("returns_no_active_subscription_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockSubRepo{
			getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return nil, errors.New("not found")
			},
		}
		svc := newTestSubService(repo)
		_, err := svc.ListInvoices(context.Background(), "user-1")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrNoActiveSubscription)
	})

	t.Run("empty_stripe_subscription_id_returns_empty_list", func(t *testing.T) {
		t.Parallel()
		// Seed / admin-grant rows have status=active but no Stripe object.
		repo := &mockSubRepo{
			getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return &domain.Subscription{ID: "sub-1", StripeSubscriptionID: ""}, nil
			},
		}
		svc := newTestSubService(repo)
		invoices, err := svc.ListInvoices(context.Background(), "user-1")
		require.NoError(t, err)
		assert.Empty(t, invoices)
	})
}

// --- AdminListSubscriptions ---

func TestSubscriptionService_AdminListSubscriptions(t *testing.T) {
	t.Parallel()
	expected := []*domain.Subscription{{ID: "s1"}, {ID: "s2"}}
	repo := &mockSubRepo{
		adminListSubscriptionsFn: func(_ context.Context, statusFilter, tierID string, page, pageSize int) ([]*domain.Subscription, int, int64, error) {
			assert.Equal(t, "active", statusFilter)
			assert.Equal(t, "tier-pro", tierID)
			assert.Equal(t, 1, page)
			assert.Equal(t, 50, pageSize)
			return expected, 100, 12345, nil
		},
	}
	svc := newTestSubService(repo)
	got, total, mrr, err := svc.AdminListSubscriptions(context.Background(), "active", "tier-pro", 1, 50)
	require.NoError(t, err)
	assert.Equal(t, expected, got)
	assert.Equal(t, 100, total)
	assert.Equal(t, int64(12345), mrr)
}

// --- AdminUpdateTier ---

func TestSubscriptionService_AdminUpdateTier(t *testing.T) {
	t.Parallel()

	t.Run("updates_existing_tier", func(t *testing.T) {
		t.Parallel()
		updated := proTier()
		updated.MonthlyPriceCents = 4999
		var capturedUpdates map[string]interface{}
		repo := &mockSubRepo{
			getTierFn: func(_ context.Context, _ string) (*domain.SubscriptionTier, error) {
				return proTier(), nil
			},
			updateTierFn: func(_ context.Context, _ string, updates map[string]interface{}) (*domain.SubscriptionTier, error) {
				capturedUpdates = updates
				return updated, nil
			},
		}
		svc := newTestSubService(repo)
		got, err := svc.AdminUpdateTier(context.Background(), "tier-pro", map[string]interface{}{
			"monthly_price_cents": int64(4999),
		})
		require.NoError(t, err)
		assert.Equal(t, int64(4999), got.MonthlyPriceCents)
		assert.NotNil(t, capturedUpdates)
	})

	t.Run("rejects_unknown_tier", func(t *testing.T) {
		t.Parallel()
		repo := &mockSubRepo{
			getTierFn: func(_ context.Context, _ string) (*domain.SubscriptionTier, error) {
				return nil, domain.ErrTierNotFound
			},
		}
		svc := newTestSubService(repo)
		_, err := svc.AdminUpdateTier(context.Background(), "tier-missing", map[string]interface{}{})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrTierNotFound)
	})
}

// --- AdminGrantSubscription ---

func TestSubscriptionService_AdminGrantSubscription(t *testing.T) {
	t.Parallel()

	t.Run("grants_free_subscription", func(t *testing.T) {
		t.Parallel()
		var captured *domain.Subscription
		repo := &mockSubRepo{
			getTierFn: func(_ context.Context, _ string) (*domain.SubscriptionTier, error) {
				return proTier(), nil
			},
			getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return nil, errors.New("not found") // no existing
			},
			createSubscriptionFn: func(_ context.Context, sub *domain.Subscription) error {
				captured = sub
				return nil
			},
		}
		svc := newTestSubService(repo)
		sub, err := svc.AdminGrantSubscription(context.Background(), "user-1", "tier-pro", 90, "comped beta tester")
		require.NoError(t, err)
		require.NotNil(t, sub)
		assert.Equal(t, "user-1", sub.UserID)
		assert.Equal(t, int64(0), sub.CurrentPriceCents,
			"granted subscription must have zero cost")
		assert.Equal(t, "active", sub.Status)
		require.NotNil(t, captured)
		// Period end is now + 90 days.
		require.NotNil(t, captured.CurrentPeriodEnd)
		days := int(captured.CurrentPeriodEnd.Sub(*captured.CurrentPeriodStart).Hours() / 24)
		assert.Equal(t, 90, days)
	})

	t.Run("rejects_when_user_already_subscribed", func(t *testing.T) {
		t.Parallel()
		repo := &mockSubRepo{
			getTierFn: func(_ context.Context, _ string) (*domain.SubscriptionTier, error) {
				return proTier(), nil
			},
			getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return &domain.Subscription{ID: "existing", Status: "active"}, nil
			},
		}
		svc := newTestSubService(repo)
		_, err := svc.AdminGrantSubscription(context.Background(), "user-1", "tier-pro", 30, "x")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrAlreadySubscribed)
	})

	t.Run("rejects_unknown_tier", func(t *testing.T) {
		t.Parallel()
		repo := &mockSubRepo{
			getTierFn: func(_ context.Context, _ string) (*domain.SubscriptionTier, error) {
				return nil, domain.ErrTierNotFound
			},
		}
		svc := newTestSubService(repo)
		_, err := svc.AdminGrantSubscription(context.Background(), "user-1", "tier-x", 30, "x")
		require.Error(t, err)
	})
}

// --- HandleSubscriptionWebhook ---

func TestSubscriptionService_HandleSubscriptionWebhook_Coverage(t *testing.T) {
	t.Parallel()

	t.Run("subscription_updated_persists_period", func(t *testing.T) {
		t.Parallel()
		var capturedStart, capturedEnd time.Time
		repo := &mockSubRepo{
			getSubByStripeFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return &domain.Subscription{ID: "sub-1"}, nil
			},
			updateSubPeriodFn: func(_ context.Context, _ string, periodStart, periodEnd time.Time) error {
				capturedStart = periodStart
				capturedEnd = periodEnd
				return nil
			},
		}
		svc := newTestSubService(repo)
		ps := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
		pe := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
		err := svc.HandleSubscriptionWebhook(context.Background(), "customer.subscription.updated", "sub_xyz", &ps, &pe)
		require.NoError(t, err)
		assert.Equal(t, ps, capturedStart)
		assert.Equal(t, pe, capturedEnd)
	})

	t.Run("subscription_deleted_marks_expired", func(t *testing.T) {
		t.Parallel()
		var capturedStatus string
		repo := &mockSubRepo{
			getSubByStripeFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return &domain.Subscription{ID: "sub-1"}, nil
			},
			updateSubStatusFn: func(_ context.Context, _, status string) error {
				capturedStatus = status
				return nil
			},
		}
		svc := newTestSubService(repo)
		err := svc.HandleSubscriptionWebhook(context.Background(), "customer.subscription.deleted", "sub_xyz", nil, nil)
		require.NoError(t, err)
		assert.Equal(t, "expired", capturedStatus)
	})

	t.Run("unknown_subscription_returns_nil", func(t *testing.T) {
		t.Parallel()
		repo := &mockSubRepo{
			getSubByStripeFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return nil, errors.New("not found")
			},
		}
		svc := newTestSubService(repo)
		// Should NOT propagate error — Stripe must get a 200 to stop retrying.
		err := svc.HandleSubscriptionWebhook(context.Background(), "customer.subscription.deleted", "sub_unknown", nil, nil)
		require.NoError(t, err)
	})
}
