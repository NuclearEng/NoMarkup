# Template Dockerfile for Rust engines.
# Usage: docker build --build-arg ENGINE=bidding -f deploy/docker/engine.Dockerfile .
ARG ENGINE=bidding

FROM rust:1.82-bookworm AS builder
ARG ENGINE
WORKDIR /app
COPY engines/Cargo.toml engines/Cargo.lock* ./
COPY engines/${ENGINE}/ ./${ENGINE}/
# Build only the target engine
RUN cargo build --release -p nomarkup-${ENGINE}-engine

FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*
ARG ENGINE
COPY --from=builder /app/target/release/nomarkup-${ENGINE}-engine /usr/local/bin/server
# Default port — override per engine with environment variable
EXPOSE 50053
CMD ["server"]
