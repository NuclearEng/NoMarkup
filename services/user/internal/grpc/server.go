package grpc

import (
	"github.com/nomarkup/nomarkup/services/user/internal/service"
	grpclib "google.golang.org/grpc"
)

// Server implements the UserService gRPC server.
type Server struct {
	svc *service.Service
}

// NewServer creates a new gRPC server for the user service.
func NewServer(svc *service.Service) *Server {
	return &Server{svc: svc}
}

// Register registers the user service with a gRPC server.
func Register(s *grpclib.Server, srv *Server) {
	_ = s
	_ = srv
	// Registration will happen after proto codegen:
	// pb.RegisterUserServiceServer(s, srv)
}
