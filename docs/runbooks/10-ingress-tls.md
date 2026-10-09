# Runbook: Ingress / TLS edge degraded

**Resources:** `deploy/k8s/base/ingress.yaml` · TLS secret `nomarkup-tls`  
**Edge:** Cloudflare (registrar + DNS + CDN for **`no-markup.com`**) → nginx Ingress Controller → gateway/web  
**Mesh TLS (separate):** `docs/operations/mesh-mtls.md` — gRPC peer mTLS, **not** browser TLS

Public TLS terminates at the cluster edge (ingress-nginx + `nomarkup-tls`). The
gateway and web Deployments speak **plain HTTP** inside the cluster; NetworkPolicy
restricts who may dial them (`allow-ingress-to-gateway` / `allow-ingress-to-web`).

## Symptoms

- Browsers: `NET::ERR_CERT_*`, certificate name mismatch, expired cert, or endless
  redirect (HTTP↔HTTPS loop).
- Clients: intermittent `SSL handshake failed`, 502/504 from Cloudflare or nginx,
  WebSocket upgrade failures on `/ws/`.
- External monitors: HTTPS probe fails while in-cluster `curl http://gateway:8080/health` works.
- Alerts that often co-fire when the **edge** is wrong but pods are fine:
  - `NoMarkupGatewayDown` / `NoMarkupServiceDown` (replicas up, but traffic never lands)
  - `NoMarkupHighErrorRate` / latency spikes (502/504 counted as errors)
  - `NoMarkupWebSocketConnectionDrop` (WS ingress timeouts / sticky hash issues)

If pod readiness is failing, triage DB/Redis first:
[02-database-master-down.md](./02-database-master-down.md),
[07-redis-degraded.md](./07-redis-degraded.md).

## Severity

| Impact | Priority |
|--------|----------|
| Site-wide HTTPS or all `/api/` / `/ws/` paths fail | **P0** |
| WWW-only, single path, or cert nearing expiry with no user impact yet | **P1** |

## Immediate checks

```bash
# DNS + public cert (from laptop / bastion)
dig +short no-markup.com A
dig +short www.no-markup.com A
echo | openssl s_client -servername no-markup.com -connect no-markup.com:443 2>/dev/null \
  | openssl x509 -noout -dates -subject -issuer

# Cluster ingress + TLS secret
kubectl get ingress -n nomarkup
kubectl describe ingress -n nomarkup nomarkup-ingress
kubectl describe ingress -n nomarkup nomarkup-ingress-websocket
kubectl get secret -n nomarkup nomarkup-tls -o jsonpath='{.type}{"\n"}'
# Decode leaf cert expiry (never paste private key material into chat/logs)
kubectl get secret -n nomarkup nomarkup-tls -o jsonpath='{.data.tls\.crt}' \
  | base64 -d | openssl x509 -noout -dates -subject -issuer -ext subjectAltName

# Ingress controller
kubectl get pods -n ingress-nginx
kubectl logs -n ingress-nginx -l app.kubernetes.io/component=controller --tail=100

# In-cluster backends (bypass edge TLS)
kubectl exec -n nomarkup deploy/gateway -- wget -qO- http://127.0.0.1:8080/health || true
kubectl get endpoints -n nomarkup gateway web
```

**Interpretation**

| Public HTTPS | In-cluster `/health` | Likely layer |
|--------------|----------------------|--------------|
| Fail | OK | Cloudflare / DNS / ingress TLS / NetworkPolicy |
| Fail | Fail | Gateway / deps — not this runbook alone |
| OK API, fail WS | OK | `nomarkup-ingress-websocket` timeouts / Upgrade headers |
| OK apex, fail www | OK | Missing host in Ingress TLS hosts or CF DNS |

## Common causes

1. **`nomarkup-tls` missing, expired, or wrong SANs**  
   Ingress references `secretName: nomarkup-tls` for hosts `no-markup.com` and
   `www.no-markup.com` (main) / apex only (websocket Ingress). Secret must be
   type `kubernetes.io/tls` with `tls.crt` + `tls.key`. Cert-manager or manual
   issuance is **out of band** until provisioning completes
   (`docs/operations/provisioning-checklist.md`).

2. **Cloudflare SSL/TLS mode mismatch**  
   Origin serves HTTPS with a valid (or CF Origin) cert. Modes:
   - **Full (strict)** — requires a publicly trusted or Cloudflare Origin CA cert on ingress (preferred for prod).
   - **Full** — accepts any cert (including expired/self-signed) on origin.
   - **Flexible** — CF↔visitor HTTPS, CF↔origin HTTP — **avoid**; breaks assumptions and can loop with `ssl-redirect: "true"`.

3. **Ingress class / controller down**  
   Spec uses `ingressClassName: nginx`. Wrong class or dead `ingress-nginx` pods → no edge routes.

