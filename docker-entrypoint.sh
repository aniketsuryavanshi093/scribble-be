#!/bin/sh
set -e

# ── Start Redis in the background ─────────────────────────────────────
echo "[entrypoint] Starting Redis..."
redis-server --daemonize yes --loglevel warning

# ── Wait until Redis is accepting connections ──────────────────────────
echo "[entrypoint] Waiting for Redis to be ready..."
until redis-cli ping 2>/dev/null | grep -q PONG; do
  sleep 0.2
done
echo "[entrypoint] Redis is ready."

# ── Render injects PORT; fall back to 3001 for local/docker-compose ───
export PORT="${PORT:-3001}"

echo "[entrypoint] Starting app on port $PORT..."
exec node build/server.js
