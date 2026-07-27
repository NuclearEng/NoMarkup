# NoMarkup — Code Conventions (detailed examples)

> Offloaded from `CLAUDE.md` §5 / §7 / §11 to keep the always-loaded rules file lean.
> CLAUDE.md keeps the rule bullets; this file holds the worked examples and config blocks.

## TypeScript (Frontend)

```typescript
// STRICT MODE — no exceptions
// tsconfig.json: "strict": true, "noUncheckedIndexedAccess": true

// DO: Specific types
interface Job {
  id: string;
  title: string;
  category: ServiceCategory;
  status: JobStatus;
  budget: { min: number; max: number };
  location: { lat: number; lng: number; zipCode: string };
  createdAt: Date;
}

// DON'T: any, unknown without narrowing, type assertions without checks
// The hooks will block: `any`, `as any`, `@ts-ignore`, `@ts-nocheck`

// Enums: use const objects + type extraction (not TypeScript enum)
const JOB_STATUS = {
  DRAFT: 'draft', OPEN: 'open', BIDDING: 'bidding', AWARDED: 'awarded',
  IN_PROGRESS: 'in_progress', COMPLETED: 'completed', DISPUTED: 'disputed',
  CANCELLED: 'cancelled',
} as const;
type JobStatus = typeof JOB_STATUS[keyof typeof JOB_STATUS];

// Naming:
// - Components: PascalCase (JobCard.tsx)
// - Hooks: camelCase with "use" prefix (useJobs.ts)
// - Utils: camelCase (formatCurrency.ts)
// - Types: PascalCase (ServiceCategory)
// - Constants: SCREAMING_SNAKE_CASE (MAX_BID_AMOUNT)
// - Files: kebab-case for non-components (api-client.ts)
// - Directories: kebab-case (service-categories/)

// Imports: grouped and ordered
// 1. React/Next.js  2. Third-party  3. Internal aliases (@/components, @/lib, @/hooks)
// 4. Relative imports  5. Types (type-only imports)
```

## Go (Backend Services)

```go
// Follow standard Go conventions: https://go.dev/doc/effective_go
// Project layout: cmd/ for entry points, internal/ for private code
// NO global state. Pass dependencies via constructor injection.

// Naming:
// - Packages: lowercase, single word (user, job, bid — not userService)
// - Interfaces: verb-based (Reader, Validator, JobFinder — not IJobService)
// - Exported: PascalCase   - Unexported: camelCase
// - Errors: ErrXxx (ErrJobNotFound, ErrBidExpired)
// - Context: always first parameter (ctx context.Context)

// Error handling: ALWAYS handle errors. Never use _ for error returns.
// Wrap errors with context:  return fmt.Errorf("find job %s: %w", jobID, err)

// Database queries: use pgx directly. No ORM.
// Write SQL in .sql files or as constants. Never build SQL with fmt.Sprintf.
// Use parameterized queries exclusively ($1, $2, ...).

// Logging: use slog with structured fields
//   slog.Error("failed to process bid", "job_id", jobID, "bid_id", bidID, "error", err)

// Testing: table-driven tests. Parallel by default.
//   func TestCreateJob(t *testing.T) {
//     t.Parallel()
//     tests := []struct{ name string; input CreateJobInput; want Job; wantErr error }{...}
//     for _, tt := range tests { t.Run(tt.name, func(t *testing.T) { t.Parallel(); ... }) }
//   }
```

## Rust (Engines)

```rust
// Rust 2024 edition. Clippy with pedantic lints enabled.
// #![deny(clippy::all, clippy::pedantic, clippy::nursery)]
// #![deny(unsafe_code)] — except in FFI modules, which must be isolated

// Naming:
// - Crates/Modules: snake_case (bidding_engine, fraud_detector)
// - Types/Traits: PascalCase   - Functions/Methods: snake_case
// - Constants: SCREAMING_SNAKE_CASE   - Lifetimes: short ('a, 'req, 'conn)

// Error handling: thiserror for library errors, anyhow for application errors
// Every public function returns Result<T, E> — never panic in production code.
// Use ? for propagation. Provide context:  .context("failed to compute trust score")?;

// Performance rules:
// - Zero-copy where possible. Use &str over String, &[u8] over Vec<u8>.
// - Avoid allocations in hot paths. Pre-allocate with Vec::with_capacity.
// - Use Arc<T> for shared ownership, not Rc<T> (multi-threaded context).
// - Benchmark before and after with criterion. No regression allowed.

// Async: Tokio runtime. Use tokio::spawn for concurrent work.
// Never block the async runtime. Use tokio::task::spawn_blocking for CPU work.

// FFI (C/C++ interop):
// - Isolate all unsafe FFI in dedicated modules (ffi.rs).
// - Wrap unsafe calls in safe Rust abstractions.
// - Document every unsafe block with a SAFETY comment.
// - Test FFI boundaries with integration tests.

// Testing:
// - Unit tests in same file (#[cfg(test)] mod tests)
// - Integration tests in tests/ directory
// - Property-based tests with proptest for numerical code (trust scoring, bidding)
// - Benchmarks in benches/ with criterion
```

## SQL / Database

