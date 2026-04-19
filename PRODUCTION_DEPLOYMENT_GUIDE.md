# AI-Tutor Production Deployment Guide

**Status**: ✅ Production-Ready  
**Date**: April 13, 2026  
**Backend Tests**: 113/113 Passing  
**New Features**: Promo Code System + Admin Console

---

## 1. Pre-Deployment Checklist

### Backend
- ✅ All 113 tests passing (`cargo test -p ai_tutor_api --lib`)
- ✅ Promo code system implemented and integrated
- ✅ Admin console API endpoints added
- ✅ RBAC enforcement on admin routes
- ✅ Code compiles cleanly

### Frontend
- ✅ Promo code redemption UI on `/billing` page
- ✅ Admin console dashboard at `/admin` route
- ✅ TypeScript types defined for all API responses
- ✅ Bearer token management with localStorage persistence
- ✅ Responsive design (mobile-friendly)

---

## 2. Quick Start: Seeding Admin & Test Data

### Create Admin Account
Before deploying, ensure this account is created and granted Admin role:
```
Email: faizalbashafaizalbasha07@gmail.com
Role: Admin
```

### Create Test Promo Code (File Storage)
Create file: `{ROOT}/promo-codes/FREEBYUCS.json`
```json
{
  "code": "FREEBYUCS",
  "grant_credits": 3.0,
  "max_redemptions": 1000,
  "redeemed_by_accounts": [],
  "expires_at": "2026-12-31T23:59:59Z",
  "created_at": "2026-04-13T00:00:00Z",
  "updated_at": "2026-04-13T00:00:00Z"
}
```

### Create Additional Promo Codes
```json
{
  "code": "SPRING2026",
  "grant_credits": 5.0,
  "max_redemptions": 500,
  "redeemed_by_accounts": [],
  "expires_at": "2026-06-30T23:59:59Z",
  "created_at": "2026-04-13T00:00:00Z",
  "updated_at": "2026-04-13T00:00:00Z"
}
```

---

## 3. API Endpoints Summary

### Promo Code Redemption
**POST** `/api/credits/redeem`
- **Role Required**: Writer (authenticated users)
- **Request**: `{ "code": "FREEBYUCS" }`
- **Response**: 
  ```json
  {
    "success": true,
    "message": "Successfully redeemed! You received 3 credits.",
    "credits_granted": 3.0
  }
  ```

### Admin Metrics (All require Admin role)
- **GET** `/api/admin/stats/users` → User activity metrics
- **GET** `/api/admin/stats/subscriptions` → Subscription & churn stats
- **GET** `/api/admin/stats/payments` → Payment success rate & revenue
- **GET** `/api/admin/stats/promo-codes` → Redemption tracking & credits granted

---

## 4. Frontend Routes

### Customer Features
- **Billing Page**: `/billing`
  - View catalog, payment history, active subscription
  - **NEW**: Redeem promo codes (e.g., "FREEBYUCS" → +3 credits)

### Admin Features  
- **Admin Console**: `/admin`
  - Requires Admin role authentication
  - View user metrics (DAU, WAU, MAU)
  - Monitor subscriptions (active, churn, revenue)
  - Track payments (success rate, transaction value)
  - Analyze promo code redemptions

---

## 5. Security Configuration

### Authentication
- Bearer token required for all protected endpoints
- RBAC enforced at middleware layer
- Admin endpoints gated to `ApiRole::Admin` only

### Anti-Abuse Measures
- One promo code per account (enforced)
- Max redemptions cap per code (configurable)
- Expiry date validation
- Credit ledger audit trail

### Future Enhancements (Optional)
- Rate limiting: 1 redemption attempt per 10 seconds per account
- MFA for admin console access
- IP allowlist for admin endpoints
- Full audit log API endpoint

---

## 6. Postgres Migration (Optional)

For production with high scale, migrate from FileStorage to Postgres:

```sql
-- Promo codes table
CREATE TABLE promo_codes (
  code TEXT PRIMARY KEY,
  grant_credits DECIMAL(10,2) NOT NULL,
  max_redemptions INT,
  redeemed_by_accounts TEXT[] DEFAULT ARRAY[]::TEXT[],
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- Index for faster lookups
CREATE INDEX idx_promo_codes_expiry ON promo_codes(expires_at);
```

---

## 7. Testing & Verification

### Smoke Tests
1. **User Signup**:
   ```bash
   curl -X POST /api/auth/google/login
   # → Returns authorization URL
   ```

2. **Redeem Promo Code**:
   ```bash
   curl -X POST /api/credits/redeem \
     -H "Authorization: Bearer {token}" \
     -H "Content-Type: application/json" \
     -d '{"code": "FREEBYUCS"}'
   # → Returns success message with credits granted
   ```

3. **View Admin Metrics**:
   ```bash
   curl -X GET /api/admin/stats/users \
     -H "Authorization: Bearer {admin_token}"
   # → Returns user activity metrics
   ```

### Run Full Test Suite
```bash
cd AI-Tutor-Backend
cargo test -p ai_tutor_api --lib
# Expected: 113 passed; 0 failed
```

---

## 8. Deployment Steps

### Backend
```bash
cd AI-Tutor-Backend
cargo build --release
# Deploy binary and configuration files
# Set environment variables (if using external Postgres):
#   - DATABASE_URL=postgres://...
#   - REDIS_URL=redis://...
```

### Frontend
```bash
cd AI-Tutor-Frontend/apps/web
pnpm build
# Deploy dist/ files to CDN or web server
```

### Seed Data
1. Create admin account in auth system
2. Create promo code files (or insert to Postgres)
3. Set up billing catalog (configured in code)

---

## 9. Monitoring & Operations

### Key Metrics to Track
- **User Growth**: DAU, WAU, MAU from `/api/admin/stats/users`
- **Revenue**: Monthly revenue from `/api/admin/stats/subscriptions`
- **Payment Health**: Success rate from `/api/admin/stats/payments`
- **Promo Effectiveness**: Redemption rate from `/api/admin/stats/promo-codes`

### Common Operations
- **Add new promo code**: Create JSON file or insert to Postgres
- **Disable promo code**: Set `expires_at` to current time
- **Check redemptions**: View `redeemed_by_accounts` list

---

## 10. Support & Troubleshooting

### Issue: "Promo code not found"
- Check file exists: `promo-codes/{code}.json`
- Verify code is exact match (case-sensitive)
- Confirm file format matches schema

### Issue: "You have already redeemed this code"
- This is expected behavior (anti-abuse)
- One redemption per account per code
- Different accounts can redeem the same code

### Issue: "Unauthorized - Admin role required"
- Verify token has `ApiRole::Admin`
- Check token hasn't expired
- Ensure account is in admin allowlist

---

## 11. Glossary

- **Promo Code**: One-time credit grant with redemption limits and expiry
- **Admin Console**: Metrics dashboard for monitoring system health
- **RBAC**: Role-Based Access Control (Reader/Writer/Admin)
- **Credit Ledger**: Immutable log of all credit transactions
- **Bearer Token**: OAuth token used for API authentication

---

## Conclusion

The AI-Tutor is ready for production deployment. All core features are implemented, tested extensively (113 tests), and secured with enterprise-grade RBAC and anti-abuse measures.

**Ready to deploy!** 🚀
