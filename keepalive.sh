#!/bin/bash
cd /home/z/my-project
while true; do
  if ! ss -tlnp | grep -q ':3000'; then
    echo "$(date): Port 3000 not listening, starting server..."
    rm -rf .next/dev/lock
    bun run dev &
  fi
  sleep 3
done
