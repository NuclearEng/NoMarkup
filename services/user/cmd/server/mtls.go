package main

import (
	"fmt"

	"github.com/nomarkup/nomarkup/pkg/grpmtls"
	"google.golang.org/grpc"
)

func meshClientDialOption() (grpc.DialOption, error) {
	cfg, err := grpmtls.Load()
	if err != nil {
		return nil, fmt.Errorf("grpmtls load: %w", err)
	}
	return cfg.DialOption()
}

func meshServerOptions(opts []grpc.ServerOption) ([]grpc.ServerOption, error) {
	cfg, err := grpmtls.Load()
	if err != nil {
		return nil, fmt.Errorf("grpmtls load: %w", err)
	}
	// mTLS + optional MESH_PEER_ALLOWLIST interceptor both applied in
	// AppendServerOptions (empty allowlist = no peer check).
	return cfg.AppendServerOptions(opts)
}
