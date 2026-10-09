package main

import (
	"fmt"
	"log/slog"

	"github.com/nomarkup/nomarkup/pkg/grpmtls"
	"google.golang.org/grpc"
)

func meshServerOptions(opts []grpc.ServerOption) ([]grpc.ServerOption, error) {
	cfg, err := grpmtls.Load()
	if err != nil {
		return nil, fmt.Errorf("grpmtls load: %w", err)
	}
	if cfg.Enabled {
		slog.Info("gRPC mesh mTLS enabled for payment server")
	} else {
		slog.Warn("gRPC mesh mTLS disabled; payment server accepts insecure credentials")
	}
	if al := grpmtls.PeerAllowlistFromEnv(); len(al) > 0 {
		slog.Info("gRPC mesh peer allowlist enabled for payment server", "count", len(al))
	}
	return cfg.AppendServerOptions(opts)
}
