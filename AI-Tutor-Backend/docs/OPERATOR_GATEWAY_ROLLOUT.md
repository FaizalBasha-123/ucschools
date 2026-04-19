# Operator Gateway And OTP Rollout Plan

## Topology

1. Nginx edge layer
2. Pingora gateway layer
3. AI-Tutor API layer
4. Redis temporary state
5. Neon durable state

## Redis Temporary State Map

- ops:otp:challenge:{email_hash}
- ops:otp:rate:{email_hash}
- ops:session:{session_id}
- webhook:seen:{event_id}
- ops:stats:overview (short TTL cache)

## Phase 1

- Ship SMTP AUTH mail transport
- Ship operator OTP challenge and verify endpoints
- Ship Redis-backed operator session cookie validation in auth middleware
- Keep bearer token fallback for break-glass operations

## Phase 2

- Put Nginx in front of API and gateway
- Route operator traffic through Pingora
- Add route-level rate limits and request size controls

## Phase 3

- Add full gateway audit logs
- Add risk alerts for OTP abuse and repeated admin failures
- Add UAT matrix and load tests

## Rollback

- Disable AI_TUTOR_OPERATOR_OTP_ENABLED
- Use bearer token auth only
- Keep Redis entries expiring naturally
