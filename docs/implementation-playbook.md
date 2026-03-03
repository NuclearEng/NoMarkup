# NoMarkup Implementation Playbook

> Vertical-slice implementation plan. Each slice delivers a working end-to-end feature: database operations, gRPC service logic, gateway routes, and frontend UI.

**Architecture Reference:**
- Frontend: Next.js 15, TypeScript, Tailwind 4, shadcn/ui (port 3000)
- Gateway: Go Chi router (port 8080) -- REST-to-gRPC translation
- Go services: user (50051), job (50052), payment (50054), chat (50055)
- Rust engines: bidding (50053), fraud (50056), trust (50057), imaging (50058)
- DB: PostgreSQL 16 + PostGIS, Redis 7, Meilisearch, MinIO

**Proto files:** 14 total in `/proto/{service}/v1/{service}.proto`
**Database schema:** `/database/migrations/001_initial_schema.up.sql` (20 table groups, already written)

---

## Slice 0: Proto Codegen & Infrastructure Bootstrap

**Depends on:** Nothing (foundation for everything)
**Estimated files:** ~30 files (generated) + 5 config files
**Services touched:** All (codegen), docker-compose, Makefile

### Backend Tasks
1. Install protoc, protoc-gen-go, protoc-gen-go-grpc on the development machine. Verify versions.
2. Run `make proto-gen` to generate Go stubs from all 14 proto files into `proto/gen/go/`. Confirm output directories:
   - `proto/gen/go/common/v1/common.pb.go` + `common_grpc.pb.go`
   - `proto/gen/go/user/v1/user.pb.go` + `user_grpc.pb.go`
   - `proto/gen/go/job/v1/job.pb.go` + `job_grpc.pb.go`
   - `proto/gen/go/bid/v1/bid.pb.go` + `bid_grpc.pb.go`
   - `proto/gen/go/contract/v1/contract.pb.go` + `contract_grpc.pb.go`
   - `proto/gen/go/payment/v1/payment.pb.go` + `payment_grpc.pb.go`
   - `proto/gen/go/chat/v1/chat.pb.go` + `chat_grpc.pb.go`
   - `proto/gen/go/review/v1/review.pb.go` + `review_grpc.pb.go`
   - `proto/gen/go/trust/v1/trust.pb.go` + `trust_grpc.pb.go`
   - `proto/gen/go/fraud/v1/fraud.pb.go` + `fraud_grpc.pb.go`
   - `proto/gen/go/notification/v1/notification.pb.go` + `notification_grpc.pb.go`
   - `proto/gen/go/imaging/v1/imaging.pb.go` + `imaging_grpc.pb.go`
   - `proto/gen/go/subscription/v1/subscription.pb.go` + `subscription_grpc.pb.go`
   - `proto/gen/go/analytics/v1/analytics.pb.go` + `analytics_grpc.pb.go`
3. Configure Rust tonic/prost codegen in `engines/Cargo.toml` and each engine's `build.rs`:
   - `engines/bidding/build.rs` -- compile `bid.proto`, `common.proto`, `user.proto`
   - `engines/fraud/build.rs` -- compile `fraud.proto`, `common.proto`
   - `engines/trust/build.rs` -- compile `trust.proto`, `common.proto`
   - `engines/imaging/build.rs` -- compile `imaging.proto`
4. Run `cargo build --workspace` in `engines/` to verify Rust proto codegen succeeds.
5. Install golang-migrate CLI. Verify `make migrate-up` runs `001_initial_schema.up.sql` and `002_seed_taxonomy.up.sql` against local Postgres.
6. Generate RSA keypair for JWT RS256 signing:
   - `mkdir -p keys/`
   - `openssl genpkey -algorithm RSA -out keys/private.pem -pkeyopt rsa_keygen_bits:4096`
   - `openssl rsa -pubout -in keys/private.pem -out keys/public.pem`
   - Add `keys/` to `.gitignore`.
7. Verify `make up` starts all four docker-compose services (postgres, redis, meilisearch, minio) and health checks pass.
8. Create `.env.local` from CLAUDE.md section 12 environment variables template. Validate all required vars present.
9. Wire up Go module references: update `go.mod` in `gateway/`, `services/user/`, `services/job/`, `services/payment/`, `services/chat/` to reference `proto/gen/go/` with a `replace` directive or local module path.

### Frontend Tasks
1. Run `cd web && npm install` to verify all frontend dependencies resolve.
2. Verify `npm run dev` starts the Next.js dev server on port 3000.
3. Confirm Tailwind 4 config, shadcn/ui installation, and global styles (`web/src/styles/globals.css`) load correctly.

### Integration Points
- Proto codegen output is consumed by all Go services and Rust engines.
- golang-migrate connects to PostgreSQL via `DATABASE_URL`.
- JWT keypair is read by the User Service (signing) and Gateway (verification).
- docker-compose provides PostgreSQL, Redis, Meilisearch, MinIO for all services.

### Acceptance Criteria
- [ ] `make proto-gen` completes without errors and produces `.pb.go` + `_grpc.pb.go` files for all 14 proto packages
- [ ] `cargo build --workspace` in `engines/` compiles Rust proto stubs for bidding, fraud, trust, imaging
- [ ] `make up` starts postgres, redis, meilisearch, minio; all health checks green within 30 seconds
- [ ] `make migrate-up` applies both migrations (001, 002) to postgres. Tables `users`, `jobs`, `bids`, `contracts`, `payments`, `reviews`, `trust_scores`, `chat_channels`, `chat_messages`, `fraud_signals`, `notifications`, `subscriptions`, `market_ranges`, `service_categories` all exist
- [ ] RSA keypair exists at `keys/private.pem` and `keys/public.pem`; key size is 4096 bits
- [ ] `.env.local` contains all required environment variables from CLAUDE.md section 12
- [ ] `npm run dev` in `web/` starts Next.js on port 3000 without compilation errors

### Test Requirements
- [ ] Run `make migrate-down` then `make migrate-up` to verify migrations are reversible
- [ ] Write a smoke test script that connects to each infrastructure service (pg, redis, meili, minio) and verifies connectivity
- [ ] Verify proto Go import paths resolve in a minimal `main.go` that imports `userv1`, `jobv1`, `bidv1`
- [ ] Verify proto Rust import paths resolve with `cargo check --workspace`

---

## Slice 1: User Registration & Login

**Depends on:** Slice 0
**Estimated files:** ~25 files
**Services touched:** User Service, Gateway, Frontend

### Backend Tasks

#### User Service (`services/user/`)
1. **`services/user/internal/domain/types.go`** -- Define domain types: `User`, `RefreshToken`, `RegisterInput`, `LoginInput`, `TokenPair`, error sentinels (`ErrUserNotFound`, `ErrEmailTaken`, `ErrInvalidCredentials`, `ErrTokenExpired`, `ErrTokenRevoked`)
2. **`services/user/internal/repository/postgres.go`** -- Implement repository methods:
   - `CreateUser(ctx, email, passwordHash, displayName, roles) (User, error)` -- INSERT into `users`
   - `GetUserByEmail(ctx, email) (User, error)` -- SELECT from `users` WHERE email
   - `GetUserByID(ctx, id) (User, error)` -- SELECT from `users` WHERE id
   - `CreateRefreshToken(ctx, userID, tokenHash, deviceInfo, ip, expiresAt) error` -- INSERT into `refresh_tokens`
   - `GetRefreshToken(ctx, tokenHash) (RefreshToken, error)` -- SELECT from `refresh_tokens`
   - `RevokeRefreshToken(ctx, tokenHash) error` -- UPDATE `refresh_tokens` SET revoked_at
   - `RevokeAllUserTokens(ctx, userID) error` -- UPDATE all for user
   - `UpdateEmailVerified(ctx, userID) error` -- UPDATE `users` SET email_verified = true
   - **Tables read/written:** `users`, `refresh_tokens`
3. **`services/user/internal/service/auth.go`** -- Implement auth business logic:
   - `Register(ctx, input) (TokenPair, error)` -- validate input, check email uniqueness, hash password with argon2id (memory=65536, iterations=3, parallelism=4), create user, generate JWT + refresh token, enqueue verification email
   - `Login(ctx, input) (TokenPair, error)` -- fetch user by email, verify password with argon2id, check user status != banned/suspended, generate JWT + refresh token, update last_login_at
   - `RefreshToken(ctx, refreshToken) (TokenPair, error)` -- validate refresh token hash, check not revoked, check not expired, issue new access + refresh tokens, revoke old refresh token (rotation)
   - `Logout(ctx, refreshToken) error` -- revoke refresh token
   - `VerifyEmail(ctx, token) error` -- decode email verification token, update email_verified
4. **`services/user/internal/service/jwt.go`** -- JWT utility:
   - `GenerateAccessToken(userID, email, roles) (string, time.Time, error)` -- RS256 sign with private key, 15-minute expiry, claims: sub, email, roles, iat, exp
   - `GenerateRefreshToken() (string, string, error)` -- generate cryptographically random token, return (rawToken, sha256Hash)
   - `ValidateAccessToken(tokenString) (Claims, error)` -- verify with public key
5. **`services/user/internal/grpc/server.go`** -- Implement gRPC server methods:
   - `Register(ctx, *userv1.RegisterRequest) (*userv1.RegisterResponse, error)`
   - `Login(ctx, *userv1.LoginRequest) (*userv1.LoginResponse, error)`
   - `RefreshToken(ctx, *userv1.RefreshTokenRequest) (*userv1.RefreshTokenResponse, error)`
   - `Logout(ctx, *userv1.LogoutRequest) (*userv1.LogoutResponse, error)`
   - `VerifyEmail(ctx, *userv1.VerifyEmailRequest) (*userv1.VerifyEmailResponse, error)`
   - **Proto RPCs implemented:** Register, Login, RefreshToken, Logout, VerifyEmail
6. **`services/user/cmd/server/main.go`** -- Bootstrap: load config, connect to postgres, create repo/service/grpc server, listen on port 50051

#### Gateway (`gateway/`)
7. **`gateway/internal/handler/auth.go`** -- HTTP handlers:
   - `POST /api/v1/auth/register` -- parse JSON body, call UserService.Register via gRPC, return tokens, set refresh token as HTTP-only secure cookie
   - `POST /api/v1/auth/login` -- parse JSON body, call UserService.Login, return tokens, set refresh cookie
   - `POST /api/v1/auth/refresh` -- read refresh token from cookie, call UserService.RefreshToken, set new cookie
   - `POST /api/v1/auth/logout` -- read refresh token from cookie, call UserService.Logout, clear cookie
   - `POST /api/v1/auth/verify-email` -- parse token from query param, call UserService.VerifyEmail
8. **`gateway/internal/middleware/auth.go`** -- Update JWT validation middleware:
   - Extract Bearer token from Authorization header
   - Validate JWT using public key (RS256)
   - Inject user claims (userID, email, roles) into request context
   - Return 401 if missing/invalid/expired
9. **`gateway/internal/router/router.go`** -- Register auth routes (public, no auth middleware)
10. **`gateway/internal/config/config.go`** -- Add user service gRPC address, JWT public key path to config

#### Frontend (`web/`)
11. **`web/src/lib/api.ts`** -- Implement API client with fetch wrapper: base URL, JSON headers, automatic token attachment, 401 interceptor that triggers refresh
12. **`web/src/lib/auth.ts`** -- Auth utilities: `getAccessToken()`, `setAccessToken()`, `clearTokens()`, `isAuthenticated()`, `parseJwtPayload()` (decode without verify for client-side role checks)
13. **`web/src/stores/auth-store.ts`** -- Zustand store: `user`, `accessToken`, `isAuthenticated`, `login()`, `register()`, `logout()`, `refreshToken()`
14. **`web/src/lib/validations.ts`** -- Zod schemas: `registerSchema` (email, password 8+ chars with complexity, displayName 2-50 chars), `loginSchema` (email, password)
15. **`web/src/app/(auth)/register/page.tsx`** -- Registration page with multi-step form (email/password, display name, role selection)
16. **`web/src/components/forms/RegisterForm.tsx`** -- Registration form component using React Hook Form + Zod, shadcn/ui Input, Button, Form components
17. **`web/src/app/(auth)/login/page.tsx`** -- Login page
18. **`web/src/components/forms/LoginForm.tsx`** -- Login form component
19. **`web/src/app/(auth)/layout.tsx`** -- Auth layout (centered card, NoMarkup branding, redirect to dashboard if already authenticated)
20. **`web/src/app/(auth)/verify-email/page.tsx`** -- Email verification callback page (reads token from URL, calls verify endpoint, shows success/error)
21. **`web/src/components/layout/Header.tsx`** -- Header component with conditional auth state display (Login/Register buttons or user avatar/menu)

### Integration Points
- Gateway connects to User Service via gRPC on `localhost:50051`
- Frontend calls Gateway REST endpoints at `localhost:8080/api/v1/auth/*`
- Refresh tokens stored as HTTP-only secure cookies (set by gateway, sent automatically by browser)
- Access tokens stored in memory (Zustand store) -- NOT localStorage
- JWT public key shared between User Service (signing with private) and Gateway (verification with public)

### Acceptance Criteria
- [ ] `POST /api/v1/auth/register` with valid email/password/displayName returns 201 with access_token and sets refresh_token cookie
- [ ] `POST /api/v1/auth/register` with duplicate email returns 409 Conflict
- [ ] `POST /api/v1/auth/register` with weak password returns 400 with field-specific error
- [ ] `POST /api/v1/auth/login` with correct credentials returns 200 with tokens
- [ ] `POST /api/v1/auth/login` with wrong password returns 401
- [ ] `POST /api/v1/auth/login` with suspended user returns 403
- [ ] `POST /api/v1/auth/refresh` with valid refresh cookie returns new token pair and rotates refresh token
- [ ] `POST /api/v1/auth/refresh` with revoked token returns 401
- [ ] `POST /api/v1/auth/logout` revokes refresh token and clears cookie
- [ ] Access token expires after 15 minutes; refresh flow works transparently
- [ ] Frontend registration form validates inline (email format, password strength, name length)
- [ ] Frontend redirects to dashboard after successful registration/login
- [ ] Frontend redirects to login when accessing authenticated routes without valid token
- [ ] Password stored as argon2id hash, never plaintext

