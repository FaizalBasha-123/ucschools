# Database Schema Reference

## Schema Overview

All 21 PostgreSQL migrations live in `crates/storage/src/filesystem.rs` (`POSTGRES_MIGRATIONS` array, starting ~line 144).

### PostgreSQL Tables (21 migrations applied, 23 tables)

| # | Table | Purpose | Created In |
|---|-------|---------|------------|
| 1 | `schema_migrations` | Migration tracking | Code (line 926) |
| 2 | `tutor_accounts` | User accounts | v1 |
| 3 | `credit_ledger` | Credit transaction journal | v1 (+v20 type change) |
| 4 | `credit_balances` | Current credit balances | v1 (+v20 type change) |
| 5 | `payment_orders` | Payment transactions | v1 (+v20 type change) |
| 6 | `subscriptions` | Recurring billing | v3 |
| 7 | `invoices` | Billing invoices | v4 |
| 8 | `invoice_lines` | Invoice line items | v4 |
| 9 | `payment_intents` | Payment attempt tracking | v5 |
| 10 | `dunning_cases` | Failed payment collections | v5 |
| 11 | `webhook_events` | Gateway webhooks | v6 |
| 12 | `financial_audit_logs` | Financial audit trail | v6 |
| 13 | `schools` | Enterprise tenant schools | v7 (+v15 rename) |
| 14 | `school_invoices` | School-level invoices | v8 |
| 15 | `lessons` | AI-generated lessons | v9 (+v11 tenant cols) |
| 16 | `lesson_jobs` | Lesson generation jobs | v9 (+v11, v12) |
| 17 | `lesson_adaptive_states` | Adaptive learning state | v9 |
| 18 | `runtime_sessions` | Interactive session state | v9 (+v11 tenant cols) |
| 19 | `runtime_action_executions` | Session action logs | v9 |
| 20 | `lesson_shelf_items` | Student lesson shelf | v10 |
| 21 | `api_usage_records` | LLM API usage tracking | v10 (+v17, v21) |
| 22 | `refresh_tokens` | JWT refresh tokens | v13 |
| 23 | `operator_emails` | Operator email whitelist | v16 |

---

## Complete Column Reference

### `schema_migrations`

| Column | Type | Constraints |
|--------|------|-------------|
| `version` | `BIGINT` | `PRIMARY KEY` |
| `name` | `TEXT` | `NOT NULL` |
| `applied_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` |

---

### `tutor_accounts`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `email` | `TEXT` | `NOT NULL` |
| `google_id` | `TEXT` | `NOT NULL UNIQUE` |
| `phone_number` | `TEXT` | `UNIQUE` |
| `phone_verified` | `BOOLEAN` | `NOT NULL` |
| `status` | `TEXT` | `NOT NULL` |
| `school_id` | `TEXT` | `REFERENCES schools(id) ON DELETE SET NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_tutor_accounts_email_lower` — `UNIQUE` on `LOWER(email)`
- `idx_tutor_accounts_school_id` on `(school_id)`

---

### `credit_ledger`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | `NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE` |
| `kind` | `TEXT` | `NOT NULL` |
| `amount` | **`NUMERIC(12,2)`** | `NOT NULL` |
| `reason` | `TEXT` | `NOT NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_credit_ledger_account_created_at` on `(account_id, created_at DESC)`

**Type history:** Originally `DOUBLE PRECISION`. Changed to `NUMERIC(12,2)` in migration v20 for exact decimal arithmetic.

---

### `credit_balances`

| Column | Type | Constraints |
|--------|------|-------------|
| `account_id` | `TEXT` | `PRIMARY KEY REFERENCES tutor_accounts(id) ON DELETE CASCADE` |
| `balance` | **`NUMERIC(12,2)`** | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Type history:** Originally `DOUBLE PRECISION`. Changed to `NUMERIC(12,2)` in migration v20 for exact decimal arithmetic.

---

