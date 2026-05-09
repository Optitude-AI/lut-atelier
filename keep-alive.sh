#!/bin/bash
cd /home/z/my-project
while true; do
    if ! command -v ss >/dev/null 2>&1 || ! ss -tlnp 2>/dev/null | grep -q ':3000 '; then
        npx next dev --port 3000 >> /home/z/my-project/dev.log 2>&1
    fi
    sleep 1
done