### Test Requirements
- [ ] **Unit:** `service/auth.go` -- test Register (happy path, duplicate email, invalid input), Login (happy path, wrong password, banned user), RefreshToken (happy, expired, revoked), Logout
- [ ] **Unit:** `service/jwt.go` -- test GenerateAccessToken produces valid RS256 JWT, ValidateAccessToken rejects expired/tampered tokens
- [ ] **Unit:** `repository/postgres.go` -- test against real PostgreSQL (testcontainers): CreateUser, GetUserByEmail, CreateRefreshToken, RevokeRefreshToken
- [ ] **Unit:** Frontend Zod schemas -- test registerSchema, loginSchema validation rules
- [ ] **Integration:** Full register -> login -> refresh -> logout flow through Gateway HTTP endpoints
- [ ] **E2E:** Playwright test: navigate to /register, fill form, submit, verify redirect to dashboard

---

## Slice 2: User Profiles & Provider Onboarding

**Depends on:** Slice 1
**Estimated files:** ~20 files
**Services touched:** User Service, Gateway, Frontend

### Backend Tasks

#### User Service (`services/user/`)
1. **`services/user/internal/repository/postgres.go`** -- Add repository methods:
   - `GetUser(ctx, userID) (User, error)` -- SELECT from `users`
   - `UpdateUser(ctx, userID, fields) (User, error)` -- UPDATE `users` (display_name, phone, avatar_url, timezone)
   - `EnableRole(ctx, userID, role) (User, error)` -- append to `users.roles` array
   - `CreateProviderProfile(ctx, userID) (ProviderProfile, error)` -- INSERT into `provider_profiles` with defaults
   - `GetProviderProfile(ctx, userID) (ProviderProfile, error)` -- SELECT from `provider_profiles` JOIN `provider_service_categories` JOIN `provider_portfolio_images`
   - `UpdateProviderProfile(ctx, userID, fields) (ProviderProfile, error)` -- UPDATE `provider_profiles` (business_name, bio, service_address, service_location, service_radius_km)
   - `SetGlobalTerms(ctx, userID, terms) error` -- UPDATE `provider_profiles` (default_payment_timing, default_milestone_json, cancellation_policy, warranty_terms)
   - `UpdateServiceCategories(ctx, providerID, categoryIDs) error` -- DELETE + INSERT `provider_service_categories`
   - `UpdatePortfolio(ctx, providerID, images) error` -- DELETE + INSERT `provider_portfolio_images`
   - `SetInstantAvailability(ctx, userID, enabled, available, schedule) error` -- UPDATE `provider_profiles`
   - `GetServiceCategories(ctx, level, parentID) ([]Category, error)` -- SELECT from `service_categories`
   - **Tables read/written:** `users`, `provider_profiles`, `provider_service_categories`, `provider_portfolio_images`, `service_categories`
2. **`services/user/internal/service/profile.go`** -- Profile business logic:
   - `GetUser(ctx, userID) (User, error)` -- simple passthrough with authorization check
   - `UpdateUser(ctx, userID, input) (User, error)` -- validate fields, update
   - `EnableRole(ctx, userID, role) (User, error)` -- validate role, create provider_profile if enabling "provider"
   - `GetProviderProfile(ctx, userID) (ProviderProfile, error)` -- enrich with trust score, review summary
   - `UpdateProviderProfile(ctx, userID, input) (ProviderProfile, error)` -- validate, update, recompute profile_completeness
   - `SetGlobalTerms(ctx, userID, terms) error` -- validate payment timing, milestone percentages sum to 100
3. **`services/user/internal/grpc/server.go`** -- Add gRPC methods:
   - `GetUser`, `UpdateUser`, `EnableRole`
   - `GetProviderProfile`, `UpdateProviderProfile`, `SetGlobalTerms`, `UpdateServiceCategories`, `UpdatePortfolio`, `SetInstantAvailability`
   - `GetServiceCategories`, `GetCategoryTree`
   - **Proto RPCs implemented:** GetUser, UpdateUser, EnableRole, GetProviderProfile, UpdateProviderProfile, SetGlobalTerms, UpdateServiceCategories, UpdatePortfolio, SetInstantAvailability

#### Gateway (`gateway/`)
4. **`gateway/internal/handler/user.go`** -- HTTP handlers:
   - `GET /api/v1/users/me` -- get current user (from JWT claims)
   - `PATCH /api/v1/users/me` -- update current user profile
   - `POST /api/v1/users/me/roles` -- enable a role (body: `{role: "provider"}`)
   - `GET /api/v1/users/:id` -- get public user profile
5. **`gateway/internal/handler/provider.go`** -- HTTP handlers:
   - `GET /api/v1/providers/me` -- get current user's provider profile
   - `PATCH /api/v1/providers/me` -- update provider profile
   - `PUT /api/v1/providers/me/terms` -- set global terms
   - `PUT /api/v1/providers/me/categories` -- set service categories
   - `PUT /api/v1/providers/me/portfolio` -- update portfolio images
   - `PUT /api/v1/providers/me/availability` -- set instant availability
   - `GET /api/v1/providers/:id` -- get public provider profile
6. **`gateway/internal/handler/categories.go`** -- HTTP handlers:
   - `GET /api/v1/categories` -- list categories (query params: level, parent_id)
   - `GET /api/v1/categories/tree` -- full category tree
7. **`gateway/internal/router/router.go`** -- Register profile and provider routes (auth-required)

#### Frontend (`web/`)
8. **`web/src/app/(dashboard)/profile/page.tsx`** -- User profile page (customer view): display name, email, phone, avatar, properties
9. **`web/src/components/forms/ProfileForm.tsx`** -- Profile edit form (display name, phone, avatar upload placeholder, timezone)
10. **`web/src/app/(dashboard)/provider/onboarding/page.tsx`** -- Provider onboarding flow (multi-step):
    - Step 1: Business info (name, bio, service address)
    - Step 2: Service categories (multi-select from category tree)
    - Step 3: Service area (radius on map)
    - Step 4: Global terms (payment timing, milestone templates, cancellation policy)
    - Step 5: Portfolio upload (placeholder -- imaging pipeline in Slice 13)
11. **`web/src/components/providers/ProviderProfileCard.tsx`** -- Provider profile display card (name, business, rating, trust tier, badges, categories)
12. **`web/src/components/providers/CategorySelector.tsx`** -- Hierarchical category selection component (3-level drill-down)
13. **`web/src/hooks/useProfile.ts`** -- TanStack Query hook for fetching/mutating user profile
14. **`web/src/hooks/useProviderProfile.ts`** -- TanStack Query hook for provider profile
15. **`web/src/hooks/useCategories.ts`** -- TanStack Query hook for category tree
16. **`web/src/types/index.ts`** -- Add TypeScript types: `User`, `ProviderProfile`, `ServiceCategory`, `CategoryTree`

### Integration Points
- Gateway auth middleware extracts userID from JWT for `/me` endpoints
- EnableRole("provider") auto-creates a `provider_profiles` row
- Category tree is loaded once and cached client-side (rarely changes)
- Provider profile completeness computed server-side based on filled fields

### Acceptance Criteria
- [ ] `GET /api/v1/users/me` returns current authenticated user's profile
- [ ] `PATCH /api/v1/users/me` updates display_name, phone, avatar_url
- [ ] `POST /api/v1/users/me/roles` with `{role: "provider"}` adds provider role and creates provider_profile record
- [ ] `GET /api/v1/providers/me` returns full provider profile including categories, portfolio, trust stub
- [ ] `PATCH /api/v1/providers/me` updates business_name, bio, service_address, service_location, service_radius_km
- [ ] `PUT /api/v1/providers/me/categories` replaces service categories for provider
- [ ] `GET /api/v1/categories/tree` returns full 3-level category hierarchy
- [ ] Frontend onboarding flow navigates through all 5 steps and creates a complete provider profile
- [ ] Profile completeness percentage updates as fields are filled
- [ ] Enabling provider role from frontend triggers onboarding redirect

### Test Requirements
- [ ] **Unit:** `service/profile.go` -- test GetUser, UpdateUser (valid/invalid fields), EnableRole (duplicate role, invalid role), provider profile CRUD
- [ ] **Unit:** `repository/postgres.go` -- test provider profile creation, category association, portfolio management against real PostgreSQL
- [ ] **Integration:** Register user -> enable provider role -> update provider profile -> verify full profile returned
- [ ] **E2E:** Playwright: register, complete provider onboarding flow, verify profile page shows all data

---

## Slice 3: Job Posting & Discovery

**Depends on:** Slices 1, 2
**Estimated files:** ~25 files
**Services touched:** Job Service, Gateway, Frontend, Meilisearch

### Backend Tasks

#### Job Service (`services/job/`)
1. **`services/job/internal/domain/types.go`** -- Define domain types: `Job`, `JobDetail`, `ServiceCategory`, `MarketRange`, `CreateJobInput`, `SearchJobsInput`, error sentinels (`ErrJobNotFound`, `ErrNotDraft`, `ErrNotOwner`)
2. **`services/job/internal/repository/postgres.go`** -- Implement repository methods:
   - `CreateJob(ctx, input) (Job, error)` -- INSERT into `jobs`, INSERT into `job_photos`, INSERT into `job_tags`. Compute `approximate_location` from property's zip centroid. Set `auction_ends_at = now() + duration_hours`
   - `UpdateJob(ctx, jobID, fields) (Job, error)` -- UPDATE `jobs` WHERE status = 'draft'
   - `GetJob(ctx, jobID) (Job, error)` -- SELECT from `jobs` JOIN `service_categories` (3 levels) JOIN `job_photos`
   - `GetJobDetail(ctx, jobID, requestingUserID) (JobDetail, error)` -- Full join including customer info; include exact address only if requesting user is awarded provider
   - `DeleteDraft(ctx, jobID) error` -- DELETE from `jobs` WHERE status = 'draft'
   - `PublishJob(ctx, jobID) (Job, error)` -- UPDATE status 'draft' -> 'active', SET auction_ends_at
   - `CloseAuction(ctx, jobID, customerID) (Job, error)` -- UPDATE status 'active' -> 'closed'
   - `CancelJob(ctx, jobID, customerID, reason) (Job, error)` -- UPDATE status -> 'cancelled'
   - `SearchJobs(ctx, input) ([]Job, Pagination, error)` -- SELECT with filters: category, location (PostGIS ST_DWithin), price range, schedule type, text (pg_trgm), pagination, sorting
   - `ListCustomerJobs(ctx, customerID, statusFilter, pagination) ([]Job, Pagination, error)` -- SELECT for customer's jobs
   - `ListDrafts(ctx, customerID) ([]Job, error)` -- SELECT WHERE status = 'draft' AND customer_id
   - `GetServiceCategories(ctx, level, parentID) ([]Category, error)` -- SELECT from `service_categories`
   - `GetCategoryTree(ctx) ([]CategoryTreeNode, error)` -- Recursive CTE for full tree
   - `LookupMarketRange(ctx, serviceTypeID, zipCode) (MarketRange, error)` -- SELECT from `market_ranges`
   - **Tables read/written:** `jobs`, `job_photos`, `job_tags`, `service_categories`, `properties`, `market_ranges`
3. **`services/job/internal/service/job.go`** -- Business logic:
   - `CreateJob(ctx, input) (Job, error)` -- validate category hierarchy exists, validate property belongs to customer, validate auction params (duration 24-168 hours, offer_accepted >= starting_bid), lookup market range for display
   - `PublishJob(ctx, jobID) (Job, error)` -- validate is draft, validate required fields, transition to active, index in Meilisearch
   - `SearchJobs(ctx, input) ([]Job, error)` -- query Meilisearch for text search, PostgreSQL for geo/filter queries
   - `CloseAuction(ctx, jobID, customerID) (Job, error)` -- validate owner, validate status active, close
4. **`services/job/internal/service/search.go`** -- Meilisearch integration:
   - `IndexJob(ctx, job) error` -- push job document to Meilisearch index
   - `RemoveJob(ctx, jobID) error` -- remove from index
   - `SearchJobs(ctx, query, filters) ([]string, error)` -- full-text search returning job IDs
   - Configure Meilisearch index settings: searchable attributes (title, description, category_name), filterable (status, category_id, schedule_type), sortable (created_at, starting_bid_cents)
5. **`services/job/internal/grpc/server.go`** -- Implement gRPC methods:
   - `CreateJob`, `UpdateJob`, `GetJob`, `DeleteDraft`, `PublishJob`, `CloseAuction`, `CancelJob`
   - `SearchJobs`, `ListCustomerJobs`, `ListDrafts`
   - `GetServiceCategories`, `GetCategoryTree`
   - **Proto RPCs implemented:** CreateJob, UpdateJob, GetJob, DeleteDraft, PublishJob, CloseAuction, CancelJob, SearchJobs, ListCustomerJobs, ListDrafts, GetServiceCategories, GetCategoryTree
6. **`services/job/cmd/server/main.go`** -- Bootstrap: load config, connect postgres + meilisearch, create repo/service/grpc, listen on 50052

#### Gateway (`gateway/`)
7. **`gateway/internal/handler/job.go`** -- HTTP handlers:
   - `POST /api/v1/jobs` -- create job (draft or publish)
   - `PATCH /api/v1/jobs/:id` -- update draft
   - `GET /api/v1/jobs/:id` -- get job detail
   - `DELETE /api/v1/jobs/:id` -- delete draft
   - `POST /api/v1/jobs/:id/publish` -- publish draft
   - `POST /api/v1/jobs/:id/close` -- close auction
   - `POST /api/v1/jobs/:id/cancel` -- cancel job
   - `GET /api/v1/jobs` -- search/list jobs (query params: category, location, radius, price, text, sort, page)
   - `GET /api/v1/jobs/mine` -- list customer's jobs (requires customer role)
   - `GET /api/v1/jobs/drafts` -- list customer's drafts
8. **`gateway/internal/router/router.go`** -- Register job routes. Search is public; create/update/delete require auth + customer role.

