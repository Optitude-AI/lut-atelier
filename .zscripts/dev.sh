#!/bin/bash
cd /home/z/my-project

# Install dependencies
echo "[DEV] Installing dependencies..."
bun install

# Setup database
echo "[DEV] Setting up database..."
bun run db:push 2>/dev/null || true

# Build for production (faster startup, less memory)
echo "[DEV] Building for production..."
bun run build 2>/dev/null || true

# Start the standalone server in the foreground
# This keeps the subshell alive!
echo "[DEV] Starting production server on port 3000..."
cd /home/z/my-project/.next/standalone
exec node server.js -p 3000
