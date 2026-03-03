# Multi-stage build for the Chat Service.
# Build context must be the repository root.

FROM golang:1.22-alpine AS builder
WORKDIR /app

# Copy the shared proto module first — the service go.mod has:
#   replace github.com/nomarkup/nomarkup/proto => ../../proto/gen/go
COPY proto/gen/go/ proto/gen/go/

# Copy service module files and download dependencies.
COPY services/chat/go.mod services/chat/go.sum services/chat/
WORKDIR /app/services/chat
RUN go mod download

# Copy service source and build.
COPY services/chat/ /app/services/chat/
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server

# ── Runtime ──────────────────────────────────────────────────
FROM alpine:3.20
RUN apk --no-cache add ca-certificates
COPY --from=builder /server /server
# gRPC port + WebSocket port
EXPOSE 50055 50065
ENTRYPOINT ["/server"]
