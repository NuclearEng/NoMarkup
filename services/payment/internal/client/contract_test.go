package client

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

// fakeContractServer implements only the RPCs PauseOnPaymentFailed needs.
type fakeContractServer struct {
	contractv1.UnimplementedContractServiceServer
	cfg             *contractv1.RecurringConfig
	contract        *contractv1.Contract
	getErr          error
	getContractErr  error
	pauseErr        error
	pauseCalls      int
	lastPauseUserID string
	lastPauseRecID  string
}

func (f *fakeContractServer) GetRecurringConfig(
	_ context.Context,
	req *contractv1.GetRecurringConfigRequest,
) (*contractv1.GetRecurringConfigResponse, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	if f.cfg != nil && f.cfg.GetContractId() != "" && f.cfg.GetContractId() != req.GetContractId() {
		return nil, status.Error(codes.NotFound, "no config")
	}
	return &contractv1.GetRecurringConfigResponse{Config: f.cfg}, nil
}

func (f *fakeContractServer) GetContract(
	_ context.Context,
	req *contractv1.GetContractRequest,
) (*contractv1.GetContractResponse, error) {
	if f.getContractErr != nil {
		return nil, f.getContractErr
	}
	if f.contract != nil {
		return &contractv1.GetContractResponse{Contract: f.contract}, nil
	}
	return &contractv1.GetContractResponse{
		Contract: &contractv1.Contract{
			Id:         req.GetContractId(),
			CustomerId: "cust-1",
			ProviderId: "prov-1",
		},
	}, nil
}

func (f *fakeContractServer) PauseRecurring(
	_ context.Context,
	req *contractv1.PauseRecurringRequest,
) (*contractv1.PauseRecurringResponse, error) {
	f.pauseCalls++
	f.lastPauseUserID = req.GetUserId()
	f.lastPauseRecID = req.GetRecurringId()
	if f.pauseErr != nil {
		return nil, f.pauseErr
	}
	paused := &contractv1.RecurringConfig{
		Id:     req.GetRecurringId(),
		Status: "paused",
	}
	if f.cfg != nil {
		paused.ContractId = f.cfg.GetContractId()
	}
	return &contractv1.PauseRecurringResponse{Config: paused}, nil
}

// recordingNotifier captures Send calls for FR-18.8 dual-party notify tests.
type recordingNotifier struct {
	mu    sync.Mutex
	calls []notifyCall
	err   error
}

type notifyCall struct {
	userID string
	typ    notificationv1.NotificationType
	title  string
}

func (r *recordingNotifier) Send(
	_ context.Context,
	userID string,
	notificationType notificationv1.NotificationType,
	title, _, _ string,
	_ map[string]string,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, notifyCall{userID: userID, typ: notificationType, title: title})
	return r.err
}

func (r *recordingNotifier) recipients() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.calls))
	for _, c := range r.calls {
		out = append(out, c.userID)
	}
	return out
}

func dialFakeContract(t *testing.T, srv *fakeContractServer) *ContractClient {
	t.Helper()
	lis := bufconn.Listen(1024 * 1024)
	gs := grpc.NewServer()
	contractv1.RegisterContractServiceServer(gs, srv)
	go func() { _ = gs.Serve(lis) }()
	t.Cleanup(func() {
		gs.Stop()
		_ = lis.Close()
	})

	conn, err := grpc.NewClient(
		"passthrough:///bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return lis.Dial()
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })

	return &ContractClient{conn: conn, client: contractv1.NewContractServiceClient(conn)}
}

// withStrikeCount injects FR-16.7 durable counter (nil db in unit tests).
func withStrikeCount(c *ContractClient, count int) *ContractClient {
	c.incrPaymentRetryFn = func(_ context.Context, _ string) (int, *time.Time, error) {
		var next *time.Time
		if count < recurringPaymentRetryPauseThreshold {
			t := time.Now().UTC().Add(72 * time.Hour)
			next = &t
		}
		return count, next, nil
	}
	return c
}

// TestContractClient_PauseOnPaymentFailed_BelowThresholdNoPause: FR-16.7
// first/second charge fail only increments strike; never PauseRecurring.
func TestContractClient_PauseOnPaymentFailed_BelowThresholdNoPause(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-1",
			ContractId: "ctr-1",
			Status:     "active",
		},
	}
	c := withStrikeCount(dialFakeContract(t, srv), 1)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-1", "cust-1", "inst-1", "pmt-1")
	require.NoError(t, err)
	assert.Equal(t, 0, srv.pauseCalls, "below threshold must not pause")
}

// TestContractClient_PauseOnPaymentFailed_AtThresholdPauses: third strike
// PauseRecurring as payment customer (party check).
func TestContractClient_PauseOnPaymentFailed_AtThresholdPauses(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-1",
			ContractId: "ctr-1",
			Status:     "active",
		},
	}
	c := withStrikeCount(dialFakeContract(t, srv), recurringPaymentRetryPauseThreshold)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-1", "cust-1", "inst-1", "pmt-1")
	require.NoError(t, err)
	assert.Equal(t, 1, srv.pauseCalls)
	assert.Equal(t, "cust-1", srv.lastPauseUserID, "UserId must be payment customer for party check")
	assert.Equal(t, "rec-1", srv.lastPauseRecID)
}

