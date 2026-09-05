package grpmtls

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

func TestLoad_insecureByDefault(t *testing.T) {
	t.Setenv("GRPC_MTLS", "")
	t.Setenv("GRPC_TLS_CERT_FILE", "")
	t.Setenv("GRPC_TLS_KEY_FILE", "")
	t.Setenv("GRPC_TLS_CA_FILE", "")
	t.Setenv("ENVIRONMENT", "development")

	cfg, err := Load()
	require.NoError(t, err)
	assert.False(t, cfg.Enabled)

	creds, err := cfg.ClientCredentials()
	require.NoError(t, err)
	assert.Equal(t, "insecure", creds.Info().SecurityProtocol)
}

func TestLoad_partialPathsFailClosed(t *testing.T) {
	t.Setenv("GRPC_MTLS", "")
	t.Setenv("GRPC_TLS_CERT_FILE", "/tmp/only-cert.pem")
	t.Setenv("GRPC_TLS_KEY_FILE", "")
	t.Setenv("GRPC_TLS_CA_FILE", "")

	_, err := Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "partial")
}

func TestLoad_forceWithoutPathsFails(t *testing.T) {
	t.Setenv("GRPC_MTLS", "true")
	t.Setenv("GRPC_TLS_CERT_FILE", "")
	t.Setenv("GRPC_TLS_KEY_FILE", "")
	t.Setenv("GRPC_TLS_CA_FILE", "")

	_, err := Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "incomplete")
}

func TestLoad_andRoundTripCredentials(t *testing.T) {
	dir := t.TempDir()
	caCert, caKey := mustCA(t)
	writePEM(t, filepath.Join(dir, "ca.pem"), "CERTIFICATE", caCert.Raw)

	srvCert, srvKey := mustLeaf(t, caCert, caKey, "payment", false)
	writeCertKey(t, dir, "server", srvCert, srvKey)

	cliCert, cliKey := mustLeaf(t, caCert, caKey, "gateway", true)
	writeCertKey(t, dir, "client", cliCert, cliKey)

	t.Setenv("GRPC_MTLS", "true")
	t.Setenv("GRPC_TLS_CERT_FILE", filepath.Join(dir, "client.pem"))
	t.Setenv("GRPC_TLS_KEY_FILE", filepath.Join(dir, "client-key.pem"))
	t.Setenv("GRPC_TLS_CA_FILE", filepath.Join(dir, "ca.pem"))
	t.Setenv("GRPC_TLS_SERVER_NAME", "nomarkup-mesh")

	cfg, err := Load()
	require.NoError(t, err)
	assert.True(t, cfg.Enabled)

	clientCreds, err := cfg.ClientCredentials()
	require.NoError(t, err)
	assert.Equal(t, "tls", clientCreds.Info().SecurityProtocol)

	t.Setenv("GRPC_TLS_CERT_FILE", filepath.Join(dir, "server.pem"))
	t.Setenv("GRPC_TLS_KEY_FILE", filepath.Join(dir, "server-key.pem"))
	srvCfg, err := Load()
	require.NoError(t, err)
	serverCreds, err := srvCfg.ServerCredentials()
	require.NoError(t, err)
	require.NotNil(t, serverCreds)
	assert.Equal(t, "tls", serverCreds.Info().SecurityProtocol)
}

func TestPeerServiceName_fromSPIFFE(t *testing.T) {
	uri, err := url.Parse("spiffe://nomarkup/service/gateway")
	require.NoError(t, err)
	leaf := &x509.Certificate{
		Subject: pkix.Name{CommonName: "ignored"},
		URIs:    []*url.URL{uri},
	}
	assert.Equal(t, "gateway", PeerServiceName(peerWithLeaf(leaf)))
}

func TestPeerServiceName_fromCN(t *testing.T) {
	leaf := &x509.Certificate{Subject: pkix.Name{CommonName: "job"}}
	assert.Equal(t, "job", PeerServiceName(peerWithLeaf(leaf)))
	assert.Equal(t, "", PeerServiceName(nil))
	assert.Equal(t, "", PeerServiceName(&peer.Peer{}))
}

func TestParsePeerAllowlist(t *testing.T) {
	assert.Nil(t, ParsePeerAllowlist(""))
	assert.Nil(t, ParsePeerAllowlist("  ,  , "))
	got := ParsePeerAllowlist(" gateway ,payment, job ")
	assert.Equal(t, map[string]struct{}{
		"gateway": {},
		"payment": {},
		"job":     {},
	}, got)
}

func TestPeerAllowlistFromEnv_emptyDefault(t *testing.T) {
	t.Setenv("MESH_PEER_ALLOWLIST", "")
	assert.Nil(t, PeerAllowlistFromEnv())
}

func TestUnaryServerInterceptor_emptyAllowlistIsNoop(t *testing.T) {
	called := false
	interceptor := UnaryServerInterceptor(nil)
	resp, err := interceptor(context.Background(), "req", &grpc.UnaryServerInfo{FullMethod: "/t/M"},
		func(ctx context.Context, req any) (any, error) {
			called = true
			return "ok", nil
		})
	require.NoError(t, err)
	assert.Equal(t, "ok", resp)
	assert.True(t, called)
}

