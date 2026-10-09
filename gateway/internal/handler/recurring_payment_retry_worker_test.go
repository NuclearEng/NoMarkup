package handler

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

func TestProcessDueRecurringPaymentRetries_unwired(t *testing.T) {
	t.Parallel()

	var nilH *ContractHandler
	_, _, _, err := nilH.ProcessDueRecurringPaymentRetries(context.Background(), 10)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "handler nil")

	h := NewContractHandler(nil, nil, nil)
	_, _, _, err = h.ProcessDueRecurringPaymentRetries(context.Background(), 10)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "database pool unwired")

	h2 := NewContractHandler(nil, nil, nil)
	h2.claimDueRecurringRetriesFn = func(_ context.Context, _ int) ([]dueRecurringRetry, error) {
		return nil, nil
	}
	// claim hook present but payment still unwired
	_, _, _, err = h2.ProcessDueRecurringPaymentRetries(context.Background(), 10)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "payment client unwired")
}

func TestProcessDueRecurringPaymentRetries_successResetsCounter(t *testing.T) {
	t.Parallel()

	var (
		mu       sync.Mutex
		createN  int
		resetN   int
		lastKey  string
		lastInst string
	)

	pc := &mockApprovePaymentClient{
		createFn: func(_ context.Context, req *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error) {
			mu.Lock()
			createN++
			lastKey = req.GetIdempotencyKey()
			lastInst = req.GetRecurringInstanceId()
			mu.Unlock()
			return &paymentv1.CreatePaymentResponse{
				Payment: &paymentv1.Payment{
					Id:                  "pay-retry-1",
					ContractId:          req.GetContractId(),
					RecurringInstanceId: req.GetRecurringInstanceId(),
					CustomerId:          req.GetCustomerId(),
					AmountCents:         req.GetAmountCents(),
					Status:              paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW,
				},
			}, nil
		},
	}
	cc := &mockApproveContractClient{}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)
	h.claimDueRecurringRetriesFn = func(_ context.Context, _ int) ([]dueRecurringRetry, error) {
		return []dueRecurringRetry{{
			ID:                testRecurringID,
			ContractID:        testContractID,
			PaymentRetryCount: 1,
		}}, nil
	}
	h.findUnpaidApprovedVisitFn = func(_ context.Context, rid string) (*unpaidApprovedVisit, error) {
		assert.Equal(t, testRecurringID, rid)
		return &unpaidApprovedVisit{
			InstanceID:  testInstanceID,
			ContractID:  testContractID,
			CustomerID:  testCustomerID,
			AmountCents: 7500,
		}, nil
	}
	h.resetPaymentRetryFn = func(_ context.Context, rid string) error {
		mu.Lock()
		resetN++
		mu.Unlock()
		assert.Equal(t, testRecurringID, rid)
		return nil
	}

	claimed, succeeded, failed, err := h.ProcessDueRecurringPaymentRetries(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, claimed)
	assert.Equal(t, 1, succeeded)
	assert.Equal(t, 0, failed)
	assert.Equal(t, 1, createN)
	assert.Equal(t, 1, resetN)
	assert.Equal(t, testInstanceID, lastInst)
	assert.Equal(t, "recurring-instance-pay:"+testInstanceID+":attempt-2", lastKey)
}

