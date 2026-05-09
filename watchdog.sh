#!/bin/bash
cd /home/z/my-project

while true; do
    # Check if port 3000 is listening
    if ! ss -tlnp 2>/dev/null | grep -q ':3000 '; then
        echo "[$(date '+%H:%M:%S')] Server down, restarting..." >> watchdog.log
        # Kill any stale processes
        pkill -f "next dev" 2>/dev/null
        pkill -f "next-server" 2>/dev/null
        sleep 1
        
        # Start fresh
        npx next dev --port 3000 >> dev.log 2>&1 &
        SPID=$!
        echo "[$(date '+%H:%M:%S')] Started PID $SPID" >> watchdog.log
        
        # Wait for port to be available
        for i in $(seq 1 30); do
            if ss -tlnp 2>/dev/null | grep -q ':3000 '; then
                # Pre-warm: make a request to trigger compilation
                sleep 2
                curl -s -o /dev/null http://localhost:3000/ 2>/dev/null
                echo "[$(date '+%H:%M:%S')] Server ready and pre-warmed" >> watchdog.log
                break
            fi
            sleep 1
        fi
    fi
    sleep 1
done
