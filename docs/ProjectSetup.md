# NoMarkup — Project Setup Checklist

Master tracking document for all pre-development artifacts. Every item must be complete before implementation begins.

---

## Pre-Development Artifacts

### Completed

| # | Artifact | File | Status |
|---|----------|------|--------|
| 1 | Product Requirements Document | `PRD.md` | Done (v2.0, 1,922 lines) |
| 2 | Development Conventions & Architecture | `CLAUDE.md` | Done (916 lines) |
| 3 | Database Schema | `database/migrations/001_initial_schema.up.sql` | Done (41 tables, 80+ indexes) |
| 4 | Service Taxonomy Seed Data | `database/migrations/002_seed_taxonomy.up.sql` | Done (16 categories, 3-level hierarchy) |
| 5 | Protobuf Service Contracts | `proto/` (14 files) | Done (14 services, ~170 RPCs) |
| 6 | Monorepo Scaffold | All directories + config files | Done (132 files, all compile) |
| 7 | CI/CD Pipeline | `.github/workflows/ci.yml` | Done (5 jobs: web, gateway, services, engines, build) |
| 8 | Docker Configurations | `deploy/docker/*.Dockerfile` | Done (4 Dockerfiles: web, gateway, service, engine) |
| 9 | Local Dev Environment | `docker-compose.yml` | Done (Postgres+PostGIS, Redis, Meilisearch, MinIO) |
| 10 | File Write Hooks | `.claude/hooks/` | Done (11 hooks + settings.json) |
| 11 | Auth Flow Detail | `docs/auth-flow.md` | Done (2,206 lines) |
| 12 | Gateway REST→gRPC Route Map | `docs/route-map.md` | Done (714 lines) |
| 13 | Implementation Playbook | `docs/implementation-playbook.md` | Done (1,446 lines) |
| 14 | State Management Map | `docs/state-management.md` | Done (2,841 lines) |
| 15 | Proto Codegen (Go) | `proto/gen/go/` (27 files) | Done — all 5 Go modules compile |
| 16 | Proto Codegen (Rust) | `engines/*/build.rs` + `src/grpc.rs` | Done — all 4 Rust engines compile |
| 17 | RSA Keypair (JWT RS256) | `keys/private.pem`, `keys/public.pem` | Done (4096-bit) |

| 18 | Page & Component Spec | `docs/page-component-spec.md` | Done (4,567 lines) |
| 19 | Test Fixtures & Seed Scenarios | `docs/test-fixtures.md` | Done (2,988 lines) |

---

## Proto File Inventory

| Service | File | Language | Port | RPCs |
|---------|------|----------|------|------|
| Common Types | `proto/common/v1/common.proto` | — | — | — |
| User | `proto/user/v1/user.proto` | Go | 50051 | 36 |
| Job | `proto/job/v1/job.proto` | Go | 50052 | 21 |
| Bid | `proto/bid/v1/bid.proto` | Rust | 50053 | 12 |
| Contract | `proto/contract/v1/contract.proto` | Go | — | 26 |
| Payment | `proto/payment/v1/payment.proto` | Go | 50054 | 18 |
| Chat | `proto/chat/v1/chat.proto` | Go | 50055 | 11 |
| Review | `proto/review/v1/review.proto` | Go | — | 11 |
| Trust | `proto/trust/v1/trust.proto` | Rust | 50057 | 10 |
| Fraud | `proto/fraud/v1/fraud.proto` | Rust | 50056 | 11 |
| Notification | `proto/notification/v1/notification.proto` | Go | — | 12 |
| Imaging | `proto/imaging/v1/imaging.proto` | Rust | 50058 | 10 |
| Subscription | `proto/subscription/v1/subscription.proto` | Go | — | 12 |
| Analytics | `proto/analytics/v1/analytics.proto` | Go | — | 10 |

---

## Scaffold Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Rust compile | `cd engines && cargo check --all` | Pass |
| Rust format | `cd engines && cargo fmt --all -- --check` | Pass |
| Rust lint | `cd engines && cargo clippy --all-targets -- -D warnings` | Pass |
| Rust test | `cd engines && cargo test --all` | Pass (0 tests, scaffold) |
| Go gateway | `cd gateway && go build ./cmd/server` | Pass |
| Go user service | `cd services/user && go build ./cmd/server` | Pass |
| Go job service | `cd services/job && go build ./cmd/server` | Pass |
| Go payment service | `cd services/payment && go build ./cmd/server` | Pass |
| Go chat service | `cd services/chat && go build ./cmd/server` | Pass |
| Go proto codegen | `make proto-gen-go` | Pass (27 files generated) |
| Rust proto codegen | `cargo build --all` (tonic-build) | Pass (all 4 engines) |
| Web build | `cd web && npm install && npm run build` | Pass |
| Web typecheck | `cd web && npm run typecheck` | Pass |
| Docker infra | `docker compose up -d` | Pass (4/4 healthy) |

## Tools Installed

| Tool | Version | Purpose |
|------|---------|---------|
| `protoc` | libprotoc 33.4 | Protobuf compiler |
| `protoc-gen-go` | latest | Go protobuf code generator |
| `protoc-gen-go-grpc` | latest | Go gRPC code generator |
| `golang-migrate` | latest | Database migration tool |

---

## Implementation Readiness Criteria

Before starting implementation, ALL of the following must be true:

- [x] All 19 artifacts above are complete
- [x] `docker compose up -d` starts all infrastructure with healthy containers
- [x] `cd web && npm install && npm run build` succeeds
- [x] `cd gateway && go mod tidy && go build ./cmd/server` succeeds
- [x] All four Go services compile after `go mod tidy`
- [x] Proto codegen produces compilable Go and Rust code
- [x] Auth flow document reviewed and approved
- [x] Route map covers every proto RPC
- [x] Implementation playbook defines clear vertical slices with dependencies
- [x] Test fixtures cover every entity and status transition
- [x] RSA keypair generated for JWT RS256 signing

---

## Quick Reference — Service Ports

```
Web (Next.js)        → localhost:3000
Gateway (Go/Chi)     → localhost:8080
User Service (Go)    → localhost:50051
Job Service (Go)     → localhost:50052
Bidding Engine (Rust) → localhost:50053
Payment Service (Go) → localhost:50054
Chat Service (Go)    → localhost:50055
Fraud Engine (Rust)  → localhost:50056
Trust Engine (Rust)  → localhost:50057
Imaging Engine (Rust) → localhost:50058
PostgreSQL           → localhost:5433
Redis                → localhost:6379
Meilisearch          → localhost:7700
MinIO                → localhost:9000 (API), 9001 (Console)
```
