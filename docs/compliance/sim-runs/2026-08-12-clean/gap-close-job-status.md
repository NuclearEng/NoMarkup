# Gap close — public `GET /api/v1/jobs?status=`

- **Sim folder**: `2026-08-12-clean`
- **API**: `http://127.0.0.1:8081` (local `bin/dev`, `GATEWAY_PORT=8081`)
- **Did not commit.**

## Problem

Public Search (`JobHandler.Search` → gRPC `SearchJobs`) ignored query `status=`.
Home and Jobs browse had to client-filter live rows (`isLiveAuctionStatus` /
`isOpenBrowseStatus`) because a mixed catalog page could be all closed.

Repo `SearchJobs` already defaulted `j.status = 'active'`. The missing piece was
the query → proto → domain `StatusFilter` wire.

## Change

1. `SearchJobsRequest.status_filter = 11` (`proto/job/v1/job.proto`) + job-only proto-gen
2. gRPC `SearchJobs` copies `StatusFilter` like `ListCustomerJobs`
3. Domain `SearchJobsInput.StatusFilter`; repo binds `j.status = $n` (default `active`; `open` aliases `active`)
4. Gateway `Search`: `q.Get("status")` → `grpcReq.StatusFilter`; `stringToJobStatus("open")` → `JOB_STATUS_ACTIVE`
5. iOS `fetchJobs(status:)`; Jobs browse + Home `loadCatalog` pass `status=open`

Rebuilt + restarted: `bin/dev rebuild job`, `bin/dev rebuild gateway`, `bin/dev up job`, `bin/dev up gateway`.

## Proof (2026-08-13 local)

```
curl -sS 'http://127.0.0.1:8081/api/v1/jobs?page=1&page_size=5&status=open'
```

HTTP 200. `pagination.totalCount=3`. Statuses: `active`, `active`, `active`.
Titles: SaaS vendor contract / LLC legal consult / AC Unit. `non_open_count=0`.

Contrast (filter is not ignored):

| Query | totalCount | statuses |
|-------|------------|----------|
| no `status` (default active) | 3 | active × 3 |
| `status=open` | 3 | active × 3 |
| `status=active` | 3 | active × 3 |
| `status=closed` | 0 | [] |

`status=closed` returning empty is the proof the param is applied: before this
change it would have been the same 3 active rows as an unfiltered call.

Gateway unit: `TestJobHandler_Search_forwards_status` (`status=open` → proto `JOB_STATUS_ACTIVE`).
