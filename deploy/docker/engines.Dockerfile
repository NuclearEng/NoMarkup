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
FROM rust:1.92-bookworm AS builder
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
COPY engines/pricing/Cargo.toml engines/pricing/build.rs engines/pricing/
COPY engines/underwriting/Cargo.toml engines/underwriting/build.rs engines/underwriting/

# Create dummy source and bench files so cargo can resolve the workspace and
# compile deps. Every crate declares a [lib] plus a named [[bench]], so each
# needs src/main.rs, src/lib.rs, and a bench file matching its declared name.
RUN for eng in bidding fraud trust imaging pricing underwriting; do \
        mkdir -p engines/$eng/src engines/$eng/benches && \
        echo "fn main() {}" > engines/$eng/src/main.rs && \
        touch engines/$eng/src/lib.rs; \
    done && \
    for b in bidding/benches/bidding_bench fraud/benches/fraud_bench \
             trust/benches/trust_bench imaging/benches/imaging_bench \
             pricing/benches/fair_price underwriting/benches/underwrite; do \
        echo "fn main() {}" > engines/$b.rs; \
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
    for BIN in nomarkup-bidding-engine nomarkup-fraud-engine nomarkup-trust-engine nomarkup-imaging-engine nomarkup-pricing-engine nomarkup-underwriting-engine; do \
        cp /app/engines/target/release/$BIN /usr/local/bin/ ; \
    done

# ── Runtime targets (one per engine) ──────────────────────────
FROM debian:bookworm-slim AS runtime-base
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    adduser --system --group --uid 10001 app

FROM runtime-base AS bidding
COPY --from=builder --chown=app:app /usr/local/bin/nomarkup-bidding-engine /usr/local/bin/server
USER app
EXPOSE 50053
ENTRYPOINT ["server"]

FROM runtime-base AS fraud
COPY --from=builder --chown=app:app /usr/local/bin/nomarkup-fraud-engine /usr/local/bin/server
USER app
EXPOSE 50056
ENTRYPOINT ["server"]

FROM runtime-base AS trust
COPY --from=builder --chown=app:app /usr/local/bin/nomarkup-trust-engine /usr/local/bin/server
USER app
EXPOSE 50057
ENTRYPOINT ["server"]

FROM runtime-base AS imaging
COPY --from=builder --chown=app:app /usr/local/bin/nomarkup-imaging-engine /usr/local/bin/server
USER app
EXPOSE 50058
ENTRYPOINT ["server"]

FROM runtime-base AS underwriting
COPY --from=builder --chown=app:app /usr/local/bin/nomarkup-underwriting-engine /usr/local/bin/server
USER app
EXPOSE 50060
ENTRYPOINT ["server"]

FROM runtime-base AS pricing
COPY --from=builder --chown=app:app /usr/local/bin/nomarkup-pricing-engine /usr/local/bin/server
USER app
EXPOSE 50061
ENTRYPOINT ["server"]