// TestProcessDueRecurringPaymentRetries_attemptNFromStrikeCount: strike count 2
// → CreatePayment sticky key attempt-3 (FR-16.7 scheduled retry scope).
func TestProcessDueRecurringPaymentRetries_attemptNFromStrikeCount(t *testing.T) {
	t.Parallel()

	var lastKey string
	pc := &mockApprovePaymentClient{
		createFn: func(_ context.Context, req *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error) {
			lastKey = req.GetIdempotencyKey()
			return &paymentv1.CreatePaymentResponse{
				Payment: &paymentv1.Payment{
					Id:                  "pay-retry-3",
					ContractId:          req.GetContractId(),
					RecurringInstanceId: req.GetRecurringInstanceId(),
					CustomerId:          req.GetCustomerId(),
					AmountCents:         req.GetAmountCents(),
					Status:              paymentv1.PaymentStatus_PAYMENT_STATUS_PENDING,
				},
				ClientSecret: "pi_secret_attempt3",
			}, nil
		},
	}
	h := NewContractHandler(&mockApproveContractClient{}, nil, nil)
	h.SetPaymentClient(pc)
	h.claimDueRecurringRetriesFn = func(_ context.Context, _ int) ([]dueRecurringRetry, error) {
		return []dueRecurringRetry{{
			ID:                testRecurringID,
			ContractID:        testContractID,
			PaymentRetryCount: 2,
		}}, nil
	}
	h.findUnpaidApprovedVisitFn = func(_ context.Context, _ string) (*unpaidApprovedVisit, error) {
		return &unpaidApprovedVisit{
			InstanceID:  testInstanceID,
			ContractID:  testContractID,
			CustomerID:  testCustomerID,
			AmountCents: 7500,
		}, nil
	}
	h.resetPaymentRetryFn = func(_ context.Context, _ string) error { return nil }

	claimed, succeeded, failed, err := h.ProcessDueRecurringPaymentRetries(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, claimed)
	assert.Equal(t, 1, succeeded)
	assert.Equal(t, 0, failed)
	assert.Equal(t, "recurring-instance-pay:"+testInstanceID+":attempt-3", lastKey)
}

func TestProcessDueRecurringPaymentRetries_createFailureIncrementsStrike(t *testing.T) {
	t.Parallel()

	var incrN, pauseN int
	pc := &mockApprovePaymentClient{
		createFn: func(_ context.Context, _ *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error) {
			return nil, status.Error(codes.Unavailable, "payment mesh down")
		},
	}
	cc := &mockApproveContractClient{
		pauseRecurringFn: func(_ context.Context, _ *contractv1.PauseRecurringRequest) (*contractv1.PauseRecurringResponse, error) {
			pauseN++
			return &contractv1.PauseRecurringResponse{
				Config: &contractv1.RecurringConfig{Id: testRecurringID, Status: "paused"},
			}, nil
		},
	}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)
	h.claimDueRecurringRetriesFn = func(_ context.Context, _ int) ([]dueRecurringRetry, error) {
		return []dueRecurringRetry{{
			ID:                testRecurringID,
			ContractID:        testContractID,
			PaymentRetryCount: 1,
		}}, nil
	}
	h.findUnpaidApprovedVisitFn = func(_ context.Context, _ string) (*unpaidApprovedVisit, error) {
		return &unpaidApprovedVisit{
			InstanceID:  testInstanceID,
			ContractID:  testContractID,
			CustomerID:  testCustomerID,
			AmountCents: 7500,
		}, nil
	}
	h.incrPaymentRetryFn = func(_ context.Context, rid string) (int, *time.Time, error) {
		incrN++
		assert.Equal(t, testRecurringID, rid)
		next := time.Now().UTC().Add(4 * 24 * time.Hour)
		return 2, &next, nil
	}

	claimed, succeeded, failed, err := h.ProcessDueRecurringPaymentRetries(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, claimed)
	assert.Equal(t, 0, succeeded)
	assert.Equal(t, 1, failed)
	assert.Equal(t, 1, incrN, "CreatePayment failure must burn one strike")
	assert.Equal(t, 0, pauseN, "must not pause below threshold")
}

