.PHONY: up down dev dev-full dev-infra dev-status dev-logs migrate-up migrate-down seed proto-gen proto-gen-go proto-gen-rust \
       verify-proto setup-tools test lint fmt build-gateway build-web build-engines clean

# ── Native Dev (bin/dev) ─────────────────────────────────────

dev:
	bin/dev up

dev-setup:
	bin/dev setup

dev-status:
	bin/dev status

dev-logs:
	bin/dev logs

dev-down:
	bin/dev down

# ── Docker (legacy) ──────────────────────────────────────────

up:
	docker compose up -d

down:
	docker compose down

dev-full:
	docker compose up --build

dev-infra:
	docker compose up postgres redis meilisearch minio

# ── Database ──────────────────────────────────────────────────

migrate-up:
	@echo "Running migrations..."
	migrate -path database/migrations -database "$(DATABASE_URL)" up

migrate-down:
	@echo "Rolling back last migration..."
	migrate -path database/migrations -database "$(DATABASE_URL)" down 1

seed:
	@echo "Seeding database with dev data..."
	cd database && go run ./cmd/seed

# Demo seed: base seed + 40 marketplace listings distributed across closing-time
# buckets so the /marketplace scoreboard reads as a populated live event for VC
# walkthroughs. See database/cmd/seed/marketplace_demo.go.
seed-demo:
	@echo "Seeding database with demo marketplace fixture (40 listings, 8 critical, 12 urgent, 20 normal)..."
	cd database && SEED_DEMO_MARKETPLACE=1 go run ./cmd/seed

# Bring the local stack up, run migrations, and seed the demo marketplace.
# Use this before a live demo to get a populated scoreboard from a clean DB.
demo-up: dev-infra migrate-up seed-demo
	@echo ""
	@echo "Demo stack ready."
	@echo "  Web:        http://localhost:3000/marketplace"
	@echo "  Gateway:    http://localhost:8080"
	@echo "  Login:      customer@nomarkup.com / Password123!"
	@echo ""
	@echo "Pre-demo checklist: docs/demo-script.md (T-30)"

# Backfill / re-encrypt PII columns flagged in migration 031. Idempotent: only
# touches rows where pii_encrypted_v1 = FALSE. Requires ENCRYPTION_KEY (and,
# during a rotation, ENCRYPTION_KEY_PREVIOUS) to be set in the environment.
# See docs/operations/encryption-key-rotation.md.
encrypt-pii:
	@echo "Backfilling PII encryption..."
	cd database && go run ./cmd/encrypt-pii

encrypt-pii-dry-run:
	cd database && go run ./cmd/encrypt-pii -dry-run

# ── Toolchain Setup ───────────────────────────────────────────

setup-tools:
	@echo "Installing protobuf toolchain..."
	brew install protobuf
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
	brew install golang-migrate
	@echo "Generating RSA keypair for JWT..."
	@mkdir -p keys
	openssl genrsa -out keys/private.pem 4096
	openssl rsa -in keys/private.pem -pubout -out keys/public.pem
	@echo "Setup complete."

# ── Proto Generation ──────────────────────────────────────────

proto-gen: proto-gen-go proto-gen-rust

proto-gen-go:
	@echo "Generating Go protobuf code..."
	@mkdir -p proto/gen/go
	protoc \
		--proto_path=proto \
		--go_out=proto/gen/go --go_opt=paths=source_relative \
		--go-grpc_out=proto/gen/go --go-grpc_opt=paths=source_relative \
		proto/common/v1/common.proto \
		proto/user/v1/user.proto \
		proto/job/v1/job.proto \
		proto/bid/v1/bid.proto \
		proto/contract/v1/contract.proto \
		proto/payment/v1/payment.proto \
		proto/chat/v1/chat.proto \
		proto/review/v1/review.proto \
		proto/trust/v1/trust.proto \
		proto/fraud/v1/fraud.proto \
		proto/notification/v1/notification.proto \
		proto/imaging/v1/imaging.proto \
		proto/subscription/v1/subscription.proto \
		proto/analytics/v1/analytics.proto \
		proto/listing/v1/listing.proto
	@echo "Go proto generation complete."

proto-gen-rust:
	@echo "Generating Rust protobuf code (via tonic-build)..."
	cd engines && cargo build --all
	@echo "Rust proto generation complete (code in engines/target/)."

# Verify generated proto code is up-to-date with the .proto sources and that
# all Go consumers still compile against it. CI runs this — a broken .proto
# now fails the build instead of silently persisting behind hand-written
# stand-in files (which is how an audit-period Stripe webhook regression
# went undetected for weeks; see docs/TODOS.md S8).
verify-proto:
	@echo "Regenerating protobuf code..."
	$(MAKE) proto-gen-go
	@echo "Verifying no proto drift (working tree must be clean after regen)..."
	@if [ -n "$$(git status --porcelain proto/gen)" ]; then \
		echo "ERROR: proto/gen has drift — regenerate locally and commit:"; \
		git status --porcelain proto/gen; \
		git --no-pager diff -- proto/gen | head -200; \
		exit 1; \
	fi
	@echo "Running go vet across all Go modules..."
	cd gateway && go vet ./...
	cd services/user && go vet ./...
	cd services/job && go vet ./...
	cd services/payment && go vet ./...
	cd services/chat && go vet ./...
	cd services/notification && go vet ./...
	@echo "Proto verification passed."

# ── Testing ───────────────────────────────────────────────────

test: test-web test-gateway test-services test-engines

test-web:
	cd web && npm run test

test-gateway:
	cd gateway && go test ./... -race

test-services:
	cd services/user && go test ./... -race
	cd services/job && go test ./... -race
	cd services/payment && go test ./... -race
	cd services/chat && go test ./... -race
	cd services/notification && go test ./... -race

test-engines:
	cd engines && cargo test --all

# ── Linting ───────────────────────────────────────────────────

lint: lint-web lint-go lint-rust

lint-web:
	cd web && npm run lint

lint-go:
	cd gateway && go vet ./...
	cd services/user && go vet ./...
	cd services/job && go vet ./...
	cd services/payment && go vet ./...
	cd services/chat && go vet ./...
	cd services/notification && go vet ./...

lint-rust:
	cd engines && cargo clippy --all-targets -- -D warnings

# ── Formatting ────────────────────────────────────────────────

fmt:
	cd web && npm run format
	cd gateway && gofmt -w .
	cd services/user && gofmt -w .
	cd services/job && gofmt -w .
	cd services/payment && gofmt -w .
	cd services/chat && gofmt -w .
	cd services/notification && gofmt -w .
	cd engines && cargo fmt --all

# ── Build ─────────────────────────────────────────────────────

build-gateway:
	cd gateway && go build -o bin/server ./cmd/server

build-web:
	cd web && npm run build

build-engines:
	cd engines && cargo build --release

# ── Clean ─────────────────────────────────────────────────────

clean:
	rm -rf web/.next web/out
	rm -rf gateway/bin
	rm -rf services/*/bin
	rm -rf engines/target
	rm -rf coverage
