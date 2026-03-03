package grpc

import (
	"github.com/nomarkup/nomarkup/services/job/internal/service"
	grpclib "google.golang.org/grpc"
)

// Server implements the JobService gRPC server.
type Server struct {
	svc *service.Service
}

// NewServer creates a new gRPC server for the job service.
func NewServer(svc *service.Service) *Server {
	return &Server{svc: svc}
}

// Register registers the job service with a gRPC server.
func Register(s *grpclib.Server, srv *Server) {
	_ = s
	_ = srv
	// Registration will happen after proto codegen:
	// pb.RegisterJobServiceServer(s, srv)
}