func TestProcessDueRecurringPaymentRetries_createFailureAtThresholdPauses(t *testing.T) {
	t.Parallel()

	var pauseN int
	pc := &mockApprovePaymentClient{
		createFn: func(_ context.Context, _ *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error) {
			return nil, status.Error(codes.Internal, "stripe boom")
		},
	}
	cc := &mockApproveContractClient{
		pauseRecurringFn: func(_ context.Context, req *contractv1.PauseRecurringRequest) (*contractv1.PauseRecurringResponse, error) {
			pauseN++
			assert.Equal(t, testRecurringID, req.GetRecurringId())
			assert.Equal(t, testCustomerID, req.GetUserId())
			return &contractv1.PauseRecurringResponse{
				Config: &contractv1.RecurringConfig{Id: testRecurringID, Status: "paused"},
			}, nil
		},
	}
	h := NewContractHandler(cc, nil, nil)
	h.SetPaymentClient(pc)
	h.claimDueRecurringRetriesFn = func(_ context.Context, _ int) ([]dueRecurringRetry, error) {
		return []dueRecurringRetry{{
			ID:                testRecurringID,
			ContractID:        testContractID,
			PaymentRetryCount: 2,
		}}, nil
	}
	h.findUnpaidApprovedVisitFn = func(_ context.Context, _ string) (*unpaidApprovedVisit, error) {
		return &unpaidApprovedVisit{
			InstanceID:  testInstanceID,
			ContractID:  testContractID,
			CustomerID:  testCustomerID,
			AmountCents: 7500,
		}, nil
	}
	h.incrPaymentRetryFn = func(_ context.Context, _ string) (int, *time.Time, error) {
		return recurringPaymentRetryPauseThreshold, nil, nil
	}

	_, succeeded, failed, err := h.ProcessDueRecurringPaymentRetries(context.Background(), 5)
	require.NoError(t, err)
	assert.Equal(t, 0, succeeded)
	assert.Equal(t, 1, failed)
	assert.Equal(t, 1, pauseN, "third strike must PauseRecurring")
}

func TestProcessDueRecurringPaymentRetries_noUnpaidVisitClearsSchedule(t *testing.T) {
	t.Parallel()

	var resetN, createN int
	pc := &mockApprovePaymentClient{
		createFn: func(_ context.Context, _ *paymentv1.CreatePaymentRequest) (*paymentv1.CreatePaymentResponse, error) {
			createN++
			return nil, errors.New("should not CreatePayment")
		},
	}
	h := NewContractHandler(&mockApproveContractClient{}, nil, nil)
	h.SetPaymentClient(pc)
	h.claimDueRecurringRetriesFn = func(_ context.Context, _ int) ([]dueRecurringRetry, error) {
		return []dueRecurringRetry{{
			ID:                testRecurringID,
			ContractID:        testContractID,
			PaymentRetryCount: 1,
		}}, nil
	}
	h.findUnpaidApprovedVisitFn = func(_ context.Context, _ string) (*unpaidApprovedVisit, error) {
		return nil, nil
	}
	h.resetPaymentRetryFn = func(_ context.Context, _ string) error {
		resetN++
		return nil
	}

	_, succeeded, failed, err := h.ProcessDueRecurringPaymentRetries(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, succeeded)
	assert.Equal(t, 0, failed)
	assert.Equal(t, 0, createN)
	assert.Equal(t, 1, resetN)
}

func TestProcessDueRecurringPaymentRetries_emptyClaim(t *testing.T) {
	t.Parallel()
	pc := &mockApprovePaymentClient{}
	h := NewContractHandler(nil, nil, nil)
	h.SetPaymentClient(pc)
	h.claimDueRecurringRetriesFn = func(_ context.Context, _ int) ([]dueRecurringRetry, error) {
		return nil, nil
	}
	claimed, succeeded, failed, err := h.ProcessDueRecurringPaymentRetries(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 0, claimed)
	assert.Equal(t, 0, succeeded)
	assert.Equal(t, 0, failed)
}

func TestRunRecurringPaymentRetryCron_disabledWithoutDeps(t *testing.T) {
	t.Parallel()
	RunRecurringPaymentRetryCron(context.Background(), nil, 0, 0, 0)
	RunRecurringPaymentRetryCron(context.Background(), NewContractHandler(nil, nil, nil), 0, 0, 0)
}

func TestRecurringPaymentRetryEnvHelpers(t *testing.T) {
	t.Parallel()
	assert.Greater(t, RecurringPaymentRetryIntervalFromEnv(), time.Duration(0))
	assert.GreaterOrEqual(t, RecurringPaymentRetryInitialDelayFromEnv(), time.Duration(0))
	assert.Greater(t, RecurringPaymentRetryBatchFromEnv(), 0)
}
