# Multi-stage build for the Imaging Engine (Rust).
# Build context must be the repository root.

FROM rust:1.93-bookworm AS builder
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy proto definitions (needed by tonic-build at compile time).
COPY proto/ proto/

# Copy the full workspace and build only the imaging engine.
COPY engines/ engines/
WORKDIR /app/engines
RUN cargo build --release -p nomarkup-imaging-engine

# ── Runtime ──────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/engines/target/release/nomarkup-imaging-engine /usr/local/bin/server
EXPOSE 50058
ENTRYPOINT ["server"]
