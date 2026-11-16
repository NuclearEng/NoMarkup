package handler

import (
	"crypto/x509"
	"encoding/pem"
	"errors"
	"sync"
)

// appleRootCAG3PEM is the official Apple Root CA - G3 certificate published
// at https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
// (DER converted to PEM). This is a public root certificate, not a secret.
const appleRootCAG3PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----
`

var (
	appleRootPoolOnce sync.Once
	appleRootPool     *x509.CertPool
	appleRootPoolErr  error
)

func appleRootCertPool() (*x509.CertPool, error) {
	appleRootPoolOnce.Do(func() {
		block, _ := pem.Decode([]byte(appleRootCAG3PEM))
		if block == nil || len(block.Bytes) == 0 {
			appleRootPoolErr = errors.New("apple root CA G3: PEM decode failed")
			return
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			appleRootPoolErr = err
			return
		}
		pool := x509.NewCertPool()
		pool.AddCert(cert)
		appleRootPool = pool
	})
	if appleRootPoolErr != nil {
		return nil, appleRootPoolErr
	}
	return appleRootPool, nil
}