#### Frontend (`web/`)
9. **`web/src/app/(dashboard)/jobs/new/page.tsx`** -- Job posting page (multi-step form)
10. **`web/src/components/forms/JobPostingForm.tsx`** -- Multi-step job posting form:
    - Step 1: Category selection (3-level drill-down using CategorySelector from Slice 2)
    - Step 2: Job details (title, description, photos placeholder)
    - Step 3: Location (select property or enter new address)
    - Step 4: Schedule (specific date, date range, or flexible; recurring toggle)
    - Step 5: Auction parameters (starting bid, offer accepted price, duration, min provider rating)
    - Step 6: Review & publish (shows market range comparison)
11. **`web/src/app/(public)/jobs/page.tsx`** -- Job listing/search page (public)
12. **`web/src/components/jobs/JobCard.tsx`** -- Job card component (title, category, location, bid count, time remaining, starting bid)
13. **`web/src/components/jobs/JobSearchFilters.tsx`** -- Search filters sidebar (category, location/radius, price range, schedule type)
14. **`web/src/app/(public)/jobs/[id]/page.tsx`** -- Job detail page (title, description, photos, category, location map, schedule, auction timer, bid count, market range display)
15. **`web/src/components/jobs/AuctionTimer.tsx`** -- Countdown timer component for auction deadline
16. **`web/src/components/jobs/MarketRangeDisplay.tsx`** -- Market range visualization (low/median/high bar chart)
17. **`web/src/app/(dashboard)/jobs/mine/page.tsx`** -- Customer's jobs dashboard (tabs: active, drafts, completed, cancelled)
18. **`web/src/hooks/useJobs.ts`** -- TanStack Query hooks: useSearchJobs, useJob, useCreateJob, useUpdateJob, usePublishJob, useCustomerJobs
19. **`web/src/lib/validations.ts`** -- Add jobSchema (title 10-100 chars, description 50-2000 chars, category required, auction duration 24-168)

### Integration Points
- Gateway connects to Job Service via gRPC on `localhost:50052`
- Job Service connects to PostgreSQL and Meilisearch
- Job creation reads from `properties` table (user service domain) -- cross-service read is acceptable for owned data
- Market range data comes from pre-seeded `market_ranges` table
- Published jobs are indexed in Meilisearch for full-text search

### Acceptance Criteria
- [ ] `POST /api/v1/jobs` with `publish: false` creates a draft job; returns job with status "draft"
- [ ] `POST /api/v1/jobs/:id/publish` transitions draft to active, sets auction_ends_at
- [ ] `GET /api/v1/jobs/:id` returns full job detail including category hierarchy, photos, market range
- [ ] `GET /api/v1/jobs/:id` hides exact address from non-awarded users, shows approximate location
- [ ] `GET /api/v1/jobs?text_query=plumbing&radius_km=25` returns geo-filtered, text-matched results
- [ ] `GET /api/v1/jobs?category_ids=xxx` filters by category correctly
- [ ] Frontend job posting form validates all fields inline, prevents submission with missing required fields
- [ ] Frontend job search page loads jobs with infinite scroll/pagination
- [ ] Frontend auction timer counts down correctly and shows "Auction Closed" when expired
- [ ] Market range displays correctly on job detail page

### Test Requirements
- [ ] **Unit:** `service/job.go` -- test CreateJob validation (invalid category, missing title, bad auction duration), PublishJob state transition, CloseAuction authorization
- [ ] **Unit:** `repository/postgres.go` -- test CRUD operations, PostGIS distance query, search with filters
- [ ] **Unit:** `service/search.go` -- test Meilisearch indexing and search (requires meilisearch container)
- [ ] **Integration:** Create job as draft -> update -> publish -> search -> find in results -> close auction
- [ ] **Frontend Unit:** JobPostingForm step navigation, validation per step, AuctionTimer countdown logic
- [ ] **E2E:** Playwright: post a job through all steps, verify it appears in search results

---

## Slice 4: Bidding System

**Depends on:** Slices 1, 2, 3
**Estimated files:** ~20 files
**Services touched:** Bidding Engine (Rust), Gateway, Frontend, Job Service (status updates)

### Backend Tasks

#### Bidding Engine (`engines/bidding/`)
1. **`engines/bidding/src/models.rs`** -- Define domain types: `Bid`, `BidStatus`, `PlaceBidInput`, `BidValidation`, error types (`AuctionClosed`, `BelowMinimum`, `AlreadyBid`, `NotBidOwner`, `BidNotActive`)
2. **`engines/bidding/src/engine.rs`** -- Core auction logic:
   - `place_bid(job_id, provider_id, amount_cents) -> Result<Bid>` -- validate auction is active (check `jobs.auction_ends_at`), validate provider has provider role, validate one-bid-per-provider (UNIQUE constraint), validate amount > 0, check if amount <= offer_accepted_cents (auto-accept), INSERT into `bids`, UPDATE `jobs.bid_count`, return bid
   - `update_bid(bid_id, provider_id, new_amount_cents) -> Result<Bid>` -- validate bid ownership, validate bid is active, validate new amount < current amount (bids can only go lower), UPDATE `bids`, append to `bid_updates` JSONB
   - `withdraw_bid(bid_id, provider_id) -> Result<Bid>` -- validate ownership, UPDATE status to 'withdrawn', UPDATE `jobs.bid_count`
   - `accept_offer_price(job_id, provider_id) -> Result<Bid>` -- place bid at exactly offer_accepted_cents with is_offer_accepted = true
   - `award_bid(job_id, bid_id, customer_id) -> Result<(Bid, String)>` -- validate customer owns job, validate bid is active, UPDATE bid status to 'awarded', UPDATE all other bids to 'not_selected', UPDATE job status to 'awarded' + awarded_provider_id + awarded_bid_id, return (bid, contract_id placeholder)
   - `list_bids_for_job(job_id, customer_id) -> Result<Vec<BidWithProvider>>` -- sealed-bid: only customer sees all bids. JOIN with user/provider data for display
   - `list_bids_for_provider(provider_id, status_filter) -> Result<Vec<Bid>>` -- provider sees own bids across jobs
   - `get_bid_count(job_id) -> Result<i32>` -- return count (public info, visible to all)
   - `expire_auction(job_id) -> Result<i32>` -- expire all active bids for a closed auction
   - **Tables read/written:** `bids`, `jobs` (bid_count, status, awarded_provider_id, awarded_bid_id), `users`, `provider_profiles`
3. **`engines/bidding/src/grpc.rs`** -- tonic gRPC server implementation:
   - `PlaceBid`, `UpdateBid`, `WithdrawBid`, `AcceptOfferPrice`
   - `AwardBid`
   - `GetBid`, `ListBidsForJob`, `ListBidsForProvider`, `GetBidCount`
   - `ExpireAuction`, `CheckAuctionDeadlines`
   - `GetBidAnalytics`
   - **Proto RPCs implemented:** PlaceBid, UpdateBid, WithdrawBid, AcceptOfferPrice, AwardBid, GetBid, ListBidsForJob, ListBidsForProvider, GetBidCount, ExpireAuction, CheckAuctionDeadlines, GetBidAnalytics
4. **`engines/bidding/src/main.rs`** -- Bootstrap: load config, connect to PostgreSQL via sqlx, start tonic server on port 50053

#### Gateway (`gateway/`)
5. **`gateway/internal/handler/bid.go`** -- HTTP handlers:
   - `POST /api/v1/jobs/:job_id/bids` -- place bid (provider role required)
   - `PATCH /api/v1/bids/:id` -- update bid amount (provider role, must be lower)
   - `DELETE /api/v1/bids/:id` -- withdraw bid (provider role)
   - `POST /api/v1/jobs/:job_id/bids/accept-offer` -- accept offer price (provider role)
   - `POST /api/v1/jobs/:job_id/bids/:bid_id/award` -- award bid to provider (customer role)
   - `GET /api/v1/jobs/:job_id/bids` -- list bids for job (customer who owns job only)
   - `GET /api/v1/bids/mine` -- list provider's bids across all jobs
   - `GET /api/v1/jobs/:job_id/bids/count` -- get bid count (public)
6. **`gateway/internal/router/router.go`** -- Register bid routes with appropriate role middleware

#### Frontend (`web/`)
7. **`web/src/components/bids/BidForm.tsx`** -- Bid submission form: amount input with currency formatting, offer-accepted toggle, validation (amount > 0, amount < starting bid if set)
8. **`web/src/components/bids/BidCard.tsx`** -- Bid card component for customer view: provider info, amount, trust score, review summary, verification badges, award button
9. **`web/src/components/bids/BidList.tsx`** -- Bid listing for customer: sortable by price, rating, trust score
10. **`web/src/app/(dashboard)/bids/page.tsx`** -- Provider's bids dashboard: active bids, won bids, lost bids
11. **`web/src/components/bids/ProviderBidCard.tsx`** -- Provider view of their own bid: job info, amount, status, update/withdraw actions
12. **`web/src/app/(public)/jobs/[id]/page.tsx`** -- Update job detail page: add bid form for providers, bid count display, bid listing for job owner
13. **`web/src/hooks/useBids.ts`** -- TanStack Query hooks: usePlaceBid, useUpdateBid, useWithdrawBid, useBidsForJob, useMyBids, useBidCount, useAwardBid
14. **`web/src/lib/validations.ts`** -- Add bidSchema (amount_cents > 0, required job_id)

### Integration Points
- Gateway connects to Bidding Engine via gRPC on `localhost:50053`
- Bidding Engine reads from `jobs` table to validate auction state (cross-service read)
- Bidding Engine writes to `jobs` table to update bid_count and awarded fields
- Sealed-bid logic: providers cannot see other bids; only the customer (job owner) can list all bids
- Bid count is public (visible on job cards)
- AwardBid triggers: job status change, all non-selected bids updated (triggers contract creation in Slice 5)

### Acceptance Criteria
- [ ] `POST /api/v1/jobs/:id/bids` with valid amount creates bid; job bid_count increments
- [ ] `POST /api/v1/jobs/:id/bids` with expired auction returns 400 "auction closed"
- [ ] `POST /api/v1/jobs/:id/bids` when provider already has bid returns 409 "already bid"
- [ ] `PATCH /api/v1/bids/:id` with lower amount succeeds; bid history updated
- [ ] `PATCH /api/v1/bids/:id` with higher amount returns 400 "bids can only go lower"
- [ ] `DELETE /api/v1/bids/:id` sets status to withdrawn; bid_count decrements
- [ ] `POST /api/v1/jobs/:id/bids/accept-offer` creates bid at offer_accepted_cents with is_offer_accepted = true
- [ ] `POST /api/v1/jobs/:id/bids/:bid_id/award` awards bid, updates job status, marks other bids as not_selected
- [ ] `GET /api/v1/jobs/:id/bids` returns all bids only for the customer who owns the job; returns 403 for others
- [ ] `GET /api/v1/jobs/:id/bids/count` returns bid count for any authenticated user
- [ ] Frontend bid form validates amount, shows market range comparison
- [ ] Frontend bid list for customer sorts by price/rating/trust and shows provider details

### Test Requirements
- [ ] **Unit (Rust):** engine.rs -- place_bid validation (auction closed, already bid, below minimum), update_bid (only lower), withdraw, award logic (all other bids updated). Use proptest for concurrent bid safety
- [ ] **Unit (Rust):** engine.rs -- bid analytics computation (lowest, highest, median)
- [ ] **Integration:** Place multiple bids from different providers -> customer lists bids -> awards one -> verify all statuses correct
- [ ] **Benchmark (Rust):** criterion benchmark for place_bid with concurrent load -- must be < 1ms p99
- [ ] **E2E:** Playwright: provider places bid on job, customer views bids, awards a bid

---

## Slice 5: Contract Management

**Depends on:** Slices 1, 3, 4
**Estimated files:** ~18 files
**Services touched:** Job Service (contract logic), Gateway, Frontend

### Backend Tasks

#### Job Service (`services/job/`) -- Contract logic lives here as it is tightly coupled with job lifecycle
1. **`services/job/internal/domain/contract_types.go`** -- Define: `Contract`, `Milestone`, `ChangeOrder`, `ContractStatus`, error sentinels (`ErrContractNotFound`, `ErrNotContractParty`, `ErrAlreadyAccepted`, `ErrDeadlineExpired`)
2. **`services/job/internal/repository/contract_repo.go`** -- Repository methods:
   - `CreateContract(ctx, jobID, customerID, providerID, bidID, amountCents, paymentTiming, milestones) (Contract, error)` -- INSERT into `contracts` with generated contract_number (NM-YYYY-NNNNN using `contract_number_seq`), INSERT milestones, SET acceptance_deadline = now() + 72h
   - `GetContract(ctx, contractID) (Contract, error)` -- SELECT from `contracts` JOIN `milestones` JOIN `change_orders`
   - `AcceptContract(ctx, contractID, userID) (Contract, error)` -- UPDATE customer_accepted or provider_accepted, if both accepted -> status = 'active', set accepted_at
   - `StartWork(ctx, contractID, providerID) (Contract, error)` -- UPDATE status -> 'active', set started_at, UPDATE first milestone to 'in_progress'
   - `ListContracts(ctx, userID, statusFilter, pagination) ([]Contract, error)` -- SELECT for user as customer OR provider
   - `SubmitMilestone(ctx, milestoneID, providerID) (Milestone, error)` -- UPDATE milestone status -> 'submitted'
   - `ApproveMilestone(ctx, milestoneID, customerID) (Milestone, error)` -- UPDATE status -> 'approved', advance next milestone to 'in_progress'
   - `RequestRevision(ctx, milestoneID, customerID, notes) (Milestone, error)` -- CHECK revision_count < 3, UPDATE status -> 'revision_requested', increment revision_count
   - **Tables read/written:** `contracts`, `milestones`, `change_orders`, `jobs` (status update to 'contract_pending', 'in_progress')
3. **`services/job/internal/service/contract.go`** -- Business logic:
   - `CreateContractFromAward(ctx, jobID, bidID) (Contract, error)` -- called after bid award: lookup bid amount + provider's default terms, create contract with milestones, update job status to 'contract_pending'
   - `AcceptContract(ctx, contractID, userID) (Contract, error)` -- validate user is party to contract, validate within 72h deadline, accept
   - `VoidExpiredContracts(ctx) error` -- scheduled: find contracts past acceptance_deadline where both haven't accepted, void them, update job back to 'closed'
   - `SubmitMilestone`, `ApproveMilestone`, `RequestRevision` -- validate authorization and state transitions