// TestContractClient_PauseOnPaymentFailed_AtThresholdNotifiesBothParties:
// FR-16.7 dual-party notify after successful pause.
func TestContractClient_PauseOnPaymentFailed_AtThresholdNotifiesBothParties(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-1",
			ContractId: "ctr-1",
			Status:     "active",
		},
		contract: &contractv1.Contract{
			Id:         "ctr-1",
			CustomerId: "cust-1",
			ProviderId: "prov-1",
		},
	}
	notifier := &recordingNotifier{}
	c := withStrikeCount(dialFakeContract(t, srv), recurringPaymentRetryPauseThreshold)
	c.SetNotifier(notifier)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-1", "cust-1", "inst-1", "pmt-1")
	require.NoError(t, err)
	assert.Equal(t, 1, srv.pauseCalls)
	assert.ElementsMatch(t, []string{"cust-1", "prov-1"}, notifier.recipients())
	for _, call := range notifier.calls {
		assert.Equal(t, notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED, call.typ)
	}
}

// TestContractClient_PauseOnPaymentFailed_NotifyFailureDoesNotBlockPause:
// Send errors are residual; PauseOnPaymentFailed still succeeds.
func TestContractClient_PauseOnPaymentFailed_NotifyFailureDoesNotBlockPause(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-1",
			ContractId: "ctr-1",
			Status:     "active",
		},
	}
	notifier := &recordingNotifier{err: errors.New("notification mesh down")}
	c := withStrikeCount(dialFakeContract(t, srv), recurringPaymentRetryPauseThreshold)
	c.SetNotifier(notifier)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-1", "cust-1", "inst-1", "pmt-1")
	require.NoError(t, err, "notify failure must not fail pause")
	assert.Equal(t, 1, srv.pauseCalls)
	assert.NotEmpty(t, notifier.recipients(), "Send was attempted")
}

// TestContractClient_PauseOnPaymentFailed_BelowThresholdNoNotify: strikes
// below pause threshold must not notify either party.
func TestContractClient_PauseOnPaymentFailed_BelowThresholdNoNotify(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-1",
			ContractId: "ctr-1",
			Status:     "active",
		},
	}
	notifier := &recordingNotifier{}
	c := withStrikeCount(dialFakeContract(t, srv), 1)
	c.SetNotifier(notifier)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-1", "cust-1", "inst-1", "pmt-1")
	require.NoError(t, err)
	assert.Equal(t, 0, srv.pauseCalls)
	assert.Empty(t, notifier.recipients())
}

// TestContractClient_PauseOnPaymentFailed_NilNotifierResidual: unwired
// notifier does not error the pause path.
func TestContractClient_PauseOnPaymentFailed_NilNotifierResidual(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-1",
			ContractId: "ctr-1",
			Status:     "active",
		},
	}
	c := withStrikeCount(dialFakeContract(t, srv), recurringPaymentRetryPauseThreshold)
	// deliberately no SetNotifier

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-1", "cust-1", "inst-1", "pmt-1")
	require.NoError(t, err)
	assert.Equal(t, 1, srv.pauseCalls)
}

// TestContractClient_PauseOnPaymentFailed_NoCounterNoPause: without durable
// strike tracking, fail closed — do not invent a pause.
func TestContractClient_PauseOnPaymentFailed_NoCounterNoPause(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-1",
			ContractId: "ctr-1",
			Status:     "active",
		},
	}
	// No incrPaymentRetryFn and nil db → increment errors → no pause.
	c := dialFakeContract(t, srv)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-1", "cust-1", "inst-1", "pmt-1")
	require.Error(t, err)
	assert.Equal(t, 0, srv.pauseCalls, "must not pause without durable strike count")
}

func TestContractClient_PauseOnPaymentFailed_AlreadyPausedIsNoop(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-2",
			ContractId: "ctr-2",
			Status:     "paused",
		},
	}
	c := dialFakeContract(t, srv)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-2", "cust-2", "inst-2", "pmt-2")
	require.NoError(t, err)
	assert.Equal(t, 0, srv.pauseCalls, "already paused must not call PauseRecurring")
}

func TestContractClient_PauseOnPaymentFailed_CancelledLeftAlone(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-3",
			ContractId: "ctr-3",
			Status:     "cancelled",
		},
	}
	c := dialFakeContract(t, srv)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-3", "cust-3", "inst-3", "pmt-3")
	require.NoError(t, err)
	assert.Equal(t, 0, srv.pauseCalls, "cancelled configs must never be re-cancelled via payment path")
}

func TestContractClient_PauseOnPaymentFailed_RequiresIDs(t *testing.T) {
	t.Parallel()
	c := &ContractClient{} // no dial needed — validation is local
	err := c.PauseOnPaymentFailed(context.Background(), "", "cust", "inst", "pmt")
	require.Error(t, err)
	err = c.PauseOnPaymentFailed(context.Background(), "ctr", "", "inst", "pmt")
	require.Error(t, err)
}

func TestContractClient_PauseOnPaymentFailed_GetErrorPropagates(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		getErr: status.Error(codes.Unavailable, "job down"),
	}
	c := dialFakeContract(t, srv)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-x", "cust-x", "inst-x", "pmt-x")
	require.Error(t, err)
	assert.Equal(t, 0, srv.pauseCalls)
}

func TestNewContractClient_EmptyAddr(t *testing.T) {
	t.Parallel()
	_, err := NewContractClient("", nil)
	require.Error(t, err)
}
