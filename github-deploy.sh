#!/bin/bash
set -e
cd /app/trivio
git fetch origin main
git reset --hard origin/main
docker compose -f docker-compose.prod.yml --env-file .env.prod build app
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps --force-recreate app
echo 'Trivio deploy complete'
