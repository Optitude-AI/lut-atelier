#!/bin/bash
cd /home/z/my-project/.next/standalone
while true; do
    node server.js -p 3000 2>>/home/z/my-project/dev.log
    echo "[$(date)] Standalone server exited, restarting..." >> /home/z/my-project/watchdog.log
    sleep 0.5
done
