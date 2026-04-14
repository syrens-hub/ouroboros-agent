# Ouroboros Agent — Production Dockerfile
# ========================================

FROM node:20-slim AS base

# Install build tools for native dependencies (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY web/package*.json ./web/

# Install dependencies
RUN npm ci
RUN cd web && npm ci

# Copy source
COPY . .

# Build web UI
RUN cd web && npm run build

# Create non-root user and ensure ownership of app dir
RUN groupadd -r ouroboros && useradd -r -g ouroboros -m -d /home/ouroboros ouroboros \
  && chown -R ouroboros:ouroboros /app

# Expose web port
EXPOSE 8080

USER ouroboros

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["npm", "run", "web:start"]
