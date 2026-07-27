# NetworkPolicy egress (OPS-19)

Namespace-wide **default-deny egress** plus practical allowlists for DNS,
in-cluster mesh, managed Postgres/Redis, and public HTTPS (Stripe, S3, OAuth,
Sentry, SendGrid/Twilio, Web Push).

| Manifest | Role |
|----------|------|
| `deploy/k8s/base/network-policy.yaml` | Ingress only (gateway/web/mesh/prometheus) |
| `deploy/k8s/base/network-policy-egress.yaml` | Egress default-deny + allowlists |

## Policies (egress file)

| Name | Selects | Allows |
|------|---------|--------|
| `default-deny-egress` | all pods | nothing |
| `allow-egress-dns` | all pods | kube-system :53 UDP/TCP |
| `allow-egress-in-namespace` | all pods | any pod in `nomarkup` |
| `allow-egress-data-stores` | gateway, Go services, engines, `db-migrate` | TCP 5432 / 6379 / 6380 to world except loopback + link-local |
| `allow-egress-https-public` | app pods + `otel-collector` (not Meilisearch / migrate) | TCP 443 to public Internet (RFC1918/CGNAT/IMDS carved out) |
| `allow-egress-otel-backend` | `otel-collector` | OTLP 4317/4318 cross-namespace + non-loopback |
| `allow-egress-payment-stripe` | `payment` | TCP 443 public (documented Stripe path; same carve-outs) |

NetworkPolicy evaluation is the **union** of all policies that select a pod.
Fail closed: omit a pod from a needed allow list and that path breaks.

## Limitations

1. **SaaS CIDRs are broad.** Stripe, S3, Sentry, OAuth, SendGrid, Twilio, Mapbox,
   and Web Push do not ship a single safe static allowlist. Public HTTPS with
   private + link-local exclusions is SSRF / lateral containment, not vendor
   fingerprinting.
2. **Postgres/Redis are external.** No in-cluster DB/Redis Deployment. Policies
   cannot match by DNS name; data-store egress is port-based (5432/6379/6380).
   Prefer overlay-patching to the VPC CIDR when known (example below).
3. **CNI must enforce NetworkPolicy.** Calico, Cilium, Azure NPM, etc. kind’s
   default kindnet does **not** enforce — local kind smoke is not proof.
4. **IPv6** not covered. Disable dual-stack or add `::/0` rules.
5. **Not live-tested** until `DEPLOY_PROVISIONED` and a real cluster apply.
   Treat manifests as the contract; run the smoke checklist before production.

## Narrow data-store CIDRs (recommended when VPC is known)

Patch `allow-egress-data-stores` in the production overlay instead of world-open
ports:

```yaml
# deploy/k8s/overlays/production/network-policy-egress-patch.yaml (example)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-egress-data-stores
  namespace: nomarkup
spec:
  egress:
    - to:
        # Replace with the VPC CIDR(s) that host RDS + ElastiCache / Memorystore.
        - ipBlock:
            cidr: 10.0.0.0/16
      ports:
        - protocol: TCP
          port: 5432
        - protocol: TCP
          port: 6379
        - protocol: TCP
          port: 6380
```

Wire via `patches:` / `patchesStrategicMerge` in
`overlays/production/kustomization.yaml`. Do **not** edit the base policy’s
ports without updating this doc.

## Smoke checklist (target cluster)

```bash
# 1. Policies present
kubectl get networkpolicy -n nomarkup | grep -E 'egress|default-deny'

# 2. DNS still works
kubectl -n nomarkup exec deploy/gateway -- nslookup kubernetes.default.svc.cluster.local

# 3. Mesh (gateway → user) still works — readiness /api health path

# 4. Data plane: payment/user Ready (Postgres/Redis dials succeed)

# 5. Stripe path: create a test PaymentIntent in staging (payment logs, no dial timeout)

# 6. Negative: compromised-pod simulation — HTTPS to a 10.x address should fail
#    from notification (SSRF control for push endpoints)
kubectl -n nomarkup exec deploy/notification -- \
  /bin/sh -c 'wget -T 3 -O- https://10.0.0.1/ || true'
# Expect timeout / connection refused at the CNI, not a TLS handshake.
```

## Related

- Ingress rules + mesh least-privilege comments: `deploy/k8s/base/network-policy.yaml`
- External Postgres/Redis/S3: `deploy/k8s/README.md`, `deploy/k8s/SECRETS.md`
- OTel backend URL: `docs/operations/otel-collector.md`
- Tracker: OPS-19 in `docs/planning/adversarial-action-tracker.md`
