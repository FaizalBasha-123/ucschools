# Consent Withdrawal Incidents Runbook

## Overview
Consent withdrawal is a legally sensitive operation (DPDPA). Failures must be resolved within SLA.

## API Endpoints
| Action | Method | Endpoint |
|--------|--------|----------|
| List consent history | GET | `/admin/consent/history?status=all` |
| Withdraw consent | POST | `/admin/consent/:id/withdraw` |
| View audit trail | GET | `/admin/consent/audit` |

## Incident: Withdrawal Request Failed

### Diagnosis
1. Check audit events for the consent ID:
```bash
curl "$API_URL/api/v1/admin/consent/audit?limit=20"
```

2. Check consent record status:
```sql
SELECT id, status, withdrawn_at, withdrawal_reason
FROM parental_consents
WHERE id = '<consent_id>';
```

### Common Failures

| Error | Cause | Fix |
|-------|-------|-----|
| "consent already withdrawn" | Duplicate request | No action needed — idempotent |
| "consent not found" | Invalid ID or wrong school scope | Verify consent ID and school_id |
| "internal server error" | DB connection issue | Check PostgreSQL connectivity |

### Manual Withdrawal (Emergency)
Only if API is unavailable:
```sql
UPDATE parental_consents
SET status = 'withdrawn',
    withdrawn_at = NOW(),
    withdrawn_by = 'ops_team',
    withdrawal_reason = 'Emergency manual withdrawal - ticket #XXXX',
    withdrawal_method = 'other'
WHERE id = '<consent_id>' AND status = 'active';

-- MUST also create audit event
INSERT INTO consent_audit_events (id, school_id, consent_id, event_type, actor_id, actor_role, metadata, created_at)
VALUES (gen_random_uuid(), '<school_id>', '<consent_id>', 'consent_withdrawn', 'ops_team', 'system',
        '{"method": "manual_sql", "ticket": "XXXX"}'::jsonb, NOW());
```

## Post-Incident
- [ ] Confirm audit event was created
- [ ] Notify guardian of successful withdrawal
- [ ] File incident report if SLA was breached
