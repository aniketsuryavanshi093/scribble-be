# ─────────────────────────────────────────────
# Single-image build: Node 20 (Debian) + Redis
# Steps: npm i → build TypeScript → start Redis → npm start
# Render-compatible: listens on $PORT (injected by Render at runtime)
# ─────────────────────────────────────────────
FROM node:20-bullseye-slim

# ── Install Redis from the Debian repo ────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends redis-server && \
    rm -rf /var/lib/apt/lists/*

# ── App working directory ─────────────────────
WORKDIR /app

# ── Copy dependency manifests first (layer cache) ──
COPY package.json package-lock.json* pnpm-lock.yaml* ./

# ── Install all dependencies (including devDeps needed for build) ──
RUN npm install

# ── Copy the rest of the source ───────────────
COPY . .

# ── Build TypeScript at image-build time so the startup is fast ──
RUN npm run build

# ── Copy and make the entrypoint script executable ──
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# ── Render injects $PORT at runtime; expose a default for local use ──
EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
