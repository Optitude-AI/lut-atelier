#!/bin/bash
while true; do
  bun run dev 2>&1
  echo "[$(date)] Server died, restarting in 1s..." 
  sleep 1
done