4. **Path routing / backend Service**  
   Main Ingress: `/api/` and `/ws/` → `gateway:8080`; `/` → `web:3000`. Empty Endpoints on those Services look like 502 at the edge even when other pods are healthy.

5. **WebSocket-specific**  
   Dedicated Ingress `nomarkup-ingress-websocket`: 3600s read/send timeouts, Upgrade headers, `upstream-hash-by: $remote_addr`. Too-short CF or LB idle timeouts drop long-lived chat/WS.

6. **Body size / timeouts on API**  
   Annotations: `proxy-body-size: "25m"`, 60s read/send. Large uploads or slow upstreams return 413/504 at nginx (app `MAX_FILE_SIZE_BYTES` is still 10MB — edge is looser on purpose).

7. **NetworkPolicy**  
   Only pods labeled as ingress-nginx may hit gateway/web Ingress ports. A custom LB or debug port-forward from the wrong namespace will be denied.

8. **Mesh mTLS confusion**  
   Edge TLS ≠ gRPC mTLS. Arming mesh certs does not fix browser `ERR_CERT_*`. See [mesh-mtls.md](../operations/mesh-mtls.md).

## Mitigation

### Path A: Certificate refresh

```bash
# After storing a new PEM pair in Vault / ExternalSecret (names illustrative):
kubectl annotate externalsecret nomarkup-secrets force-sync=$(date +%s) -n nomarkup --overwrite
# Or apply a kubernetes.io/tls secret (ops-only; never commit keys):
# kubectl create secret tls nomarkup-tls --cert=fullchain.pem --key=privkey.pem -n nomarkup --dry-run=client -o yaml | kubectl apply -f -

# Force nginx to reload (usually automatic on secret update)
kubectl rollout restart deployment -n ingress-nginx -l app.kubernetes.io/component=controller
```

Confirm SANs include both apex and `www` if both are used publicly.

### Path B: Cloudflare

1. DNS: orange-cloud (proxied) A/AAAA/CNAME for apex + www pointing at the cluster LB / ingress.
2. SSL/TLS → Overview: **Full (strict)** once origin cert is valid.
3. Edge Certificates: Universal SSL active; no expired custom certs overriding.
4. Network: WebSockets **enabled** for `/ws/`.
5. If you just rotated origin certs, purge CF cache only for HTML/assets if needed — **API data** uses gateway `Cache-Control` / ETag; do not “fix” TLS by setting Flexible.

### Path C: Ingress / controller recovery

```bash
kubectl get ingressclass
kubectl rollout status deployment -n ingress-nginx -l app.kubernetes.io/component=controller
# Re-apply base ingress if objects were deleted
kubectl apply -f deploy/k8s/base/ingress.yaml
```

### Path D: Backend 502 with healthy pods

```bash
kubectl get svc,endpoints -n nomarkup gateway web
kubectl describe networkpolicy -n nomarkup allow-ingress-to-gateway allow-ingress-to-web
# Confirm readiness so endpoints are populated
kubectl get pods -n nomarkup -l app.kubernetes.io/name=gateway
```

Roll gateway/web only if readiness is false or logs show crash loops — not as a first response to cert errors.

## Verify

```bash
curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://no-markup.com/api/v1/markets
curl -sSI https://no-markup.com/ | head -n 15
# Expect HTTP/2 or HTTP/1.1 200/301/304 as designed; ssl_verify_result 0
echo | openssl s_client -servername no-markup.com -connect no-markup.com:443 2>/dev/null \
  | openssl x509 -noout -checkend 604800   # fails if expires within 7 days
```

- Ingress address assigned; no `secret "nomarkup-tls" not found` events on the Ingress.
- WS path: authenticated client can open `/ws/chat` (or app-specific WS) without 502.
- Gateway `/metrics` remains **not** publicly routed (only `/api/` + `/ws/` to gateway) — see `deploy/k8s/README.md`.

## Escalation

- Cert inventory / Vault access: platform secrets owner (`deploy/k8s/SECRETS.md`).
- Cloudflare account / zone settings: founder ops (account/zone IDs are not in-repo).
- Cluster LB / nginx controller: platform on-call.
- Suspected app regression after cert is proven good: service runbooks (auth 05, redis 07, DB 02).

## Related

- [README.md](./README.md) — alert → runbook index  
- [mesh-mtls.md](../operations/mesh-mtls.md) — in-cluster gRPC TLS  
- [provisioning-checklist.md](../operations/provisioning-checklist.md) — deploy gate  
- [cdn-cache-auth-bypass.md](../operations/cdn-cache-auth-bypass.md) — edge cache vs auth  
- `deploy/k8s/base/ingress.yaml` · `deploy/k8s/base/network-policy.yaml`
