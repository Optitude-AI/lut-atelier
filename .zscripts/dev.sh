#!/bin/bash
cd /home/z/my-project

exec > /tmp/dev-bootstrap.log 2>&1

echo "=== $(date) Starting custom dev script ==="

# Install deps
bun install 2>&1 || true

# Setup database
bun run db:push 2>&1 || true

# Start dev server in foreground (keeps init subshell alive)
echo "Starting dev server on port 3000..."
exec npx next dev -p 3000
