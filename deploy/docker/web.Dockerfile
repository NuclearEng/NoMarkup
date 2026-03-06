# syntax=docker/dockerfile:1
# Multi-stage build for the Next.js frontend.
# Build context must be the repository root.

FROM node:22-alpine AS deps
WORKDIR /app
RUN echo "══════════════════════════════════════════════════════════" && \
    echo "  WEB · Build started"                                     && \
    echo "  Node $(node --version) · npm $(npm --version)"           && \
    echo "══════════════════════════════════════════════════════════"
COPY web/package.json web/package-lock.json ./
RUN echo "  [1/3] DEPS · Installing npm packages..." && \
    START=$(date +%s) && \
    npm ci 2>&1 && \
    ELAPSED=$(( $(date +%s) - START )) && \
    COUNT=$(ls node_modules | wc -l | tr -d ' ') && \
    echo "  [1/3] ✔ ${COUNT} packages installed in ${ELAPSED}s"

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY web/ .
RUN echo "  [2/3] BUILD · Running Next.js production build..." && \
    START=$(date +%s) && \
    npm run build 2>&1 && \
    ELAPSED=$(( $(date +%s) - START )) && \
    echo "  [2/3] ✔ Next.js built in ${ELAPSED}s" && \
    echo "        standalone: $(du -sh .next/standalone | awk '{print $1}')" && \
    echo "        static:     $(du -sh .next/static | awk '{print $1}')"

# ── Runtime ──────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
RUN echo "  [3/3] ✔ web image ready · $(du -sh /app | awk '{print $1}')"
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
