# Template Dockerfile for Go microservices.
# Usage: docker build --build-arg SERVICE=user -f deploy/docker/service.Dockerfile .
ARG SERVICE=user

FROM golang:1.22-alpine AS builder
ARG SERVICE
WORKDIR /app
COPY services/${SERVICE}/go.mod services/${SERVICE}/go.sum* ./
RUN go mod download
COPY services/${SERVICE}/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /server /server
# Default port — override per service with environment variable
EXPOSE 50051
CMD ["/server"]
