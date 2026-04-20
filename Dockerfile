# Ouroboros Agent — Multi-Stage Production Dockerfile
# ====================================================

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM node:20-slim AS builder

# Install build tools for native dependencies (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies)
COPY package*.json ./
COPY web/package*.json ./web/
RUN npm ci
RUN cd web && npm ci

# Copy source and build web UI + compile native modules
COPY . .
RUN cd web && npm run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:20-slim AS production

# Install minimal runtime dependencies for native modules
RUN apt-get update && apt-get install -y \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r ouroboros && useradd -r -g ouroboros -m -d /home/ouroboros ouroboros

WORKDIR /app
RUN chown -R ouroboros:ouroboros /app

# Copy package files
COPY --chown=ouroboros:ouroboros package*.json ./
COPY --chown=ouroboros:ouroboros web/package*.json ./web/

# Install production dependencies only
USER ouroboros
RUN npm ci --omit=dev && cd web && npm ci --omit=dev

# Copy built artifacts from builder stage
COPY --chown=ouroboros:ouroboros --from=builder /app/web/dist ./web/dist
COPY --chown=ouroboros:ouroboros --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --chown=ouroboros:ouroboros . .

# Precompile better-sqlite3 check
RUN node -e "require('better-sqlite3')" || exit 1

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["npm", "run", "web:start"]
