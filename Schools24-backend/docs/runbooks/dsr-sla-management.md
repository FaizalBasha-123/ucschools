# DSR SLA Management Runbook

## SLA Requirements (DPDPA)
| Request Type | Max Response Time | Max Completion Time |
|-------------|------------------|-------------------|
| Access | 72 hours | 30 days |
| Rectification | 72 hours | 30 days |
| Erasure | 72 hours | 30 days |
| Portability | 72 hours | 30 days |
| Objection | 72 hours | 15 days |

## Monitoring SLA Breaches

### Find overdue DSRs
```sql
SELECT id, requester_name, request_type, status, submitted_at,
       EXTRACT(EPOCH FROM (NOW() - submitted_at)) / 3600 AS hours_since_submission
FROM data_subject_requests
WHERE status NOT IN ('completed', 'cancelled', 'rejected')
  AND submitted_at < NOW() - INTERVAL '72 hours'
ORDER BY submitted_at ASC;
```

### Daily SLA Report
```bash
curl "$API_URL/api/v1/admin/dsr?status=submitted&limit=100"
```

## State Machine

```
submitted → under_review → approved → completed
                        → rejected
submitted → cancelled
```

### Valid Transitions
| From | To | Who |
|------|----|-----|
| submitted | under_review | Admin |
| submitted | cancelled | Admin |
| under_review | approved | Admin |
| under_review | rejected | Admin |
| approved | completed | Admin |

## Escalation

| SLA Breach | Action |
|-----------|--------|
| > 72h no review | Auto-assign to school admin lead |
| > 7 days pending | Escalate to super admin |
| > 25 days incomplete | Critical alert — legal risk |

## Emergency: Bulk Status Update
```sql
-- Move all stale "submitted" DSRs to "under_review"
UPDATE data_subject_requests
SET status = 'under_review', updated_at = NOW()
WHERE status = 'submitted'
  AND submitted_at < NOW() - INTERVAL '72 hours';
```
