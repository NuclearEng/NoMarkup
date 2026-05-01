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

# ── Stage 1: build workspace dependencies ─────────────────────
FROM rust:1.95-bookworm AS builder
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy proto definitions first (needed by build.rs / tonic-build).
COPY proto/ proto/

# Copy workspace manifests, lockfile, and build.rs files for dep-layer caching.
# Changes to source code alone won't invalidate this layer.
COPY engines/Cargo.toml engines/Cargo.lock engines/
COPY engines/bidding/Cargo.toml engines/bidding/build.rs engines/bidding/
COPY engines/fraud/Cargo.toml engines/fraud/build.rs engines/fraud/
COPY engines/trust/Cargo.toml engines/trust/build.rs engines/trust/
COPY engines/imaging/Cargo.toml engines/imaging/build.rs engines/imaging/

# Create dummy source and bench files so cargo can resolve the workspace and compile deps.
RUN for eng in bidding fraud trust imaging; do \
        mkdir -p engines/$eng/src engines/$eng/benches && \
        echo "fn main() {}" > engines/$eng/src/main.rs && \
        echo "fn main() {}" > engines/$eng/benches/${eng}_bench.rs; \
    done

WORKDIR /app/engines
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/engines/target \
    cargo build --release --workspace 2>&1

# ── Stage 2: build real source (deps already cached) ──────────
COPY engines/ /app/engines/
# Touch source files so cargo detects them as newer than the cached dummy
# fingerprints. The dep-cache stage compiled placeholder `fn main() {}` stubs
# and wrote fingerprints with the build-time mtime; without this touch, cargo
# sees the real sources as "older" and skips recompilation.
RUN find /app/engines -name '*.rs' -exec touch {} + && \
    find /app/engines -name 'build.rs' -exec touch {} +
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
