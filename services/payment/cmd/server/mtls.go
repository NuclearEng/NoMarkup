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
	return cfg.AppendServerOptions(opts)
}
