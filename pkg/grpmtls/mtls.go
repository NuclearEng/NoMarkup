// Package grpmtls loads mutual-TLS credentials for the NoMarkup gRPC mesh.
//
// Until mTLS is armed, any process that can open a TCP connection to a service
// port can call RPCs and supply any customer_id / provider_id in the request
// body — network position is the authentication boundary. Arming mTLS makes
// peer identity cryptographic: only holders of a mesh client certificate can
// dial, and servers record the peer's service name from the cert.
//
// Configuration (all optional in development; required together when armed):
//
//	GRPC_MTLS              = "true" | "1" to require mTLS (also implied when
//	                         ENVIRONMENT=production AND the three paths are set)
//	GRPC_TLS_CERT_FILE     = path to this process's certificate (PEM)
//	GRPC_TLS_KEY_FILE      = path to this process's private key (PEM)
//	GRPC_TLS_CA_FILE       = path to the mesh CA that signed peer certs (PEM)
//	GRPC_TLS_SERVER_NAME   = expected server name for client dials (optional;
//	                         defaults to the cert DNS SAN / "nomarkup-mesh")
//	GRPC_MTLS_SERVICE_NAME = SPIFFE-ish identity this process presents as the
//	                         certificate Common Name when minting is external;
//	                         used by PeerServiceName for allowlists
//	MESH_PEER_ALLOWLIST    = comma-separated mesh service names permitted to
//	                         call this server (e.g. "gateway,payment"). Empty
//	                         (default) = no peer-identity check. When set,
//	                         Unary/Stream interceptors reject peers whose
//	                         SPIFFE/CN is not on the list (PermissionDenied).
//
// Development default remains insecure credentials when GRPC_MTLS is unset and
// the cert paths are empty — local `go test` and docker-compose without certs
// keep working. Production with GRPC_MTLS=true and missing files fails closed
// at Load time rather than silently dialing plaintext.
package grpmtls

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

// Config is the resolved mTLS posture for one process.
type Config struct {
	// Enabled is true when this process will present and require mesh certs.
	Enabled bool
	// ServiceName is the mesh identity this process claims (from env or cert CN).
	ServiceName string
	// ServerName is the value used as tls.Config.ServerName on client dials.
	ServerName string

	certFile string
	keyFile  string
	caFile   string
}

// Load reads mTLS configuration from the environment.
//
// Fail-closed rules:
//   - GRPC_MTLS=true (or 1) with any cert path missing → error
//   - ENVIRONMENT=production and GRPC_MTLS=true with incomplete paths → error
//   - Partial paths (some set, some empty) without GRPC_MTLS → error (misconfig)
//
// Fail-open (insecure) only when mTLS is not requested and no cert paths are set.
func Load() (Config, error) {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
	force := truthy(os.Getenv("GRPC_MTLS"))
	certFile := strings.TrimSpace(os.Getenv("GRPC_TLS_CERT_FILE"))
	keyFile := strings.TrimSpace(os.Getenv("GRPC_TLS_KEY_FILE"))
	caFile := strings.TrimSpace(os.Getenv("GRPC_TLS_CA_FILE"))
	serverName := strings.TrimSpace(os.Getenv("GRPC_TLS_SERVER_NAME"))
	if serverName == "" {
		serverName = "nomarkup-mesh"
	}
	serviceName := strings.TrimSpace(os.Getenv("GRPC_MTLS_SERVICE_NAME"))

	anyPath := certFile != "" || keyFile != "" || caFile != ""
	allPaths := certFile != "" && keyFile != "" && caFile != ""

	if force && !allPaths {
		return Config{}, fmt.Errorf("grpmtls: GRPC_MTLS is set but GRPC_TLS_CERT_FILE / GRPC_TLS_KEY_FILE / GRPC_TLS_CA_FILE are incomplete")
	}
	if anyPath && !allPaths {
		return Config{}, fmt.Errorf("grpmtls: partial TLS paths set; provide all three of GRPC_TLS_CERT_FILE, GRPC_TLS_KEY_FILE, GRPC_TLS_CA_FILE (or none)")
	}

	// Production does not auto-enable mTLS (certs may not be provisioned yet —
	// DEPLOY_PROVISIONED). Operators arm it explicitly via GRPC_MTLS=true once
	// the mesh CA and per-service certs exist. Auto-enabling would brick a
	// production deploy that has not finished cert rollout.
	_ = env

	cfg := Config{
		Enabled:     force && allPaths,
		ServiceName: serviceName,
		ServerName:  serverName,
		certFile:    certFile,
		keyFile:     keyFile,
		caFile:      caFile,
	}
	if !cfg.Enabled && allPaths {
		// Certs present but GRPC_MTLS not set: still enable. Having the files
		// mounted is the operator signal to use them; requiring a second flag
		// has caused "certs mounted, still plaintext" surprises elsewhere.
		cfg.Enabled = true
	}
	return cfg, nil
}