### `payment_orders`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | `NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE` |
| `product_code` | `TEXT` | `NOT NULL` |
| `product_kind` | `TEXT` | `NOT NULL` |
| `gateway` | `TEXT` | `NOT NULL` |
| `gateway_txn_id` | `TEXT` | `NOT NULL UNIQUE` |
| `gateway_payment_id` | `TEXT` | |
| `amount_minor` | `BIGINT` | `NOT NULL` |
| `currency` | `TEXT` | `NOT NULL` |
| `credits_to_grant` | **`NUMERIC(12,2)`** | `NOT NULL` |
| `status` | `TEXT` | `NOT NULL` |
| `checkout_url` | `TEXT` | |
| `udf1`..`udf5` | `TEXT` | |
| `raw_response` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `completed_at` | `TIMESTAMPTZ` | |

**Indexes:**
- `idx_payment_orders_account_created_at` on `(account_id, created_at DESC)`
- `idx_payment_orders_status_created_at` on `(status, created_at DESC)`

---

### `subscriptions`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | `NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE` |
| `plan_code` | `TEXT` | `NOT NULL` |
| `gateway` | `TEXT` | `NOT NULL` |
| `gateway_subscription_id` | `TEXT` | `UNIQUE` |
| `status` | `TEXT` | `NOT NULL` |
| `billing_interval` | `TEXT` | `NOT NULL` |
| `credits_per_cycle` | `DOUBLE PRECISION` | `NOT NULL` |
| `autopay_enabled` | `BOOLEAN` | `NOT NULL` |
| `current_period_start` | `TIMESTAMPTZ` | `NOT NULL` |
| `current_period_end` | `TIMESTAMPTZ` | `NOT NULL` |
| `next_renewal_at` | `TIMESTAMPTZ` | |
| `grace_period_until` | `TIMESTAMPTZ` | |
| `cancelled_at` | `TIMESTAMPTZ` | |
| `last_payment_order_id` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_subscriptions_account_updated_at` on `(account_id, updated_at DESC)`
- `idx_subscriptions_renewal_due` on `(next_renewal_at ASC)`
- `idx_subscriptions_status_updated_at` on `(status, updated_at DESC)`

---

### `invoices`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | `NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE` |
| `invoice_type` | `TEXT` | `NOT NULL` |
| `billing_cycle_start` | `TIMESTAMPTZ` | `NOT NULL` |
| `billing_cycle_end` | `TIMESTAMPTZ` | `NOT NULL` |
| `status` | `TEXT` | `NOT NULL` |
| `amount_cents` | `BIGINT` | `NOT NULL` |
| `amount_after_credits` | `BIGINT` | `NOT NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `finalized_at` | `TIMESTAMPTZ` | |
| `paid_at` | `TIMESTAMPTZ` | |
| `due_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_invoices_account_id` on `(account_id)`
- `idx_invoices_status` on `(status)`
- `idx_invoices_account_created` on `(account_id, created_at DESC)`

---

### `invoice_lines`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `invoice_id` | `TEXT` | `NOT NULL REFERENCES invoices(id) ON DELETE CASCADE` |
| `line_type` | `TEXT` | `NOT NULL` |
| `description` | `TEXT` | `NOT NULL` |
| `amount_cents` | `BIGINT` | `NOT NULL` |
| `quantity` | `INTEGER` | `NOT NULL` |
| `unit_price_cents` | `BIGINT` | `NOT NULL` |
| `is_prorated` | `BOOLEAN` | `NOT NULL` |
| `period_start` | `TIMESTAMPTZ` | `NOT NULL` |
| `period_end` | `TIMESTAMPTZ` | `NOT NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_invoice_lines_invoice_id` on `(invoice_id)`
- `idx_invoice_lines_type` on `(line_type)`

---

