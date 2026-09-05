package client

import (
	"fmt"

	"github.com/nomarkup/nomarkup/pkg/grpmtls"
	"google.golang.org/grpc"
)

// meshDialOption loads shared mesh mTLS (or insecure when unconfigured).
func meshDialOption() (grpc.DialOption, error) {
	cfg, err := grpmtls.Load()
	if err != nil {
		return nil, fmt.Errorf("grpmtls load: %w", err)
	}
	return cfg.DialOption()
}