// ClientCredentials returns transport credentials for a gRPC dial.
// When mTLS is disabled this is insecure.NewCredentials() — same as today.
func (c Config) ClientCredentials() (credentials.TransportCredentials, error) {
	if !c.Enabled {
		return insecure.NewCredentials(), nil
	}
	tlsCfg, err := c.clientTLS()
	if err != nil {
		return nil, err
	}
	return credentials.NewTLS(tlsCfg), nil
}

// ServerCredentials returns transport credentials for a gRPC server.
// When mTLS is disabled this is nil (caller should omit grpc.Creds).
func (c Config) ServerCredentials() (credentials.TransportCredentials, error) {
	if !c.Enabled {
		return nil, nil
	}
	tlsCfg, err := c.serverTLS()
	if err != nil {
		return nil, err
	}
	return credentials.NewTLS(tlsCfg), nil
}

// DialOption is a convenience wrapper for ClientCredentials.
func (c Config) DialOption() (grpc.DialOption, error) {
	creds, err := c.ClientCredentials()
	if err != nil {
		return nil, err
	}
	return grpc.WithTransportCredentials(creds), nil
}

// AppendServerOptions adds grpc.Creds when mTLS is enabled, and optional
// MESH_PEER_ALLOWLIST unary/stream interceptors when that env is non-empty.
// When mTLS is disabled and the allowlist is empty the slice is returned
// unchanged so callers can keep a single construction path.
func (c Config) AppendServerOptions(opts []grpc.ServerOption) ([]grpc.ServerOption, error) {
	creds, err := c.ServerCredentials()
	if err != nil {
		return nil, err
	}
	if creds != nil {
		opts = append(opts, grpc.Creds(creds))
	}
	if allowed := PeerAllowlistFromEnv(); len(allowed) > 0 {
		opts = append(opts,
			grpc.ChainUnaryInterceptor(UnaryServerInterceptor(allowed)),
			grpc.ChainStreamInterceptor(StreamServerInterceptor(allowed)),
		)
	}
	return opts, nil
}