### `payment_intents`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | `NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE` |
| `invoice_id` | `TEXT` | `NOT NULL REFERENCES invoices(id) ON DELETE CASCADE` |
| `status` | `TEXT` | `NOT NULL` |
| `amount_cents` | `BIGINT` | `NOT NULL` |
| `idempotency_key` | `TEXT` | `NOT NULL UNIQUE` |
| `payment_method_id` | `TEXT` | |
| `gateway_payment_intent_id` | `TEXT` | |
| `authorize_error` | `TEXT` | |
| `authorized_at` | `TIMESTAMPTZ` | |
| `captured_at` | `TIMESTAMPTZ` | |
| `canceled_at` | `TIMESTAMPTZ` | |
| `attempt_count` | `INTEGER` | `NOT NULL` |
| `next_retry_at` | `TIMESTAMPTZ` | |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_payment_intents_invoice_id` on `(invoice_id)`
- `idx_payment_intents_retry` on `(status, next_retry_at ASC)`

---

### `dunning_cases`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | `NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE` |
| `invoice_id` | `TEXT` | `NOT NULL REFERENCES invoices(id) ON DELETE CASCADE` |
| `payment_intent_id` | `TEXT` | `NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE` |
| `status` | `TEXT` | `NOT NULL` |
| `attempt_schedule_json` | `TEXT` | `NOT NULL` |
| `grace_period_end` | `TIMESTAMPTZ` | `NOT NULL` |
| `final_attempt_at` | `TIMESTAMPTZ` | |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_dunning_cases_invoice_id` on `(invoice_id)`
- `idx_dunning_cases_status` on `(status)`

---

### `webhook_events`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `event_identifier` | `TEXT` | `NOT NULL UNIQUE` |
| `event_type` | `TEXT` | `NOT NULL` |
| `payload_json` | `TEXT` | `NOT NULL` |
| `processed_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Index:**
- `idx_webhook_events_processed_at` on `(processed_at DESC)`

---

### `financial_audit_logs`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | `NOT NULL` |
| `event_type` | `TEXT` | `NOT NULL` |
| `entity_type` | `TEXT` | `NOT NULL` |
| `entity_id` | `TEXT` | `NOT NULL` |
| `actor` | `TEXT` | |
| `before_state_json` | `TEXT` | `NOT NULL` |
| `after_state_json` | `TEXT` | `NOT NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Index:**
- `idx_financial_audit_logs_account_created` on `(account_id, created_at DESC)`

---

### `schools`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `name` | `TEXT` | `NOT NULL` |
| `operator_email` | `TEXT` | `NOT NULL` |
| `institution_type` | `TEXT` | `NOT NULL DEFAULT 'school'` |
| `description` | `TEXT` | |
| `plan` | `TEXT` | `NOT NULL DEFAULT 'free'` |
| `credit_pool` | `DOUBLE PRECISION` | `NOT NULL DEFAULT 0.0` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

---

### `school_invoices`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `school_id` | `TEXT` | `NOT NULL REFERENCES schools(id) ON DELETE CASCADE` |
| `amount_cents` | `BIGINT` | `NOT NULL` |
| `payment_link` | `TEXT` | |
| `status` | `TEXT` | `NOT NULL` |
| `due_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `paid_at` | `TIMESTAMPTZ` | |

---

### `lessons`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `title` | `TEXT` | `NOT NULL` |
| `language` | `TEXT` | `NOT NULL` |
| `description` | `TEXT` | |
| `data_json` | `TEXT` | `NOT NULL` |
| `account_id` | `TEXT` | |
| `school_id` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_lessons_created_at` on `(created_at DESC)`
- `idx_lessons_account_id` on `(account_id)`
- `idx_lessons_school_id` on `(school_id)`

---

### `lesson_jobs`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `status` | `TEXT` | `NOT NULL` |
| `step` | `TEXT` | `NOT NULL` |
| `progress` | `INTEGER` | `NOT NULL` |
| `message` | `TEXT` | `NOT NULL` |
| `error` | `TEXT` | |
| `result_json` | `TEXT` | |
| `input_summary_json` | `TEXT` | |
| `lesson_id` | `TEXT` | |
| `account_id` | `TEXT` | |
| `school_id` | `TEXT` | |
| `scenes_generated` | `INTEGER` | `NOT NULL DEFAULT 0` |
| `total_scenes` | `INTEGER` | |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `started_at` | `TIMESTAMPTZ` | |
| `completed_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_lesson_jobs_status_created_at` on `(status, created_at DESC)`
- `idx_lesson_jobs_account_id` on `(account_id)`
- `idx_lesson_jobs_school_id` on `(school_id)`

---

### `lesson_adaptive_states`