4. **`services/job/internal/grpc/contract_server.go`** -- gRPC methods:
   - `GetContract`, `AcceptContract`, `StartWork`, `ListContracts`
   - `SubmitMilestone`, `ApproveMilestone`, `RequestRevision`
   - **Proto RPCs implemented:** GetContract, AcceptContract, StartWork, ListContracts, SubmitMilestone, ApproveMilestone, RequestRevision

#### Gateway (`gateway/`)
5. **`gateway/internal/handler/contract.go`** -- HTTP handlers:
   - `GET /api/v1/contracts/:id` -- get contract detail
   - `POST /api/v1/contracts/:id/accept` -- accept contract (customer or provider)
   - `POST /api/v1/contracts/:id/start` -- start work (provider)
   - `GET /api/v1/contracts` -- list user's contracts
   - `POST /api/v1/milestones/:id/submit` -- submit milestone (provider)
   - `POST /api/v1/milestones/:id/approve` -- approve milestone (customer)
   - `POST /api/v1/milestones/:id/revision` -- request revision (customer)
6. **`gateway/internal/router/router.go`** -- Register contract routes (auth-required)

#### Frontend (`web/`)
7. **`web/src/app/(dashboard)/contracts/page.tsx`** -- Contracts list page (tabs: pending, active, completed)
8. **`web/src/app/(dashboard)/contracts/[id]/page.tsx`** -- Contract detail page: terms, milestones timeline, accept/reject actions, status display
9. **`web/src/components/forms/ContractAcceptance.tsx`** -- Contract acceptance UI: display terms, accept/decline buttons, 72h countdown timer
10. **`web/src/components/jobs/MilestoneTracker.tsx`** -- Milestone progress tracker: visual timeline, submit/approve/revision actions per milestone
11. **`web/src/hooks/useContracts.ts`** -- TanStack Query hooks: useContract, useContracts, useAcceptContract, useSubmitMilestone, useApproveMilestone

### Integration Points
- Contract auto-created when bid is awarded (Bidding Engine -> Job Service)
- Contract acceptance deadline: 72 hours, enforced by scheduled job (VoidExpiredContracts)
- Milestone approval triggers payment creation (wired in Slice 6)
- Contract status changes update job status (contract_pending -> in_progress)
- Contract number format: NM-YYYY-NNNNN (using PostgreSQL sequence)

### Acceptance Criteria
- [ ] Awarding a bid automatically creates a contract with generated contract number, milestones, and 72-hour acceptance deadline
- [ ] Both customer and provider must accept within 72 hours; contract becomes 'active' when both accept
- [ ] Contract voided automatically if acceptance deadline passes without both accepting
- [ ] `GET /api/v1/contracts/:id` returns full contract with milestones and change orders
- [ ] Provider can submit milestones; customer can approve or request revision (max 3 revisions)
- [ ] Milestone status progression: pending -> in_progress -> submitted -> approved (or revision_requested -> in_progress)
- [ ] `GET /api/v1/contracts` returns contracts where user is customer or provider
- [ ] Frontend contract detail page shows acceptance countdown, milestone tracker

### Test Requirements
- [ ] **Unit:** contract creation from award (correct number format, milestone amounts sum to contract total)
- [ ] **Unit:** acceptance flow (single accept, double accept, expired deadline, non-party rejection)
- [ ] **Unit:** milestone state machine (valid transitions, max revision count)
- [ ] **Integration:** Full flow: award bid -> contract created -> both accept -> provider submits milestone -> customer approves
- [ ] **E2E:** Playwright: award bid, navigate to contract, accept as both parties, submit and approve milestone

---

## Slice 6: Payment Processing

**Depends on:** Slices 1, 2, 5
**Estimated files:** ~22 files
**Services touched:** Payment Service, Gateway, Frontend, Stripe

### Backend Tasks

#### Payment Service (`services/payment/`)
1. **`services/payment/internal/domain/types.go`** -- Define: `Payment`, `PaymentMethod`, `PaymentBreakdown`, `FeeConfig`, error sentinels (`ErrPaymentNotFound`, `ErrInsufficientFunds`, `ErrStripeError`, `ErrIdempotencyConflict`)
2. **`services/payment/internal/repository/postgres.go`** -- Repository methods:
   - `GetFeeConfig(ctx, categoryID) (FeeConfig, error)` -- SELECT from `platform_fee_config`
   - `CreatePayment(ctx, input) (Payment, error)` -- INSERT into `payments` with idempotency_key UNIQUE constraint
   - `GetPayment(ctx, paymentID) (Payment, error)` -- SELECT from `payments`
   - `UpdatePaymentStatus(ctx, paymentID, status, stripeFields) error` -- UPDATE `payments`
   - `ListPayments(ctx, userID, filters, pagination) ([]Payment, error)` -- SELECT for user as customer or provider
   - `GetStripeAccountID(ctx, userID) (string, error)` -- SELECT from `provider_profiles.stripe_account_id`
   - `SetStripeAccountID(ctx, userID, stripeAccountID) error` -- UPDATE `provider_profiles`
   - **Tables read/written:** `payments`, `provider_profiles` (stripe_account_id), `platform_fee_config`
3. **`services/payment/internal/service/stripe.go`** -- Stripe integration:
   - `CreateStripeAccount(ctx, userID, email, businessName) (string, error)` -- Create Stripe Connect Express account, store stripe_account_id
   - `GetOnboardingLink(ctx, userID, returnURL, refreshURL) (string, error)` -- Generate Stripe Account Link for onboarding
   - `GetAccountStatus(ctx, userID) (AccountStatus, error)` -- Retrieve Stripe account, return charges_enabled, payouts_enabled, requirements
   - `CreateSetupIntent(ctx, customerStripeID) (string, error)` -- Create SetupIntent for saving payment method
   - `ListPaymentMethods(ctx, customerStripeID) ([]PaymentMethod, error)` -- List customer's saved payment methods
   - `CreatePaymentIntent(ctx, amount, customerID, providerStripeAccountID, idempotencyKey) (string, error)` -- Create PaymentIntent with destination charge to Connect account, hold in escrow
   - `ReleaseEscrow(ctx, transferID) error` -- Release held funds to provider
   - `CreateRefund(ctx, paymentIntentID, amount) error` -- Issue refund through Stripe
4. **`services/payment/internal/service/payment.go`** -- Payment business logic:
   - `CalculateFees(ctx, amountCents, categoryID) (PaymentBreakdown, error)` -- compute platform fee + guarantee fee from `platform_fee_config`
   - `CreatePayment(ctx, input) (Payment, error)` -- calculate fees, create payment record, create Stripe PaymentIntent
   - `ProcessPayment(ctx, paymentID, paymentMethodID) (Payment, error)` -- confirm PaymentIntent with payment method
   - `ReleaseEscrow(ctx, paymentID, reason) (Payment, error)` -- release held funds after milestone approval/completion
   - `HandleWebhook(ctx, payload, signature) error` -- verify Stripe webhook signature, process events: payment_intent.succeeded -> status=escrow, transfer.created, charge.refunded
