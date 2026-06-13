#!/bin/bash

# Source environment variables if .env exists
if [ -f ../.env ]; then
  source ../.env
fi

# AI_TUTOR_NEON_DATABASE_URL should be available now
if [ -z "$AI_TUTOR_NEON_DATABASE_URL" ]; then
  echo "Error: AI_TUTOR_NEON_DATABASE_URL is not set in .env"
  exit 1
fi

echo "Applying initial schema..."
psql "$AI_TUTOR_NEON_DATABASE_URL" -f ../migrations/20260613000000_initial.sql

echo "Applying queue schema..."
psql "$AI_TUTOR_NEON_DATABASE_URL" -f ../migrations/20260613000001_queue.sql

echo "Migrations completed successfully!"
