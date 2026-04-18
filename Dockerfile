# Ouroboros Agent — Production Dockerfile
# ========================================

FROM node:20-slim AS base

# Install build tools for native dependencies (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user early so npm installs files with correct ownership
RUN groupadd -r ouroboros && useradd -r -g ouroboros -m -d /home/ouroboros ouroboros

WORKDIR /app
RUN chown -R ouroboros:ouroboros /app

# Copy package files and install dependencies as non-root user
COPY --chown=ouroboros:ouroboros package*.json ./
COPY --chown=ouroboros:ouroboros web/package*.json ./web/

USER ouroboros
RUN npm ci
RUN cd web && npm ci

# Copy source and build web UI
COPY --chown=ouroboros:ouroboros . .
RUN cd web && npm run build

# Expose web port
EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["npm", "run", "web:start"]
