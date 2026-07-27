package client

import (
	"context"
	"net"
	"testing"

	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
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
	getErr          error
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

func TestContractClient_PauseOnPaymentFailed_ActivePauses(t *testing.T) {
	t.Parallel()
	srv := &fakeContractServer{
		cfg: &contractv1.RecurringConfig{
			Id:         "rec-1",
			ContractId: "ctr-1",
			Status:     "active",
		},
	}
	c := dialFakeContract(t, srv)

	err := c.PauseOnPaymentFailed(context.Background(), "ctr-1", "cust-1", "inst-1", "pmt-1")
	require.NoError(t, err)
	assert.Equal(t, 1, srv.pauseCalls)
	assert.Equal(t, "cust-1", srv.lastPauseUserID)
	assert.Equal(t, "rec-1", srv.lastPauseRecID)
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
	_, err := NewContractClient("")
	require.Error(t, err)
}