func (c Config) clientTLS() (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(c.certFile, c.keyFile)
	if err != nil {
		return nil, fmt.Errorf("grpmtls: load client key pair: %w", err)
	}
	caPEM, err := os.ReadFile(c.caFile)
	if err != nil {
		return nil, fmt.Errorf("grpmtls: read CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("grpmtls: no certificates found in CA file %s", c.caFile)
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		RootCAs:      pool,
		ServerName:   c.ServerName,
	}, nil
}

func (c Config) serverTLS() (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(c.certFile, c.keyFile)
	if err != nil {
		return nil, fmt.Errorf("grpmtls: load server key pair: %w", err)
	}
	caPEM, err := os.ReadFile(c.caFile)
	if err != nil {
		return nil, fmt.Errorf("grpmtls: read CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("grpmtls: no certificates found in CA file %s", c.caFile)
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		ClientCAs:    pool,
		// Require a mesh client cert. Kubelet native gRPC probes cannot present
		// one — switch liveness/readiness to the HTTP healthz port when mTLS is
		// armed (see deploy/k8s and docs/operations).
		ClientAuth: tls.RequireAndVerifyClientCert,
	}, nil
}

// PeerServiceName extracts the calling mesh service identity from the peer
// certificate on an inbound RPC. Prefer the URI SAN (SPIFFE-style
// spiffe://nomarkup/service/<name>); fall back to the leaf Common Name.
// Returns "" when mTLS is not in use or the peer presented no cert.
func PeerServiceName(p *peer.Peer) string {
	if p == nil || p.AuthInfo == nil {
		return ""
	}
	tlsInfo, ok := p.AuthInfo.(credentials.TLSInfo)
	if !ok {
		return ""
	}
	state := tlsInfo.State
	if len(state.PeerCertificates) == 0 {
		return ""
	}
	leaf := state.PeerCertificates[0]
	for _, uri := range leaf.URIs {
		if uri == nil {
			continue
		}
		// spiffe://nomarkup/service/gateway → gateway
		const prefix = "spiffe://nomarkup/service/"
		if strings.HasPrefix(uri.String(), prefix) {
			return strings.TrimPrefix(uri.String(), prefix)
		}
		if uri.Scheme == "spiffe" {
			parts := strings.Split(strings.Trim(uri.Path, "/"), "/")
			if len(parts) > 0 {
				return parts[len(parts)-1]
			}
		}
	}
	return leaf.Subject.CommonName
}

// PeerAllowlistFromEnv reads MESH_PEER_ALLOWLIST (comma-separated service
// names). Empty / whitespace-only → nil (no extra check). Unknown names are
// not validated against a global catalog — operators set what each server
// accepts.
func PeerAllowlistFromEnv() map[string]struct{} {
	return ParsePeerAllowlist(os.Getenv("MESH_PEER_ALLOWLIST"))
}

// ParsePeerAllowlist parses a comma-separated list of mesh service names into
// a set. Empty tokens are skipped. Returns nil when the result would be empty
// so callers can use len(allowed) == 0 as "disabled".
func ParsePeerAllowlist(s string) map[string]struct{} {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	out := make(map[string]struct{})
	for _, part := range strings.Split(s, ",") {
		name := strings.TrimSpace(part)
		if name == "" {
			continue
		}
		out[name] = struct{}{}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// peerAllowed reports whether the peer identity from ctx is on the allowlist.
// Empty allowlist → always true (feature off). Unknown or missing peer name →
// false (fail closed when the feature is armed).
func peerAllowed(ctx context.Context, allowed map[string]struct{}) (string, bool) {
	if len(allowed) == 0 {
		return "", true
	}
	p, _ := peer.FromContext(ctx)
	name := PeerServiceName(p)
	_, ok := allowed[name]
	return name, ok
}

// UnaryServerInterceptor rejects unary RPCs whose peer SPIFFE/CN is not in
// allowed. When allowed is empty/nil the interceptor is a no-op (default OFF).
// Denied calls return codes.PermissionDenied.
func UnaryServerInterceptor(allowed map[string]struct{}) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		name, ok := peerAllowed(ctx, allowed)
		if !ok {
			return nil, status.Errorf(codes.PermissionDenied, "mesh peer %q not in MESH_PEER_ALLOWLIST", name)
		}
		return handler(ctx, req)
	}
}

// StreamServerInterceptor is the streaming counterpart of UnaryServerInterceptor.
func StreamServerInterceptor(allowed map[string]struct{}) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		name, ok := peerAllowed(ss.Context(), allowed)
		if !ok {
			return status.Errorf(codes.PermissionDenied, "mesh peer %q not in MESH_PEER_ALLOWLIST", name)
		}
		return handler(srv, ss)
	}
}

func truthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
