# syntax=docker/dockerfile:1
# Multi-stage build for the Payment Service.
# Build context must be the repository root.

FROM golang:1.26-alpine AS builder
WORKDIR /app
RUN echo "══════════════════════════════════════════════════════════" && \
    echo "  PAYMENT-SERVICE · Build started"                         && \
    echo "  Go $(go version | awk '{print $3}')"                     && \
    echo "══════════════════════════════════════════════════════════"

# Copy the shared proto module first — the service go.mod has:
#   replace github.com/nomarkup/nomarkup/proto => ../../proto/gen/go
COPY proto/gen/go/ proto/gen/go/

# Copy service module files and download dependencies.
COPY services/payment/go.mod services/payment/go.sum services/payment/
WORKDIR /app/services/payment
RUN --mount=type=cache,target=/go/pkg/mod \
    echo "  [1/3] DEPS · Downloading Go modules..." && \
    START=$(date +%s) && \
    go mod download 2>&1 && \
    ELAPSED=$(( $(date +%s) - START )) && \
    COUNT=$(go list -m all 2>/dev/null | wc -l | tr -d ' ') && \
    echo "  [1/3] ✔ ${COUNT} modules ready in ${ELAPSED}s"

# Copy service source and build.
COPY services/payment/ /app/services/payment/
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    echo "  [2/3] BUILD · Compiling payment-service binary..." && \
    START=$(date +%s) && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /server ./cmd/server 2>&1 && \
    ELAPSED=$(( $(date +%s) - START )) && \
    SIZE=$(du -h /server | awk '{print $1}') && \
    echo "  [2/3] ✔ Compiled in ${ELAPSED}s · ${SIZE}"

# ── Runtime ──────────────────────────────────────────────────
FROM alpine:3.20
RUN apk --no-cache add ca-certificates
COPY --from=builder /server /server
RUN echo "  [3/3] ✔ payment-service image ready · $(du -h /server | awk '{print $1}')"
EXPOSE 50054
ENTRYPOINT ["/server"]
