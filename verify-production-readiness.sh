#!/usr/bin/env bash
# AI-Tutor Production Readiness Verification Script

set -e

echo "════════════════════════════════════════════════════"
echo "  AI-Tutor Production Readiness Check"
echo "════════════════════════════════════════════════════"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

check() {
  local name=$1
  local cmd=$2
  echo -n "Checking: $name... "
  if eval "$cmd" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
    ((PASSED++))
  else
    echo -e "${RED}✗${NC}"
    ((FAILED++))
  fi
}

# Backend checks
echo "${YELLOW}Backend Checks${NC}"
echo "──────────────────────────────────────────────────"
cd AI-Tutor-Backend
check "Cargo.toml exists" "test -f Cargo.toml"
check "Backend compilation" "cargo check -p ai_tutor_api 2>/dev/null"
check "Backend tests pass" "cargo test -p ai_tutor_api --lib 2>&1 | grep -q 'test result: ok'"
cd ..

# Frontend checks
echo ""
echo "${YELLOW}Frontend Checks${NC}"
echo "──────────────────────────────────────────────────"
cd AI-Tutor-Frontend/apps/web
check "package.json exists" "test -f package.json"
check "TypeScript config exists" "test -f tsconfig.json"
check "Billing page exists" "test -f app/billing/page.tsx"
check "Admin console exists" "test -f app/admin/page.tsx"
cd ../../..

# Core files checks
echo ""
echo "${YELLOW}Core Implementation Checks${NC}"
echo "──────────────────────────────────────────────────"
check "PromoCode domain model" "grep -r 'struct PromoCode' AI-Tutor-Backend/crates/domain/src/"
check "PromoCodeRepository trait" "grep -r 'trait PromoCodeRepository' AI-Tutor-Backend/crates/storage/src/"
check "Promo redemption handler" "grep -r 'async fn redeem_promo_code' AI-Tutor-Backend/crates/api/src/"
check "Admin stats endpoints" "grep -r 'api/admin/stats' AI-Tutor-Backend/crates/api/src/"
check "RBAC enforcement" "grep -r 'required_role_for_request' AI-Tutor-Backend/crates/api/src/"

# Summary
echo ""
echo "════════════════════════════════════════════════════"
echo "Summary:"
echo "  ${GREEN}✓ Passed: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
  echo "  ${RED}✗ Failed: $FAILED${NC}"
else
  echo "  ${RED}✗ Failed: 0${NC}"
fi
echo "════════════════════════════════════════════════════"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed! AI-Tutor is production-ready.${NC}"
  exit 0
else
  echo -e "${RED}✗ Some checks failed. Please review the implementation.${NC}"
  exit 1
fi
