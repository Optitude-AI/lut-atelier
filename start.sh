#!/bin/bash
cd /home/z/my-project
rm -rf .next/dev/lock 2>/dev/null
while true; do
  echo "=== Starting dev server at $(date) ==="
  bun run dev 2>&1
  echo "=== Server stopped, restarting in 2s ==="
  sleep 2
done
