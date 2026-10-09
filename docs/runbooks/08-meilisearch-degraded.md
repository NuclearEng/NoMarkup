# Runbook: Meilisearch degraded

**Symptom:** marketplace / job search empty or 5xx; gateway logs Meilisearch HTTP errors.
In-cluster Deployment: `meilisearch` (PVC `meili-data`).

## Severity

P1 for search-only outages (catalog can still load by id). P0 if index rebuild corrupts prod.

## Immediate checks

```bash
kubectl get pods -n nomarkup -l app.kubernetes.io/name=meilisearch
kubectl logs -n nomarkup deploy/meilisearch --tail=100
kubectl exec -n nomarkup deploy/meilisearch -- wget -qO- http://127.0.0.1:7700/health

# From gateway config
echo "$MEILISEARCH_URL"   # should be http://meilisearch:7700
# Master key must match nomarkup-secrets/MEILISEARCH_API_KEY
```

## Common causes

1. **Pod CrashLoop** — bad master key, disk full on PVC.
2. **Key mismatch** — `MEILI_MASTER_KEY` ≠ gateway `MEILISEARCH_API_KEY`.
3. **PVC full** — index growth; expand PVC or prune.
4. **Recreate strategy stuck** — RWO volume; old pod not releasing claim.

## Mitigation

1. Confirm secret key present:
   ```bash
   kubectl get secret nomarkup-secrets -n nomarkup -o jsonpath='{.data.MEILISEARCH_API_KEY}' | wc -c
   ```
2. Restart Meilisearch (Recreate strategy — brief search downtime):
   ```bash
   kubectl rollout restart deploy/meilisearch -n nomarkup
   kubectl rollout status deploy/meilisearch -n nomarkup
   ```
3. If indexes empty after restore, re-run the job/listing indexers (see `docs/operations/`).

## Verify

```bash
curl -sS -H "Authorization: Bearer $MEILISEARCH_API_KEY" \
  "$MEILISEARCH_URL/health"
# Gateway search endpoint returns results for a known query
```
