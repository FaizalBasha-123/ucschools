#!/usr/bin/env bash
set -euo pipefail

echo "uc-school workspace"
echo "backend:   Schools24-backend"
echo "frontend:  Schools24-frontend"
echo "landing:   schools24-landing"
echo "mobile:    client/android-mobile"
echo "ai tutor:  AI-Tutor-Backend + AI-Tutor-Frontend"

echo
echo "Recommended verification commands:"
echo "  cd Schools24-backend && go test ./..."
echo "  cd Schools24-frontend && npm run build"
echo "  cd schools24-landing && npm run build"
echo "  cd AI-Tutor-Backend && cargo check"
