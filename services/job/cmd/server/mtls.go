package main

import (
	"fmt"
	"log/slog"
	"sort"

	"github.com/nomarkup/nomarkup/pkg/grpmtls"
	"google.golang.org/grpc"
)

func meshServerOptions(opts []grpc.ServerOption) ([]grpc.ServerOption, error) {
	cfg, err := grpmtls.Load()
	if err != nil {
		return nil, fmt.Errorf("grpmtls load: %w", err)
	}
	if cfg.Enabled {
		slog.Info("gRPC mesh mTLS enabled for job server")
	} else {
		slog.Warn("gRPC mesh mTLS disabled; job server accepts insecure credentials")
	}
	if al := grpmtls.PeerAllowlistFromEnv(); len(al) > 0 {
		slog.Info("gRPC mesh peer allowlist enabled for job server", "peers", sortedPeerNames(al))
	}
	return cfg.AppendServerOptions(opts)
}

func sortedPeerNames(al map[string]struct{}) []string {
	names := make([]string, 0, len(al))
	for n := range al {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
