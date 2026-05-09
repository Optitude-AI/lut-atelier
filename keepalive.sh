#!/bin/bash
while true; do
  echo "Starting dev server at $(date)" >> /home/z/my-project/dev.log
  bun run dev >> /home/z/my-project/dev.log 2>&1
  echo "Dev server died at $(date), restarting in 2s..." >> /home/z/my-project/dev.log
  sleep 2
done
