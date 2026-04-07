# syntax=docker/dockerfile:1
# Single multi-target Dockerfile for ALL Rust engines.
# Builds the entire workspace once — shared deps (tokio, tonic, serde, sqlx, etc.)
# compile only once instead of 4 times.
#
# Usage in docker-compose:
#   bidding:
#     build:
#       dockerfile: deploy/docker/engines.Dockerfile
#       target: bidding

# ── Stage 1: build all engines ────────────────────────────────
FROM rust:latest AS builder
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY proto/ proto/
COPY engines/ engines/
WORKDIR /app/engines

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/engines/target \
    cargo build --release --workspace 2>&1 && \
    for BIN in nomarkup-bidding-engine nomarkup-fraud-engine nomarkup-trust-engine nomarkup-imaging-engine; do \
        cp /app/engines/target/release/$BIN /usr/local/bin/ ; \
    done

# ── Runtime targets (one per engine) ──────────────────────────
FROM debian:bookworm-slim AS runtime-base
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

FROM runtime-base AS bidding
COPY --from=builder /usr/local/bin/nomarkup-bidding-engine /usr/local/bin/server
EXPOSE 50053
ENTRYPOINT ["server"]

FROM runtime-base AS fraud
COPY --from=builder /usr/local/bin/nomarkup-fraud-engine /usr/local/bin/server
EXPOSE 50056
ENTRYPOINT ["server"]

FROM runtime-base AS trust
COPY --from=builder /usr/local/bin/nomarkup-trust-engine /usr/local/bin/server
EXPOSE 50057
ENTRYPOINT ["server"]

FROM runtime-base AS imaging
COPY --from=builder /usr/local/bin/nomarkup-imaging-engine /usr/local/bin/server
EXPOSE 50058
ENTRYPOINT ["server"]
