# NoMarkup — Development Rules

> Reverse-auction service marketplace. Customers post jobs, providers compete on price.
> This file is the single source of truth for all architecture, conventions, and quality standards.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                               │
│  Next.js 15 Web App  ·  iOS (future)  ·  Android (future)  │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTPS/WSS                    │
┌──────────────▼──────────────────────────────▼───────────────┐
│                    API GATEWAY (Go)                          │
│  Auth · Rate Limiting · Request Validation · Routing        │
│  Framework: net/http + Chi router                           │
└──────┬─────────┬──────────┬──────────┬─────────┬───────────┘
       │ gRPC    │ gRPC     │ gRPC     │ gRPC    │ gRPC
┌──────▼───┐ ┌───▼────┐ ┌──▼─────┐ ┌──▼────┐ ┌──▼──────────┐
│ User Svc │ │Job Svc │ │Bid Eng │ │Pay Svc│ │ Chat Svc    │
│   (Go)   │ │  (Go)  │ │ (Rust) │ │ (Go)  │ │(Go+WebSocket│
└──────────┘ └────────┘ └────────┘ └───────┘ └─────────────┘
       │          │          │          │           │
┌──────▼──────────▼──────────▼──────────▼───────────▼────────┐
│                     DATA LAYER                              │
│  PostgreSQL 16 + PostGIS  ·  Redis 7  ·  Meilisearch       │
└─────────────────────────────────────────────────────────────┘
       │
┌──────▼─────────────────────────────────────────────────────┐
│              PERFORMANCE-CRITICAL SERVICES (Rust)           │
│  Bidding Engine · Fraud Detection · Trust Scoring           │
│  Search Ranking · Image Pipeline · Geo Computation          │
└─────────────────────────────────────────────────────────────┘
       │
┌──────▼─────────────────────────────────────────────────────┐
│              NATIVE EXTENSIONS (C/C++)                       │
│  libvips (image processing) · Custom PostGIS functions      │
│  argon2 (password hashing) · libsodium (encryption)         │
└─────────────────────────────────────────────────────────────┘
```

### Service Boundaries

| Service | Language | Responsibility | Why This Language |
|---------|----------|---------------|-------------------|
| API Gateway | Go | HTTP routing, auth, rate limiting, request validation | Excellent stdlib net/http, low latency, high concurrency |
| User Service | Go | Registration, profiles, identity verification, roles | CRUD-heavy, benefits from Go simplicity |
| Job Service | Go | Job posting, lifecycle, categories, search coordination | Business logic, orchestration |
| Bidding Engine | **Rust** | Real-time bid processing, auction timing, sealed-bid logic | Sub-millisecond latency, zero-cost abstractions, memory safety under concurrent load |
| Payment Service | Go | Stripe Connect integration, escrow, disbursement, refunds | Stripe SDK availability, webhook handling |
| Chat Service | Go | WebSocket connections, message persistence, presence | goroutine-per-connection scales to millions |
| Fraud Detection | **Rust** | Browser fingerprinting analysis, behavioral scoring, ring detection | CPU-intensive ML inference, pattern matching at scale |
| Trust Scoring | **Rust** | Composite score computation, real-time recalculation | High-throughput numerical computation |
| Search & Ranking | **Rust** (Meilisearch) | Full-text search, geo-filtered results, relevance ranking | Meilisearch is Rust-native, sub-50ms queries |
| Image Pipeline | **Rust** + **C** (libvips) | Resize, optimize, watermark, format conversion | libvips via FFI, 8x faster than ImageMagick |
| Geo Computation | **Rust** + **C** (PostGIS) | Service area calculation, proximity matching, route estimation | PostGIS C extensions + Rust geo crate for app-layer |
| Crypto Operations | **C** (libsodium) | Encryption at rest, token signing, key derivation | libsodium via Go/Rust FFI, audited C implementation |

---

## 2. Tech Stack — Locked Decisions

### Frontend (Web)
- **Framework**: Next.js 15 (App Router) with TypeScript 5.x strict mode
- **Styling**: Tailwind CSS 4.x — no CSS modules, no styled-components, no inline styles
- **Components**: shadcn/ui as base — customize, never fork
- **State**: Zustand for client state, TanStack Query for server state
- **Forms**: React Hook Form + Zod validation
- **Maps**: Mapbox GL JS (provider browse + directions)
- **Real-time**: Native WebSocket client (no Socket.io — unnecessary abstraction)
- **Testing**: Vitest + React Testing Library + Playwright (E2E)
- **Bundle**: Turbopack (Next.js built-in)

### Backend (Go Services)
- **Language**: Go 1.22+
- **Router**: Chi (lightweight, stdlib-compatible)
- **Database**: pgx (pure Go PostgreSQL driver, no ORM)
- **Migrations**: golang-migrate
- **Cache**: go-redis/redis
- **gRPC**: google.golang.org/grpc + protobuf
- **Auth**: Custom JWT (RS256) + secure session cookies
- **Validation**: go-playground/validator
- **Logging**: slog (stdlib structured logging)
- **Testing**: Go stdlib testing + testify assertions
- **Payments**: stripe-go SDK

### Backend (Rust Services)
- **Language**: Rust (latest stable, 2024 edition)
- **Async Runtime**: Tokio
- **gRPC**: tonic + prost
- **Serialization**: serde + serde_json
- **HTTP** (where needed): axum
- **Database**: sqlx (compile-time checked queries)
- **Image Processing**: image crate + libvips FFI
- **Geo**: geo crate + PostGIS queries
- **ML Inference**: ort (ONNX Runtime bindings) for fraud models
- **Testing**: cargo test + proptest (property-based)
- **Benchmarking**: criterion

### Native (C/C++)
- **Image processing**: libvips (called via Rust FFI)
- **Cryptography**: libsodium (called via Go/Rust FFI)
- **Password hashing**: argon2id (via rust-argon2)
- **Custom PostGIS**: C extensions only when PostGIS built-ins are insufficient

### Database
- **Primary**: PostgreSQL 16 + PostGIS 3.4
- **Cache/Sessions/PubSub**: Redis 7 (Cluster mode in production)
- **Search**: Meilisearch 1.x (Rust-native, sub-50ms)
- **File Storage**: S3-compatible (MinIO local, AWS S3 production)
- **Migrations**: Forward-only in production, reversible in development

### Infrastructure
- **Container Runtime**: Docker + Docker Compose (local dev)
- **Orchestration**: Kubernetes (production)
- **CI/CD**: GitHub Actions
- **CDN**: Cloudflare (public assets only)
- **Monitoring**: Prometheus + Grafana
- **Error Tracking**: Sentry (frontend + backend)
- **APM**: OpenTelemetry (distributed tracing across Go/Rust services)
- **Secrets**: HashiCorp Vault (production), .env.local (development)

---

## 3. Project Structure

```
NoMarkup/
├── CLAUDE.md                          # This file
├── PRD.md                             # Product requirements
├── docker-compose.yml                 # Local dev environment
├── .github/
│   └── workflows/                     # CI/CD pipelines
├── proto/                             # Protobuf definitions (shared)
│   ├── user/v1/user.proto
│   ├── job/v1/job.proto
│   ├── bid/v1/bid.proto
│   ├── payment/v1/payment.proto
│   └── chat/v1/chat.proto
├── web/                               # Next.js frontend
│   ├── src/
│   │   ├── app/                       # App Router pages
│   │   │   ├── (auth)/               # Auth group (login, register)
│   │   │   ├── (dashboard)/          # Authenticated layout
│   │   │   ├── (public)/             # Public pages (landing, browse)
│   │   │   ├── api/                  # API routes (BFF pattern)
│   │   │   ├── layout.tsx
│   │   │   └── global-error.tsx
│   │   ├── components/
│   │   │   ├── ui/                   # shadcn/ui primitives
│   │   │   ├── forms/                # Form components
│   │   │   ├── layout/               # Header, Footer, Sidebar, Nav
│   │   │   ├── jobs/                 # Job-related components
│   │   │   ├── bids/                 # Bidding components
│   │   │   ├── chat/                 # Chat components
│   │   │   ├── maps/                 # Map components
│   │   │   ├── payments/             # Payment components
│   │   │   └── providers/            # Provider profile components
│   │   ├── hooks/                    # Custom React hooks
│   │   ├── lib/                      # Utilities, API client, constants
│   │   │   ├── api.ts               # Type-safe API client
│   │   │   ├── auth.ts              # Auth utilities
│   │   │   ├── constants.ts         # App-wide constants
│   │   │   ├── utils.ts             # Pure utility functions
│   │   │   └── validations.ts       # Shared Zod schemas
│   │   ├── stores/                   # Zustand stores
│   │   ├── styles/                   # Global styles, Tailwind config
│   │   └── types/                    # TypeScript type definitions
│   ├── public/                       # Static assets
│   ├── tests/
│   │   ├── unit/                     # Vitest unit tests
│   │   ├── integration/              # Vitest integration tests
│   │   └── e2e/                      # Playwright E2E tests
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── package.json
├── gateway/                           # Go API Gateway
│   ├── cmd/
│   │   └── server/main.go
│   ├── internal/
│   │   ├── middleware/               # Auth, rate limit, CORS, logging
│   │   ├── handler/                  # HTTP handlers (thin — delegate to services)
│   │   ├── router/                   # Route definitions
│   │   └── config/                   # Configuration loading
│   ├── go.mod
│   └── go.sum
├── services/                          # Go microservices
│   ├── user/
│   │   ├── cmd/server/main.go
│   │   ├── internal/
│   │   │   ├── domain/              # Domain types, interfaces
│   │   │   ├── repository/          # PostgreSQL queries
│   │   │   ├── service/             # Business logic
│   │   │   └── grpc/                # gRPC server implementation
│   │   ├── migrations/
│   │   ├── go.mod
│   │   └── go.sum
│   ├── job/                          # Same structure as user/
│   ├── payment/                      # Same structure as user/
│   └── chat/
│       ├── cmd/server/main.go
│       ├── internal/
│       │   ├── domain/
│       │   ├── repository/
│       │   ├── service/
│       │   ├── grpc/
│       │   └── ws/                   # WebSocket handler
│       ├── migrations/
│       ├── go.mod
│       └── go.sum
├── engines/                           # Rust performance-critical services
│   ├── bidding/
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── engine.rs            # Core auction logic
│   │   │   ├── grpc.rs              # gRPC server
│   │   │   └── models.rs            # Domain types
│   │   ├── tests/
│   │   ├── benches/                 # Criterion benchmarks
│   │   └── Cargo.toml
│   ├── fraud/
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── detector.rs          # Fraud detection pipeline
│   │   │   ├── fingerprint.rs       # Browser fingerprint analysis
│   │   │   ├── behavioral.rs        # Behavioral pattern analysis
│   │   │   ├── inference.rs         # ONNX model inference
│   │   │   └── grpc.rs
│   │   ├── models/                  # Trained ONNX models
│   │   ├── tests/
│   │   ├── benches/
│   │   └── Cargo.toml
│   ├── trust/
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── scorer.rs            # Trust score computation
│   │   │   ├── dimensions.rs        # Feedback, Volume, Risk, Fraud scores
│   │   │   └── grpc.rs
│   │   ├── tests/
│   │   ├── benches/
│   │   └── Cargo.toml
│   └── imaging/
│       ├── src/
│       │   ├── main.rs
│       │   ├── pipeline.rs          # Image processing pipeline
│       │   ├── optimize.rs          # Compression, format conversion
│       │   └── grpc.rs
│       ├── tests/
│       └── Cargo.toml
├── ml/                                # Python ML training (not deployed as service)
│   ├── fraud/                        # Fraud model training
│   ├── pricing/                      # Market pricing models
│   └── requirements.txt
└── deploy/
    ├── docker/                       # Dockerfiles per service
    ├── k8s/                          # Kubernetes manifests
    └── terraform/                    # Infrastructure as code
```

---

## 4. Design System & UI Standards

### Design Philosophy
Follow platform-native quality. The web app must feel as polished as a native iOS/Android app.

### Apple Human Interface Guidelines (applied to web)
- **Clarity**: Content is paramount. Every design element serves the content. No decorative chrome.
- **Deference**: UI helps people understand and interact with content — it never competes with it.
- **Depth**: Visual layers and realistic motion give vitality and convey hierarchy.
- **Direct manipulation**: Where possible, manipulate content directly rather than through abstract controls.
- **Feedback**: Acknowledge every action. Highlight results of interactions. Indicate progress.
- **Consistency**: Use familiar patterns. Same action = same result everywhere.
- **Typography**: Use system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`). Clear hierarchy: only 3-4 font sizes per page.
- **Touch targets**: Minimum 44x44px for all interactive elements (matches Apple's 44pt minimum).

### Material Design 3 Principles (applied to web)
- **Adaptive layouts**: Responsive breakpoints — compact (< 600px), medium (600-840px), expanded (840-1200px), large (> 1200px).
- **Color system**: Dynamic color with semantic tokens (primary, secondary, tertiary, error, surface, on-surface). Light and dark themes mandatory.
- **Elevation**: Use shadow tokens, not arbitrary box-shadows. 5 elevation levels.
- **Motion**: Meaningful transitions only. Enter: 250ms ease-out. Exit: 200ms ease-in. No motion for motion's sake.
- **Components**: Use established patterns (FAB, bottom sheets, cards, chips, dialogs, snackbars).
- **Navigation**: Persistent nav rail on desktop, bottom navigation on mobile. Never more than 5 top-level destinations.

### WCAG 2.2 AA Compliance (Mandatory)

All four principles — **Perceivable, Operable, Understandable, Robust** — must be met at AA level minimum.

**Perceivable:**
- All images: meaningful `alt` text or `role="presentation"` for decorative
- Color contrast: 4.5:1 for normal text, 3:1 for large text (18px bold / 24px regular)
- Don't use color alone to convey meaning — always pair with icon, text, or pattern
- Captions for all video/audio content
- Text resizable to 200% without breaking layout

**Operable:**
- Full keyboard navigation. Every interactive element reachable via Tab.
- Visible focus indicators on all focusable elements (minimum 2px outline, 3:1 contrast)
- Skip navigation link as first focusable element
- No keyboard traps
- Minimum touch targets: 44x44px (24x24px absolute minimum with 44px spacing)
- No time-limited interactions without user control (bidding timers show remaining time, provide extension option)

**Understandable:**
- Form errors: inline, associated with field via `aria-describedby`, specific ("Email must include @")
- Language attribute on `<html>` element
- Consistent navigation across all pages
- Input purpose identified via `autocomplete` attributes

**Robust:**
- Valid HTML — no duplicate IDs, proper nesting
- ARIA only when native HTML semantics are insufficient
- Live regions (`aria-live`) for dynamic content (bid updates, chat messages, notifications)
- Test with screen readers: VoiceOver (macOS/iOS), NVDA (Windows)

### Tailwind Design Tokens

```typescript
// tailwind.config.ts — canonical tokens
const config = {
  theme: {
    extend: {
      colors: {
        // Semantic tokens — NEVER use raw hex in components
        primary: { DEFAULT: '', foreground: '' },
        secondary: { DEFAULT: '', foreground: '' },
        destructive: { DEFAULT: '', foreground: '' },
        muted: { DEFAULT: '', foreground: '' },
        accent: { DEFAULT: '', foreground: '' },
        card: { DEFAULT: '', foreground: '' },
        border: '',
        input: '',
        ring: '',
        background: '',
        foreground: '',
        // NoMarkup-specific
        trust: { low: '', medium: '', high: '', elite: '' },
        bid: { active: '', winning: '', expired: '' },
        status: { open: '', in_progress: '', completed: '', disputed: '' },
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.25rem',
      },
      fontSize: {
        // Strict type scale — only these sizes
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
    },
  },
}
```

### Component Rules
- Every component gets its own file. One component per file.
- Use shadcn/ui primitives as foundation. Customize via Tailwind — never override with CSS.
- All interactive components must accept `className` prop for composition.
- Loading states: use Skeleton components, never spinners (except full-page initial load).
- Error states: every data-fetching component must handle loading, error, and empty states.
- Responsive: mobile-first. All layouts must work at 320px minimum width.

---

## 5. Code Conventions

### TypeScript (Frontend)

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
  DRAFT: 'draft',
  OPEN: 'open',
  BIDDING: 'bidding',
  AWARDED: 'awarded',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  DISPUTED: 'disputed',
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
// 1. React/Next.js
// 2. Third-party libraries
// 3. Internal aliases (@/components, @/lib, @/hooks)
// 4. Relative imports
// 5. Types (type-only imports)
```

### Go (Backend Services)

```go
// Follow standard Go conventions: https://go.dev/doc/effective_go

// Project layout: cmd/ for entry points, internal/ for private code
// NO global state. Pass dependencies via constructor injection.

// Naming:
// - Packages: lowercase, single word (user, job, bid — not userService)
// - Interfaces: verb-based (Reader, Validator, JobFinder — not IJobService)
// - Exported: PascalCase
// - Unexported: camelCase
// - Errors: ErrXxx (ErrJobNotFound, ErrBidExpired)
// - Context: always first parameter (ctx context.Context)

// Error handling: ALWAYS handle errors. Never use _ for error returns.
// Wrap errors with context:
//   return fmt.Errorf("find job %s: %w", jobID, err)

// Database queries: use pgx directly. No ORM.
// Write SQL in .sql files or as constants. Never build SQL with fmt.Sprintf.
// Use parameterized queries exclusively ($1, $2, ...).

// Logging: use slog with structured fields
//   slog.Error("failed to process bid",
//     "job_id", jobID,
//     "bid_id", bidID,
//     "error", err,
//   )

// Testing: table-driven tests. Parallel by default.
//   func TestCreateJob(t *testing.T) {
//     t.Parallel()
//     tests := []struct{ name string; input CreateJobInput; want Job; wantErr error }{...}
//     for _, tt := range tests {
//       t.Run(tt.name, func(t *testing.T) {
//         t.Parallel()
//         ...
//       })
//     }
//   }
```

### Rust (Engines)

```rust
// Rust 2024 edition. Clippy with pedantic lints enabled.
// #![deny(clippy::all, clippy::pedantic, clippy::nursery)]
// #![deny(unsafe_code)] — except in FFI modules, which must be isolated

// Naming:
// - Crates: snake_case (bidding_engine, fraud_detector)
// - Modules: snake_case
// - Types/Traits: PascalCase
// - Functions/Methods: snake_case
// - Constants: SCREAMING_SNAKE_CASE
// - Lifetimes: short, descriptive ('a, 'req, 'conn)

// Error handling: thiserror for library errors, anyhow for application errors
// Every public function returns Result<T, E> — never panic in production code.
// Use ? operator for propagation. Provide context:
//   .context("failed to compute trust score")?;

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

### SQL / Database

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

### Protobuf (Service Communication)

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
// Use string for UUIDs (not bytes).
// Use int64 for monetary values in cents.
```

---

## 6. Security Rules

These are non-negotiable. The hooks enforce many of these automatically.

### Authentication & Authorization
- JWT (RS256) for API authentication. Short-lived access tokens (15 min). Refresh tokens in HTTP-only secure cookies.
- Role-based access: `customer`, `provider`, `admin`. Every endpoint checks role.
- Every API route handler wrapped in `withAuth()` (or annotated `// @public` if intentionally open).
- Session timeouts: 60 min customer, 120 min provider, 30 min admin. WebSocket heartbeat resets timer.
- Password hashing: argon2id (memory=65536, iterations=3, parallelism=4).

### Input Validation
- Validate at every boundary: client-side (Zod), API gateway (Go validator), service layer (business rules).
- Never trust client input. Re-validate server-side even if client validates.
- Use Zod schemas shared between frontend and API routes.
- Parameterized queries only. String interpolation in SQL is blocked by hooks.

### Data Protection
- PII encrypted at rest (AES-256-GCM via libsodium).
- TLS 1.3 for all connections. No exceptions.
- CORS: explicit origin allowlist. No wildcards in production.
- CSP headers: strict. No `unsafe-inline`, no `unsafe-eval`.
- Rate limiting: per-IP and per-user. Stricter on auth endpoints (5 attempts/15 min).
- File uploads: validate MIME type server-side (don't trust Content-Type header). Max 10MB images, 25MB documents. Virus scan before storage.

### Payment Security
- All price calculations server-side. Client displays only.
- Stripe webhook signature verification mandatory (hooks enforce).
- Idempotency keys on all payment mutations (hooks enforce).
- PCI DSS: never touch raw card numbers. Stripe Elements/PaymentIntent only.
- Escrow: funds held in Stripe Connect Express. Released only on job completion confirmation.

### Secrets Management
- No secrets in code. Ever. Hooks detect and block.
- Development: `.env.local` (gitignored)
- Production: HashiCorp Vault
- Required env vars validated at startup with Zod schema. App fails to start if missing.

---

## 7. Testing Standards

### Frontend (Vitest + React Testing Library + Playwright)

**Vitest Configuration:**
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/',
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
```

**What to test:**
- **Unit tests**: Pure functions, hooks, Zod schemas, store logic, formatters, validators
- **Integration tests**: Component trees with mocked API, form submission flows, auth flows
- **E2E tests (Playwright)**: Critical user paths — registration, job posting, bidding, payment, chat
- **Accessibility tests**: axe-core integrated into component tests (`vitest-axe`)

**Testing patterns:**
```typescript
// Component tests: test behavior, not implementation
// DO: "displays bid amount when bid is placed"
// DON'T: "calls setBidAmount with correct value"

// Mock at the network boundary (MSW), not at the component boundary
// Use @testing-library/user-event, not fireEvent

// Every component that fetches data must be tested in:
// 1. Loading state
// 2. Success state (with data)
// 3. Error state
// 4. Empty state (no data)
```

### Backend — Go (stdlib testing)

```go
// Coverage target: 80% line coverage minimum.
// Every exported function must have tests.
// Table-driven tests. Parallel execution.

// Database tests: use testcontainers-go for real PostgreSQL.
// Never mock the database for repository tests.
// Use transactions that rollback for test isolation.

// HTTP handler tests: use httptest.NewServer.
// gRPC tests: use bufconn for in-process connections.

// Integration tests: test full request→response through the service layer.
// Use build tags to separate unit and integration tests:
//   //go:build integration
```

### Backend — Rust (cargo test + proptest)

```rust
// Coverage target: 80% minimum.
// Unit tests: in-module #[cfg(test)] blocks.
// Integration tests: in tests/ directory.
// Property-based tests: proptest for all numerical computations.
//   - Trust score: arbitrary inputs → output always 0..=100
//   - Bid engine: concurrent bids → no data races, no lost bids
//   - Fraud scorer: arbitrary fingerprints → no panics

// Benchmarks: criterion in benches/ directory.
// Performance budgets:
//   - Bid processing: < 1ms p99
//   - Trust score computation: < 5ms p99
//   - Fraud scoring: < 50ms p99
//   - Image resize (1080p): < 200ms p99
```

### Test Organization
```
tests/
├── unit/              # Fast, isolated, no I/O
├── integration/       # Service + database, real containers
├── e2e/               # Full browser flows (Playwright)
├── load/              # k6 load test scripts
└── fixtures/          # Shared test data factories
```

---

## 8. Performance Budgets

### Frontend
| Metric | Budget |
|--------|--------|
| LCP (Largest Contentful Paint) | < 2.5s |
| FID (First Input Delay) | < 100ms |
| CLS (Cumulative Layout Shift) | < 0.1 |
| TTI (Time to Interactive) | < 3.5s |
| Bundle size (initial JS) | < 200KB gzipped |
| Bundle size (per-route) | < 50KB gzipped |
| Image (hero) | < 200KB (WebP/AVIF) |
| Font loading | < 100KB total, font-display: swap |

### Backend
| Metric | Budget |
|--------|--------|
| API response (p50) | < 50ms |
| API response (p95) | < 200ms |
| API response (p99) | < 500ms |
| Bid processing (p99) | < 1ms |
| Trust score calc (p99) | < 5ms |
| Fraud scoring (p99) | < 50ms |
| Search query (p99) | < 50ms |
| Image processing (p99) | < 200ms |
| WebSocket message delivery | < 100ms |
| Database query (p95) | < 20ms |

### Infrastructure
| Metric | Budget |
|--------|--------|
| Uptime | 99.9% (8.7h downtime/year max) |
| Error rate | < 0.1% of requests |
| Concurrent WebSocket connections | 100K per node |
| Concurrent HTTP requests | 10K per Go service instance |

---

## 9. Error Handling

### Frontend
```typescript
// Global error boundary at app root — catches React rendering errors.
// Per-feature error boundaries around each major section.
// API errors: typed error responses, never show raw error to user.

// Error display hierarchy:
// 1. Inline field errors (form validation)
// 2. Toast/snackbar (action feedback: "Bid placed", "Network error")
// 3. Error state in component (data fetch failed — show retry button)
// 4. Full-page error (500, unexpected crash)

// Never: empty catch blocks, console.log errors, generic "Something went wrong"
// Always: specific user-friendly message + retry action where applicable
```

### Go Services
```go
// Errors are values. Wrap with context at every level.
// Use sentinel errors for expected conditions:
//   var ErrJobNotFound = errors.New("job not found")
//   var ErrBidExpired = errors.New("bid expired")
//   var ErrInsufficientFunds = errors.New("insufficient funds")

// Map domain errors to HTTP status codes in the gateway:
//   ErrNotFound → 404
//   ErrValidation → 400
//   ErrUnauthorized → 401
//   ErrForbidden → 403
//   ErrConflict → 409
//   Everything else → 500 (log full error, return generic message)

// Never expose internal error details to clients.
// Log full stack traces server-side with request ID for correlation.
```

### Rust Engines
```rust
// Use thiserror for typed errors:
//   #[derive(Debug, thiserror::Error)]
//   enum BidError {
//       #[error("auction closed for job {job_id}")]
//       AuctionClosed { job_id: String },
//       #[error("bid amount {amount} below minimum {minimum}")]
//       BelowMinimum { amount: i64, minimum: i64 },
//   }

// Never unwrap() or expect() in production code paths.
// Use .context() from anyhow for additional context.
// Panics are bugs. Catch at service boundary with std::panic::catch_unwind.
```

---

## 10. Git & Workflow Rules

- **Branch naming**: `feat/{ticket}-{short-desc}`, `fix/{ticket}-{short-desc}`, `chore/{desc}`
- **Commits**: Conventional Commits. `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`
- **PR size**: < 400 lines changed. Larger changes split into stacked PRs.
- **Main branch**: always deployable. Never push directly.
- **Pre-commit**: lint + format + type check. Enforced by Husky.
- **CI pipeline**: lint → type check → unit tests → integration tests → build → deploy preview
- **No force-push to main/master** (hooks block this).

---

## 11. Logging & Observability

```
// Structured JSON logs everywhere. No fmt.Println, no console.log.
// Log levels: DEBUG (dev only), INFO, WARN, ERROR, FATAL
// Every log entry includes: timestamp, level, service, request_id, message, fields
// Every HTTP request logged: method, path, status, duration_ms, request_id
// Every gRPC call logged: service, method, status, duration_ms, request_id

// Distributed tracing: OpenTelemetry spans across all services.
// Trace ID propagated via headers (traceparent).
// Every external call (DB, Redis, Stripe, S3) gets its own span.

// Metrics: Prometheus counters/histograms
// - http_requests_total{method, path, status}
// - http_request_duration_seconds{method, path}
// - grpc_requests_total{service, method, status}
// - bid_processing_duration_seconds
// - trust_score_computation_duration_seconds
// - active_websocket_connections
// - stripe_webhook_processing_duration_seconds
```

---

## 12. Environment Variables

```bash
# .env.example — every var the app needs
# Copy to .env.local for development

# === Required ===
DATABASE_URL=postgresql://nomarkup:password@localhost:5432/nomarkup?sslmode=disable
REDIS_URL=redis://localhost:6379
MEILISEARCH_URL=http://localhost:7700
MEILISEARCH_API_KEY=masterKey

# === Auth ===
JWT_PRIVATE_KEY_PATH=./keys/private.pem
JWT_PUBLIC_KEY_PATH=./keys/public.pem
SESSION_SECRET=generate-with-openssl-rand-base64-32

# === Stripe ===
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...

# === Storage ===
S3_BUCKET=nomarkup-dev
S3_REGION=us-west-2
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

# === Maps ===
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ...

# === Monitoring ===
SENTRY_DSN=https://...@sentry.io/...
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317

# === Service Ports ===
GATEWAY_PORT=8080
USER_SERVICE_PORT=50051
JOB_SERVICE_PORT=50052
BID_ENGINE_PORT=50053
PAYMENT_SERVICE_PORT=50054
CHAT_SERVICE_PORT=50055
FRAUD_ENGINE_PORT=50056
TRUST_ENGINE_PORT=50057
IMAGING_SERVICE_PORT=50058
WEB_PORT=3000
```

---

## 13. Do NOT

- Use `any` type in TypeScript (hook blocks this)
- Use `@ts-ignore` or `@ts-nocheck` (hook blocks this)
- Use `console.log` in production code (hook blocks this, use structured logger)
- Use `dangerouslySetInnerHTML` without DOMPurify (hook blocks this)
- Use string interpolation in SQL (hook blocks this)
- Hardcode secrets (hook blocks this)
- Use CSS-in-JS, CSS modules, or inline styles (use Tailwind)
- Use `<img>` tags (use Next.js `<Image>`)
- Use `<a>` for internal links (use Next.js `<Link>`)
- Use TypeScript `enum` (use const object + type extraction)
- Use `any` database ORM (use pgx for Go, sqlx for Rust — raw SQL with type safety)
- Use `Float` or `Decimal` for money (use integer cents)
- Use `setTimeout`/`setInterval` for polling (use WebSocket or Server-Sent Events)
- Skip error handling. Every error path must be handled explicitly.
- Write tests without assertions (hook blocks this)
- Deploy without passing CI pipeline
- Commit to main directly
- Use `React.FC` (use plain function declarations with typed props)
