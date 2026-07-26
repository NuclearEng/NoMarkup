package grpmtls

import (
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
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
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