| Column | Type | Constraints |
|--------|------|-------------|
| `lesson_id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | |
| `state_json` | `TEXT` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

---

### `runtime_sessions`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `director_state_json` | `TEXT` | `NOT NULL` |
| `account_id` | `TEXT` | |
| `school_id` | `TEXT` | |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Index:**
- `idx_runtime_sessions_account_id` on `(account_id)`

---

### `runtime_action_executions`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `session_id` | `TEXT` | `NOT NULL` |
| `record_json` | `TEXT` | `NOT NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Index:**
- `idx_runtime_action_executions_session_id` on `(session_id)`

---

### `lesson_shelf_items`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | `NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE` |
| `lesson_id` | `TEXT` | `NOT NULL` |
| `source_job_id` | `TEXT` | |
| `title` | `TEXT` | `NOT NULL` |
| `subject` | `TEXT` | |
| `language` | `TEXT` | |
| `status` | `TEXT` | `NOT NULL` |
| `progress_pct` | `INTEGER` | `NOT NULL` |
| `thumbnail_url` | `TEXT` | |
| `failure_reason` | `TEXT` | |
| `group_id` | `TEXT` | |
| `is_shared` | `BOOLEAN` | `NOT NULL DEFAULT FALSE` |
| `last_opened_at` | `TIMESTAMPTZ` | |
| `archived_at` | `TIMESTAMPTZ` | |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

**Indexes:**
- `idx_lesson_shelf_account_status` on `(account_id, status)`
- `idx_lesson_shelf_account_updated` on `(account_id, updated_at DESC)`

---

### `api_usage_records`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `account_id` | `TEXT` | `NOT NULL` |
| `component` | `TEXT` | `NOT NULL` |
| `provider` | `TEXT` | `NOT NULL` |
| `model_id` | `TEXT` | `NOT NULL` |
| `input_tokens` | `BIGINT` | `NOT NULL DEFAULT 0` |
| `output_tokens` | `BIGINT` | `NOT NULL DEFAULT 0` |
| `cost_usd_millicents` | `BIGINT` | `NOT NULL DEFAULT 0` |
| `lesson_id` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT NOW()` |

**Indexes:**
- `idx_api_usage_account_created` on `(account_id, created_at DESC)`
- `idx_api_usage_lesson_id` on `(lesson_id)`

---

### `refresh_tokens`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` |
| `token_hash` | `TEXT` | `NOT NULL UNIQUE` |
| `account_id` | `TEXT` | `NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE` |
| `family_id` | `TEXT` | `NOT NULL` |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `revoked_at` | `TIMESTAMPTZ` | |

**Indexes:**
- `idx_refresh_tokens_account` on `(account_id)`
- `idx_refresh_tokens_family` on `(family_id)`
- `idx_refresh_tokens_token_hash` on `(token_hash)`

---

### `operator_emails`

