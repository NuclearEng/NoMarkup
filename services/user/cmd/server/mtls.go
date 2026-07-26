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
	if cfg.Enabled {
		// log via caller
	}
	return cfg.AppendServerOptions(opts)
}