5. **`services/payment/internal/service/webhook.go`** -- Webhook handler:
   - Parse and verify Stripe webhook signature
   - Handle events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`, `account.updated` (Connect), `transfer.created`
   - Update payment status in database based on webhook events
6. **`services/payment/internal/grpc/server.go`** -- gRPC methods:
   - `CreateStripeAccount`, `GetStripeOnboardingLink`, `GetStripeAccountStatus`, `GetStripeDashboardLink`
   - `CreateSetupIntent`, `ListPaymentMethods`, `DeletePaymentMethod`
   - `CreatePayment`, `ProcessPayment`, `ReleaseEscrow`, `GetPayment`, `ListPayments`
   - `CreateRefund`
   - `HandleStripeWebhook`
   - `CalculateFees`, `GetFeeConfig`
   - **Proto RPCs implemented:** CreateStripeAccount, GetStripeOnboardingLink, GetStripeAccountStatus, GetStripeDashboardLink, CreateSetupIntent, ListPaymentMethods, DeletePaymentMethod, CreatePayment, ProcessPayment, ReleaseEscrow, GetPayment, ListPayments, CreateRefund, HandleStripeWebhook, CalculateFees, GetFeeConfig
7. **`services/payment/cmd/server/main.go`** -- Bootstrap: load config (Stripe keys), connect postgres, create service/grpc, listen on 50054

#### Gateway (`gateway/`)
8. **`gateway/internal/handler/payment.go`** -- HTTP handlers:
   - `POST /api/v1/providers/me/stripe/account` -- create Stripe Connect account
   - `GET /api/v1/providers/me/stripe/onboarding` -- get onboarding link
   - `GET /api/v1/providers/me/stripe/status` -- get account status
   - `POST /api/v1/payments/setup-intent` -- create setup intent for saving card
   - `GET /api/v1/payments/methods` -- list payment methods
   - `DELETE /api/v1/payments/methods/:id` -- remove payment method
   - `POST /api/v1/payments` -- create payment (tied to contract/milestone)
   - `POST /api/v1/payments/:id/process` -- process payment with payment method
   - `GET /api/v1/payments` -- list payment history
   - `GET /api/v1/payments/:id` -- get payment detail with fee breakdown
   - `POST /api/v1/payments/calculate-fees` -- preview fee calculation
9. **`gateway/internal/handler/webhook.go`** -- Stripe webhook endpoint:
   - `POST /api/v1/webhooks/stripe` -- raw body passthrough to Payment Service (no auth middleware, verified by Stripe signature)
10. **`gateway/internal/router/router.go`** -- Register payment routes and webhook route (webhook is public but signature-verified)

#### Frontend (`web/`)
11. **`web/src/app/(dashboard)/payments/page.tsx`** -- Payment history page
12. **`web/src/components/payments/StripeOnboarding.tsx`** -- Provider Stripe Connect onboarding component (redirect to Stripe, return handling)
13. **`web/src/components/payments/PaymentMethodForm.tsx`** -- Stripe Elements integration: card input via SetupIntent for saving payment methods
14. **`web/src/components/payments/PaymentMethodList.tsx`** -- Display saved payment methods with delete action
15. **`web/src/components/payments/PaymentBreakdown.tsx`** -- Display fee breakdown: subtotal, platform fee, guarantee fee, total, provider payout
16. **`web/src/components/payments/PaymentHistory.tsx`** -- Payment history table: date, contract, amount, status, actions
17. **`web/src/hooks/usePayments.ts`** -- TanStack Query hooks: useCreatePayment, useProcessPayment, usePayments, usePaymentMethods, useStripeOnboarding, useFeeCalculation
18. **`web/src/lib/stripe.ts`** -- Stripe.js initialization, Elements provider setup

### Integration Points
- Milestone approval (Slice 5) triggers payment creation via Payment Service
- Completion approval triggers final payment release
- Stripe Connect onboarding link returned to frontend for provider setup
- Stripe webhooks update payment status asynchronously
- All payments use idempotency keys to prevent double-charging
- Fee calculation: `platform_fee_config` table provides percentage per category
- Provider payout = amount - platform_fee - guarantee_fee

### Acceptance Criteria
- [ ] Provider can create Stripe Connect account and complete onboarding flow
- [ ] Customer can save payment method via Stripe Elements + SetupIntent
- [ ] Creating a payment calculates fees correctly from `platform_fee_config`
- [ ] Payment goes through stages: pending -> processing -> escrow -> released -> completed
- [ ] Stripe webhook signature verification rejects invalid signatures
- [ ] Idempotency key prevents duplicate payment creation
- [ ] Fee breakdown shows correct platform fee, guarantee fee, and provider payout
- [ ] Payment history shows all transactions for the authenticated user
- [ ] Refund creates Stripe refund and updates payment status

### Test Requirements
- [ ] **Unit:** fee calculation (different categories, edge cases: min fee, max fee cap)
- [ ] **Unit:** webhook handler (valid signature, invalid signature, each event type)
- [ ] **Unit:** payment state machine (valid transitions, invalid transitions)
- [ ] **Integration:** Create payment -> process with test Stripe key -> verify webhook updates status
- [ ] **Frontend Unit:** PaymentBreakdown rendering with various fee configurations
- [ ] **E2E:** Playwright (with Stripe test mode): save payment method, create payment, verify in payment history

---

## Slice 7: Chat & Real-Time Messaging

**Depends on:** Slices 1, 3, 4
**Estimated files:** ~20 files
**Services touched:** Chat Service, Gateway, Frontend, Redis

### Backend Tasks

#### Chat Service (`services/chat/`)
1. **`services/chat/internal/domain/types.go`** -- Define: `Channel`, `Message`, `ChannelType`, `MessageType`, `SharedContact`, error sentinels (`ErrChannelNotFound`, `ErrNotChannelMember`, `ErrChannelClosed`)
2. **`services/chat/internal/repository/postgres.go`** -- Repository methods:
   - `CreateChannel(ctx, jobID, customerID, providerID, channelType) (Channel, error)` -- INSERT into `chat_channels` with UNIQUE (job_id, customer_id, provider_id)
   - `GetChannel(ctx, channelID, userID) (Channel, error)` -- SELECT with unread count relative to user's last_read_at
   - `ListChannels(ctx, userID, pagination) ([]Channel, error)` -- SELECT where user is customer or provider, ORDER BY last_message_at DESC
   - `SendMessage(ctx, channelID, senderID, messageType, content, attachments) (Message, error)` -- INSERT into `chat_messages`, UPDATE `chat_channels.last_message_at` and `message_count`
   - `ListMessages(ctx, channelID, userID, pagination, before) ([]Message, error)` -- SELECT from `chat_messages` ORDER BY created_at DESC (cursor-based)
   - `MarkRead(ctx, channelID, userID, lastReadMessageID) error` -- UPDATE `chat_channels.customer_last_read_at` or `provider_last_read_at`
   - `DetectContactInfo(content string) bool` -- regex check for phone numbers, email addresses in message content
   - `GetUnreadCount(ctx, userID) (int, []ChannelUnread, error)` -- computed from last_read_at vs last_message_at
   - **Tables read/written:** `chat_channels`, `chat_messages`
3. **`services/chat/internal/service/service.go`** -- Business logic:
   - `CreateChannel(ctx, input) (Channel, error)` -- validate users exist, auto-create channel when provider places bid (pre-award type)
   - `SendMessage(ctx, input) (Message, error)` -- validate sender is channel member, check contact info detection, flag if detected, publish to Redis Pub/Sub for real-time delivery
   - `MarkRead(ctx, channelID, userID, messageID) error` -- update read position
4. **`services/chat/internal/service/pubsub.go`** -- Redis Pub/Sub:
   - `PublishMessage(ctx, channelID, message) error` -- publish to Redis channel `chat:{channelID}`
   - `Subscribe(channelID) (<-chan Message)` -- subscribe to Redis channel, return message stream
5. **`services/chat/internal/ws/handler.go`** -- WebSocket handler:
   - Upgrade HTTP connection to WebSocket
   - Authenticate via JWT token (passed as query param or first message)
   - Subscribe to user's channels via Redis Pub/Sub
   - Forward incoming WebSocket messages to SendMessage service
   - Forward Redis Pub/Sub messages to WebSocket client
   - Handle typing indicators (broadcast to other channel member)
   - Handle connection lifecycle (ping/pong, disconnect cleanup)
6. **`services/chat/internal/grpc/server.go`** -- gRPC methods:
   - `CreateChannel`, `GetChannel`, `ListChannels`
   - `SendMessage`, `ListMessages`, `MarkRead`
   - `ShareContactInfo`, `GetSharedContacts`
   - `SendTypingIndicator`
   - `GetUnreadCount`
   - **Proto RPCs implemented:** CreateChannel, GetChannel, ListChannels, SendMessage, ListMessages, MarkRead, ShareContactInfo, GetSharedContacts, SendTypingIndicator, GetUnreadCount
7. **`services/chat/cmd/server/main.go`** -- Bootstrap: load config, connect postgres + redis, create service/grpc + WebSocket handler, listen on 50055

#### Gateway (`gateway/`)
8. **`gateway/internal/handler/chat.go`** -- HTTP + WebSocket handlers:
   - `GET /api/v1/channels` -- list user's channels
   - `GET /api/v1/channels/:id` -- get channel detail
   - `GET /api/v1/channels/:id/messages` -- list messages (paginated)
   - `POST /api/v1/channels/:id/messages` -- send message (REST fallback)
   - `POST /api/v1/channels/:id/read` -- mark as read
   - `GET /api/v1/channels/unread` -- get unread counts
   - `GET /ws/chat` -- WebSocket upgrade endpoint (auth via query param token)
9. **`gateway/internal/router/router.go`** -- Register chat routes and WebSocket upgrade

#### Frontend (`web/`)
10. **`web/src/app/(dashboard)/messages/page.tsx`** -- Chat inbox page: channel list sidebar, active conversation
11. **`web/src/components/chat/ChannelList.tsx`** -- Channel list component: last message preview, unread badge, timestamp
12. **`web/src/components/chat/MessageThread.tsx`** -- Message thread component: messages with sender avatar, timestamps, infinite scroll loading older messages
13. **`web/src/components/chat/MessageInput.tsx`** -- Message input: text area, file attachment button, send button, typing indicator display
14. **`web/src/components/chat/TypingIndicator.tsx`** -- "User is typing..." indicator
15. **`web/src/hooks/useChat.ts`** -- WebSocket hook: connect, send message, receive messages, typing indicators, reconnection logic with exponential backoff
16. **`web/src/hooks/useChannels.ts`** -- TanStack Query hooks: useChannels, useChannel, useMessages, useMarkRead, useUnreadCount
17. **`web/src/stores/chat-store.ts`** -- Zustand store: activeChannelID, messages map, typing indicators, unread counts, WebSocket connection state

### Integration Points
- Chat channels auto-created when provider places bid (Bidding Engine triggers channel creation)
- Channel type upgrades from 'pre_award' to 'contract' when bid awarded
- Redis Pub/Sub distributes messages between Chat Service instances (horizontal scaling)
- WebSocket connection authenticated via JWT passed as query parameter
- Contact info detection flags messages containing phone/email (off-platform communication prevention)
- Unread count feeds into notification bell (Slice 12)

### Acceptance Criteria
- [ ] Chat channel auto-created when provider places bid on a job
- [ ] Messages sent via WebSocket appear in real-time for both parties
- [ ] Messages sent via REST API also trigger WebSocket delivery
- [ ] Typing indicators show when other user is composing
- [ ] Unread count updates correctly when messages arrive and when user reads
- [ ] Message history loads with cursor-based pagination (load older messages)
- [ ] Contact info in messages is detected and message is flagged
- [ ] WebSocket reconnects automatically on disconnect with exponential backoff
- [ ] Channel list shows last message preview and correct timestamps

### Test Requirements
- [ ] **Unit:** message persistence, channel creation, unread count computation
- [ ] **Unit:** contact info detection regex (phone formats, email patterns)
- [ ] **Unit:** Redis Pub/Sub message serialization/deserialization
- [ ] **Integration:** Two users connected via WebSocket: send message from A, verify B receives in real-time
- [ ] **Frontend Unit:** ChatStore state management, WebSocket hook reconnection logic
- [ ] **E2E:** Playwright: two browser contexts, send message in one, verify appears in other

---

## Slice 8: Job Completion & Handoff

**Depends on:** Slices 5, 6
**Estimated files:** ~10 files
**Services touched:** Job Service (contract), Payment Service, Gateway, Frontend

### Backend Tasks

#### Job Service (`services/job/`) -- Contract completion logic
1. **`services/job/internal/service/contract.go`** -- Add completion methods:
   - `MarkComplete(ctx, contractID, providerID) (Contract, error)` -- validate provider is contract party, validate all milestones approved (or no milestones for completion-pay), transition contract to status where customer confirms
   - `ApproveCompletion(ctx, contractID, customerID) (Contract, error)` -- validate customer is party, mark completed, update job status to 'completed', trigger final payment release, set completed_at timestamp, track on-time delivery (scheduled_date vs completed_at)
   - `RequestRevision(ctx, contractID, customerID, notes) (Contract, error)` -- max 3 revisions across contract, revert to in-progress
   - `AutoReleaseCompletedContracts(ctx) error` -- scheduled job: find contracts marked complete by provider > 7 days without customer action, auto-approve
   - `RecordOnTimeDelivery(ctx, contractID) error` -- compare completed_at with job's scheduled_date to determine on-time status
2. **`services/job/internal/repository/contract_repo.go`** -- Add methods:
   - `MarkContractComplete(ctx, contractID) error` -- UPDATE contracts SET status
   - `ApproveContractCompletion(ctx, contractID) error` -- UPDATE status = 'completed', completed_at = now()
   - `GetContractsAwaitingApproval(ctx, olderThan time.Duration) ([]Contract, error)` -- for auto-release scheduler
   - `UpdateJobCompleted(ctx, jobID) error` -- UPDATE jobs SET status = 'completed', completed_at = now()
3. **`services/job/internal/grpc/contract_server.go`** -- Add gRPC methods:
   - `MarkComplete`, `ApproveCompletion`
   - **Proto RPCs implemented:** MarkComplete, ApproveCompletion (additions to ContractService)

#### Gateway (`gateway/`)
4. **`gateway/internal/handler/contract.go`** -- Add HTTP handlers:
   - `POST /api/v1/contracts/:id/complete` -- provider marks complete
   - `POST /api/v1/contracts/:id/approve-completion` -- customer approves completion
   - `POST /api/v1/contracts/:id/request-revision` -- customer requests revision

#### Frontend (`web/`)
5. **`web/src/app/(dashboard)/contracts/[id]/page.tsx`** -- Update contract detail page: add completion flow UI
6. **`web/src/components/jobs/CompletionFlow.tsx`** -- Completion flow component:
   - Provider view: "Mark Work Complete" button, status indicator
   - Customer view: "Approve Completion" or "Request Revision" (with notes, 200 char minimum), 7-day auto-release countdown
7. **`web/src/components/jobs/RevisionRequest.tsx`** -- Revision request form (notes textarea, remaining revisions count)
8. **`web/src/components/jobs/AutoReleaseTimer.tsx`** -- 7-day countdown timer showing when payment will auto-release

### Integration Points
- Completion approval triggers final payment release via Payment Service
- 7-day auto-release requires a scheduled background job (cron or ticker)
- On-time delivery tracking updates provider's on_time_rate in provider_profiles
- Job status transitions: in_progress -> completed -> reviewed (after review in Slice 9)
- Max 3 revisions enforced across the entire contract lifecycle

### Acceptance Criteria
- [ ] Provider can mark contract as complete when all milestones are approved
- [ ] Customer can approve completion, triggering final payment release
- [ ] Customer can request revision with 200+ character notes (max 3 total revisions)
- [ ] 7-day auto-release timer correctly auto-approves completion if customer does not respond
- [ ] Job status updates to 'completed' after completion approval
- [ ] On-time delivery tracked correctly (compared to scheduled date)
- [ ] Frontend shows appropriate actions based on contract state and user role

### Test Requirements
- [ ] **Unit:** MarkComplete (all milestones approved, unapproved milestones blocked), ApproveCompletion, RequestRevision (max 3 limit)
- [ ] **Unit:** AutoReleaseCompletedContracts (finds correct contracts, releases, updates statuses)
- [ ] **Integration:** Full contract lifecycle: active -> milestones submitted/approved -> marked complete -> approved -> payment released
- [ ] **E2E:** Playwright: provider marks complete, customer approves, verify job status is completed

---

## Slice 9: Reviews & Ratings

**Depends on:** Slices 5, 8
**Estimated files:** ~15 files
**Services touched:** Job Service (review logic), Gateway, Frontend

### Backend Tasks

#### Job Service (`services/job/`) -- Review logic lives here alongside contracts
1. **`services/job/internal/domain/review_types.go`** -- Define: `Review`, `ReviewResponse`, `ReviewDirection`, `FlagReason`, error sentinels (`ErrReviewNotFound`, `ErrNotEligible`, `ErrAlreadyReviewed`, `ErrReviewWindowClosed`)
2. **`services/job/internal/repository/review_repo.go`** -- Repository methods:
   - `CreateReview(ctx, input) (Review, error)` -- INSERT into `reviews` with review_window_ends = contract.completed_at + 14 days
   - `GetReview(ctx, reviewID) (Review, error)` -- SELECT with review_response
   - `ListReviewsForUser(ctx, userID, directionFilter, pagination) ([]Review, error)` -- SELECT where reviewee_id = userID
   - `ListReviewsByUser(ctx, userID, pagination) ([]Review, error)` -- SELECT where reviewer_id = userID
   - `CreateReviewResponse(ctx, reviewID, responderID, comment) (ReviewResponse, error)` -- INSERT into `review_responses`
   - `FlagReview(ctx, reviewID, flaggedBy, reason, details) (string, error)` -- UPDATE `reviews` SET status = 'flagged'
   - `CheckReviewEligibility(ctx, contractID, userID) (eligible bool, alreadyReviewed bool, windowCloses time.Time, error)` -- check contract completed, user is party, not already reviewed, within 14-day window
   - `PublishPendingReviews(ctx) error` -- both parties reviewed OR 14-day window expired -> publish all pending reviews for that contract
   - `ComputeAverageRating(ctx, userID) (float64, int, error)` -- AVG(overall_rating), COUNT
   - **Tables read/written:** `reviews`, `review_responses`, `contracts` (for eligibility check)
3. **`services/job/internal/service/review.go`** -- Business logic:
   - `CreateReview(ctx, input) (Review, error)` -- check eligibility, validate ratings (1-5), validate comment (50+ chars), create review, check if both parties reviewed -> trigger dual-publish, update job status to 'reviewed'
   - `RespondToReview(ctx, reviewID, responderID, comment) error` -- validate responder is reviewee, one response per review
   - `FlagReview(ctx, reviewID, flaggedBy, reason, details) error` -- create flag, set review status to flagged
   - `PublishReviews(ctx, contractID) error` -- dual-publish: both reviews become visible simultaneously (or single publish after 14 days)
4. **`services/job/internal/grpc/review_server.go`** -- gRPC methods:
   - `CreateReview`, `GetReview`, `ListReviewsForUser`, `ListReviewsByUser`
   - `RespondToReview`, `FlagReview`, `GetReviewEligibility`
   - **Proto RPCs implemented:** CreateReview, GetReview, ListReviewsForUser, ListReviewsByUser, RespondToReview, FlagReview, GetReviewEligibility

#### Gateway (`gateway/`)
5. **`gateway/internal/handler/review.go`** -- HTTP handlers:
   - `POST /api/v1/contracts/:id/reviews` -- create review for contract
   - `GET /api/v1/reviews/:id` -- get single review
   - `GET /api/v1/users/:id/reviews` -- list reviews received by user
   - `POST /api/v1/reviews/:id/respond` -- respond to review
   - `POST /api/v1/reviews/:id/flag` -- flag review
   - `GET /api/v1/contracts/:id/reviews/eligibility` -- check if user can review
6. **`gateway/internal/router/router.go`** -- Register review routes

#### Frontend (`web/`)
7. **`web/src/app/(dashboard)/contracts/[id]/review/page.tsx`** -- Review submission page (prompted after completion)
8. **`web/src/components/forms/ReviewForm.tsx`** -- Review form: star ratings (overall, quality, communication, timeliness, value), comment textarea (50 char minimum), photo upload placeholder
9. **`web/src/components/providers/ReviewList.tsx`** -- Review list component: star display, comment, reviewer name, response, flag button
10. **`web/src/components/providers/ReviewCard.tsx`** -- Single review card with star ratings breakdown
11. **`web/src/components/providers/StarRating.tsx`** -- Reusable star rating component (display and input modes)
12. **`web/src/hooks/useReviews.ts`** -- TanStack Query hooks: useCreateReview, useReviews, useReviewEligibility, useRespondToReview, useFlagReview

### Integration Points
- Review eligibility tied to contract completion (Slice 8)
- 14-day review window starts at contract.completed_at
- Dual-publish: both reviews hidden until both submitted or 14 days pass
- Published reviews update provider's average rating and review count in provider_profiles
- Review signals feed into Trust Scoring (Slice 10): RecordFeedbackSignal called after publish
- Flagged reviews enter admin queue (Slice 15)

### Acceptance Criteria
- [ ] Review can only be created for completed contracts where user is a party
- [ ] Review window closes 14 days after contract completion
- [ ] Dual-publish: neither review visible until both submitted or 14-day window expires
- [ ] Review requires 1-5 star overall rating and 50+ character comment
- [ ] Customer-to-provider reviews include quality, timeliness, communication, value sub-ratings
- [ ] Reviewee can respond to review once
- [ ] Reviews can be flagged with reason (inappropriate, fake, harassment, spam, irrelevant)
- [ ] `GET /api/v1/users/:id/reviews` returns published reviews with average rating
- [ ] Frontend shows review prompt after contract completion, with countdown to deadline

### Test Requirements
- [ ] **Unit:** eligibility check (completed contract, not already reviewed, within window, correct party)
- [ ] **Unit:** dual-publish logic (both reviewed -> publish, one reviewed + 14 days -> publish, both reviewed simultaneously)
- [ ] **Unit:** flag handling (valid reasons, duplicate flag prevention)
- [ ] **Integration:** Complete contract -> both parties review -> verify both reviews published -> verify average rating updated
- [ ] **E2E:** Playwright: complete contract, leave review as customer, leave review as provider, verify both appear

---

## Slice 10: Trust Scoring

**Depends on:** Slices 4, 8, 9
**Estimated files:** ~12 files
**Services touched:** Trust Engine (Rust), Gateway, Frontend

### Backend Tasks

#### Trust Engine (`engines/trust/`)
1. **`engines/trust/src/models.rs`** -- Define: `TrustScore`, `TrustTier`, `FeedbackSignal`, `VolumeSignal`, `RiskSignal`, `TierRequirement`, `ScoreBreakdown`
2. **`engines/trust/src/engine.rs`** -- Core trust score computation:
   - `compute_trust_score(user_id) -> Result<TrustScore>` -- gather all signals, compute 4 dimensions:
     - **Feedback (35%):** average rating, rating count, rating trend, disputes lost
     - **Volume (20%):** jobs completed, jobs in last 90 days, repeat customers, on-time rate, total GMV
     - **Risk (25%):** cancellations, disputes filed, late deliveries, no-shows, cancellation/dispute rates (inverted: lower risk = higher score)
     - **Fraud (20%):** fraud signals detected, fraud probability, active flags (inverted: lower fraud = higher score)
   - Weighted sum: `overall = feedback * 0.35 + volume * 0.20 + risk * 0.25 + fraud * 0.20`
   - Determine tier from overall score and requirements (min completed jobs, min reviews, min rating, verification)
   - Store result in `trust_scores` table, snapshot in `trust_score_history`
   - **Tables read/written:** `trust_scores`, `trust_score_history`, `reviews` (aggregates), `contracts` (completion data), `disputes` (risk data), `fraud_signals` (fraud data), `verification_documents` (verification status)
3. **`engines/trust/src/engine.rs`** -- Signal recording:
   - `record_feedback_signal(user_id, source, value, reference_id)` -- store and trigger recomputation
   - `record_volume_signal(user_id, signal_type, reference_id)` -- store and trigger recomputation
   - `record_risk_signal(user_id, signal_type, severity, reference_id)` -- store and trigger recomputation
4. **`engines/trust/src/engine.rs`** -- Tier management:
   - Tier requirements: Under Review (flagged), New (< 50 score), Rising (50-69, 3+ jobs, 2+ reviews), Trusted (70-84, 10+ jobs, 5+ reviews, 4.0+ rating, verification), Top Rated (85+, 25+ jobs, 15+ reviews, 4.5+ rating, full verification)
   - Tier change detection and notification trigger
5. **`engines/trust/src/grpc.rs`** -- tonic gRPC server:
   - `ComputeTrustScore`, `BatchComputeTrustScores`
   - `GetTrustScore`, `GetTrustScoreHistory`
   - `GetTierRequirements`
   - `RecordFeedbackSignal`, `RecordVolumeSignal`, `RecordRiskSignal`
   - **Proto RPCs implemented:** ComputeTrustScore, BatchComputeTrustScores, GetTrustScore, GetTrustScoreHistory, GetTierRequirements, RecordFeedbackSignal, RecordVolumeSignal, RecordRiskSignal
6. **`engines/trust/src/main.rs`** -- Bootstrap: connect to PostgreSQL via sqlx, start tonic server on port 50057

#### Gateway (`gateway/`)
7. **`gateway/internal/handler/trust.go`** -- HTTP handlers:
   - `GET /api/v1/users/:id/trust-score` -- get user's trust score and tier
   - `GET /api/v1/users/:id/trust-history` -- get score history over time
   - `GET /api/v1/trust/tiers` -- get tier requirements
8. **`gateway/internal/router/router.go`** -- Register trust routes (trust score is public; history requires auth as self or admin)

#### Frontend (`web/`)
9. **`web/src/components/providers/TrustScoreBadge.tsx`** -- Trust tier badge component (icon + tier name + score)
10. **`web/src/components/providers/TrustScoreBreakdown.tsx`** -- Trust score breakdown view: 4 dimension bars (feedback, volume, risk, fraud), tier requirements checklist
11. **`web/src/components/providers/TrustScoreHistory.tsx`** -- Score history chart (line graph over time)
12. **`web/src/hooks/useTrustScore.ts`** -- TanStack Query hooks: useTrustScore, useTrustHistory, useTierRequirements

### Integration Points
- Review creation (Slice 9) calls `RecordFeedbackSignal` after publish
- Contract completion (Slice 8) calls `RecordVolumeSignal` (job_completed, on_time_delivery)
- Dispute resolution calls `RecordRiskSignal` (cancellation, dispute_filed, late_delivery)
- Fraud detection (Slice 11) feeds fraud_score dimension
- Trust score displayed on provider profiles, bid cards, search results
- Tier changes trigger notifications (wired in Slice 12)

### Acceptance Criteria
- [ ] Trust score computed with correct weighted formula: feedback (35%), volume (20%), risk (25%), fraud (20%)
- [ ] Score ranges 0.0 to 1.0 for each dimension and overall
- [ ] Tier correctly determined from score + requirements (jobs, reviews, rating, verification)
- [ ] Score recomputed when signals recorded (review, completion, dispute, fraud)
- [ ] Score history tracked in `trust_score_history` with trigger reason
- [ ] `GET /api/v1/users/:id/trust-score` returns current score and tier
- [ ] Frontend displays tier badge on provider profiles and bid cards
- [ ] Trust score breakdown shows all 4 dimensions with visual bars

### Test Requirements
- [ ] **Unit (Rust):** score computation with known inputs -> verify exact output. Use proptest: arbitrary signals -> score always 0.0-1.0, tier always valid
- [ ] **Unit (Rust):** tier determination edge cases (exactly at boundary scores, missing verification)
- [ ] **Benchmark (Rust):** criterion benchmark for compute_trust_score -- must be < 5ms p99
- [ ] **Integration:** Create user -> complete jobs -> leave reviews -> verify trust score updates correctly
- [ ] **Frontend Unit:** TrustScoreBadge renders correct tier icon and color, TrustScoreBreakdown layout

---

## Slice 11: Fraud Detection

**Depends on:** Slices 1, 4, 6
**Estimated files:** ~15 files
**Services touched:** Fraud Engine (Rust), Gateway, Frontend (admin)

### Backend Tasks

#### Fraud Engine (`engines/fraud/`)
1. **`engines/fraud/src/models.rs`** -- Define: `FraudSignal`, `FraudAlert`, `UserRiskProfile`, `SessionRecord`, `FraudDecision`, `RiskLevel`, `FraudSignalType`
2. **`engines/fraud/src/engine.rs`** -- Fraud detection pipeline:
   - `check_registration(email, ip, fingerprint, phone) -> FraudDecision` -- check IP reputation, device fingerprint against known fraud devices, email domain analysis, velocity check (registrations from same IP/device), multi-account detection (same fingerprint)
   - `check_bid(provider_id, job_id, customer_id, amount, ip, fingerprint) -> FraudDecision` -- shill-bid detection (shared IP/fingerprint between bidder and job poster), velocity (rapid bidding), bid pattern analysis (always same amount, bid-then-withdraw patterns)
   - `check_transaction(user_id, payment_id, amount, ip, fingerprint) -> FraudDecision` -- unusual amount for category, geo mismatch (IP location vs profile), rapid transactions, payment failure patterns
3. **`engines/fraud/src/engine.rs`** -- Signal recording and alerting:
   - `record_signal(signal) -> (FraudSignal, bool)` -- persist signal, check if aggregate risk triggers alert creation
   - `record_session(session) -> (bool, Vec<String>)` -- persist session, detect anomalies (new device, new IP range, impossible travel)
4. **`engines/fraud/src/engine.rs`** -- Risk profile:
   - `get_user_risk_profile(user_id) -> UserRiskProfile` -- aggregate all signals, compute risk score, determine risk level
   - Decision thresholds: LOW < 0.3, MEDIUM 0.3-0.6, HIGH 0.6-0.8, CRITICAL > 0.8
   - Actions: ALLOW (low), ALLOW_WITH_REVIEW (medium), CHALLENGE (high), BLOCK (critical)
   - **Tables read/written:** `fraud_signals`, `user_sessions`
5. **`engines/fraud/src/grpc.rs`** -- tonic gRPC server:
   - `CheckTransaction`, `CheckRegistration`, `CheckBid`
   - `RecordSignal`, `BatchRecordSignals`
   - `RecordSession`, `GetSessionHistory`
   - `GetUserRiskProfile`
   - `AdminListFraudAlerts`, `AdminReviewFraudAlert`, `AdminGetFraudDashboard`
   - **Proto RPCs implemented:** CheckTransaction, CheckRegistration, CheckBid, RecordSignal, BatchRecordSignals, RecordSession, GetSessionHistory, GetUserRiskProfile, AdminListFraudAlerts, AdminReviewFraudAlert, AdminGetFraudDashboard
6. **`engines/fraud/src/main.rs`** -- Bootstrap: connect to PostgreSQL via sqlx, start tonic server on port 50056

#### Gateway (`gateway/`)
7. **`gateway/internal/handler/fraud.go`** -- Admin-only HTTP handlers:
   - `GET /api/v1/admin/fraud/alerts` -- list fraud alerts (filterable by status, risk level)
   - `GET /api/v1/admin/fraud/alerts/:id` -- get alert detail
   - `POST /api/v1/admin/fraud/alerts/:id/review` -- review and resolve alert
   - `GET /api/v1/admin/fraud/dashboard` -- fraud dashboard metrics
   - `GET /api/v1/admin/fraud/users/:id/risk` -- get user risk profile
8. **`gateway/internal/middleware/auth.go`** -- Add role-based middleware for admin routes

#### Integration with existing flows
9. **Register flow (Slice 1):** After successful registration, call `FraudService.CheckRegistration` and `FraudService.RecordSession`. If BLOCK decision, immediately deactivate account.
10. **Bid flow (Slice 4):** Before placing bid, call `FraudService.CheckBid`. If BLOCK, reject bid. If CHALLENGE, require additional verification.
11. **Payment flow (Slice 6):** Before processing payment, call `FraudService.CheckTransaction`. If BLOCK, reject payment.

#### Frontend (`web/`)
12. **`web/src/app/(dashboard)/admin/fraud/page.tsx`** -- Admin fraud dashboard: alert counts by severity, recent alerts, signal breakdown chart
13. **`web/src/components/admin/FraudAlertList.tsx`** -- Fraud alert list with severity indicators, status filters, assignment
14. **`web/src/components/admin/FraudAlertDetail.tsx`** -- Alert detail: signals list, user risk profile, session history, resolution actions

### Integration Points
- Fraud checks integrated into registration (Slice 1), bidding (Slice 4), and payment (Slice 6)
- Fraud score feeds into Trust Scoring (Slice 10) as the fraud dimension
- Session recording captures device fingerprint, IP, user agent for every significant action
- Fraud alerts generate admin notifications (wired in Slice 12)
- High-risk decisions (BLOCK) can trigger automatic user suspension

### Acceptance Criteria
- [ ] Registration from known fraud IP/fingerprint returns BLOCK decision
- [ ] Shill-bid detection identifies shared IP/fingerprint between bidder and job poster
- [ ] Unusual transaction patterns trigger ALLOW_WITH_REVIEW or CHALLENGE
- [ ] Fraud signals recorded and aggregated into user risk profile
- [ ] Critical risk level triggers automatic alert creation
- [ ] Admin dashboard shows alert counts, signal breakdown, false positive rate
- [ ] Admin can review and resolve fraud alerts (restrict user, ban user, dismiss)
- [ ] Fraud score feeds into trust score computation

### Test Requirements
- [ ] **Unit (Rust):** check_registration with known fraud patterns -> verify correct decisions
- [ ] **Unit (Rust):** shill-bid detection with shared fingerprints -> verify detection
- [ ] **Unit (Rust):** risk level thresholds and decision mapping
- [ ] **Benchmark (Rust):** criterion benchmark for check_bid -- must be < 50ms p99
- [ ] **Integration:** Register user -> record sessions with anomalies -> verify risk profile updates
- [ ] **Frontend Unit:** FraudAlertList renders severity indicators correctly

---

## Slice 12: Notifications

**Depends on:** Slices 1, 4, 5, 7
**Estimated files:** ~15 files
**Services touched:** Notification Service (new Go service or extension), Gateway, Frontend, Redis

### Backend Tasks

#### Notification Service (extend into Job Service or create `services/notification/`)
1. **`services/job/internal/service/notification.go`** (or new service) -- Notification logic:
   - `SendNotification(ctx, userID, type, title, body, actionURL, data, channels) (Notification, error)` -- create notification record, dispatch to channels based on user preferences
   - `SendBulkNotification(ctx, userIDs, type, title, body, actionURL, data) (sent, failed int, error)` -- batch send
   - `ListNotifications(ctx, userID, unreadOnly, pagination) ([]Notification, error)` -- list user's in-app notifications
   - `MarkAsRead(ctx, notificationID, userID) error` -- mark single notification read
   - `MarkAllAsRead(ctx, userID) (int, error)` -- mark all as read
   - `GetUnreadCount(ctx, userID) (int, error)` -- count unread
   - `GetPreferences(ctx, userID) (Preferences, error)` -- read from `notification_preferences`
   - `UpdatePreferences(ctx, userID, prefs) error` -- update preferences
   - **Tables read/written:** `notifications`, `notification_preferences`
2. **`services/job/internal/service/notification_dispatch.go`** -- Channel dispatchers:
   - `dispatchEmail(ctx, userID, title, body, actionURL) error` -- send via email provider (SendGrid/SES stub)
   - `dispatchWebPush(ctx, userID, title, body) error` -- send web push notification (placeholder for Slice 0 device tokens)
   - `dispatchInApp(ctx, userID, notification) error` -- store in DB + publish to Redis for real-time delivery
3. **Notification triggers** -- Wire notification sends into existing flows:
   - Slice 4 (Bidding): new_bid (to customer), bid_awarded (to provider), bid_not_selected (to non-winning providers), auction_closing_soon, offer_accepted
   - Slice 5 (Contract): contract_created, contract_accepted, work_started, milestone_submitted, milestone_approved, revision_requested
   - Slice 6 (Payment): payment_received, payment_released, payment_failed
   - Slice 7 (Chat): new_message (if user is not currently in chat)
   - Slice 9 (Reviews): review_received, review_reminder (at 7 days and 13 days)
   - Slice 10 (Trust): tier_upgrade, tier_downgrade
4. **gRPC methods:**
   - `SendNotification`, `SendBulkNotification`
   - `ListNotifications`, `MarkAsRead`, `MarkAllAsRead`, `GetUnreadCount`
   - `GetPreferences`, `UpdatePreferences`
   - **Proto RPCs implemented:** SendNotification, SendBulkNotification, ListNotifications, MarkAsRead, MarkAllAsRead, GetUnreadCount, GetPreferences, UpdatePreferences

#### Gateway (`gateway/`)
5. **`gateway/internal/handler/notification.go`** -- HTTP handlers:
   - `GET /api/v1/notifications` -- list notifications (query: unread_only, pagination)
   - `POST /api/v1/notifications/:id/read` -- mark as read
   - `POST /api/v1/notifications/read-all` -- mark all as read
   - `GET /api/v1/notifications/unread-count` -- get unread count
   - `GET /api/v1/notifications/preferences` -- get preferences
   - `PUT /api/v1/notifications/preferences` -- update preferences
6. **`gateway/internal/router/router.go`** -- Register notification routes

#### Frontend (`web/`)
7. **`web/src/components/layout/NotificationBell.tsx`** -- Notification bell icon in header with unread count badge, dropdown with recent notifications
8. **`web/src/app/(dashboard)/notifications/page.tsx`** -- Full notifications page: all notifications with filters
9. **`web/src/app/(dashboard)/settings/notifications/page.tsx`** -- Notification preferences page: per-type channel toggles (in-app, email, push)
10. **`web/src/components/layout/NotificationItem.tsx`** -- Single notification item: icon by type, title, body, timestamp, read/unread indicator, click to navigate
11. **`web/src/hooks/useNotifications.ts`** -- TanStack Query hooks: useNotifications, useUnreadCount, useMarkRead, useMarkAllRead, usePreferences, useUpdatePreferences
12. **`web/src/stores/notification-store.ts`** -- Zustand store: unreadCount, recentNotifications (updated via WebSocket)

### Integration Points
- WebSocket connection (from Slice 7) carries notification events in addition to chat messages
- Redis Pub/Sub channel per user for real-time notification delivery
- Email dispatch requires email provider integration (SendGrid stub for MVP)
- Notification preferences control which channels receive which notification types
- Unread count displayed in header across all pages

### Acceptance Criteria
- [ ] Notifications created for all defined trigger events (new bid, contract created, payment received, etc.)
- [ ] In-app notifications appear in real-time via WebSocket
- [ ] Unread count badge updates in real-time in header
- [ ] Mark as read updates count immediately
- [ ] Notification preferences control per-type, per-channel delivery
- [ ] Email notifications sent for email-enabled notification types (via stub)
- [ ] Notification list paginates correctly with unread-only filter
- [ ] Clicking notification navigates to the relevant page (action_url)

### Test Requirements
- [ ] **Unit:** notification creation for each trigger type (correct title, body, action_url)
- [ ] **Unit:** preference filtering (disabled channel not dispatched)
- [ ] **Unit:** unread count computation, mark as read
- [ ] **Integration:** Place bid -> verify customer receives new_bid notification in real-time
- [ ] **Frontend Unit:** NotificationBell unread count rendering, NotificationItem click navigation

---

## Slice 13: Image Pipeline

**Depends on:** Slice 0
**Estimated files:** ~12 files
**Services touched:** Imaging Engine (Rust), Gateway, Frontend, MinIO

### Backend Tasks

#### Imaging Engine (`engines/imaging/`)
1. **`engines/imaging/src/models.rs`** -- Define: `ImageVariant`, `ProcessingOptions`, `ImageFormat`, `ResizeMode`, `ProcessedJobPhoto`
2. **`engines/imaging/src/engine.rs`** -- Image processing pipeline:
   - `process_image(source_url, options) -> Result<(ImageVariant, Option<String>)>` -- download from MinIO, process with image crate (or libvips FFI): resize, compress, strip EXIF, convert format, generate BlurHash, upload result to MinIO, return variant + blur_hash
   - `generate_thumbnail(source_url, width, height, mode) -> Result<ImageVariant>` -- resize to thumbnail dimensions
   - `process_job_photos(job_id, source_urls) -> Result<Vec<ProcessedJobPhoto>>` -- for each photo: generate large (1200px), medium (600px), thumbnail (200px), blur_hash. Strip EXIF for privacy
   - `process_portfolio_image(user_id, source_url) -> Result<(ImageVariant, ImageVariant, ImageVariant, String)>` -- full (1600px), display (800px), thumbnail (300px), blur_hash
   - `process_avatar(user_id, source_url) -> Result<(ImageVariant, ImageVariant, ImageVariant, String)>` -- large (400x400), medium (200x200), small (80x80), primary URL
   - `process_document(user_id, source_url, doc_type) -> Result<(ImageVariant, ImageVariant)>` -- orientation-corrected original + thumbnail for admin review
3. **`engines/imaging/src/engine.rs`** -- Upload URL management:
   - `get_upload_url(user_id, filename, mime_type, file_size, context) -> Result<(String, String, Timestamp)>` -- validate mime type (image/jpeg, image/png, image/webp), validate file size (max 10MB), generate pre-signed PUT URL for MinIO, return (upload_url, object_key, expires_at)
   - `confirm_upload(object_key, user_id, context) -> Result<(String, bool, String)>` -- verify object exists in MinIO, validate actual content type, return confirmed source URL
   - **External integrations:** MinIO S3 API for object storage and pre-signed URLs
4. **`engines/imaging/src/grpc.rs`** -- tonic gRPC server:
   - `ProcessImage`, `GenerateThumbnail`, `BatchProcessImages`
   - `ProcessJobPhotos`, `ProcessPortfolioImage`, `ProcessAvatar`, `ProcessDocument`
   - `GetUploadURL`, `ConfirmUpload`
   - **Proto RPCs implemented:** ProcessImage, GenerateThumbnail, BatchProcessImages, ProcessJobPhotos, ProcessPortfolioImage, ProcessAvatar, ProcessDocument, GetUploadURL, ConfirmUpload
5. **`engines/imaging/src/main.rs`** -- Bootstrap: configure MinIO client, start tonic server on port 50058

#### Gateway (`gateway/`)
6. **`gateway/internal/handler/image.go`** -- HTTP handlers:
   - `POST /api/v1/images/upload-url` -- get pre-signed upload URL (body: filename, mime_type, file_size, context)
   - `POST /api/v1/images/confirm` -- confirm upload completed
   - `POST /api/v1/images/process` -- trigger processing (body: source_url, context, options)

#### Frontend (`web/`)
7. **`web/src/components/ui/ImageUpload.tsx`** -- Reusable image upload component: get upload URL, upload directly to MinIO via PUT, confirm upload, trigger processing, show progress bar
8. **`web/src/components/ui/ProgressiveImage.tsx`** -- Progressive image display: show BlurHash placeholder while loading, fade in actual image
9. **`web/src/hooks/useImageUpload.ts`** -- Hook: getUploadURL -> upload to MinIO -> confirmUpload -> processImage -> return processed URLs
10. Wire image upload into existing forms:
    - **Job posting form (Slice 3):** job photo upload
    - **Provider onboarding (Slice 2):** portfolio image upload, avatar upload
    - **Verification (Slice 2):** document upload

### Integration Points
- Frontend uploads directly to MinIO via pre-signed PUT URL (no gateway proxy)
- After upload, frontend calls gateway to confirm and trigger processing
- Processed images stored in MinIO with structured keys: `{context}/{user_id}/{variant}/{filename}`
- BlurHash strings stored alongside image URLs for progressive loading
- EXIF stripping ensures no location/device metadata leaks from job photos

### Acceptance Criteria
- [ ] Pre-signed upload URL generated with correct expiry and permissions
- [ ] Image uploaded directly to MinIO from browser (no server proxy)
- [ ] Job photos processed into 3 sizes (large, medium, thumbnail) with EXIF stripped
- [ ] Portfolio images processed into 3 sizes with high quality
- [ ] Avatar processed into 3 square sizes (400, 200, 80)
- [ ] BlurHash generated for all processed images
- [ ] Document images orientation-corrected but not resized
- [ ] Upload rejects non-image mime types and files > 10MB
- [ ] Progressive image loading shows BlurHash placeholder then fades in

### Test Requirements
- [ ] **Unit (Rust):** image processing (resize dimensions correct, EXIF stripped, format conversion)
- [ ] **Unit (Rust):** upload URL generation (valid MinIO pre-signed URL, correct expiry)
- [ ] **Unit (Rust):** mime type validation, file size validation
- [ ] **Integration:** Upload image -> confirm -> process -> verify all variants exist in MinIO
- [ ] **Benchmark (Rust):** criterion benchmark for 1080p image processing -- must be < 200ms p99
- [ ] **Frontend Unit:** ImageUpload component states (selecting, uploading, processing, complete, error)

---

## Slice 14: Subscriptions & Analytics

**Depends on:** Slices 1, 6, 3
**Estimated files:** ~20 files
**Services touched:** Payment Service (subscription), Job Service (analytics), Gateway, Frontend, Stripe

### Backend Tasks

#### Payment Service (`services/payment/`) -- Subscription management
1. **`services/payment/internal/service/subscription.go`** -- Subscription logic:
   - `ListTiers(ctx) ([]SubscriptionTier, error)` -- SELECT from `subscription_tiers` WHERE active = true
   - `CreateSubscription(ctx, userID, tierID, billingInterval, paymentMethodID) (Subscription, error)` -- create Stripe subscription, store in `subscriptions` table
   - `GetSubscription(ctx, userID) (Subscription, error)` -- SELECT from `subscriptions` JOIN `subscription_tiers`
   - `CancelSubscription(ctx, userID, reason, immediately) (Subscription, error)` -- cancel Stripe subscription (immediately or at period end)
   - `ChangeSubscriptionTier(ctx, userID, newTierID, billingInterval) (Subscription, int64, error)` -- update Stripe subscription, compute proration
   - `CheckFeatureAccess(ctx, userID, feature) (bool, string, error)` -- check if user's tier includes feature
   - `GetUsage(ctx, userID) (Usage, error)` -- active bids, categories, portfolio images vs limits
   - `HandleSubscriptionWebhook(ctx, payload, signature) error` -- process Stripe subscription events (invoice.paid, invoice.payment_failed, customer.subscription.deleted)
   - **Tables read/written:** `subscriptions`, `subscription_tiers`
2. **`services/payment/internal/repository/subscription_repo.go`** -- Repository methods for subscription CRUD

#### Job Service (`services/job/`) -- Analytics logic
3. **`services/job/internal/service/analytics.go`** -- Analytics:
   - `GetMarketRange(ctx, categoryID, subcategoryID, serviceTypeID, location, radius) (MarketRange, error)` -- SELECT from `market_ranges`, blend with platform data if available
   - `GetProviderAnalytics(ctx, providerID, dateRange) (ProviderAnalytics, error)` -- aggregate from `analytics_transactions`, `bids`, `contracts`, `reviews`
   - `GetProviderEarnings(ctx, providerID, dateRange, groupBy) ([]EarningsDataPoint, error)` -- aggregate payments grouped by period
   - `GetCustomerSpending(ctx, customerID, dateRange, groupBy) ([]SpendingDataPoint, error)` -- aggregate payments by period
   - `RecordTransaction(ctx, input) error` -- INSERT into `analytics_transactions` (called after payment completion)
   - **Tables read/written:** `market_ranges`, `analytics_transactions`, `payments`, `bids`, `contracts`, `reviews`
4. **gRPC methods:**
   - Subscription: `ListTiers`, `CreateSubscription`, `GetSubscription`, `CancelSubscription`, `ChangeSubscriptionTier`, `CheckFeatureAccess`, `GetUsage`, `ListInvoices`, `HandleSubscriptionWebhook`
   - Analytics: `GetMarketRange`, `GetProviderAnalytics`, `GetProviderEarnings`, `GetCustomerSpending`, `RecordTransaction`
   - **Proto RPCs implemented:** ListTiers, CreateSubscription, GetSubscription, CancelSubscription, ChangeSubscriptionTier, CheckFeatureAccess, GetUsage, ListInvoices, HandleSubscriptionWebhook, GetMarketRange, GetProviderAnalytics, GetProviderEarnings, GetCustomerSpending, RecordTransaction

#### Gateway (`gateway/`)
5. **`gateway/internal/handler/subscription.go`** -- HTTP handlers:
   - `GET /api/v1/subscriptions/tiers` -- list available tiers (public)
   - `POST /api/v1/subscriptions` -- create subscription
   - `GET /api/v1/subscriptions/me` -- get current subscription
   - `DELETE /api/v1/subscriptions/me` -- cancel subscription
   - `PATCH /api/v1/subscriptions/me/tier` -- change tier
   - `GET /api/v1/subscriptions/me/usage` -- get usage vs limits
   - `GET /api/v1/subscriptions/me/invoices` -- list invoices
6. **`gateway/internal/handler/analytics.go`** -- HTTP handlers:
   - `GET /api/v1/analytics/market-range` -- get market range for category+location
   - `GET /api/v1/analytics/provider` -- get provider analytics (provider role)
   - `GET /api/v1/analytics/provider/earnings` -- get earnings breakdown (provider role)
   - `GET /api/v1/analytics/customer/spending` -- get spending breakdown (customer role)
7. **`gateway/internal/handler/webhook.go`** -- Add Stripe subscription webhook handler:
   - `POST /api/v1/webhooks/stripe/subscription` -- route subscription events

#### Frontend (`web/`)
8. **`web/src/app/(dashboard)/settings/subscription/page.tsx`** -- Subscription management page: current plan, usage, upgrade/downgrade, cancel
9. **`web/src/components/payments/SubscriptionTierCard.tsx`** -- Tier card: name, price, features, CTA button
10. **`web/src/components/payments/SubscriptionTierComparison.tsx`** -- Tier comparison table (features across tiers)
11. **`web/src/app/(dashboard)/analytics/page.tsx`** -- Analytics dashboard:
    - Provider: earnings chart, bid win rate, jobs completed, on-time rate, category breakdown
    - Customer: spending chart, jobs posted, average cost, savings vs market
12. **`web/src/components/analytics/EarningsChart.tsx`** -- Earnings over time chart (bar/line chart)
13. **`web/src/components/analytics/MarketRangeDisplay.tsx`** -- Market range visualization (update from Slice 3 with real data)
14. **`web/src/hooks/useSubscription.ts`** -- TanStack Query hooks: useTiers, useSubscription, useCreateSubscription, useCancelSubscription, useUsage
15. **`web/src/hooks/useAnalytics.ts`** -- TanStack Query hooks: useProviderAnalytics, useProviderEarnings, useCustomerSpending, useMarketRange

### Integration Points
- Subscription tier limits enforced at bid placement (max active bids) and category selection (max categories)
- Fee discount from subscription applied in payment fee calculation
- Analytics data populated by RecordTransaction called after payment completion
- Market range displayed during job posting and on job detail pages
- Subscription webhooks keep status in sync with Stripe

### Acceptance Criteria
- [ ] Subscription tiers listed with correct pricing and feature comparison
- [ ] Provider can subscribe, change tier, and cancel via Stripe
- [ ] Subscription limits enforced (max bids, max categories, portfolio images)
- [ ] Fee discount applied correctly based on subscription tier
- [ ] Provider analytics show correct earnings, win rate, completion metrics
- [ ] Customer analytics show spending breakdown by category and period
- [ ] Market range data displayed during job posting for price guidance
- [ ] Stripe subscription webhooks correctly update subscription status

### Test Requirements
- [ ] **Unit:** fee discount calculation per tier, feature access check
- [ ] **Unit:** analytics aggregation queries (correct sums, averages, grouping)
- [ ] **Unit:** subscription state machine (trialing -> active -> cancelled, past_due handling)
- [ ] **Integration:** Create subscription -> verify limits enforced -> upgrade tier -> verify new limits
- [ ] **Frontend Unit:** SubscriptionTierComparison renders features correctly, EarningsChart with mock data

---

## Slice 15: Admin Dashboard

**Depends on:** All previous slices
**Estimated files:** ~25 files
**Services touched:** All services (admin RPCs), Gateway, Frontend

### Backend Tasks

#### Gateway (`gateway/`)
1. **`gateway/internal/middleware/auth.go`** -- Add admin role enforcement middleware:
   - `RequireAdmin()` -- middleware that checks JWT claims for admin role
   - `RequireRole(roles ...string)` -- generic role check middleware
2. **`gateway/internal/handler/admin_users.go`** -- Admin user management:
   - `GET /api/v1/admin/users` -- search users (AdminSearchUsers)
   - `GET /api/v1/admin/users/:id` -- get full user detail (AdminGetUser)
   - `POST /api/v1/admin/users/:id/suspend` -- suspend user (AdminSuspendUser)
   - `POST /api/v1/admin/users/:id/ban` -- ban user (AdminBanUser)
3. **`gateway/internal/handler/admin_verification.go`** -- Verification queue:
   - `GET /api/v1/admin/verification/queue` -- list pending documents (ListDocuments with status=pending)
   - `POST /api/v1/admin/verification/:id/review` -- approve/reject document (AdminReviewDocument)
4. **`gateway/internal/handler/admin_jobs.go`** -- Admin job management:
   - `GET /api/v1/admin/jobs` -- list all jobs with filters (AdminListJobs)
   - `POST /api/v1/admin/jobs/:id/suspend` -- suspend job (AdminSuspendJob)
   - `POST /api/v1/admin/jobs/:id/remove` -- remove job (AdminRemoveJob)
5. **`gateway/internal/handler/admin_disputes.go`** -- Dispute resolution:
   - `GET /api/v1/admin/disputes` -- list disputes (ListDisputes)
   - `GET /api/v1/admin/disputes/:id` -- get dispute detail (GetDispute)
   - `POST /api/v1/admin/disputes/:id/resolve` -- resolve dispute (AdminResolveDispute)
6. **`gateway/internal/handler/admin_reviews.go`** -- Flagged reviews:
   - `GET /api/v1/admin/reviews/flagged` -- list flagged reviews (AdminListFlaggedReviews)
   - `POST /api/v1/admin/reviews/flags/:id/resolve` -- resolve flag (AdminResolveFlag)
   - `DELETE /api/v1/admin/reviews/:id` -- remove review (AdminRemoveReview)
7. **`gateway/internal/handler/admin_payments.go`** -- Payment admin:
   - `GET /api/v1/admin/payments` -- list all payments (AdminListPayments)
   - `GET /api/v1/admin/payments/:id` -- payment detail with Stripe IDs (AdminGetPaymentDetails)
   - `GET /api/v1/admin/revenue` -- revenue report (GetRevenueReport)
8. **`gateway/internal/handler/admin_platform.go`** -- Platform admin:
   - `GET /api/v1/admin/platform/metrics` -- platform metrics (GetPlatformMetrics)
   - `GET /api/v1/admin/platform/growth` -- growth metrics (GetGrowthMetrics)
   - `GET /api/v1/admin/categories` -- category management (AdminCreateCategory, AdminUpdateCategory, AdminDeleteCategory)
   - `PUT /api/v1/admin/fees` -- update fee config (AdminUpdateFeeConfig)
   - `GET /api/v1/admin/subscriptions` -- list subscriptions (AdminListSubscriptions)
9. **gRPC calls:** admin handlers call admin RPCs across all services:
   - UserService: AdminGetUser, AdminSearchUsers, AdminSuspendUser, AdminBanUser, AdminReviewDocument
   - JobService: AdminListJobs, AdminSuspendJob, AdminRemoveJob, AdminCreateCategory, AdminUpdateCategory, AdminDeleteCategory
   - ContractService: ListDisputes, GetDispute, AdminResolveDispute
   - PaymentService: AdminListPayments, AdminGetPaymentDetails, AdminUpdateFeeConfig, GetRevenueReport
   - ReviewService: AdminListFlaggedReviews, AdminResolveFlag, AdminRemoveReview
   - FraudService: AdminListFraudAlerts, AdminReviewFraudAlert, AdminGetFraudDashboard
   - TrustService: AdminOverrideTrustScore, AdminGetTrustBreakdown
   - SubscriptionService: AdminListSubscriptions, AdminUpdateTier, AdminGrantSubscription
   - **Proto RPCs consumed:** All Admin* RPCs across all 14 proto files

#### Frontend (`web/`)
10. **`web/src/app/(dashboard)/admin/layout.tsx`** -- Admin layout: sidebar navigation with sections (Users, Jobs, Disputes, Reviews, Fraud, Payments, Platform)
11. **`web/src/app/(dashboard)/admin/page.tsx`** -- Admin dashboard overview: key metrics cards, recent alerts, pending queues
12. **`web/src/app/(dashboard)/admin/users/page.tsx`** -- User management: search, filter by status/role, user table with actions
13. **`web/src/app/(dashboard)/admin/users/[id]/page.tsx`** -- User detail: full profile, provider profile, documents, trust breakdown, fraud signals, actions (suspend, ban)
14. **`web/src/app/(dashboard)/admin/verification/page.tsx`** -- Verification queue: pending documents list, document viewer, approve/reject actions
15. **`web/src/app/(dashboard)/admin/disputes/page.tsx`** -- Dispute list: status filters, dispute detail expandable, resolution form
16. **`web/src/app/(dashboard)/admin/disputes/[id]/page.tsx`** -- Dispute detail: contract info, both parties, evidence, chat history, resolution form (type, notes, refund amount)
17. **`web/src/app/(dashboard)/admin/reviews/page.tsx`** -- Flagged reviews queue: review content, flag reason, resolve (uphold/dismiss)
18. **`web/src/app/(dashboard)/admin/payments/page.tsx`** -- Payment admin: transaction list, revenue report, fee configuration
19. **`web/src/app/(dashboard)/admin/platform/page.tsx`** -- Platform metrics: GMV, users, jobs, growth charts, category metrics, geographic metrics
20. **`web/src/components/admin/AdminSidebar.tsx`** -- Admin sidebar navigation
21. **`web/src/components/admin/MetricsCard.tsx`** -- Reusable metrics display card (value, change, trend arrow)
22. **`web/src/components/admin/DataTable.tsx`** -- Reusable admin data table with sorting, filtering, pagination
23. **`web/src/components/admin/ActionConfirmDialog.tsx`** -- Confirmation dialog for destructive actions (suspend, ban, remove)
24. **`web/src/hooks/useAdmin.ts`** -- TanStack Query hooks for all admin endpoints

### Integration Points
- Admin routes require admin role in JWT claims
- Admin actions trigger notifications to affected users (via Slice 12)
- Dispute resolution triggers payment refund (via Slice 6)
- User suspension/ban updates fraud signals and trust score
- Verification approval updates trust score verification dimension
- Admin audit trail: all admin actions logged (action, admin_id, timestamp, details)

### Acceptance Criteria
- [ ] All admin routes return 403 for non-admin users
- [ ] Admin can search users by email, name, phone with status/role filters
- [ ] Admin can suspend/ban users with reason (affects all active sessions)
- [ ] Verification queue shows pending documents; admin can approve/reject with reason
- [ ] Dispute resolution updates contract status and triggers refund if applicable
- [ ] Flagged review resolution upholds (removes review) or dismisses (review stays)
- [ ] Revenue report shows GMV, revenue, guarantee fund, effective take rate
- [ ] Platform metrics dashboard shows growth trends, category performance, geographic distribution
- [ ] Admin sidebar navigation provides access to all admin sections
- [ ] All admin actions require confirmation dialog for destructive operations

### Test Requirements
- [ ] **Unit:** admin middleware role enforcement (admin allowed, non-admin blocked, missing role)
- [ ] **Unit:** dispute resolution logic (release payment, partial refund, full refund)
- [ ] **Integration:** Admin suspends user -> verify user cannot login -> admin unsuspends -> user can login
- [ ] **Integration:** Admin resolves dispute with refund -> verify payment refunded via Stripe
- [ ] **E2E:** Playwright: admin logs in, navigates to verification queue, approves document, verifies badge appears on provider profile
- [ ] **E2E:** Playwright: admin views platform metrics dashboard, verifies data loads correctly

---

## Implementation Order Summary

```
Slice 0  (Infrastructure)     [WEEK 1]
  |
  v
