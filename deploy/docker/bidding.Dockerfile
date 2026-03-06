# Multi-stage build for the Bidding Engine (Rust).
# Build context must be the repository root.
#
# The build.rs files reference ../../proto relative to the engine crate,
# so we replicate the repo layout: /app/proto + /app/engines.

FROM rust:1.93-bookworm AS builder
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy proto definitions (needed by tonic-build at compile time).
COPY proto/ proto/

# Copy the full workspace and build only the bidding engine.
COPY engines/ engines/
WORKDIR /app/engines
RUN cargo build --release -p nomarkup-bidding-engine

# ── Runtime ──────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/engines/target/release/nomarkup-bidding-engine /usr/local/bin/server
EXPOSE 50053
ENTRYPOINT ["server"]
