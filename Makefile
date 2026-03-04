.PHONY: up down dev-full dev-infra migrate-up migrate-down seed proto-gen proto-gen-go proto-gen-rust \
       setup-tools test lint fmt build-gateway build-web build-engines clean

# ── Infrastructure ────────────────────────────────────────────

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
		proto/analytics/v1/analytics.proto
	@echo "Go proto generation complete."

proto-gen-rust:
	@echo "Generating Rust protobuf code (via tonic-build)..."
	cd engines && cargo build --all
	@echo "Rust proto generation complete (code in engines/target/)."

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
