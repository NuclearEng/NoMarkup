# Multi-stage build for the Go API Gateway.
# Build context must be the repository root.

FROM golang:1.22-alpine AS builder
WORKDIR /app

# Copy the shared proto module first — the gateway's go.mod has:
#   replace github.com/nomarkup/nomarkup/proto => ../proto/gen/go
COPY proto/gen/go/ proto/gen/go/

# Copy gateway module files and download dependencies.
COPY gateway/go.mod gateway/go.sum gateway/
WORKDIR /app/gateway
RUN go mod download

# Copy gateway source and build.
COPY gateway/ /app/gateway/
RUN CGO_ENABLED=0 GOOS=linux go build -o /gateway ./cmd/server

# ── Runtime ──────────────────────────────────────────────────
FROM alpine:3.20
RUN apk --no-cache add ca-certificates
COPY --from=builder /gateway /gateway
EXPOSE 8080
ENTRYPOINT ["/gateway"]