| Column | Type | Constraints |
|--------|------|-------------|
| `email` | `TEXT` | `PRIMARY KEY` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` |

---

---

## Migration Index

| Version | Name | Description |
|---------|------|-------------|
| 1 | `initial_tutor_accounts_credits_and_payments` | Core tables: accounts, credits, payments |
| 2 | `billing_and_credit_indexes` | Query performance indexes |
| 3 | `subscriptions_lifecycle` | Recurring billing support |
| 4 | `invoices_and_invoice_lines` | Invoice generation |
| 5 | `payment_intents_and_dunning_cases` | Payment processing + dunning |
| 6 | `webhook_events_and_financial_audit_logs` | Webhooks + audit trail |
| 7 | `enterprise_schools` | Multi-tenant schools |
| 8 | `school_invoices` | School billing |
| 9 | `lessons_jobs_and_runtime_persistence` | Lesson engine tables |
| 10 | `lesson_shelf_and_api_usage` | Student shelf + LLM tracking |
| 11 | `lesson_tenant_isolation` | Tenant IDs on lesson tables |
| 12 | `lesson_jobs_scenes_counts` | Scene progress tracking |
| 13 | `refresh_tokens` | JWT refresh rotation |
| 14 | `restore_unique_email_index` | Fix dropped unique index |
| 15 | `fix_schools_column_names` | Rename `admin_email` → `operator_email`, add columns |
| 16 | `operator_emails` | Operator whitelist |
| 17 | `fix_api_usage_records_schema` | Restructure usage tracking |
| 18 | `enable_lz4_toast_compression` | LZ4 compression on large text columns (PG >=14) |
| 19 | `drop_redundant_api_usage_index` | Remove unused index |
| 20 | **`exact_numeric_credits`** | **`DOUBLE PRECISION` → `NUMERIC(12,2)` on credit/balance/amount columns** |
| 21 | `usage_records_lesson_id` | Link usage to lessons |

---

## `NUMERIC(12,2)` vs `DOUBLE PRECISION` — Why the Change Matters

### The Bug That Triggered This

Migration v20 changed three financial columns from `DOUBLE PRECISION` to `NUMERIC(12,2)`:

| Table | Column | Old Type | New Type |
|-------|--------|----------|----------|
| `credit_ledger` | `amount` | `DOUBLE PRECISION` | `NUMERIC(12,2)` |
| `credit_balances` | `balance` | `DOUBLE PRECISION` | `NUMERIC(12,2)` |
| `payment_orders` | `credits_to_grant` | `DOUBLE PRECISION` | `NUMERIC(12,2)` |

After this migration, the Rust code **must** read these columns as `String` first (then parse to `f64`), because the `postgres` crate v0.19 **without** the `with-rust_decimal-1` feature cannot deserialize PostgreSQL `NUMERIC` directly into `f64`. Direct reads like `row.get::<_, f64>("amount")` panic at runtime:

```
thread panicked at crates/storage/src/filesystem.rs:879:31:
error retrieving column amount: error deserializing column 3
```

### Storage Comparison

| Type | Storage Size | Precision |
|------|-------------|-----------|
| `DOUBLE PRECISION` | **8 bytes** fixed | ~15 decimal digits (approximate) |
| `NUMERIC(12,2)` | **~7–8 bytes** variable | 12 digits, 2 after decimal (exact) |

Storage is **essentially identical** (~8 bytes). This change was about **correctness**, not storage.

### Correctness: Why `NUMERIC` Is Used for Money

`DOUBLE PRECISION` is IEEE 754 floating-point. It cannot represent all decimal values exactly:

```
0.01 + 0.02 = 0.030000000000000002  (floating-point error)
```

In a billing system that processes millions of micro-transactions, these tiny errors compound into visible discrepancies. `NUMERIC(12,2)` is exact decimal arithmetic — every calculation produces the mathematically correct result to 2 decimal places.

### Rust Deserialization Pattern

When reading `NUMERIC` columns in Rust (without the `with-rust_decimal-1` postgres feature), use this pattern:

```rust
// ❌ WRONG — panics at runtime:
let amount: f64 = row.get("amount");

// ✅ CORRECT — read as String, then parse:
let raw: String = row.get("amount");
let amount = raw.parse::<f64>().map_err(|e| format!("failed to parse: {e}"))?;
```

This pattern is used at:
- `filesystem.rs:879` — `credit_ledger.amount`
- `filesystem.rs:1202` — `payment_orders.credits_to_grant`
- `filesystem.rs:2429-2432` — `credit_balances.balance` (returned from INSERT)
- `filesystem.rs:2470` — `credit_balances.balance` (direct read)

### Existing `DOUBLE PRECISION` Columns (Not Changed)

The following columns remain `DOUBLE PRECISION` because they are not financial transaction data — they are plan configuration values:

- `subscriptions.credits_per_cycle` — plan-level setting
- `schools.credit_pool` — school-level pool (tracking reference)

These are configuration values, not transactional balances. If they later need exact arithmetic, they should also be migrated.

### Key Takeaway

**`NUMERIC(12,2)` is always the right choice for money/credit amounts.** The storage cost is identical to `DOUBLE PRECISION`. The only reason to use `DOUBLE PRECISION` is for non-financial approximate values (percentages, scores, etc.) where slight rounding is acceptable. Always prefer `NUMERIC(p,s)` for financial data in PostgreSQL.