Slice 1  (Auth)               [WEEK 1-2]
  |
  v
Slice 2  (Profiles)           [WEEK 2-3]
  |
  +----------+
  v          v
Slice 3    Slice 7 (Chat)     [WEEK 3-4]
(Jobs)       |
  |          |
  v          |
Slice 4  <---+               [WEEK 4-5]
(Bids)
  |
  v
Slice 5  (Contracts)          [WEEK 5-6]
  |
  v
Slice 6  (Payments)           [WEEK 6-7]
  |
  v
Slice 8  (Completion)         [WEEK 7-8]
  |
  v
Slice 9  (Reviews)            [WEEK 8-9]
  |
  +------+------+
  v      v      v
Slice 10 Slice 11 Slice 12   [WEEK 9-10]
(Trust)  (Fraud)  (Notifications)
  |
  v
Slice 13 (Imaging)            [WEEK 10-11] (can start earlier, low dependency)
  |
  v
Slice 14 (Subscriptions)      [WEEK 11-12]
  |
  v
Slice 15 (Admin)              [WEEK 12-14]
```

## Cross-Cutting Concerns (Applied Across All Slices)

### Logging (every slice)
- All Go services: slog structured logging with request_id, service name, method, duration
- All Rust engines: tracing crate with structured fields
- All HTTP handlers: request method, path, status, duration_ms, request_id logged

### Error Handling (every slice)
- Go: wrap errors with context at every level, map to HTTP status at gateway
- Rust: thiserror for typed errors, anyhow for application context
- Frontend: error boundaries per feature section, toast notifications for action feedback

### Metrics (every slice)
- Prometheus counters for each endpoint: requests_total, duration_seconds
- Custom metrics: bid_processing_duration, trust_computation_duration, active_websocket_connections

### Security (every slice)
- Input validation at every boundary (Zod client, Go validator gateway, business rules service)
- Parameterized SQL queries only (pgx for Go, sqlx for Rust)
- Rate limiting on all public endpoints (stricter on auth: 5/15min)
- CORS explicit origin allowlist

### Database Conventions (every slice)
- All queries use `$1, $2, ...` parameter placeholders
- All writes include proper transaction handling (BEGIN/COMMIT/ROLLBACK)
- All reads filter `WHERE deleted_at IS NULL` for soft-deleted tables
- UUID v7 for all primary keys
- BIGINT cents for all monetary values
