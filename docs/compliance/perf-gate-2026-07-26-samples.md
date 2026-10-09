# API p50/p95 sample results

- **When (UTC):** 2026-07-27T03:09:56Z
- **API_BASE:** `http://192.168.1.101:8081`
- **Samples per path:** 20
- **Budget:** catalog p95 < 200 ms
- **Method:** `curl -o /dev/null -w '%{http_code} %{time_total}'` sequential, client-side total time
- **Overall catalog budget:** PASS

| Path | HTTP (mode) | p50 ms | p95 ms | min ms | max ms | non-2xx | Budget |
|------|-------------|--------|--------|--------|--------|---------|--------|
| `/health` | 200 | 2 | 2 | 2 | 13 | 0 | — |
| `/api/v1/jobs?page=1&page_size=20` | 200 | 3 | 3 | 3 | 5 | 0 | PASS |
| `/api/v1/listings?page=1&page_size=20` | 200 | 6 | 7 | 6 | 92 | 0 | PASS |
| `/api/v1/flags` | 200 | 2 | 3 | 2 | 3 | 0 | PASS |
| `/api/v1/providers/search?page=1&page_size=20` | 200 | 3 | 9 | 3 | 12 | 0 | PASS |

Percentiles: sorted sample list; index = floor(q × (n−1)) for q ∈ {0.50, 0.95}.
