#!/usr/bin/env bash
# Generate a local mesh CA and per-service certs for gRPC mTLS (C1).
#
# Usage:
#   ./scripts/gen-mesh-certs.sh [out-dir]
#
# Default out-dir: keys/mesh/
# Mount the resulting files into pods as GRPC_TLS_CERT_FILE / KEY_FILE / CA_FILE
# and set GRPC_MTLS=true (or rely on paths alone). See docs/operations/mesh-mtls.md.
set -euo pipefail

OUT="${1:-keys/mesh}"
mkdir -p "$OUT"
cd "$OUT"

if [[ -f ca.pem && -f ca-key.pem ]]; then
  echo "reusing existing CA in $OUT"
else
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout ca-key.pem -out ca.pem -days 3650 \
    -subj "/CN=nomarkup-mesh-ca"
  echo "wrote ca.pem + ca-key.pem"
fi

# Service identities. CN becomes PeerServiceName fallback; DNS SAN is
# nomarkup-mesh (matches GRPC_TLS_SERVER_NAME default) plus the service name.
services=(
  gateway
  user
  job
  payment
  chat
  notification
  bidding
  fraud
  trust
  imaging
  pricing
  underwriting
)

for svc in "${services[@]}"; do
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout "${svc}-key.pem" -out "${svc}.csr" \
    -subj "/CN=${svc}"
  openssl x509 -req -in "${svc}.csr" -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
    -out "${svc}.pem" -days 825 \
    -extfile <(printf "subjectAltName=DNS:nomarkup-mesh,DNS:%s,URI:spiffe://nomarkup/service/%s\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth\n" "$svc" "$svc")
  rm -f "${svc}.csr"
  echo "wrote ${svc}.pem + ${svc}-key.pem"
done

echo
echo "Example env for gateway:"
echo "  GRPC_MTLS=true"
echo "  GRPC_TLS_CERT_FILE=$OUT/gateway.pem"
echo "  GRPC_TLS_KEY_FILE=$OUT/gateway-key.pem"
echo "  GRPC_TLS_CA_FILE=$OUT/ca.pem"
echo "  GRPC_TLS_SERVER_NAME=nomarkup-mesh"
echo
echo "NOTE: native gRPC kubelet probes cannot present a client cert."
echo "When mTLS is armed, switch liveness/readiness to the HTTP healthz port."
