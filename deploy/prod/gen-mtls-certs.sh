#!/usr/bin/env bash
# Generate a local mesh CA and per-service mTLS certificates for
# deploy/prod/docker-compose.mtls.yml (gRPC mutual TLS between services).
#
# Usage:
#   deploy/prod/gen-mtls-certs.sh                 # writes deploy/prod/mtls/
#   MTLS_DIR=/opt/nomarkup/mtls deploy/prod/gen-mtls-certs.sh
#   MTLS_CERT_OWNER=10001:10001 sudo -E deploy/prod/gen-mtls-certs.sh
#   deploy/prod/gen-mtls-certs.sh --force         # rotate (overwrites leaf certs; keeps CA)
#   deploy/prod/gen-mtls-certs.sh --force-ca      # rotate CA AND all leaf certs
#
# Layout (one directory per service, mounted read-only at /mtls):
#   mtls/ca/ca.crt  mtls/ca/ca.key        (CA — keep OFF the containers; back up off-box)
#   mtls/<svc>/tls.crt  tls.key  ca.crt   (what each container sees)
#
# Every leaf is usable as both server and client (serverAuth + clientAuth) and
# carries:
#   CN=<svc>, DNS SANs <svc> + nomarkup-mesh (+ localhost),
#   URI SAN spiffe://nomarkup/service/<svc>
# pkg/grpmtls clients verify ServerName "nomarkup-mesh" by default and
# PeerServiceName() reads the SPIFFE URI, so MESH_PEER_ALLOWLIST can use the
# plain service names below.
#
# Private keys are never printed. The output dir is gitignored; never commit it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MTLS_DIR="${MTLS_DIR:-${SCRIPT_DIR}/mtls}"
CA_DAYS="${MTLS_CA_DAYS:-1825}"
LEAF_DAYS="${MTLS_LEAF_DAYS:-397}"
SERVICES="${MTLS_SERVICES:-gateway user job payment chat notification bidding fraud trust imaging underwriting pricing}"
FORCE=0
FORCE_CA=0
for arg in "$@"; do
  case "${arg}" in
    --force) FORCE=1 ;;
    --force-ca) FORCE=1; FORCE_CA=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown argument: ${arg}" >&2; exit 2 ;;
  esac
done

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }
umask 077
mkdir -p "${MTLS_DIR}/ca"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

log() { printf '[gen-mtls] %s\n' "$*"; }

CA_KEY="${MTLS_DIR}/ca/ca.key"
CA_CRT="${MTLS_DIR}/ca/ca.crt"
if [[ "${FORCE_CA}" == "1" || ! -s "${CA_KEY}" || ! -s "${CA_CRT}" ]]; then
  log "creating mesh CA (${CA_DAYS}d)"
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "${CA_KEY}" 2>/dev/null
  openssl req -x509 -new -key "${CA_KEY}" -sha256 -days "${CA_DAYS}" \
    -subj "/O=NoMarkup/CN=NoMarkup Mesh CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -out "${CA_CRT}"
else
  log "reusing existing CA at ${CA_CRT}"
fi

for svc in ${SERVICES}; do
  [[ "${svc}" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "invalid service name: ${svc}" >&2; exit 1; }
  out="${MTLS_DIR}/${svc}"
  if [[ "${FORCE}" != "1" && -s "${out}/tls.crt" && -s "${out}/tls.key" ]]; then
    log "${svc}: exists (use --force to rotate)"
    cp "${CA_CRT}" "${out}/ca.crt"
    continue
  fi
  mkdir -p "${out}"
  cat > "${TMP}/${svc}.ext" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
subjectAltName=DNS:${svc},DNS:nomarkup-mesh,DNS:localhost,URI:spiffe://nomarkup/service/${svc}
EXT
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "${out}/tls.key" 2>/dev/null
  openssl req -new -key "${out}/tls.key" -subj "/O=NoMarkup/CN=${svc}" -out "${TMP}/${svc}.csr"
  openssl x509 -req -in "${TMP}/${svc}.csr" -CA "${CA_CRT}" -CAkey "${CA_KEY}" \
    -CAcreateserial -CAserial "${TMP}/ca.srl" -sha256 -days "${LEAF_DAYS}" \
    -extfile "${TMP}/${svc}.ext" -out "${out}/tls.crt" 2>/dev/null
  cp "${CA_CRT}" "${out}/ca.crt"
  openssl verify -CAfile "${CA_CRT}" "${out}/tls.crt" >/dev/null
  log "${svc}: issued ($(openssl x509 -in "${out}/tls.crt" -noout -enddate))"
done

# Permissions: certs world-readable, keys owner-only. Containers that run as a
# non-root UID need to own their key: set MTLS_CERT_OWNER=uid:gid (needs root).
find "${MTLS_DIR}" -type d -exec chmod 0755 {} +
find "${MTLS_DIR}" -name '*.crt' -exec chmod 0644 {} +
find "${MTLS_DIR}" -name '*.key' -exec chmod 0600 {} +
chmod 0700 "${MTLS_DIR}/ca"
if [[ -n "${MTLS_CERT_OWNER:-}" ]]; then
  for svc in ${SERVICES}; do chown -R "${MTLS_CERT_OWNER}" "${MTLS_DIR}/${svc}"; done
  log "chowned service dirs to ${MTLS_CERT_OWNER}"
fi

log "done → ${MTLS_DIR}"
log "arm with: docker compose -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.mtls.yml --env-file deploy/prod/.env up -d"
log "or:       MTLS=1 ./scripts/prod/deploy.sh"
