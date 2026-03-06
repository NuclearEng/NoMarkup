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

# ── Stage 1: cargo-chef planner ────────────────────────────────
FROM rust:1.93-bookworm AS chef
RUN echo "══════════════════════════════════════════════════════════" && \
    echo "  [1/5] TOOLCHAIN · Installing cargo-chef + protoc"       && \
    echo "══════════════════════════════════════════════════════════"
RUN cargo install cargo-chef 2>&1 | tail -1
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*
RUN echo "  [1/5] ✔ Toolchain ready · rustc $(rustc --version | awk '{print $2}') · protoc $(protoc --version | awk '{print $2}')"
WORKDIR /app

# ── Stage 2: analyze deps ─────────────────────────────────────
FROM chef AS planner
RUN echo "══════════════════════════════════════════════════════════" && \
    echo "  [2/5] PLAN · Analyzing workspace dependency graph"      && \
    echo "══════════════════════════════════════════════════════════"
COPY proto/ proto/
COPY engines/ engines/
WORKDIR /app/engines
RUN cargo chef prepare --recipe-path recipe.json && \
    echo "  [2/5] ✔ Recipe generated · $(wc -l < recipe.json) lines"

# ── Stage 3: build deps (cached until Cargo.toml/lock changes) ─
FROM chef AS builder
COPY proto/ proto/
COPY --from=planner /app/engines/recipe.json /app/engines/recipe.json
WORKDIR /app/engines

RUN echo "══════════════════════════════════════════════════════════" && \
    echo "  [3/5] DEPS · Compiling workspace dependencies"          && \
    echo "        (cached layer — skipped when Cargo.toml unchanged)" && \
    echo "══════════════════════════════════════════════════════════"
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/engines/target \
    START=$(date +%s) && \
    cargo chef cook --release --recipe-path recipe.json 2>&1 && \
    ELAPSED=$(( $(date +%s) - START )) && \
    echo "  [3/5] ✔ Dependencies compiled in ${ELAPSED}s"

# Copy real source and build all workspace members
COPY engines/ .
RUN echo "══════════════════════════════════════════════════════════" && \
    echo "  [4/5] BUILD · Compiling all engine binaries"             && \
    echo "        bidding · fraud · trust · imaging"                  && \
    echo "══════════════════════════════════════════════════════════"
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/engines/target \
    START=$(date +%s) && \
    cargo build --release --workspace 2>&1 && \
    ELAPSED=$(( $(date +%s) - START )) && \
    echo "" && \
    echo "  [4/5] ✔ Workspace compiled in ${ELAPSED}s" && \
    echo "        Copying binaries out of cache mount..." && \
    for BIN in nomarkup-bidding-engine nomarkup-fraud-engine nomarkup-trust-engine nomarkup-imaging-engine; do \
        SIZE=$(du -h /app/engines/target/release/$BIN | awk '{print $1}') && \
        cp /app/engines/target/release/$BIN /usr/local/bin/ && \
        echo "        · $BIN ($SIZE)"; \
    done && \
    echo "  [4/5] ✔ All binaries staged"

# ── Runtime targets (one per engine) ──────────────────────────
FROM debian:bookworm-slim AS runtime-base
RUN echo "══════════════════════════════════════════════════════════" && \
    echo "  [5/5] RUNTIME · Preparing minimal runtime image"        && \
    echo "══════════════════════════════════════════════════════════"
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

FROM runtime-base AS bidding
COPY --from=builder /usr/local/bin/nomarkup-bidding-engine /usr/local/bin/server
RUN echo "  ✔ bidding-engine ready · $(du -h /usr/local/bin/server | awk '{print $1}')"
EXPOSE 50053
ENTRYPOINT ["server"]

FROM runtime-base AS fraud
COPY --from=builder /usr/local/bin/nomarkup-fraud-engine /usr/local/bin/server
RUN echo "  ✔ fraud-engine ready · $(du -h /usr/local/bin/server | awk '{print $1}')"
EXPOSE 50056
ENTRYPOINT ["server"]

FROM runtime-base AS trust
COPY --from=builder /usr/local/bin/nomarkup-trust-engine /usr/local/bin/server
RUN echo "  ✔ trust-engine ready · $(du -h /usr/local/bin/server | awk '{print $1}')"
EXPOSE 50057
ENTRYPOINT ["server"]

FROM runtime-base AS imaging
COPY --from=builder /usr/local/bin/nomarkup-imaging-engine /usr/local/bin/server
RUN echo "  ✔ imaging-engine ready · $(du -h /usr/local/bin/server | awk '{print $1}')"
EXPOSE 50058
ENTRYPOINT ["server"]
