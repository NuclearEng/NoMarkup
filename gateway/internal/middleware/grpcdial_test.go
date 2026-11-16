package middleware

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc"
)

// TestGRPCTimeoutUnaryInterceptor_AppliesDeadline is the regression test for
// RES-01: a handler forwarding a deadline-free r.Context() must not be able to
// pin a gateway goroutine on a wedged backend.
// Not t.Parallel: subtests call t.Setenv, which the testing package forbids
// under a parallel parent.
func TestGRPCTimeoutUnaryInterceptor_AppliesDeadline(t *testing.T) {
	tests := []struct {
		name          string
		callerTimeout time.Duration // 0 == no caller deadline
		envTimeout    string
		wantDeadline  bool
		// wantAtMost bounds the deadline the invoker observes.
		wantAtMost time.Duration
	}{
		{
			name:          "no caller deadline gets the default ceiling",
			callerTimeout: 0,
			wantDeadline:  true,
			wantAtMost:    defaultGRPCCallTimeout,
		},
		{
			name:          "later caller deadline is clamped to the ceiling",
			callerTimeout: time.Hour,
			wantDeadline:  true,
			wantAtMost:    defaultGRPCCallTimeout,
		},
		{
			name:          "stricter caller deadline is preserved",
			callerTimeout: 50 * time.Millisecond,
			wantDeadline:  true,
			wantAtMost:    50 * time.Millisecond,
		},
		{
			name:          "env override tightens the ceiling",
			callerTimeout: 0,
			envTimeout:    "250ms",
			wantDeadline:  true,
			wantAtMost:    250 * time.Millisecond,
		},
		{
			name:          "zero env disables the ceiling",
			callerTimeout: 0,
			envTimeout:    "0",
			wantDeadline:  false,
		},
		{
			name:          "invalid env falls back to the default",
			callerTimeout: 0,
			envTimeout:    "not-a-duration",
			wantDeadline:  true,
			wantAtMost:    defaultGRPCCallTimeout,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Not parallel: t.Setenv mutates process state.
			if tt.envTimeout != "" {
				t.Setenv(grpcCallTimeoutEnv, tt.envTimeout)
			}

			ctx := context.Background()
			if tt.callerTimeout > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, tt.callerTimeout)
				defer cancel()
			}

			var (
				gotDeadline bool
				gotRemain   time.Duration
			)
			invoker := func(ctx context.Context, _ string, _, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
				deadline, ok := ctx.Deadline()
				gotDeadline = ok
				if ok {
					gotRemain = time.Until(deadline)
				}
				return nil
			}

			err := GRPCTimeoutUnaryInterceptor(ctx, "/nomarkup.user.v1.UserService/GetUser", nil, nil, nil, invoker)
			if err != nil {
				t.Fatalf("interceptor returned error: %v", err)
			}

			if gotDeadline != tt.wantDeadline {
				t.Fatalf("deadline present = %v, want %v", gotDeadline, tt.wantDeadline)
			}
			if tt.wantDeadline && gotRemain > tt.wantAtMost {
				t.Errorf("deadline remaining = %v, want <= %v", gotRemain, tt.wantAtMost)
			}
		})
	}
}

// TestGRPCTimeoutUnaryInterceptor_ExpiresSlowCall proves the deadline actually
// aborts a hung invoker rather than merely being attached to the context.
func TestGRPCTimeoutUnaryInterceptor_ExpiresSlowCall(t *testing.T) {
	t.Setenv(grpcCallTimeoutEnv, "30ms")

	invoker := func(ctx context.Context, _ string, _, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
		<-ctx.Done() // a wedged backend: never responds
		return ctx.Err()
	}

	start := time.Now()
	err := GRPCTimeoutUnaryInterceptor(context.Background(), "/nomarkup.job.v1.JobService/GetJob", nil, nil, nil, invoker)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected the wedged call to fail, got nil error")
	}
	if elapsed > time.Second {
		t.Errorf("call took %v, expected it to be released after ~30ms", elapsed)
	}
}

func TestGRPCCallTimeout_PerMethodOverride(t *testing.T) {
	const method = "/nomarkup.test.v1.TestService/Slow"

	longRunningGRPCMethods[method] = 42 * time.Second
	t.Cleanup(func() { delete(longRunningGRPCMethods, method) })

	if got := GRPCCallTimeout(method); got != 42*time.Second {
		t.Errorf("GRPCCallTimeout(%q) = %v, want 42s", method, got)
	}
	if got := GRPCCallTimeout("/nomarkup.test.v1.TestService/Fast"); got != defaultGRPCCallTimeout {
		t.Errorf("unlisted method timeout = %v, want %v", got, defaultGRPCCallTimeout)
	}
}

func TestGRPCClientKeepalive_BelowServerEnforcementFloor(t *testing.T) {
	t.Parallel()

	kp := GRPCClientKeepalive()
	// grpc-go servers GOAWAY a client that pings more often than their
	// EnforcementPolicy.MinTime. The services set MinTime to
	// GRPCServerMinKeepaliveTime, so the client interval must exceed it.
	if kp.Time <= GRPCServerMinKeepaliveTime {
		t.Errorf("client keepalive Time %v must exceed server MinTime %v", kp.Time, GRPCServerMinKeepaliveTime)
	}
	if !kp.PermitWithoutStream {
		t.Error("PermitWithoutStream must be true so idle subchannels are probed")
	}
}