func TestUnaryServerInterceptor_allow(t *testing.T) {
	allowed := ParsePeerAllowlist("gateway,payment")
	uri, err := url.Parse("spiffe://nomarkup/service/gateway")
	require.NoError(t, err)
	leaf := &x509.Certificate{
		Subject: pkix.Name{CommonName: "ignored"},
		URIs:    []*url.URL{uri},
	}
	ctx := peer.NewContext(context.Background(), peerWithLeaf(leaf))

	called := false
	interceptor := UnaryServerInterceptor(allowed)
	resp, err := interceptor(ctx, "req", &grpc.UnaryServerInfo{FullMethod: "/t/M"},
		func(ctx context.Context, req any) (any, error) {
			called = true
			return "ok", nil
		})
	require.NoError(t, err)
	assert.Equal(t, "ok", resp)
	assert.True(t, called)
}

func TestUnaryServerInterceptor_denyUnknownPeer(t *testing.T) {
	allowed := ParsePeerAllowlist("gateway")
	leaf := &x509.Certificate{Subject: pkix.Name{CommonName: "fraud"}}
	ctx := peer.NewContext(context.Background(), peerWithLeaf(leaf))

	interceptor := UnaryServerInterceptor(allowed)
	resp, err := interceptor(ctx, "req", &grpc.UnaryServerInfo{FullMethod: "/t/M"},
		func(ctx context.Context, req any) (any, error) {
			t.Fatal("handler must not run for denied peer")
			return nil, nil
		})
	assert.Nil(t, resp)
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Contains(t, st.Message(), "fraud")
	assert.Contains(t, st.Message(), "MESH_PEER_ALLOWLIST")
}

func TestUnaryServerInterceptor_denyMissingPeer(t *testing.T) {
	// Allowlist armed but no TLS peer (insecure dial) → fail closed.
	allowed := ParsePeerAllowlist("gateway")
	interceptor := UnaryServerInterceptor(allowed)
	_, err := interceptor(context.Background(), "req", &grpc.UnaryServerInfo{FullMethod: "/t/M"},
		func(ctx context.Context, req any) (any, error) {
			t.Fatal("handler must not run without peer identity")
			return nil, nil
		})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
}

func TestStreamServerInterceptor_allowAndDeny(t *testing.T) {
	allowed := ParsePeerAllowlist("gateway")

	allowLeaf := &x509.Certificate{Subject: pkix.Name{CommonName: "gateway"}}
	allowSS := &stubServerStream{ctx: peer.NewContext(context.Background(), peerWithLeaf(allowLeaf))}
	err := StreamServerInterceptor(allowed)(nil, allowSS, &grpc.StreamServerInfo{FullMethod: "/t/S"},
		func(srv any, ss grpc.ServerStream) error { return nil })
	require.NoError(t, err)

	denyLeaf := &x509.Certificate{Subject: pkix.Name{CommonName: "chat"}}
	denySS := &stubServerStream{ctx: peer.NewContext(context.Background(), peerWithLeaf(denyLeaf))}
	err = StreamServerInterceptor(allowed)(nil, denySS, &grpc.StreamServerInfo{FullMethod: "/t/S"},
		func(srv any, ss grpc.ServerStream) error {
			t.Fatal("handler must not run for denied stream peer")
			return nil
		})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
}

func TestAppendServerOptions_wiresAllowlistInterceptor(t *testing.T) {
	t.Setenv("MESH_PEER_ALLOWLIST", "gateway")
	t.Setenv("GRPC_MTLS", "")
	t.Setenv("GRPC_TLS_CERT_FILE", "")
	t.Setenv("GRPC_TLS_KEY_FILE", "")
	t.Setenv("GRPC_TLS_CA_FILE", "")

	cfg, err := Load()
	require.NoError(t, err)
	opts, err := cfg.AppendServerOptions(nil)
	require.NoError(t, err)
	// Creds disabled + allowlist set → two chain options (unary + stream).
	assert.Len(t, opts, 2)
}

type stubServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *stubServerStream) Context() context.Context { return s.ctx }

func peerWithLeaf(leaf *x509.Certificate) *peer.Peer {
	return &peer.Peer{
		AuthInfo: credentials.TLSInfo{
			State: tls.ConnectionState{
				PeerCertificates: []*x509.Certificate{leaf},
			},
		},
	}
}

func mustCA(t *testing.T) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "nomarkup-mesh-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	return cert, key
}

func mustLeaf(t *testing.T, ca *x509.Certificate, caKey *ecdsa.PrivateKey, name string, withSPIFFE bool) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:     []string{"nomarkup-mesh", name},
	}
	if withSPIFFE {
		u, err := url.Parse("spiffe://nomarkup/service/" + name)
		require.NoError(t, err)
		tmpl.URIs = []*url.URL{u}
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca, &key.PublicKey, caKey)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	return cert, key
}

func writePEM(t *testing.T, path, typ string, der []byte) {
	t.Helper()
	f, err := os.Create(path)
	require.NoError(t, err)
	defer f.Close()
	require.NoError(t, pem.Encode(f, &pem.Block{Type: typ, Bytes: der}))
}

func writeCertKey(t *testing.T, dir, prefix string, cert *x509.Certificate, key *ecdsa.PrivateKey) {
	t.Helper()
	writePEM(t, filepath.Join(dir, prefix+".pem"), "CERTIFICATE", cert.Raw)
	keyDER, err := x509.MarshalECPrivateKey(key)
	require.NoError(t, err)
	writePEM(t, filepath.Join(dir, prefix+"-key.pem"), "EC PRIVATE KEY", keyDER)
}
