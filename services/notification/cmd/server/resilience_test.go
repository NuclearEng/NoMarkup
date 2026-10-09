package main

import (
	"context"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// fakeServerStream is the minimum grpc.ServerStream needed to drive the
// streaming recovery interceptor.
type fakeServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (f *fakeServerStream) Context() context.Context { return f.ctx }

// TestRecoveryUnaryInterceptor is the regression test for RES-03: grpc-go does
// not recover handler panics, so without this interceptor each case below
// would terminate the process instead of returning an error.
func TestRecoveryUnaryInterceptor(t *testing.T) {
	t.Parallel()

	secret := "panic: user 8f2c... card pm_1Nxx secret"

	tests := []struct {
		name    string
		handler grpc.UnaryHandler
		wantErr bool
	}{
		{
			name:    "nil dereference",
			handler: func(context.Context, any) (any, error) { var m map[string]string; m["k"] = "v"; return nil, nil },
			wantErr: true,
		},
		{
			name:    "index out of range",
			handler: func(context.Context, any) (any, error) { s := []int{}; _ = s[3]; return nil, nil },
			wantErr: true,
		},
		{
			name:    "explicit panic carrying sensitive text",
			handler: func(context.Context, any) (any, error) { panic(secret) },
			wantErr: true,
		},
		{
			name:    "healthy handler is untouched",
			handler: func(context.Context, any) (any, error) { return "ok", nil },
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			info := &grpc.UnaryServerInfo{FullMethod: "/nomarkup.test.v1.TestService/Do"}
			resp, err := recoveryUnaryInterceptor(context.Background(), nil, info, tt.handler)

			if !tt.wantErr {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if resp != "ok" {
					t.Fatalf("resp = %v, want ok", resp)
				}
				return
			}

			if err == nil {
				t.Fatal("expected an error after the handler panicked, got nil")
			}
			if got := status.Code(err); got != codes.Internal {
				t.Errorf("status code = %v, want %v", got, codes.Internal)
			}
			if resp != nil {
				t.Errorf("resp = %v, want nil after a panic", resp)
			}
			// The panic value must never reach the client.
			if strings.Contains(err.Error(), "pm_1Nxx") || strings.Contains(err.Error(), "8f2c") {
				t.Errorf("panic value leaked to client: %q", err.Error())
			}
		})
	}
}

func TestRecoveryStreamInterceptor(t *testing.T) {
	t.Parallel()

	info := &grpc.StreamServerInfo{FullMethod: "/nomarkup.test.v1.TestService/Stream"}
	ss := &fakeServerStream{ctx: context.Background()}

	err := recoveryStreamInterceptor(nil, ss, info, func(any, grpc.ServerStream) error {
		panic("stream handler exploded")
	})
	if err == nil {
		t.Fatal("expected an error after the stream handler panicked, got nil")
	}
	if got := status.Code(err); got != codes.Internal {
		t.Errorf("status code = %v, want %v", got, codes.Internal)
	}
	if strings.Contains(err.Error(), "exploded") {
		t.Errorf("panic value leaked to client: %q", err.Error())
	}

	if err := recoveryStreamInterceptor(nil, ss, info, func(any, grpc.ServerStream) error { return nil }); err != nil {
		t.Errorf("healthy stream handler returned %v, want nil", err)
	}
}

// TestKeepaliveEnforcementPermitsGatewayPings guards the interaction that makes
// client keepalive safe: the gateway pings every 30s, and grpc-go GOAWAYs a
// client that pings more often than EnforcementPolicy.MinTime.
func TestKeepaliveEnforcementPermitsGatewayPings(t *testing.T) {
	t.Parallel()

	const gatewayClientPingInterval = 30 // seconds; middleware.grpcClientKeepaliveTime

	ep := grpcKeepaliveEnforcement()
	if ep.MinTime.Seconds() >= gatewayClientPingInterval {
		t.Errorf("MinTime %v must be below the gateway's %ds ping interval", ep.MinTime, gatewayClientPingInterval)
	}
	if !ep.PermitWithoutStream {
		t.Error("PermitWithoutStream must be true; the gateway pings idle connections")
	}
	if kp := grpcKeepaliveParams(); kp.Time <= 0 || kp.Timeout <= 0 {
		t.Errorf("server keepalive params not set: %+v", kp)
	}
}