```sql
-- Table naming: snake_case, plural (users, jobs, bids, reviews)
-- Column naming: snake_case (created_at, bid_amount, job_id)
-- Primary keys: UUID v7 (time-sortable). Column name: id
-- Foreign keys: {referenced_table_singular}_id (user_id, job_id)
-- Timestamps: always UTC. Columns: created_at, updated_at (with trigger)
-- Soft delete: deleted_at TIMESTAMPTZ NULL (not a boolean)
-- Monetary values: BIGINT in cents (not DECIMAL, not FLOAT)
-- Geographic: PostGIS geometry(Point, 4326) for coordinates

-- Every table MUST have:
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid()
--   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

-- Indexes: create for every foreign key and every column used in WHERE/ORDER BY.
-- Name format: idx_{table}_{columns} (idx_bids_job_id, idx_jobs_status_created_at)

-- Migrations: one operation per migration file. Never combine CREATE TABLE + INSERT.
-- Every migration MUST have a rollback (down migration).
-- Never modify a deployed migration. Create a new one.
```

## Protobuf (Service Communication)

```protobuf
// All inter-service communication uses gRPC with Protocol Buffers v3.
// Proto files live in /proto/{service}/v1/{service}.proto
// Version namespace (v1) allows non-breaking evolution.

// Naming:
// - Package: nomarkup.{service}.v1
// - Service: {Service}Service (UserService, BidService)
// - RPC methods: PascalCase verbs (CreateJob, PlaceBid, GetTrustScore)
// - Messages: PascalCase (CreateJobRequest, CreateJobResponse)
// - Fields: snake_case (job_id, bid_amount)

// Every RPC must define request and response messages (no reuse across RPCs).
// Use google.protobuf.Timestamp for all time fields.
// Use string for UUIDs (not bytes). Use int64 for monetary values in cents.
```

## Testing Standards (detail)

### Frontend — Vitest config
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom', globals: true, setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8', reporter: ['text', 'lcov', 'html'],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
      exclude: ['node_modules/', 'tests/', '**/*.d.ts', '**/*.config.*', '**/types/'],
    },
    testTimeout: 10000, hookTimeout: 10000,
  },
});
```

**What to test:** Unit (pure functions, hooks, Zod schemas, store logic, formatters); Integration
(component trees w/ mocked API, form/auth flows); E2E Playwright (register, post job, bid, pay,
chat); Accessibility (axe-core via `vitest-axe`).

**Patterns:** test behavior not implementation ("displays bid amount when bid is placed", not
"calls setBidAmount"). Mock at the network/API boundary (prefer `vi.mock` of the API client /
fetch helpers used by TanStack Query hooks — **MSW is not the current standard**; no MSW server
is wired in `web/tests`). Use `@testing-library/user-event`, not `fireEvent`. Every data-fetching
component tested in loading / success / error / empty states.

### Backend — Go
```go
// Coverage target: 80% line coverage minimum. Every exported function tested.
// Table-driven, parallel. DB tests: real Postgres via the CI PostGIS service
// container (GitHub Actions) — not testcontainers-go in this tree. HTTP: httptest.
// gRPC: bufconn in-process. Integration tests gated with //go:build integration
```

**CI map (honest, QA-11):**

| Surface | Unit in CI | `//go:build integration` in CI |
|---------|------------|--------------------------------|
| `gateway` | `gateway-test` | `go-integration-test` (`-short`) |
| `services/user`, `job`, `payment` | `services-test` matrix | `go-integration-test` (`-short`); money races / live idempotency also in `fullstack-security-test` / `money-race-tests` |
| `services/chat`, `services/notification` | `services-test` matrix (`go test ./... -race`) | **None** — no integration packages exist under those modules |
| Live stack (`tests/integration/`) | n/a | `fullstack-security-test` — boots compose **without** `chat` (and without `web`/`imaging`/`minio`); `notification` container may run but is not covered by a service-level integration suite |

Do not claim “all Go services have integration coverage in CI.” Closing the chat/notification gap means adding real `//go:build integration` tests (DB/WS/push paths) **and** wiring them into `go-integration-test` (and/or starting `chat` in the fullstack job when a suite needs it) — not an empty green step.

### Backend — Rust
```rust
// Coverage target: 80%. Unit tests in-module (#[cfg(test)]). Integration in tests/.
// proptest for all numerical computation:
//   - Trust score: arbitrary inputs → output always 0..=100
//   - Bid engine: concurrent bids → no data races, no lost bids
//   - Fraud scorer: arbitrary fingerprints → no panics
// criterion benches. Budgets: bid <1ms p99, trust <5ms p99, fraud <50ms p99, resize(1080p) <200ms p99
```

### Test layout
```
tests/  unit/ (fast, no I/O)  integration/ (svc+db, real containers)
        e2e/ (Playwright)  load/ (k6)  fixtures/ (shared factories)
```

## Logging & Observability (detail)

```
// Structured JSON logs everywhere. No fmt.Println, no console.log.
// Levels: DEBUG (dev only), INFO, WARN, ERROR, FATAL
// Every entry: timestamp, level, service, request_id, message, fields
// Every HTTP request logged: method, path, status, duration_ms, request_id
// Every gRPC call logged: service, method, status, duration_ms, request_id

// Distributed tracing: OpenTelemetry spans across all services.
// Trace ID propagated via headers (traceparent).
// Every external call (DB, Redis, Stripe, S3) gets its own span.

// Prometheus metrics:
// - http_requests_total{method, path, status}
// - http_request_duration_seconds{method, path}
// - grpc_requests_total{service, method, status}
// - bid_processing_duration_seconds
// - trust_score_computation_duration_seconds
// - active_websocket_connections
// - stripe_webhook_processing_duration_seconds
```
