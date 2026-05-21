use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    sync::Arc,
    time::{Duration, SystemTime},
};

use chrono::Utc;
use anyhow::Result as AnyResult;
use async_trait::async_trait;
use postgres::Client;
use serde::{Deserialize, Serialize};
use tokio::fs;

use ai_tutor_domain::{
    auth::{TutorAccount, TutorAccountStatus},
    billing::{
        BillingInterval, BillingProductKind, DunningCase, DunningStatus, FinancialAuditLog,
        Invoice, InvoiceLine, InvoiceLineType, InvoiceStatus, InvoiceType, PaymentIntent,
        PaymentIntentStatus, PaymentOrder, PaymentOrderStatus, RetryAttempt, Subscription,
        SubscriptionStatus, WebhookEvent,
    },
    credits::{CreditBalance, CreditEntryKind, CreditLedgerEntry, PromoCode},
    job::{
        LessonGenerationJob, LessonGenerationJobStatus, LessonGenerationStep,
        QueuedLessonJobSnapshot,
    },
    lesson_adaptive::LessonAdaptiveState,
    lesson_shelf::{LessonShelfItem, LessonShelfStatus},
    lesson::Lesson,
    runtime::{DirectorState, RuntimeActionExecutionRecord},
};

use crate::repositories::{
    CreditLedgerRepository, DunningCaseRepository, FinancialAuditRepository,
    InvoiceLineRepository, InvoiceRepository, LessonAdaptiveRepository, LessonJobRepository,
    LessonRepository, LessonShelfRepository, PaymentIntentRepository, PaymentOrderRepository,
    PromoCodeRepository, RuntimeActionExecutionRepository, RuntimeSessionRepository, SchoolRepository,
    SubscriptionRepository, TutorAccountRepository, WebhookEventRepository,
};

const STALE_JOB_TIMEOUT: Duration = Duration::from_secs(30 * 60);

use std::sync::OnceLock;

#[derive(Clone)]
pub enum PgPool {
    Tls(r2d2::Pool<r2d2_postgres::PostgresConnectionManager<postgres_native_tls::MakeTlsConnector>>),
    NoTls(r2d2::Pool<r2d2_postgres::PostgresConnectionManager<postgres::NoTls>>),
}

pub enum PooledPgConnection {
    Tls(r2d2::PooledConnection<r2d2_postgres::PostgresConnectionManager<postgres_native_tls::MakeTlsConnector>>),
    NoTls(r2d2::PooledConnection<r2d2_postgres::PostgresConnectionManager<postgres::NoTls>>),
}

impl std::ops::Deref for PooledPgConnection {
    type Target = postgres::Client;
    fn deref(&self) -> &Self::Target {
        match self {
            Self::Tls(conn) => &**conn,
            Self::NoTls(conn) => &**conn,
        }
    }
}

impl std::ops::DerefMut for PooledPgConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        match self {
            Self::Tls(conn) => &mut **conn,
            Self::NoTls(conn) => &mut **conn,
        }
    }
}

static PG_POOL: OnceLock<PgPool> = OnceLock::new();

fn get_pg_client(url: &str) -> AnyResult<PooledPgConnection> {
    let pool = PG_POOL.get_or_init(|| {
        let pool = if url.contains("sslmode=require") || url.contains("sslmode=verify-full") {
            let tls = native_tls::TlsConnector::builder().build().unwrap();
            let connector = postgres_native_tls::MakeTlsConnector::new(tls);
            let manager = r2d2_postgres::PostgresConnectionManager::new(
                url.parse().unwrap(),
                connector
            );
            PgPool::Tls(
                r2d2::Pool::builder()
                    .max_size(5)
                    .max_lifetime(Some(Duration::from_secs(5 * 60)))
                    .idle_timeout(Some(Duration::from_secs(3 * 60)))
                    .connection_timeout(Duration::from_secs(5))
                    .test_on_check_out(true)
                    .build(manager)
                    .unwrap()
            )
        } else {
            let manager = r2d2_postgres::PostgresConnectionManager::new(
                url.parse().unwrap(),
                postgres::NoTls
            );
            PgPool::NoTls(
                r2d2::Pool::builder()
                    .max_size(5)
                    .max_lifetime(Some(Duration::from_secs(5 * 60)))
                    .idle_timeout(Some(Duration::from_secs(3 * 60)))
                    .connection_timeout(Duration::from_secs(5))
                    .test_on_check_out(true)
                    .build(manager)
                    .unwrap()
            )
        };

        // Run migrations once on startup
        let mut client = match &pool {
            PgPool::Tls(p) => PooledPgConnection::Tls(p.get().unwrap()),
            PgPool::NoTls(p) => PooledPgConnection::NoTls(p.get().unwrap()),
        };
        FileStorage::run_postgres_migrations(&mut client).expect("failed to run postgres migrations");

        pool
    });

    match pool {
        PgPool::Tls(p) => Ok(PooledPgConnection::Tls(p.get()?)),
        PgPool::NoTls(p) => Ok(PooledPgConnection::NoTls(p.get()?)),
    }
}

#[derive(Debug, Clone)]
pub struct FileStorage {
    root: PathBuf,
    postgres_url: String,
    postgres_ready: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Copy)]
struct PostgresMigration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const POSTGRES_MIGRATIONS: &[PostgresMigration] = &[
    PostgresMigration {
        version: 1,
        name: "initial_tutor_accounts_credits_and_payments",
        sql: r#"
            CREATE TABLE IF NOT EXISTS tutor_accounts (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                google_id TEXT NOT NULL UNIQUE,
                phone_number TEXT UNIQUE,
                phone_verified BOOLEAN NOT NULL,
                status TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_accounts_email_lower ON tutor_accounts (LOWER(email));

            CREATE TABLE IF NOT EXISTS credit_ledger (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                amount DOUBLE PRECISION NOT NULL,
                reason TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE IF NOT EXISTS credit_balances (
                account_id TEXT PRIMARY KEY REFERENCES tutor_accounts(id) ON DELETE CASCADE,
                balance DOUBLE PRECISION NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE IF NOT EXISTS payment_orders (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE,
                product_code TEXT NOT NULL,
                product_kind TEXT NOT NULL,
                gateway TEXT NOT NULL,
                gateway_txn_id TEXT NOT NULL UNIQUE,
                gateway_payment_id TEXT,
                amount_minor BIGINT NOT NULL,
                currency TEXT NOT NULL,
                credits_to_grant DOUBLE PRECISION NOT NULL,
                status TEXT NOT NULL,
                checkout_url TEXT,
                udf1 TEXT,
                udf2 TEXT,
                udf3 TEXT,
                udf4 TEXT,
                udf5 TEXT,
                raw_response TEXT,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL,
                completed_at TIMESTAMPTZ
            );
        "#,
    },
    PostgresMigration {
        version: 2,
        name: "billing_and_credit_indexes",
        sql: r#"
            CREATE INDEX IF NOT EXISTS idx_credit_ledger_account_created_at
                ON credit_ledger (account_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_payment_orders_account_created_at
                ON payment_orders (account_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_payment_orders_status_created_at
                ON payment_orders (status, created_at DESC);
        "#,
    },
    PostgresMigration {
        version: 3,
        name: "subscriptions_lifecycle",
        sql: r#"
            CREATE TABLE IF NOT EXISTS subscriptions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE,
                plan_code TEXT NOT NULL,
                gateway TEXT NOT NULL,
                gateway_subscription_id TEXT UNIQUE,
                status TEXT NOT NULL,
                billing_interval TEXT NOT NULL,
                credits_per_cycle DOUBLE PRECISION NOT NULL,
                autopay_enabled BOOLEAN NOT NULL,
                current_period_start TIMESTAMPTZ NOT NULL,
                current_period_end TIMESTAMPTZ NOT NULL,
                next_renewal_at TIMESTAMPTZ,
                grace_period_until TIMESTAMPTZ,
                cancelled_at TIMESTAMPTZ,
                last_payment_order_id TEXT,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_subscriptions_account_updated_at
                ON subscriptions (account_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal_due
                ON subscriptions (next_renewal_at ASC);
            CREATE INDEX IF NOT EXISTS idx_subscriptions_status_updated_at
                ON subscriptions (status, updated_at DESC);
        "#,
    },
    PostgresMigration {
        version: 4,
        name: "invoices_and_invoice_lines",
        sql: r#"
            CREATE TABLE IF NOT EXISTS invoices (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE,
                invoice_type TEXT NOT NULL,
                billing_cycle_start TIMESTAMPTZ NOT NULL,
                billing_cycle_end TIMESTAMPTZ NOT NULL,
                status TEXT NOT NULL,
                amount_cents BIGINT NOT NULL,
                amount_after_credits BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                finalized_at TIMESTAMPTZ,
                paid_at TIMESTAMPTZ,
                due_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_invoices_account_id
                ON invoices (account_id);
            CREATE INDEX IF NOT EXISTS idx_invoices_status
                ON invoices (status);
            CREATE INDEX IF NOT EXISTS idx_invoices_account_created
                ON invoices (account_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS invoice_lines (
                id TEXT PRIMARY KEY,
                invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                line_type TEXT NOT NULL,
                description TEXT NOT NULL,
                amount_cents BIGINT NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price_cents BIGINT NOT NULL,
                is_prorated BOOLEAN NOT NULL,
                period_start TIMESTAMPTZ NOT NULL,
                period_end TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id
                ON invoice_lines (invoice_id);
            CREATE INDEX IF NOT EXISTS idx_invoice_lines_type
                ON invoice_lines (line_type);
        "#,
    },
    PostgresMigration {
        version: 5,
        name: "payment_intents_and_dunning_cases",
        sql: r#"
            CREATE TABLE IF NOT EXISTS payment_intents (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE,
                invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                amount_cents BIGINT NOT NULL,
                idempotency_key TEXT NOT NULL UNIQUE,
                payment_method_id TEXT,
                gateway_payment_intent_id TEXT,
                authorize_error TEXT,
                authorized_at TIMESTAMPTZ,
                captured_at TIMESTAMPTZ,
                canceled_at TIMESTAMPTZ,
                attempt_count INTEGER NOT NULL,
                next_retry_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_payment_intents_invoice_id
                ON payment_intents (invoice_id);
            CREATE INDEX IF NOT EXISTS idx_payment_intents_retry
                ON payment_intents (status, next_retry_at ASC);

            CREATE TABLE IF NOT EXISTS dunning_cases (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE,
                invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                payment_intent_id TEXT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                attempt_schedule_json TEXT NOT NULL,
                grace_period_end TIMESTAMPTZ NOT NULL,
                final_attempt_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_dunning_cases_invoice_id
                ON dunning_cases (invoice_id);
            CREATE INDEX IF NOT EXISTS idx_dunning_cases_status
                ON dunning_cases (status);
        "#,
    },
    PostgresMigration {
        version: 6,
        name: "webhook_events_and_financial_audit_logs",
        sql: r#"
            CREATE TABLE IF NOT EXISTS webhook_events (
                id TEXT PRIMARY KEY,
                event_identifier TEXT NOT NULL UNIQUE,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                processed_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at
                ON webhook_events (processed_at DESC);

            CREATE TABLE IF NOT EXISTS financial_audit_logs (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                actor TEXT,
                before_state_json TEXT NOT NULL,
                after_state_json TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_financial_audit_logs_account_created
                ON financial_audit_logs (account_id, created_at DESC);
        "#,
    },
    PostgresMigration {
        version: 7,
        name: "enterprise_schools",
        sql: r#"
            CREATE TABLE IF NOT EXISTS schools (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                operator_email TEXT NOT NULL,
                plan TEXT NOT NULL DEFAULT 'free',
                credit_pool DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            ALTER TABLE tutor_accounts
                ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(id) ON DELETE SET NULL;

            CREATE INDEX IF NOT EXISTS idx_tutor_accounts_school_id
                ON tutor_accounts (school_id);
        "#,
    },
    PostgresMigration {
        version: 8,
        name: "school_invoices",
        sql: r#"
            CREATE TABLE IF NOT EXISTS school_invoices (
                id TEXT PRIMARY KEY,
                school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
                amount_cents BIGINT NOT NULL,
                payment_link TEXT,
                status TEXT NOT NULL,
                due_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                paid_at TIMESTAMPTZ
            );
        "#,
    },
    PostgresMigration {
        version: 9,
        name: "lessons_jobs_and_runtime_persistence",
        sql: r#"
            CREATE TABLE IF NOT EXISTS lessons (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                language TEXT NOT NULL,
                description TEXT,
                data_json TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lesson_jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                step TEXT NOT NULL,
                progress INTEGER NOT NULL,
                message TEXT NOT NULL,
                error TEXT,
                result_json TEXT,
                input_summary_json TEXT,
                lesson_id TEXT,
                created_at TIMESTAMPTZ NOT NULL,
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ NOT NULL,
                scenes_generated INTEGER NOT NULL DEFAULT 0,
                total_scenes INTEGER
            );

            CREATE TABLE IF NOT EXISTS lesson_adaptive_states (
                lesson_id TEXT PRIMARY KEY,
                account_id TEXT,
                state_json TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE IF NOT EXISTS runtime_sessions (
                id TEXT PRIMARY KEY,
                director_state_json TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE IF NOT EXISTS runtime_action_executions (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                record_json TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_lessons_created_at ON lessons (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_lesson_jobs_status_created_at ON lesson_jobs (status, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_runtime_action_executions_session_id ON runtime_action_executions (session_id);
        "#,
    },
    PostgresMigration {
        version: 10,
        name: "lesson_shelf_and_api_usage",
        sql: r#"
            CREATE TABLE IF NOT EXISTS lesson_shelf_items (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE,
                lesson_id TEXT NOT NULL,
                source_job_id TEXT,
                title TEXT NOT NULL,
                subject TEXT,
                language TEXT,
                status TEXT NOT NULL,
                progress_pct INTEGER NOT NULL,
                thumbnail_url TEXT,
                failure_reason TEXT,
                group_id TEXT,
                is_shared BOOLEAN NOT NULL DEFAULT FALSE,
                last_opened_at TIMESTAMPTZ,
                archived_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_lesson_shelf_account_status ON lesson_shelf_items (account_id, status);
            CREATE INDEX IF NOT EXISTS idx_lesson_shelf_account_updated ON lesson_shelf_items (account_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS api_usage_records (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                component TEXT NOT NULL,
                provider TEXT NOT NULL,
                model_id TEXT NOT NULL,
                input_tokens BIGINT NOT NULL DEFAULT 0,
                output_tokens BIGINT NOT NULL DEFAULT 0,
                cost_usd_millicents BIGINT NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_api_usage_account_created ON api_usage_records (account_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_records (created_at DESC);
        "#,
    },
    PostgresMigration {
        version: 11,
        name: "lesson_tenant_isolation",
        sql: r#"
            ALTER TABLE lessons ADD COLUMN IF NOT EXISTS account_id TEXT;
            ALTER TABLE lessons ADD COLUMN IF NOT EXISTS school_id TEXT;
            ALTER TABLE lesson_jobs ADD COLUMN IF NOT EXISTS account_id TEXT;
            ALTER TABLE lesson_jobs ADD COLUMN IF NOT EXISTS school_id TEXT;
            ALTER TABLE runtime_sessions ADD COLUMN IF NOT EXISTS account_id TEXT;
            ALTER TABLE runtime_sessions ADD COLUMN IF NOT EXISTS school_id TEXT;

            CREATE INDEX IF NOT EXISTS idx_lessons_account_id ON lessons (account_id);
            CREATE INDEX IF NOT EXISTS idx_lesson_jobs_account_id ON lesson_jobs (account_id);
            CREATE INDEX IF NOT EXISTS idx_runtime_sessions_account_id ON runtime_sessions (account_id);
            CREATE INDEX IF NOT EXISTS idx_lessons_school_id ON lessons (school_id);
            CREATE INDEX IF NOT EXISTS idx_lesson_jobs_school_id ON lesson_jobs (school_id);
        "#,
    },
    PostgresMigration {
        version: 12,
        name: "lesson_jobs_scenes_counts",
        sql: r#"
            ALTER TABLE lesson_jobs ADD COLUMN IF NOT EXISTS scenes_generated INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE lesson_jobs ADD COLUMN IF NOT EXISTS total_scenes INTEGER;
        "#,
    },
    PostgresMigration {
        version: 13,
        name: "refresh_tokens",
        sql: r#"
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL UNIQUE,
                account_id TEXT NOT NULL REFERENCES tutor_accounts(id) ON DELETE CASCADE,
                family_id TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                revoked_at TIMESTAMPTZ
            );

            CREATE INDEX IF NOT EXISTS idx_refresh_tokens_account ON refresh_tokens (account_id);
            CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens (family_id);
            CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens (token_hash);
        "#,
    },
    PostgresMigration {
        version: 14,
        name: "restore_unique_email_index",
        sql: r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_accounts_email_lower ON tutor_accounts (LOWER(email));
        "#,
    },
    PostgresMigration {
        version: 15,
        name: "fix_schools_column_names",
        sql: r#"
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT FROM information_schema.columns
                    WHERE table_schema = 'public'
                    AND table_name = 'schools'
                    AND column_name = 'admin_email'
                ) THEN
                    ALTER TABLE schools RENAME COLUMN admin_email TO operator_email;
                END IF;
            END $$;

            ALTER TABLE schools ADD COLUMN IF NOT EXISTS institution_type TEXT NOT NULL DEFAULT 'school';
            ALTER TABLE schools ADD COLUMN IF NOT EXISTS description TEXT;
        "#,
    },
    PostgresMigration {
        version: 16,
        name: "operator_emails",
        sql: r#"
            CREATE TABLE IF NOT EXISTS operator_emails (
                email TEXT PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL
            );
        "#,
    },
    PostgresMigration {
        version: 17,
        name: "fix_api_usage_records_schema",
        sql: r#"
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_usage_records') THEN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_usage_records' AND column_name = 'request_id') THEN
                        ALTER TABLE api_usage_records DROP COLUMN request_id;
                    END IF;
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_usage_records' AND column_name = 'total_tokens') THEN
                        ALTER TABLE api_usage_records DROP COLUMN total_tokens;
                    END IF;
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_usage_records' AND column_name = 'estimated_cost_usd') THEN
                        ALTER TABLE api_usage_records DROP COLUMN estimated_cost_usd;
                    END IF;
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_usage_records' AND column_name = 'provider_id') THEN
                        ALTER TABLE api_usage_records RENAME COLUMN provider_id TO provider;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_usage_records' AND column_name = 'cost_usd_millicents') THEN
                        ALTER TABLE api_usage_records ADD COLUMN cost_usd_millicents BIGINT NOT NULL DEFAULT 0;
                    END IF;
                END IF;
            END $$;
        "#,
    },
    PostgresMigration {
        version: 18,
        name: "enable_lz4_toast_compression",
        sql: r#"
            DO $$
            BEGIN
                IF current_setting('server_version_num')::int >= 140000 THEN
                    ALTER TABLE lessons ALTER COLUMN data_json SET COMPRESSION lz4;
                    ALTER TABLE lessons ALTER COLUMN title SET COMPRESSION lz4;
                    ALTER TABLE lessons ALTER COLUMN description SET COMPRESSION lz4;
                    ALTER TABLE lesson_jobs ALTER COLUMN result_json SET COMPRESSION lz4;
                    ALTER TABLE lesson_jobs ALTER COLUMN input_summary_json SET COMPRESSION lz4;
                    ALTER TABLE lesson_jobs ALTER COLUMN message SET COMPRESSION lz4;
                    ALTER TABLE lesson_jobs ALTER COLUMN error SET COMPRESSION lz4;
                    ALTER TABLE lesson_adaptive_states ALTER COLUMN state_json SET COMPRESSION lz4;
                    ALTER TABLE runtime_sessions ALTER COLUMN director_state_json SET COMPRESSION lz4;
                    ALTER TABLE runtime_action_executions ALTER COLUMN record_json SET COMPRESSION lz4;
                END IF;
            END $$;
        "#,
    },
    PostgresMigration {
        version: 19,
        name: "drop_redundant_api_usage_index",
        sql: r#"
            DROP INDEX IF EXISTS idx_api_usage_created;
        "#,
    },
    PostgresMigration {
        version: 20,
        name: "exact_numeric_credits",
        sql: r#"
            ALTER TABLE credit_ledger
                ALTER COLUMN amount TYPE NUMERIC(12,2) USING amount::numeric(12,2);
            ALTER TABLE credit_balances
                ALTER COLUMN balance TYPE NUMERIC(12,2) USING balance::numeric(12,2);
            ALTER TABLE payment_orders
                ALTER COLUMN credits_to_grant TYPE NUMERIC(12,2) USING credits_to_grant::numeric(12,2);
        "#,
    },
    PostgresMigration {
        version: 21,
        name: "usage_records_lesson_id",
        sql: r#"
            ALTER TABLE api_usage_records ADD COLUMN IF NOT EXISTS lesson_id TEXT;
            CREATE INDEX IF NOT EXISTS idx_api_usage_lesson_id ON api_usage_records (lesson_id);
        "#,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetricsResponse {
    pub database: DatabaseMetrics,
    pub tables: Vec<TableMetrics>,
    pub connections: ConnectionMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseMetrics {
    pub size_bytes: i64,
    pub size_human: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMetrics {
    pub table_name: String,
    pub row_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionMetrics {
    pub total: i64,
    pub active: i64,
    pub idle: i64,
    pub idle_in_transaction: i64,
    pub waiting: i64,
    pub max_connections: i64,
}

impl FileStorage {
    pub fn with_databases(
        root: impl Into<PathBuf>,
        _lesson_db_path: Option<PathBuf>,
        _runtime_db_path: Option<PathBuf>,
        _job_db_path: Option<PathBuf>,
        postgres_url: Option<String>,
    ) -> Self {
        Self {
            root: root.into(),
            postgres_url: postgres_url.expect("AI_TUTOR_POSTGRES_URL is required"),
            postgres_ready: Arc::new(AtomicBool::new(false)),
        }
    }

    fn ensure_postgres_ready_blocking(
        postgres_url: &str,
        postgres_ready: &AtomicBool,
    ) -> Result<(), String> {
        if postgres_ready.load(Ordering::Acquire) {
            return Ok(());
        }
        let _client = get_pg_client(postgres_url).map_err(|err| err.to_string())?;
        postgres_ready.store(true, Ordering::Release);
        Ok(())
    }

    pub async fn ensure_postgres_ready(&self) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let postgres_ready = Arc::clone(&self.postgres_ready);
        tokio::task::spawn_blocking(move || {
            Self::ensure_postgres_ready_blocking(&postgres_url, postgres_ready.as_ref())
        })
        .await
        .map_err(|err| err.to_string())?
    }

    pub fn root_dir(&self) -> &std::path::Path {
        &self.root
    }

    pub fn lessons_dir(&self) -> PathBuf {
        self.root.join("lessons")
    }

    pub fn jobs_dir(&self) -> PathBuf {
        self.root.join("lesson-jobs")
    }

    pub fn assets_dir(&self) -> PathBuf {
        self.root.join("assets")
    }

    pub fn runtime_sessions_dir(&self) -> PathBuf {
        self.root.join("runtime-sessions")
    }

    pub fn runtime_session_backend(&self) -> &'static str {
        "postgres"
    }

    pub fn lesson_backend(&self) -> &'static str {
        "postgres"
    }

    pub fn job_backend(&self) -> &'static str {
        "postgres"
    }

    pub async fn deduct_credits(&self, account_id: &str, amount: f64) -> Result<f64, String> {
        if amount <= 0.0 {
            return self
                .get_credit_balance(account_id)
                .await
                .map(|balance| balance.balance);
        }
        let entry = CreditLedgerEntry {
            id: format!("manual-debit-{}-{}", account_id, uuid::Uuid::new_v4()),
            account_id: account_id.to_string(),
            kind: CreditEntryKind::Debit,
            amount,
            reason: "manual_deduct".to_string(),
            created_at: chrono::Utc::now(),
        };
        self.apply_credit_entry(&entry)
            .await
            .map(|balance| balance.balance)
    }

    fn tutor_account_status_to_db(status: &TutorAccountStatus) -> &'static str {
        match status {
            TutorAccountStatus::PreRegistered => "pre_registered",
            TutorAccountStatus::PartialAuth => "partial_auth",
            TutorAccountStatus::Active => "active",
        }
    }

    fn tutor_account_status_from_db(value: &str) -> Result<TutorAccountStatus, String> {
        match value {
            "pre_registered" => Ok(TutorAccountStatus::PreRegistered),
            "partial_auth" => Ok(TutorAccountStatus::PartialAuth),
            "active" => Ok(TutorAccountStatus::Active),
            other => Err(format!("unsupported tutor account status `{other}`")),
        }
    }

    fn postgres_row_to_tutor_account(row: postgres::Row) -> Result<TutorAccount, String> {
        let status = Self::tutor_account_status_from_db(row.get::<_, String>("status").as_str())?;
        let created_at: chrono::DateTime<Utc> = row.get("created_at");
        let updated_at: chrono::DateTime<Utc> = row.get("updated_at");
        let school_id = row.try_get("school_id").unwrap_or(None);

        Ok(TutorAccount {
            id: row.get("id"),
            email: row.get("email"),
            google_id: row.get("google_id"),
            phone_number: row.get("phone_number"),
            phone_verified: row.get("phone_verified"),
            status,
            school_id,
            created_at,
            updated_at,
        })
    }

    fn postgres_row_to_school_invoice(row: postgres::Row) -> Result<ai_tutor_domain::school::SchoolInvoice, String> {
        let status_str = row.get::<_, String>("status");
        let status = match status_str.as_str() {
            "pending" => ai_tutor_domain::school::SchoolInvoiceStatus::Pending,
            "paid" => ai_tutor_domain::school::SchoolInvoiceStatus::Paid,
            "overdue" => ai_tutor_domain::school::SchoolInvoiceStatus::Overdue,
            "cancelled" => ai_tutor_domain::school::SchoolInvoiceStatus::Cancelled,
            other => return Err(format!("unsupported school invoice status `{other}`")),
        };
        Ok(ai_tutor_domain::school::SchoolInvoice {
            id: row.get("id"),
            school_id: row.get("school_id"),
            amount_cents: row.get("amount_cents"),
            payment_link: row.try_get("payment_link").unwrap_or(None),
            status,
            due_at: row.get("due_at"),
            created_at: row.get("created_at"),
            paid_at: row.try_get("paid_at").unwrap_or(None),
        })
    }

    fn postgres_row_to_school(row: postgres::Row) -> Result<ai_tutor_domain::school::School, String> {
        Ok(ai_tutor_domain::school::School {
            id: row.get("id"),
            name: row.get("name"),
            operator_email: row.get("operator_email"),
            institution_type: row.try_get("institution_type").unwrap_or_else(|_| "school".to_string()),
            description: row.try_get("description").unwrap_or(None),
            plan: row.get("plan"),
            credit_pool: row.get("credit_pool"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    fn credit_entry_kind_to_db(kind: &CreditEntryKind) -> &'static str {

        match kind {
            CreditEntryKind::Grant => "grant",
            CreditEntryKind::Debit => "debit",
            CreditEntryKind::Refund => "refund",
        }
    }

    fn credit_entry_kind_from_db(value: &str) -> Result<CreditEntryKind, String> {
        match value {
            "grant" => Ok(CreditEntryKind::Grant),
            "debit" => Ok(CreditEntryKind::Debit),
            "refund" => Ok(CreditEntryKind::Refund),
            other => Err(format!("unsupported credit entry kind `{other}`")),
        }
    }

    fn postgres_row_to_credit_entry(row: postgres::Row) -> Result<CreditLedgerEntry, String> {
        let kind = Self::credit_entry_kind_from_db(row.get::<_, String>("kind").as_str())?;
        let created_at = row.get("created_at");
        let raw_amount: String = row.get("amount");

        Ok(CreditLedgerEntry {
            id: row.get("id"),
            account_id: row.get("account_id"),
            kind,
            amount: raw_amount.parse::<f64>().map_err(|e| format!("failed to parse amount: {e}"))?,
            reason: row.get("reason"),
            created_at,
        })
    }

    fn postgres_row_to_shelf_item(row: postgres::Row) -> Result<LessonShelfItem, String> {
        let status_str: String = row.get("status");
        let status = serde_json::from_str::<LessonShelfStatus>(&format!("\"{}\"", status_str))
            .map_err(|err| err.to_string())?;
        Ok(LessonShelfItem {
            id: row.get("id"),
            account_id: row.get("account_id"),
            lesson_id: row.get("lesson_id"),
            source_job_id: row.get("source_job_id"),
            title: row.get("title"),
            subject: row.get("subject"),
            language: row.get("language"),
            status,
            progress_pct: row.get("progress_pct"),
            thumbnail_url: row.get("thumbnail_url"),
            failure_reason: row.get("failure_reason"),
            group_id: row.try_get("group_id").unwrap_or(None),
            is_shared: row.try_get("is_shared").unwrap_or(false),
            last_opened_at: row.get("last_opened_at"),
            archived_at: row.get("archived_at"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }


    fn run_postgres_migrations(client: &mut Client) -> AnyResult<()> {
        static MIGRATIONS_DONE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if MIGRATIONS_DONE.load(Ordering::Acquire) {
            return Ok(());
        }

        client.batch_execute(
            "
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version BIGINT PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            ",
        )?;

        for migration in POSTGRES_MIGRATIONS {
            let already_applied = client
                .query_opt(
                    "SELECT version FROM schema_migrations WHERE version = $1",
                    &[&migration.version],
                )?
                .is_some();
            if already_applied {
                continue;
            }

            let mut tx = client.transaction()?;
            tx.batch_execute(migration.sql)?;
            tx.execute(
                "
                INSERT INTO schema_migrations (version, name, applied_at)
                VALUES ($1, $2, NOW())
                ",
                &[&migration.version, &migration.name],
            )?;
            tx.commit()?;
        }
        MIGRATIONS_DONE.store(true, Ordering::Release);
        Ok(())
    }

    // ─── Filesystem helpers (used by promo codes and queued-job snapshots) ───

    fn queued_job_snapshots_dir(&self) -> PathBuf {
        self.root.join("queued-job-snapshots")
    }

    fn queued_job_snapshot_path(&self, job_id: &str) -> PathBuf {
        self.queued_job_snapshots_dir().join(format!("{job_id}.json"))
    }

    pub fn promo_codes_dir(&self) -> PathBuf {
        self.root.join("promo-codes")
    }

    fn promo_code_path(&self, code: &str) -> PathBuf {
        self.promo_codes_dir().join(format!("{}.json", code))
    }

    async fn ensure_dir(dir: &Path) -> AnyResult<()> {
        fs::create_dir_all(dir).await?;
        Ok(())
    }

    async fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> AnyResult<()> {
        if let Some(parent) = path.parent() {
            Self::ensure_dir(parent).await?;
        }
        let tmp = path.with_extension(format!(
            "tmp.{}.{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));
        let content = serde_json::to_vec_pretty(value)?;
        fs::write(&tmp, content).await?;
        fs::rename(&tmp, path).await?;
        Ok(())
    }

    async fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> AnyResult<Option<T>> {
        match fs::read(path).await {
            Ok(bytes) => {
                let value = serde_json::from_slice::<T>(&bytes)?;
                Ok(Some(value))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    fn billing_product_kind_to_db(kind: &BillingProductKind) -> &'static str {
        match kind {
            BillingProductKind::Subscription => "subscription",
            BillingProductKind::Bundle => "bundle",
        }
    }

    fn billing_product_kind_from_db(value: &str) -> Result<BillingProductKind, String> {
        match value {
            "subscription" => Ok(BillingProductKind::Subscription),
            "bundle" => Ok(BillingProductKind::Bundle),
            other => Err(format!("unsupported billing product kind `{other}`")),
        }
    }

    fn payment_order_status_to_db(status: &PaymentOrderStatus) -> &'static str {
        match status {
            PaymentOrderStatus::Pending => "pending",
            PaymentOrderStatus::Succeeded => "succeeded",
            PaymentOrderStatus::Failed => "failed",
        }
    }

    fn payment_order_status_from_db(value: &str) -> Result<PaymentOrderStatus, String> {
        match value {
            "pending" => Ok(PaymentOrderStatus::Pending),
            "succeeded" => Ok(PaymentOrderStatus::Succeeded),
            "failed" => Ok(PaymentOrderStatus::Failed),
            other => Err(format!("unsupported payment order status `{other}`")),
        }
    }

    fn subscription_status_to_db(status: &SubscriptionStatus) -> &'static str {
        match status {
            SubscriptionStatus::Active => "active",
            SubscriptionStatus::PastDue => "past_due",
            SubscriptionStatus::Cancelled => "cancelled",
            SubscriptionStatus::Expired => "expired",
        }
    }

    fn subscription_status_from_db(value: &str) -> Result<SubscriptionStatus, String> {
        match value {
            "active" => Ok(SubscriptionStatus::Active),
            "past_due" => Ok(SubscriptionStatus::PastDue),
            "cancelled" => Ok(SubscriptionStatus::Cancelled),
            "expired" => Ok(SubscriptionStatus::Expired),
            other => Err(format!("unsupported subscription status `{other}`")),
        }
    }

    fn billing_interval_to_db(interval: &BillingInterval) -> &'static str {
        match interval {
            BillingInterval::Monthly => "monthly",
        }
    }

    fn billing_interval_from_db(value: &str) -> Result<BillingInterval, String> {
        match value {
            "monthly" => Ok(BillingInterval::Monthly),
            other => Err(format!("unsupported billing interval `{other}`")),
        }
    }

    fn invoice_type_to_db(invoice_type: &InvoiceType) -> &'static str {
        match invoice_type {
            InvoiceType::SubscriptionRenewal => "subscription_renewal",
            InvoiceType::AddOnCreditPurchase => "add_on_credit_purchase",
        }
    }

    fn invoice_type_from_db(value: &str) -> Result<InvoiceType, String> {
        match value {
            "subscription_renewal" => Ok(InvoiceType::SubscriptionRenewal),
            "add_on_credit_purchase" => Ok(InvoiceType::AddOnCreditPurchase),
            other => Err(format!("unsupported invoice type `{other}`")),
        }
    }

    fn invoice_status_to_db(status: &InvoiceStatus) -> &'static str {
        match status {
            InvoiceStatus::Draft => "draft",
            InvoiceStatus::Open => "open",
            InvoiceStatus::Finalized => "finalized",
            InvoiceStatus::Paid => "paid",
            InvoiceStatus::PartiallyPaid => "partially_paid",
            InvoiceStatus::Overdue => "overdue",
            InvoiceStatus::Uncollectible => "uncollectible",
        }
    }

    fn invoice_status_from_db(value: &str) -> Result<InvoiceStatus, String> {
        match value {
            "draft" => Ok(InvoiceStatus::Draft),
            "open" => Ok(InvoiceStatus::Open),
            "finalized" => Ok(InvoiceStatus::Finalized),
            "paid" => Ok(InvoiceStatus::Paid),
            "partially_paid" => Ok(InvoiceStatus::PartiallyPaid),
            "overdue" => Ok(InvoiceStatus::Overdue),
            "uncollectible" => Ok(InvoiceStatus::Uncollectible),
            other => Err(format!("unsupported invoice status `{other}`")),
        }
    }

    fn invoice_line_type_to_db(line_type: &InvoiceLineType) -> &'static str {
        match line_type {
            InvoiceLineType::SubscriptionBase => "subscription_base",
            InvoiceLineType::IncludedCredits => "included_credits",
            InvoiceLineType::UsageOverage => "usage_overage",
            InvoiceLineType::AddOnCredits => "add_on_credits",
            InvoiceLineType::AddOn => "add_on",
            InvoiceLineType::Adjustment => "adjustment",
            InvoiceLineType::TaxAmount => "tax_amount",
        }
    }

    fn invoice_line_type_from_db(value: &str) -> Result<InvoiceLineType, String> {
        match value {
            "subscription_base" => Ok(InvoiceLineType::SubscriptionBase),
            "included_credits" => Ok(InvoiceLineType::IncludedCredits),
            "usage_overage" => Ok(InvoiceLineType::UsageOverage),
            "add_on_credits" => Ok(InvoiceLineType::AddOnCredits),
            "add_on" => Ok(InvoiceLineType::AddOn),
            "adjustment" => Ok(InvoiceLineType::Adjustment),
            "tax_amount" => Ok(InvoiceLineType::TaxAmount),
            other => Err(format!("unsupported invoice line type `{other}`")),
        }
    }

    fn payment_intent_status_to_db(status: &PaymentIntentStatus) -> &'static str {
        match status {
            PaymentIntentStatus::Pending => "pending",
            PaymentIntentStatus::RequiresAction => "requires_action",
            PaymentIntentStatus::Authorized => "authorized",
            PaymentIntentStatus::Captured => "captured",
            PaymentIntentStatus::Failed => "failed",
            PaymentIntentStatus::Abandoned => "abandoned",
            PaymentIntentStatus::Canceled => "canceled",
        }
    }

    fn payment_intent_status_from_db(value: &str) -> Result<PaymentIntentStatus, String> {
        match value {
            "pending" => Ok(PaymentIntentStatus::Pending),
            "requires_action" => Ok(PaymentIntentStatus::RequiresAction),
            "authorized" => Ok(PaymentIntentStatus::Authorized),
            "captured" => Ok(PaymentIntentStatus::Captured),
            "failed" => Ok(PaymentIntentStatus::Failed),
            "abandoned" => Ok(PaymentIntentStatus::Abandoned),
            "canceled" => Ok(PaymentIntentStatus::Canceled),
            other => Err(format!("unsupported payment intent status `{other}`")),
        }
    }

    fn dunning_status_to_db(status: &DunningStatus) -> &'static str {
        match status {
            DunningStatus::Active => "active",
            DunningStatus::Recovered => "recovered",
            DunningStatus::Exhausted => "exhausted",
        }
    }

    fn dunning_status_from_db(value: &str) -> Result<DunningStatus, String> {
        match value {
            "active" => Ok(DunningStatus::Active),
            "recovered" => Ok(DunningStatus::Recovered),
            "exhausted" => Ok(DunningStatus::Exhausted),
            other => Err(format!("unsupported dunning status `{other}`")),
        }
    }

    fn postgres_row_to_payment_order(row: postgres::Row) -> Result<PaymentOrder, String> {
        let product_kind =
            Self::billing_product_kind_from_db(row.get::<_, String>("product_kind").as_str())?;
        let status =
            Self::payment_order_status_from_db(row.get::<_, String>("status").as_str())?;
        let created_at = row.get("created_at");
        let updated_at = row.get("updated_at");
        let completed_at = row
            .get::<_, Option<String>>("completed_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;

        Ok(PaymentOrder {
            id: row.get("id"),
            account_id: row.get("account_id"),
            product_code: row.get("product_code"),
            product_kind,
            gateway: row.get("gateway"),
            gateway_txn_id: row.get("gateway_txn_id"),
            gateway_payment_id: row.get("gateway_payment_id"),
            amount_minor: row.get("amount_minor"),
            currency: row.get("currency"),
            credits_to_grant: {
                let raw: String = row.get("credits_to_grant");
                raw.parse::<f64>().map_err(|e| format!("failed to parse credits_to_grant: {e}"))?
            },
            status,
            checkout_url: row.get("checkout_url"),
            udf1: row.get("udf1"),
            udf2: row.get("udf2"),
            udf3: row.get("udf3"),
            udf4: row.get("udf4"),
            udf5: row.get("udf5"),
            raw_response: row.get("raw_response"),
            created_at,
            updated_at,
            completed_at,
        })
    }

    fn postgres_row_to_subscription(row: postgres::Row) -> Result<Subscription, String> {
        let status = Self::subscription_status_from_db(row.get::<_, String>("status").as_str())?;
        let billing_interval =
            Self::billing_interval_from_db(row.get::<_, String>("billing_interval").as_str())?;
        let current_period_start = row.get("current_period_start");
        let current_period_end = row.get("current_period_end");
        let next_renewal_at = row
            .get::<_, Option<String>>("next_renewal_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let grace_period_until = row
            .get::<_, Option<String>>("grace_period_until")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let cancelled_at = row
            .get::<_, Option<String>>("cancelled_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let created_at = row.get("created_at");
        let updated_at = row.get("updated_at");

        Ok(Subscription {
            id: row.get("id"),
            account_id: row.get("account_id"),
            plan_code: row.get("plan_code"),
            gateway: row.get("gateway"),
            gateway_subscription_id: row.get("gateway_subscription_id"),
            status,
            billing_interval,
            credits_per_cycle: row.get("credits_per_cycle"),
            autopay_enabled: row.get("autopay_enabled"),
            current_period_start,
            current_period_end,
            next_renewal_at,
            grace_period_until,
            cancelled_at,
            last_payment_order_id: row.get("last_payment_order_id"),
            created_at,
            updated_at,
            // New fields — default for existing rows without these columns
            quality_mode: Default::default(),
            allowed_learning_modes: vec![],
        })
    }

    fn postgres_row_to_invoice(row: postgres::Row) -> Result<Invoice, String> {
        let invoice_type =
            Self::invoice_type_from_db(row.get::<_, String>("invoice_type").as_str())?;
        let status = Self::invoice_status_from_db(row.get::<_, String>("status").as_str())?;
        let billing_cycle_start = row.get("billing_cycle_start");
        let billing_cycle_end = row.get("billing_cycle_end");
        let created_at = row.get("created_at");
        let finalized_at = row
            .get::<_, Option<String>>("finalized_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let paid_at = row
            .get::<_, Option<String>>("paid_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let due_at = row
            .get::<_, Option<String>>("due_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let updated_at = row.get("updated_at");

        Ok(Invoice {
            id: row.get("id"),
            account_id: row.get("account_id"),
            invoice_type,
            billing_cycle_start,
            billing_cycle_end,
            status,
            amount_cents: row.get("amount_cents"),
            amount_after_credits: row.get("amount_after_credits"),
            created_at,
            finalized_at,
            paid_at,
            due_at,
            updated_at,
        })
    }

    fn postgres_row_to_invoice_line(row: postgres::Row) -> Result<InvoiceLine, String> {
        let line_type =
            Self::invoice_line_type_from_db(row.get::<_, String>("line_type").as_str())?;
        let period_start = row.get("period_start");
        let period_end = row.get("period_end");
        let created_at = row.get("created_at");
        let updated_at = row.get("updated_at");

        Ok(InvoiceLine {
            id: row.get("id"),
            invoice_id: row.get("invoice_id"),
            line_type,
            description: row.get("description"),
            amount_cents: row.get("amount_cents"),
            quantity: row.get::<_, i32>("quantity") as u32,
            unit_price_cents: row.get("unit_price_cents"),
            is_prorated: row.get("is_prorated"),
            period_start,
            period_end,
            created_at,
            updated_at,
        })
    }

    fn postgres_row_to_payment_intent(row: postgres::Row) -> Result<PaymentIntent, String> {
        let status =
            Self::payment_intent_status_from_db(row.get::<_, String>("status").as_str())?;
        let authorized_at = row
            .get::<_, Option<String>>("authorized_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let captured_at = row
            .get::<_, Option<String>>("captured_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let canceled_at = row
            .get::<_, Option<String>>("canceled_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let next_retry_at = row
            .get::<_, Option<String>>("next_retry_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let created_at = row.get("created_at");
        let updated_at = row.get("updated_at");

        Ok(PaymentIntent {
            id: row.get("id"),
            account_id: row.get("account_id"),
            invoice_id: row.get("invoice_id"),
            status,
            amount_cents: row.get("amount_cents"),
            idempotency_key: row.get("idempotency_key"),
            payment_method_id: row.get("payment_method_id"),
            gateway_payment_intent_id: row.get("gateway_payment_intent_id"),
            authorize_error: row.get("authorize_error"),
            authorized_at,
            captured_at,
            canceled_at,
            attempt_count: row.get::<_, i32>("attempt_count") as u32,
            next_retry_at,
            created_at,
            updated_at,
        })
    }

    fn postgres_row_to_dunning_case(row: postgres::Row) -> Result<DunningCase, String> {
        let status = Self::dunning_status_from_db(row.get::<_, String>("status").as_str())?;
        let grace_period_end = row.get("grace_period_end");
        let final_attempt_at = row
            .get::<_, Option<String>>("final_attempt_at")
            .map(|value| value.parse::<chrono::DateTime<Utc>>().map_err(|err| err.to_string()))
            .transpose()?;
        let created_at = row.get("created_at");
        let updated_at = row.get("updated_at");
        let attempt_schedule = serde_json::from_str::<Vec<RetryAttempt>>(
            row.get::<_, String>("attempt_schedule_json").as_str(),
        )
        .map_err(|err| err.to_string())?;

        Ok(DunningCase {
            id: row.get("id"),
            account_id: row.get("account_id"),
            invoice_id: row.get("invoice_id"),
            payment_intent_id: row.get("payment_intent_id"),
            status,
            attempt_schedule,
            grace_period_end,
            final_attempt_at,
            created_at,
            updated_at,
        })
    }

    fn postgres_row_to_webhook_event(row: postgres::Row) -> Result<WebhookEvent, String> {
        let payload = serde_json::from_str::<serde_json::Value>(&row.get::<_, String>("payload_json"))
            .map_err(|err| err.to_string())?;
        Ok(WebhookEvent {
            id: row.get("id"),
            event_identifier: row.get("event_identifier"),
            event_type: row.get("event_type"),
            payload,
            processed_at: row.get("processed_at"),
            created_at: row.get("created_at"),
        })
    }

    fn postgres_row_to_financial_audit_log(row: postgres::Row) -> Result<FinancialAuditLog, String> {
        let before_state = serde_json::from_str::<serde_json::Value>(&row.get::<_, String>("before_state_json"))
            .map_err(|err| err.to_string())?;
        let after_state = serde_json::from_str::<serde_json::Value>(&row.get::<_, String>("after_state_json"))
            .map_err(|err| err.to_string())?;
        Ok(FinancialAuditLog {
            id: row.get("id"),
            account_id: row.get("account_id"),
            event_type: row.get("event_type"),
            entity_type: row.get("entity_type"),
            entity_id: row.get("entity_id"),
            actor: row.get("actor"),
            before_state,
            after_state,
            created_at: row.get("created_at"),
        })
    }

    pub async fn save_queued_job_snapshot(
        &self,
        job_id: &str,
        snapshot: &QueuedLessonJobSnapshot,
    ) -> Result<(), String> {
        Self::write_json_atomic(&self.queued_job_snapshot_path(job_id), snapshot)
            .await
            .map_err(|err| err.to_string())
    }

    pub async fn get_queued_job_snapshot(
        &self,
        job_id: &str,
    ) -> Result<Option<QueuedLessonJobSnapshot>, String> {
        Self::read_json(&self.queued_job_snapshot_path(job_id))
            .await
            .map_err(|err| err.to_string())
    }

    pub async fn delete_queued_job_snapshot(&self, job_id: &str) -> Result<(), String> {
        let path = self.queued_job_snapshot_path(job_id);
        let _ = tokio::fs::remove_file(path).await;
        Ok(())
    }

}

#[async_trait]
impl LessonRepository for FileStorage {
    async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let lesson = lesson.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let data_json = serde_json::to_string(&lesson).map_err(|err| err.to_string())?;
            client.execute(
                "INSERT INTO lessons (id, account_id, school_id, title, language, description, data_json, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (id) DO UPDATE SET
                     account_id = EXCLUDED.account_id,
                     school_id = EXCLUDED.school_id,
                     title = EXCLUDED.title,
                     language = EXCLUDED.language,
                     description = EXCLUDED.description,
                     data_json = EXCLUDED.data_json,
                     updated_at = EXCLUDED.updated_at",
                &[
                    &lesson.id,
                    &lesson.account_id,
                    &lesson.school_id,
                    &lesson.title,
                    &lesson.language,
                    &lesson.description,
                    &data_json,
                    &lesson.created_at,
                    &lesson.updated_at,
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?

    }

    async fn get_lesson(&self, lesson_id: &str) -> Result<Option<Lesson>, String> {
        let postgres_url = self.postgres_url.clone();
        let lesson_id = lesson_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<Lesson>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client.query_opt(
                "SELECT data_json FROM lessons WHERE id = $1",
                &[&lesson_id],
            ).map_err(|err| err.to_string())?;
            
            if let Some(row) = row {
                let data_json: String = row.get(0);
                let lesson = serde_json::from_str::<Lesson>(&data_json).map_err(|err| err.to_string())?;
                Ok(Some(lesson))
            } else {
                Ok(None)
            }
        }).await.map_err(|err| err.to_string())?

    }

    async fn delete_lesson(&self, lesson_id: &str) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let lesson_id = lesson_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client.execute(
                "DELETE FROM lessons WHERE id = $1",
                &[&lesson_id],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?
    }
}

#[async_trait]
impl LessonAdaptiveRepository for FileStorage {
    async fn save_lesson_adaptive_state(&self, state: &LessonAdaptiveState) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let state = state.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let state_json = serde_json::to_string(&state).map_err(|err| err.to_string())?;
            client.execute(
                "INSERT INTO lesson_adaptive_states (lesson_id, account_id, state_json, updated_at)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (lesson_id) DO UPDATE SET
                     account_id = EXCLUDED.account_id,
                     state_json = EXCLUDED.state_json,
                     updated_at = EXCLUDED.updated_at",
                &[
                    &state.lesson_id,
                    &state.account_id,
                    &state_json,
                    &chrono::Utc::now(),
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?

    }

    async fn get_lesson_adaptive_state(
        &self,
        lesson_id: &str,
    ) -> Result<Option<LessonAdaptiveState>, String> {
        let postgres_url = self.postgres_url.clone();
        let lesson_id = lesson_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<LessonAdaptiveState>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client.query_opt(
                "SELECT state_json FROM lesson_adaptive_states WHERE lesson_id = $1",
                &[&lesson_id],
            ).map_err(|err| err.to_string())?;
            if let Some(row) = row {
                let json: String = row.get(0);
                let state = serde_json::from_str::<LessonAdaptiveState>(&json).map_err(|err| err.to_string())?;
                Ok(Some(state))
            } else {
                Ok(None)
            }
        }).await.map_err(|err| err.to_string())?
    }

    async fn delete_lesson_adaptive_state(&self, lesson_id: &str) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let lesson_id = lesson_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client.execute(
                "DELETE FROM lesson_adaptive_states WHERE lesson_id = $1",
                &[&lesson_id],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?
    }
}

#[async_trait]
impl LessonShelfRepository for FileStorage {
    async fn upsert_lesson_shelf_item(&self, item: &LessonShelfItem) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let item = item.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let status_str = serde_json::to_string(&item.status).map_err(|err| err.to_string())?.replace("\"", "");
            client.execute(
                "INSERT INTO lesson_shelf_items (id, account_id, lesson_id, source_job_id, title, subject, language, status, progress_pct, thumbnail_url, failure_reason, last_opened_at, archived_at, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                 ON CONFLICT (id) DO UPDATE SET
                     account_id = EXCLUDED.account_id,
                     lesson_id = EXCLUDED.lesson_id,
                     source_job_id = EXCLUDED.source_job_id,
                     title = EXCLUDED.title,
                     subject = EXCLUDED.subject,
                     language = EXCLUDED.language,
                     status = EXCLUDED.status,
                     progress_pct = EXCLUDED.progress_pct,
                     thumbnail_url = EXCLUDED.thumbnail_url,
                     failure_reason = EXCLUDED.failure_reason,
                     last_opened_at = EXCLUDED.last_opened_at,
                     archived_at = EXCLUDED.archived_at,
                     updated_at = EXCLUDED.updated_at",
                &[
                    &item.id,
                    &item.account_id,
                    &item.lesson_id,
                    &item.source_job_id,
                    &item.title,
                    &item.subject,
                    &item.language,
                    &status_str,
                    &(item.progress_pct as i32),
                    &item.thumbnail_url,
                    &item.failure_reason,
                    &item.last_opened_at,
                    &item.archived_at,
                    &item.created_at,
                    &item.updated_at,
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?
    }

    async fn get_lesson_shelf_item(&self, item_id: &str) -> Result<Option<LessonShelfItem>, String> {
        let postgres_url = self.postgres_url.clone();
        let item_id = item_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<LessonShelfItem>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client.query_opt(
                "SELECT id, account_id, lesson_id, source_job_id, title, subject, language, status, progress_pct, thumbnail_url, failure_reason, last_opened_at, archived_at, created_at, updated_at
                 FROM lesson_shelf_items WHERE id = $1",
                &[&item_id],
            ).map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_shelf_item).transpose()
        }).await.map_err(|err| err.to_string())?
    }

    async fn list_lesson_shelf_items_for_account(
        &self,
        account_id: &str,
        status: Option<LessonShelfStatus>,
        limit: usize,
    ) -> Result<Vec<LessonShelfItem>, String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<LessonShelfItem>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = if let Some(status) = status {
                let status_str = serde_json::to_string(&status).map_err(|err| err.to_string())?.replace("\"", "");
                client.query(
                    "SELECT id, account_id, lesson_id, source_job_id, title, subject, language, status, progress_pct, thumbnail_url, failure_reason, last_opened_at, archived_at, created_at, updated_at
                     FROM lesson_shelf_items WHERE account_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT $3",
                    &[&account_id, &status_str, &(limit as i64)],
                ).map_err(|err| err.to_string())?
            } else {
                client.query(
                    "SELECT id, account_id, lesson_id, source_job_id, title, subject, language, status, progress_pct, thumbnail_url, failure_reason, last_opened_at, archived_at, created_at, updated_at
                     FROM lesson_shelf_items WHERE account_id = $1 ORDER BY updated_at DESC LIMIT $2",
                    &[&account_id, &(limit as i64)],
                ).map_err(|err| err.to_string())?
            };
            rows.into_iter().map(Self::postgres_row_to_shelf_item).collect()
        }).await.map_err(|err| err.to_string())?
    }

    async fn mark_lesson_shelf_opened(&self, item_id: &str) -> Result<(), String> {
        let Some(mut item) = self.get_lesson_shelf_item(item_id).await? else {
            return Err("lesson shelf item not found".to_string());
        };
        item.last_opened_at = Some(Utc::now());
        if item.progress_pct == 0 {
            item.progress_pct = 5;
        }
        if item.status == LessonShelfStatus::Archived {
            item.status = LessonShelfStatus::Ready;
            item.archived_at = None;
        }
        item.updated_at = Utc::now();
        self.upsert_lesson_shelf_item(&item).await
    }

    async fn rename_lesson_shelf_item(&self, item_id: &str, title: &str) -> Result<(), String> {
        let Some(mut item) = self.get_lesson_shelf_item(item_id).await? else {
            return Err("lesson shelf item not found".to_string());
        };
        item.title = title.to_string();
        item.updated_at = Utc::now();
        self.upsert_lesson_shelf_item(&item).await
    }

    async fn archive_lesson_shelf_item(&self, item_id: &str) -> Result<(), String> {
        let Some(mut item) = self.get_lesson_shelf_item(item_id).await? else {
            return Err("lesson shelf item not found".to_string());
        };
        item.status = LessonShelfStatus::Archived;
        item.archived_at = Some(Utc::now());
        item.updated_at = Utc::now();
        self.upsert_lesson_shelf_item(&item).await
    }

    async fn reopen_lesson_shelf_item(&self, item_id: &str) -> Result<(), String> {
        let Some(mut item) = self.get_lesson_shelf_item(item_id).await? else {
            return Err("lesson shelf item not found".to_string());
        };
        item.status = LessonShelfStatus::Ready;
        item.archived_at = None;
        item.last_opened_at = Some(Utc::now());
        item.updated_at = Utc::now();
        self.upsert_lesson_shelf_item(&item).await
    }

    async fn delete_lesson_shelf_item(&self, item_id: &str) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let item_id = item_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client.execute(
                "DELETE FROM lesson_shelf_items WHERE id = $1",
                &[&item_id],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?
    }
}

#[async_trait]
impl LessonJobRepository for FileStorage {
    async fn create_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let job = job.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let status_str = serde_json::to_string(&job.status).map_err(|err| err.to_string())?.replace("\"", "");
            let step_str = serde_json::to_string(&job.step).map_err(|err| err.to_string())?.replace("\"", "");
            let result_json = job.result.as_ref().map(|r| serde_json::to_string(r)).transpose().map_err(|err| err.to_string())?;
            let input_summary_json = serde_json::to_string(&job.input_summary).map_err(|err| err.to_string())?;
            let lesson_id = job.result.as_ref().map(|r| r.lesson_id.clone());
            
            client.execute(
                "INSERT INTO lesson_jobs (id, account_id, school_id, status, step, progress, message, error, result_json, input_summary_json, lesson_id, created_at, started_at, completed_at, updated_at, scenes_generated, total_scenes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                 ON CONFLICT (id) DO UPDATE SET
                     account_id = EXCLUDED.account_id,
                     school_id = EXCLUDED.school_id,
                     status = EXCLUDED.status,
                     step = EXCLUDED.step,
                     progress = EXCLUDED.progress,
                     message = EXCLUDED.message,
                     error = EXCLUDED.error,
                     result_json = EXCLUDED.result_json,
                     input_summary_json = EXCLUDED.input_summary_json,
                     lesson_id = EXCLUDED.lesson_id,
                     started_at = EXCLUDED.started_at,
                     completed_at = EXCLUDED.completed_at,
                     updated_at = EXCLUDED.updated_at,
                     scenes_generated = EXCLUDED.scenes_generated,
                     total_scenes = EXCLUDED.total_scenes",
                &[
                    &job.id,
                    &job.account_id,
                    &job.school_id,
                    &status_str,
                    &step_str,
                    &job.progress,
                    &job.message,
                    &job.error,
                    &result_json,
                    &input_summary_json,
                    &lesson_id,
                    &job.created_at,
                    &job.started_at,
                    &job.completed_at,
                    &job.updated_at,
                    &job.scenes_generated,
                    &job.total_scenes,
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?

    }

    async fn update_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let job = job.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let status_str = serde_json::to_string(&job.status).map_err(|err| err.to_string())?.replace("\"", "");
            let step_str = serde_json::to_string(&job.step).map_err(|err| err.to_string())?.replace("\"", "");
            let result_json = job.result.as_ref().map(|r| serde_json::to_string(r)).transpose().map_err(|err| err.to_string())?;
            let input_summary_json = serde_json::to_string(&job.input_summary).map_err(|err| err.to_string())?;
            let lesson_id = job.result.as_ref().map(|r| r.lesson_id.clone());
            
            client.execute(
                "UPDATE lesson_jobs SET
                     account_id = $2,
                     school_id = $3,
                     status = $4,
                     step = $5,
                     progress = $6,
                     message = $7,
                     error = $8,
                     result_json = $9,
                     input_summary_json = $10,
                     lesson_id = $11,
                     started_at = $12,
                     completed_at = $13,
                     updated_at = $14
                 WHERE id = $1",
                &[
                    &job.id,
                    &job.account_id,
                    &job.school_id,
                    &status_str,
                    &step_str,
                    &job.progress,
                    &job.message,
                    &job.error,
                    &result_json,
                    &input_summary_json,
                    &lesson_id,
                    &job.started_at,
                    &job.completed_at,
                    &job.updated_at,
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?

    }

    async fn get_job(&self, job_id: &str) -> Result<Option<LessonGenerationJob>, String> {
        let postgres_url = self.postgres_url.clone();
        let job_id = job_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<LessonGenerationJob>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client.query_opt(
                "SELECT id, account_id, school_id, status, step, progress, message, error, result_json, input_summary_json, created_at, started_at, completed_at, updated_at, scenes_generated, total_scenes
                 FROM lesson_jobs WHERE id = $1",
                &[&job_id],
            ).map_err(|err| err.to_string())?;
            
            if let Some(row) = row {
                let status_str: String = row.get(3);
                let step_str: String = row.get(4);
                let result_json: Option<String> = row.get(8);
                let input_summary_json: String = row.get(9);
                
                let mut job = LessonGenerationJob {
                    id: row.get(0),
                    account_id: row.get(1),
                    school_id: row.get(2),
                    status: serde_json::from_str(&format!("\"{}\"", status_str)).map_err(|err| err.to_string())?,
                    step: serde_json::from_str(&format!("\"{}\"", step_str)).map_err(|err| err.to_string())?,
                    progress: row.get(5),
                    message: row.get(6),
                    error: row.get(7),
                    result: result_json.map(|s| serde_json::from_str(&s)).transpose().map_err(|err| err.to_string())?,
                    input_summary: serde_json::from_str(&input_summary_json).map_err(|err| err.to_string())?,
                    created_at: row.get(10),
                    started_at: row.get(11),
                    completed_at: row.get(12),
                    updated_at: row.get(13),
                    scenes_generated: row.get(14),
                    total_scenes: row.get(15),
                };
                
                let now = chrono::Utc::now();
                if job.status == LessonGenerationJobStatus::Running {
                    let updated_age = now
                        .signed_duration_since(job.updated_at)
                        .to_std()
                        .unwrap_or_default();
                    if updated_age > STALE_JOB_TIMEOUT {
                        job.status = LessonGenerationJobStatus::Failed;
                        job.step = LessonGenerationStep::Failed;
                        job.message = "Job appears stale (no progress update for 30 minutes)".to_string();
                        job.error = Some("Stale job: process may have restarted during generation".to_string());
                        job.updated_at = now;
                        job.completed_at = Some(now);
                        
                        // Update in postgres
                        let status_str = serde_json::to_string(&job.status).map_err(|err| err.to_string())?.replace("\"", "");
                        let step_str = serde_json::to_string(&job.step).map_err(|err| err.to_string())?.replace("\"", "");
                        client.execute(
                            "UPDATE lesson_jobs SET status = $2, step = $3, message = $4, error = $5, updated_at = $6, completed_at = $7 WHERE id = $1",
                            &[&job.id, &status_str, &step_str, &job.message, &job.error, &job.updated_at, &job.completed_at],
                        ).map_err(|err| err.to_string())?;

                    }
                }
                
                Ok(Some(job))
            } else {
                Ok(None)
            }
        }).await.map_err(|err| err.to_string())?

    }

    async fn list_all_jobs(&self, limit: usize) -> Result<Vec<LessonGenerationJob>, String> {
        let postgres_url = self.postgres_url.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<LessonGenerationJob>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client.query(
                "SELECT id, account_id, school_id, status, step, progress, message, error, result_json, input_summary_json, created_at, started_at, completed_at, updated_at, scenes_generated, total_scenes
                 FROM lesson_jobs ORDER BY created_at DESC LIMIT $1",
                &[&(limit as i64)],
            ).map_err(|err| err.to_string())?;
            
            let mut jobs = Vec::new();
            for row in rows {
                let status_str: String = row.get(3);
                let step_str: String = row.get(4);
                let result_json: Option<String> = row.get(8);
                let input_summary_json: String = row.get(9);
                
                jobs.push(LessonGenerationJob {
                    id: row.get(0),
                    account_id: row.get(1),
                    school_id: row.get(2),
                    status: serde_json::from_str(&format!("\"{}\"", status_str)).map_err(|err| err.to_string())?,
                    step: serde_json::from_str(&format!("\"{}\"", step_str)).map_err(|err| err.to_string())?,
                    progress: row.get(5),
                    message: row.get(6),
                    error: row.get(7),
                    result: result_json.map(|s| serde_json::from_str(&s)).transpose().map_err(|err| err.to_string())?,
                    input_summary: serde_json::from_str(&input_summary_json).map_err(|err| err.to_string())?,
                    created_at: row.get(10),
                    started_at: row.get(11),
                    completed_at: row.get(12),
                    updated_at: row.get(13),
                    scenes_generated: row.get(14),
                    total_scenes: row.get(15),
                });
            }
            Ok(jobs)
        }).await.map_err(|err| err.to_string())?

    }

    async fn delete_jobs_by_lesson(&self, lesson_id: &str) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let lesson_id = lesson_id.to_string();
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;

            let rows = client.query(
                "SELECT id FROM lesson_jobs WHERE lesson_id = $1",
                &[&lesson_id],
            ).map_err(|err| err.to_string())?;

            for row in &rows {
                let job_id: String = row.get(0);
                let snapshot_path = root.join("lesson-jobs").join(format!("{job_id}.json"));
                let _ = std::fs::remove_file(&snapshot_path);
            }

            client.execute(
                "DELETE FROM lesson_jobs WHERE lesson_id = $1",
                &[&lesson_id],
            ).map_err(|err| err.to_string())?;

            Ok(())
        }).await.map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl RuntimeSessionRepository for FileStorage {
    async fn save_runtime_session(
        &self,
        session_id: &str,
        director_state: &DirectorState,
    ) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let session_id = session_id.to_string();
        let director_state = director_state.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let state_json = serde_json::to_string(&director_state).map_err(|err| err.to_string())?;
            client.execute(
                "INSERT INTO runtime_sessions (id, director_state_json, updated_at)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (id) DO UPDATE SET
                     director_state_json = EXCLUDED.director_state_json,
                     updated_at = EXCLUDED.updated_at",
                &[
                    &session_id,
                    &state_json,
                    &chrono::Utc::now(),
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?

    }

    async fn get_runtime_session(&self, session_id: &str) -> Result<Option<DirectorState>, String> {
        let postgres_url = self.postgres_url.clone();
        let session_id = session_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<DirectorState>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client.query_opt(
                "SELECT director_state_json FROM runtime_sessions WHERE id = $1",
                &[&session_id],
            ).map_err(|err| err.to_string())?;
            if let Some(row) = row {
                let json: String = row.get(0);
                let state = serde_json::from_str::<DirectorState>(&json).map_err(|err| err.to_string())?;
                Ok(Some(state))
            } else {
                Ok(None)
            }
        }).await.map_err(|err| err.to_string())?
    }
}

#[async_trait]
impl RuntimeActionExecutionRepository for FileStorage {
    async fn save_runtime_action_execution(
        &self,
        record: &RuntimeActionExecutionRecord,
    ) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let record = record.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let record_json = serde_json::to_string(&record).map_err(|err| err.to_string())?;
            client.execute(
                "INSERT INTO runtime_action_executions (id, session_id, record_json, created_at)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (id) DO UPDATE SET
                     record_json = EXCLUDED.record_json",
                &[
                    &record.execution_id,
                    &record.session_id,
                    &record_json,
                    &Utc::now(),
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        }).await.map_err(|err| err.to_string())?

    }

    async fn get_runtime_action_execution(
        &self,
        execution_id: &str,
    ) -> Result<Option<RuntimeActionExecutionRecord>, String> {
        let postgres_url = self.postgres_url.clone();
        let execution_id = execution_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<RuntimeActionExecutionRecord>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client.query_opt(
                "SELECT record_json FROM runtime_action_executions WHERE id = $1",
                &[&execution_id],
            ).map_err(|err| err.to_string())?;
            
            if let Some(row) = row {
                let record_json: String = row.get(0);
                let record = serde_json::from_str::<RuntimeActionExecutionRecord>(&record_json).map_err(|err| err.to_string())?;
                Ok(Some(record))
            } else {
                Ok(None)
            }
        }).await.map_err(|err| err.to_string())?

    }

    async fn list_runtime_action_executions_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<RuntimeActionExecutionRecord>, String> {
        let postgres_url = self.postgres_url.clone();
        let session_id = session_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<RuntimeActionExecutionRecord>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client.query(
                "SELECT record_json FROM runtime_action_executions WHERE session_id = $1 ORDER BY created_at ASC",
                &[&session_id],
            ).map_err(|err| err.to_string())?;
            
            let mut records = Vec::new();
            for row in rows {
                let record_json: String = row.get(0);
                let record = serde_json::from_str::<RuntimeActionExecutionRecord>(&record_json).map_err(|err| err.to_string())?;
                records.push(record);
            }
            Ok(records)
        }).await.map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl crate::repositories::RefreshTokenRepository for FileStorage {
    async fn save_refresh_token(&self, token: &ai_tutor_domain::auth::RefreshToken) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let token = token.clone();
        
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            
            client.execute(
                "INSERT INTO refresh_tokens (id, token_hash, account_id, family_id, expires_at, created_at, revoked_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (token_hash) DO UPDATE SET
                     revoked_at = EXCLUDED.revoked_at",
                &[
                    &token.id,
                    &token.token_hash,
                    &token.account_id,
                    &token.family_id,
                    &token.expires_at,
                    &token.created_at,
                    &token.revoked_at,
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?
    }

    async fn get_refresh_token_by_hash(&self, token_hash: &str) -> Result<Option<ai_tutor_domain::auth::RefreshToken>, String> {
        let postgres_url = self.postgres_url.clone();
        let hash = token_hash.to_string();
        
        tokio::task::spawn_blocking(move || -> Result<Option<ai_tutor_domain::auth::RefreshToken>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            
            let row_opt = client.query_opt(
                "SELECT id, token_hash, account_id, family_id, expires_at, created_at, revoked_at 
                 FROM refresh_tokens WHERE token_hash = $1",
                &[&hash],
            ).map_err(|err| err.to_string())?;
            
            Ok(row_opt.map(|row| ai_tutor_domain::auth::RefreshToken {
                id: row.get("id"),
                token_hash: row.get("token_hash"),
                account_id: row.get("account_id"),
                family_id: row.get("family_id"),
                expires_at: row.get("expires_at"),
                created_at: row.get("created_at"),
                revoked_at: row.get("revoked_at"),
            }))
        })
        .await
        .map_err(|err| err.to_string())?
    }

    async fn revoke_refresh_token(&self, token_id: &str) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let id = token_id.to_string();
        
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            
            client.execute(
                "UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
                &[&id],
            ).map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?
    }

    async fn revoke_refresh_family(&self, family_id: &str) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let family = family_id.to_string();
        
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            
            client.execute(
                "UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL",
                &[&family],
            ).map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?
    }
    async fn cleanup_expired_refresh_tokens(&self) -> Result<usize, String> {
        let postgres_url = self.postgres_url.clone();
        
        tokio::task::spawn_blocking(move || -> Result<usize, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            
            // Delete tokens that expired more than 7 days ago (grace period)
            let deleted = client.execute(
                "DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '7 days'",
                &[],
            ).map_err(|err| err.to_string())?;
            
            Ok(deleted as usize)
        })
        .await
        .map_err(|err| err.to_string())?
    }
}

#[async_trait]
impl TutorAccountRepository for FileStorage {
    async fn save_tutor_account(&self, account: &TutorAccount) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let account = account.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client
                .execute(
                    "
                    INSERT INTO tutor_accounts (
                        id, email, google_id, phone_number, phone_verified, status, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (id) DO UPDATE SET
                        email = EXCLUDED.email,
                        google_id = EXCLUDED.google_id,
                        phone_number = EXCLUDED.phone_number,
                        phone_verified = EXCLUDED.phone_verified,
                        status = EXCLUDED.status,
                        updated_at = EXCLUDED.updated_at
                    ",
                    &[
                        &account.id,
                        &account.email,
                    &account.google_id,
                    &account.phone_number,
                    &account.phone_verified,
                    &Self::tutor_account_status_to_db(&account.status),
                    &account.created_at,
                    &account.updated_at,
                ],
                )
                .map_err(|err| {
                    if let Some(db_err) = err.as_db_error() {
                        if db_err.code().code() == "23505" {
                            let detail = db_err.detail().unwrap_or_default();
                            if detail.contains("google_id") {
                                return format!(
                                    "google account {} is already linked to another tutor account",
                                    account.google_id
                                );
                            }
                            if detail.contains("phone_number") {
                                if let Some(phone_number) = account.phone_number.as_deref() {
                                    return format!(
                                        "phone number {} is already linked to another tutor account",
                                        phone_number
                                    );
                                }
                                return "phone number is already linked to another tutor account"
                                    .to_string();
                            }
                        }
                    }
                    err.to_string()
                })?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_tutor_account_by_id(
        &self,
        account_id: &str,
    ) -> Result<Option<TutorAccount>, String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<TutorAccount>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "SELECT id, email, google_id, phone_number, phone_verified, status,
                            created_at,
                            updated_at
                     FROM tutor_accounts WHERE id = $1",
                    &[&account_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_tutor_account).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_tutor_account_by_google_id(
        &self,
        google_id: &str,
    ) -> Result<Option<TutorAccount>, String> {
        let postgres_url = self.postgres_url.clone();
        let google_id = google_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<TutorAccount>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| {
                format!("connect_postgres failed: {}", err)
            })?;

            Self::run_postgres_migrations(&mut client).map_err(|err| {
                format!("run_postgres_migrations failed: {}", err)
            })?;

            let row = client
                .query_opt(
                    "SELECT id, email, google_id, phone_number, phone_verified, status,
                            created_at,
                            updated_at
                     FROM tutor_accounts WHERE google_id = $1",
                    &[&google_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_tutor_account).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_tutor_account_by_phone(
        &self,
        phone_number: &str,
    ) -> Result<Option<TutorAccount>, String> {
        let postgres_url = self.postgres_url.clone();
        let phone_number = phone_number.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<TutorAccount>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "SELECT id, email, google_id, phone_number, phone_verified, status,
                            created_at,
                            updated_at
                     FROM tutor_accounts WHERE phone_number = $1",
                    &[&phone_number],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_tutor_account).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_tutor_account_by_email(
        &self,
        email: &str,
    ) -> Result<Option<TutorAccount>, String> {
        let postgres_url = self.postgres_url.clone();
        let email = email.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<TutorAccount>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "SELECT id, email, google_id, phone_number, phone_verified, status,
                            created_at,
                            updated_at
                     FROM tutor_accounts WHERE LOWER(email) = LOWER($1)",
                    &[&email],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_tutor_account).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_all_tutor_accounts(&self, limit: usize) -> Result<Vec<TutorAccount>, String> {
        let postgres_url = self.postgres_url.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<TutorAccount>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "SELECT id, email, google_id, phone_number, phone_verified, status,
                            created_at,
                            updated_at
                     FROM tutor_accounts
                     ORDER BY created_at DESC
                     LIMIT $1",
                    &[&(limit as i64)],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_tutor_account)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl CreditLedgerRepository for FileStorage {
    async fn apply_credit_entry(&self, entry: &CreditLedgerEntry) -> Result<CreditBalance, String> {
        let postgres_url = self.postgres_url.clone();
        let entry = entry.clone();
        tokio::task::spawn_blocking(move || -> Result<CreditBalance, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;

            let mut transaction = client.transaction().map_err(|err| err.to_string())?;
            let rounded_amount = (entry.amount * 100.0).round() / 100.0;
            transaction
                .execute(
                    "
                    INSERT INTO credit_ledger (id, account_id, kind, amount, reason, created_at)
                    VALUES ($1, $2, $3, ROUND($4::numeric, 2), $5, $6)
                    ",
                    &[
                        &entry.id,
                        &entry.account_id,
                        &Self::credit_entry_kind_to_db(&entry.kind),
                        &rounded_amount,
                        &entry.reason,
                        &entry.created_at,
                    ],
                )
                .or_else(|err| {
                    if let Some(db_err) = err.as_db_error() {
                        if db_err.code().code() == "23505" {
                            // Duplicate credit entry — already applied, skip
                            return Ok(1u64);
                        }
                    }
                    Err(err.to_string())
                })?;

            let delta = match entry.kind {
                CreditEntryKind::Debit => -rounded_amount,
                CreditEntryKind::Grant | CreditEntryKind::Refund => rounded_amount,
            };
            let balance = transaction
                .query_one(
                    "
                    INSERT INTO credit_balances (account_id, balance, updated_at)
                    VALUES ($1, ROUND($2::numeric, 2), $3)
                    ON CONFLICT (account_id) DO UPDATE SET
                        balance = ROUND((credit_balances.balance + EXCLUDED.balance)::numeric, 2),
                        updated_at = EXCLUDED.updated_at
                    RETURNING account_id, balance, updated_at
                    ",
                    &[&entry.account_id, &delta, &entry.created_at],
                )
                .map_err(|err| err.to_string())?;
            transaction.commit().map_err(|err| err.to_string())?;

            let raw_balance: String = balance.get("balance");
            Ok(CreditBalance {
                account_id: balance.get("account_id"),
                balance: raw_balance.parse::<f64>().map_err(|e| format!("failed to parse balance: {e}"))?,
                updated_at: balance.get("updated_at"),
            })
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_credit_balance(&self, account_id: &str) -> Result<CreditBalance, String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<CreditBalance, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT account_id, balance, updated_at
                    FROM credit_balances
                    WHERE account_id = $1
                    ",
                    &[&account_id],
                )
                .map_err(|err| err.to_string())?;

            let Some(row) = row else {
                return Ok(CreditBalance {
                    account_id,
                    balance: 0.0,
                    updated_at: Utc::now(),
                });
            };

            let updated_at = row.get("updated_at");

            let raw_balance: String = row.get("balance");
            Ok(CreditBalance {
                account_id: row.get("account_id"),
                balance: raw_balance.parse::<f64>().map_err(|e| format!("failed to parse balance: {e}"))?,
                updated_at,
            })
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_credit_entries(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<CreditLedgerEntry>, String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<CreditLedgerEntry>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, kind, amount, reason, created_at
                    FROM credit_ledger
                    WHERE account_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                    ",
                    &[&account_id, &(limit as i64)],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_credit_entry)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_all_credit_entries(&self, limit: usize) -> Result<Vec<CreditLedgerEntry>, String> {
        let postgres_url = self.postgres_url.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<CreditLedgerEntry>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, kind, amount, reason, created_at
                    FROM credit_ledger
                    ORDER BY created_at DESC
                    LIMIT $1
                    ",
                    &[&(limit as i64)],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_credit_entry)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl PromoCodeRepository for FileStorage {
    async fn save_promo_code(&self, code: &PromoCode) -> Result<(), String> {
        Self::ensure_dir(&self.promo_codes_dir())
            .await
            .map_err(|err| err.to_string())?;
        let path = self.promo_code_path(&code.code);
        Self::write_json_atomic(&path, code)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_promo_code(&self, code: &str) -> Result<Option<PromoCode>, String> {
        Self::ensure_dir(&self.promo_codes_dir())
            .await
            .map_err(|err| err.to_string())?;
        let path = self.promo_code_path(code);
        Self::read_json::<PromoCode>(&path)
            .await
            .map_err(|err| err.to_string())
    }

    async fn list_all_promo_codes(&self, limit: usize) -> Result<Vec<PromoCode>, String> {
        Self::ensure_dir(&self.promo_codes_dir())
            .await
            .map_err(|err| err.to_string())?;
        let mut reader = fs::read_dir(self.promo_codes_dir())
            .await
            .map_err(|err| err.to_string())?;
        let mut codes = Vec::new();
        while let Some(entry) = reader.next_entry().await.map_err(|err| err.to_string())? {
            if let Some(code) = Self::read_json::<PromoCode>(&entry.path())
                .await
                .map_err(|err| err.to_string())?
            {
                codes.push(code);
            }
        }
        codes.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        codes.truncate(limit);
        Ok(codes)
    }

    async fn update_promo_code_redemption(
        &self,
        code: &str,
        account_id: &str,
    ) -> Result<(), String> {
        let mut promo = self
            .get_promo_code(code)
            .await?
            .ok_or_else(|| "promo code not found".to_string())?;
        
        // Add account to redeemed list (allowing duplicates for multiple uses)
        promo.redeemed_by_accounts.push(account_id.to_string());
        promo.updated_at = Utc::now();
        self.save_promo_code(&promo).await?;
        
        Ok(())
    }
}

#[async_trait]
impl PaymentOrderRepository for FileStorage {
    async fn save_payment_order(&self, order: &PaymentOrder) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let order = order.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client
                .execute(
                    "
                    INSERT INTO payment_orders (
                        id, account_id, product_code, product_kind, gateway, gateway_txn_id,
                        gateway_payment_id, amount_minor, currency, credits_to_grant, status,
                        checkout_url, udf1, udf2, udf3, udf4, udf5, raw_response,
                        created_at, updated_at, completed_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6,
                        $7, $8, $9, $10, $11,
                        $12, $13, $14, $15, $16, $17, $18,
                        $19, $20, $21
                    )
                    ON CONFLICT (gateway_txn_id) DO UPDATE SET
                        id = EXCLUDED.id,
                        account_id = EXCLUDED.account_id,
                        product_code = EXCLUDED.product_code,
                        product_kind = EXCLUDED.product_kind,
                        gateway = EXCLUDED.gateway,
                        gateway_txn_id = EXCLUDED.gateway_txn_id,
                        gateway_payment_id = EXCLUDED.gateway_payment_id,
                        amount_minor = EXCLUDED.amount_minor,
                        currency = EXCLUDED.currency,
                        credits_to_grant = EXCLUDED.credits_to_grant,
                        status = EXCLUDED.status,
                        checkout_url = EXCLUDED.checkout_url,
                        udf1 = EXCLUDED.udf1,
                        udf2 = EXCLUDED.udf2,
                        udf3 = EXCLUDED.udf3,
                        udf4 = EXCLUDED.udf4,
                        udf5 = EXCLUDED.udf5,
                        raw_response = EXCLUDED.raw_response,
                        updated_at = EXCLUDED.updated_at,
                        completed_at = EXCLUDED.completed_at
                    ",
                    &[
                        &order.id,
                        &order.account_id,
                        &order.product_code,
                        &Self::billing_product_kind_to_db(&order.product_kind),
                        &order.gateway,
                        &order.gateway_txn_id,
                        &order.gateway_payment_id,
                        &order.amount_minor,
                        &order.currency,
                        &order.credits_to_grant,
                        &Self::payment_order_status_to_db(&order.status),
                        &order.checkout_url,
                        &order.udf1,
                        &order.udf2,
                        &order.udf3,
                        &order.udf4,
                        &order.udf5,
                        &order.raw_response,
                        &order.created_at,
                        &order.updated_at,
                        &order.completed_at,
                    ],
                )
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_payment_order_by_id(&self, order_id: &str) -> Result<Option<PaymentOrder>, String> {
        let postgres_url = self.postgres_url.clone();
        let order_id = order_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<PaymentOrder>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, product_code, product_kind, gateway, gateway_txn_id,
                           gateway_payment_id, amount_minor, currency, credits_to_grant, status,
                           checkout_url, udf1, udf2, udf3, udf4, udf5, raw_response,
                           created_at,
                           updated_at,
                           completed_at
                    FROM payment_orders
                    WHERE id = $1
                    ",
                    &[&order_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_payment_order).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_payment_order_by_gateway_txn_id(
        &self,
        gateway_txn_id: &str,
    ) -> Result<Option<PaymentOrder>, String> {
        let postgres_url = self.postgres_url.clone();
        let gateway_txn_id = gateway_txn_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<PaymentOrder>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, product_code, product_kind, gateway, gateway_txn_id,
                           gateway_payment_id, amount_minor, currency, credits_to_grant, status,
                           checkout_url, udf1, udf2, udf3, udf4, udf5, raw_response,
                           created_at,
                           updated_at,
                           completed_at
                    FROM payment_orders
                    WHERE gateway_txn_id = $1
                    ",
                    &[&gateway_txn_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_payment_order).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_payment_orders_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<PaymentOrder>, String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<PaymentOrder>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, product_code, product_kind, gateway, gateway_txn_id,
                           gateway_payment_id, amount_minor, currency, credits_to_grant, status,
                           checkout_url, udf1, udf2, udf3, udf4, udf5, raw_response,
                           created_at,
                           updated_at,
                           completed_at
                    FROM payment_orders
                    WHERE account_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                    ",
                    &[&account_id, &(limit as i64)],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_payment_order)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_all_payment_orders(&self, limit: usize) -> Result<Vec<PaymentOrder>, String> {
        let postgres_url = self.postgres_url.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<PaymentOrder>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, product_code, product_kind, gateway, gateway_txn_id,
                           gateway_payment_id, amount_minor, currency, credits_to_grant, status,
                           checkout_url, udf1, udf2, udf3, udf4, udf5, raw_response,
                           created_at,
                           updated_at,
                           completed_at
                    FROM payment_orders
                    ORDER BY created_at DESC
                    LIMIT $1
                    ",
                    &[&(limit as i64)],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_payment_order)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl SubscriptionRepository for FileStorage {
    async fn save_subscription(&self, subscription: &Subscription) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let subscription = subscription.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            if subscription.gateway_subscription_id.is_some() {
                client
                    .execute(
                        "
                        INSERT INTO subscriptions (
                            id, account_id, plan_code, gateway, gateway_subscription_id,
                            status, billing_interval, credits_per_cycle, autopay_enabled,
                            current_period_start, current_period_end, next_renewal_at,
                            grace_period_until, cancelled_at, last_payment_order_id,
                            created_at, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8, $9,
                            $10, $11, $12,
                            $13, $14, $15,
                            $16, $17
                        )
                        ON CONFLICT (gateway_subscription_id) DO UPDATE SET
                            id = EXCLUDED.id,
                            account_id = EXCLUDED.account_id,
                            plan_code = EXCLUDED.plan_code,
                            gateway = EXCLUDED.gateway,
                            gateway_subscription_id = EXCLUDED.gateway_subscription_id,
                            status = EXCLUDED.status,
                            billing_interval = EXCLUDED.billing_interval,
                            credits_per_cycle = EXCLUDED.credits_per_cycle,
                            autopay_enabled = EXCLUDED.autopay_enabled,
                            current_period_start = EXCLUDED.current_period_start,
                            current_period_end = EXCLUDED.current_period_end,
                            next_renewal_at = EXCLUDED.next_renewal_at,
                            grace_period_until = EXCLUDED.grace_period_until,
                            cancelled_at = EXCLUDED.cancelled_at,
                            last_payment_order_id = EXCLUDED.last_payment_order_id,
                            updated_at = EXCLUDED.updated_at
                        ",
                        &[
                            &subscription.id,
                            &subscription.account_id,
                            &subscription.plan_code,
                            &subscription.gateway,
                            &subscription.gateway_subscription_id,
                            &Self::subscription_status_to_db(&subscription.status),
                            &Self::billing_interval_to_db(&subscription.billing_interval),
                            &subscription.credits_per_cycle,
                            &subscription.autopay_enabled,
                            &subscription.current_period_start,
                            &subscription.current_period_end,
                            &subscription.next_renewal_at,
                            &subscription
                                .grace_period_until
                                ,
                            &subscription.cancelled_at,
                            &subscription.last_payment_order_id,
                            &subscription.created_at,
                            &subscription.updated_at,
                        ],
                    )
                    .map_err(|err| err.to_string())?;
            } else {
                client
                    .execute(
                        "
                        INSERT INTO subscriptions (
                            id, account_id, plan_code, gateway, gateway_subscription_id,
                            status, billing_interval, credits_per_cycle, autopay_enabled,
                            current_period_start, current_period_end, next_renewal_at,
                            grace_period_until, cancelled_at, last_payment_order_id,
                            created_at, updated_at
                        ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8, $9,
                            $10, $11, $12,
                            $13, $14, $15,
                            $16, $17
                        )
                        ON CONFLICT (id) DO UPDATE SET
                            account_id = EXCLUDED.account_id,
                            plan_code = EXCLUDED.plan_code,
                            gateway = EXCLUDED.gateway,
                            gateway_subscription_id = EXCLUDED.gateway_subscription_id,
                            status = EXCLUDED.status,
                            billing_interval = EXCLUDED.billing_interval,
                            credits_per_cycle = EXCLUDED.credits_per_cycle,
                            autopay_enabled = EXCLUDED.autopay_enabled,
                            current_period_start = EXCLUDED.current_period_start,
                            current_period_end = EXCLUDED.current_period_end,
                            next_renewal_at = EXCLUDED.next_renewal_at,
                            grace_period_until = EXCLUDED.grace_period_until,
                            cancelled_at = EXCLUDED.cancelled_at,
                            last_payment_order_id = EXCLUDED.last_payment_order_id,
                            updated_at = EXCLUDED.updated_at
                        ",
                        &[
                            &subscription.id,
                            &subscription.account_id,
                            &subscription.plan_code,
                            &subscription.gateway,
                            &subscription.gateway_subscription_id,
                            &Self::subscription_status_to_db(&subscription.status),
                            &Self::billing_interval_to_db(&subscription.billing_interval),
                            &subscription.credits_per_cycle,
                            &subscription.autopay_enabled,
                            &subscription.current_period_start,
                            &subscription.current_period_end,
                            &subscription.next_renewal_at,
                            &subscription
                                .grace_period_until
                                ,
                            &subscription.cancelled_at,
                            &subscription.last_payment_order_id,
                            &subscription.created_at,
                            &subscription.updated_at,
                        ],
                    )
                    .map_err(|err| err.to_string())?;

            }
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_subscription_by_id(
        &self,
        subscription_id: &str,
    ) -> Result<Option<Subscription>, String> {
        let postgres_url = self.postgres_url.clone();
        let subscription_id = subscription_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<Subscription>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, plan_code, gateway, gateway_subscription_id,
                           status, billing_interval, credits_per_cycle, autopay_enabled,
                           current_period_start,
                           current_period_end,
                           next_renewal_at,
                           grace_period_until,
                           cancelled_at,
                           last_payment_order_id,
                           created_at,
                           updated_at
                    FROM subscriptions
                    WHERE id = $1
                    ",
                    &[&subscription_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_subscription).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_subscription_by_gateway_subscription_id(
        &self,
        gateway_subscription_id: &str,
    ) -> Result<Option<Subscription>, String> {
        let postgres_url = self.postgres_url.clone();
        let gateway_subscription_id = gateway_subscription_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<Subscription>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, plan_code, gateway, gateway_subscription_id,
                           status, billing_interval, credits_per_cycle, autopay_enabled,
                           current_period_start,
                           current_period_end,
                           next_renewal_at,
                           grace_period_until,
                           cancelled_at,
                           last_payment_order_id,
                           created_at,
                           updated_at
                    FROM subscriptions
                    WHERE gateway_subscription_id = $1
                    ",
                    &[&gateway_subscription_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_subscription).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_all_subscriptions(&self, limit: usize) -> Result<Vec<Subscription>, String> {
        let postgres_url = self.postgres_url.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<Subscription>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, plan_code, gateway, gateway_subscription_id,
                           status, billing_interval, credits_per_cycle, autopay_enabled,
                           current_period_start,
                           current_period_end,
                           next_renewal_at,
                           grace_period_until,
                           cancelled_at,
                           last_payment_order_id,
                           created_at,
                           updated_at
                    FROM subscriptions
                    ORDER BY updated_at DESC
                    LIMIT $1
                    ",
                    &[&(limit as i64)],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_subscription)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_subscriptions_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<Subscription>, String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<Subscription>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, plan_code, gateway, gateway_subscription_id,
                           status, billing_interval, credits_per_cycle, autopay_enabled,
                           current_period_start,
                           current_period_end,
                           next_renewal_at,
                           grace_period_until,
                           cancelled_at,
                           last_payment_order_id,
                           created_at,
                           updated_at
                    FROM subscriptions
                    WHERE account_id = $1
                    ORDER BY updated_at DESC
                    LIMIT $2
                    ",
                    &[&account_id, &(limit as i64)],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_subscription)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_subscriptions_due_for_renewal(
        &self,
        renewal_cutoff_rfc3339: &str,
        limit: usize,
    ) -> Result<Vec<Subscription>, String> {
        let postgres_url = self.postgres_url.clone();
        let renewal_cutoff_rfc3339 = renewal_cutoff_rfc3339.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<Subscription>, String> {
            let cutoff_dt = renewal_cutoff_rfc3339
                .parse::<chrono::DateTime<chrono::Utc>>()
                .map_err(|err| err.to_string())?;
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, plan_code, gateway, gateway_subscription_id,
                           status, billing_interval, credits_per_cycle, autopay_enabled,
                           current_period_start,
                           current_period_end,
                           next_renewal_at,
                           grace_period_until,
                           cancelled_at,
                           last_payment_order_id,
                           created_at,
                           updated_at
                    FROM subscriptions
                    WHERE next_renewal_at IS NOT NULL
                      AND next_renewal_at <= $1
                      AND status IN ('active', 'past_due')
                    ORDER BY next_renewal_at ASC
                    LIMIT $2
                    ",
                    &[&cutoff_dt, &(limit as i64)],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_subscription)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl InvoiceRepository for FileStorage {
    async fn create_invoice(&self, invoice: &Invoice) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let invoice = invoice.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client
                .execute(
                    "
                    INSERT INTO invoices (
                        id, account_id, invoice_type, billing_cycle_start, billing_cycle_end,
                        status, amount_cents, amount_after_credits, created_at,
                        finalized_at, paid_at, due_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8, $9,
                        $10, $11, $12, $13
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        account_id = EXCLUDED.account_id,
                        invoice_type = EXCLUDED.invoice_type,
                        billing_cycle_start = EXCLUDED.billing_cycle_start,
                        billing_cycle_end = EXCLUDED.billing_cycle_end,
                        status = EXCLUDED.status,
                        amount_cents = EXCLUDED.amount_cents,
                        amount_after_credits = EXCLUDED.amount_after_credits,
                        created_at = EXCLUDED.created_at,
                        finalized_at = EXCLUDED.finalized_at,
                        paid_at = EXCLUDED.paid_at,
                        due_at = EXCLUDED.due_at,
                        updated_at = EXCLUDED.updated_at
                    ",
                    &[
                        &invoice.id,
                        &invoice.account_id,
                        &Self::invoice_type_to_db(&invoice.invoice_type),
                        &invoice.billing_cycle_start,
                        &invoice.billing_cycle_end,
                        &Self::invoice_status_to_db(&invoice.status),
                        &invoice.amount_cents,
                        &invoice.amount_after_credits,
                        &invoice.created_at,
                        &invoice.finalized_at,
                        &invoice.paid_at,
                        &invoice.due_at,
                        &invoice.updated_at,
                    ],
                )
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_invoice(&self, invoice_id: &str) -> Result<Option<Invoice>, String> {
        let postgres_url = self.postgres_url.clone();
        let invoice_id = invoice_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<Invoice>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, invoice_type,
                           billing_cycle_start,
                           billing_cycle_end,
                           status, amount_cents, amount_after_credits,
                           created_at,
                           finalized_at,
                           paid_at,
                           due_at,
                           updated_at
                    FROM invoices
                    WHERE id = $1
                    ",
                    &[&invoice_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_invoice).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_invoice_for_update(&self, invoice_id: &str) -> Result<Option<Invoice>, String> {
        let postgres_url = self.postgres_url.clone();
        let invoice_id = invoice_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<Invoice>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, invoice_type,
                           billing_cycle_start,
                           billing_cycle_end,
                           status, amount_cents, amount_after_credits,
                           created_at,
                           finalized_at,
                           paid_at,
                           due_at,
                           updated_at
                    FROM invoices
                    WHERE id = $1
                    ",
                    &[&invoice_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_invoice).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_invoices_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<Invoice>, String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<Invoice>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, invoice_type,
                           billing_cycle_start,
                           billing_cycle_end,
                           status, amount_cents, amount_after_credits,
                           created_at,
                           finalized_at,
                           paid_at,
                           due_at,
                           updated_at
                    FROM invoices
                    WHERE account_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                    ",
                    &[&account_id, &(limit as i64)],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter().map(Self::postgres_row_to_invoice).collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_unpaid_invoices_for_account(
        &self,
        account_id: &str,
    ) -> Result<Vec<Invoice>, String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<Invoice>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, invoice_type,
                           billing_cycle_start,
                           billing_cycle_end,
                           status, amount_cents, amount_after_credits,
                           created_at,
                           finalized_at,
                           paid_at,
                           due_at,
                           updated_at
                    FROM invoices
                    WHERE account_id = $1 AND status <> 'paid'
                    ORDER BY created_at DESC
                    ",
                    &[&account_id],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter().map(Self::postgres_row_to_invoice).collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn update_invoice_status(
        &self,
        invoice_id: &str,
        status: InvoiceStatus,
    ) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let invoice_id = invoice_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let updated_at = Utc::now();
            client
                .execute(
                    "
                    UPDATE invoices
                    SET status = $2,
                        updated_at = $3
                    WHERE id = $1
                    ",
                    &[&invoice_id, &Self::invoice_status_to_db(&status), &updated_at],
                )
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn finalize_invoice(
        &self,
        invoice_id: &str,
        due_at_rfc3339: &str,
    ) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let invoice_id = invoice_id.to_string();
        let due_at_rfc3339 = due_at_rfc3339.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let now = Utc::now();
            client
                .execute(
                    "
                    UPDATE invoices
                    SET status = 'finalized',
                        finalized_at = COALESCE(finalized_at, $2::timestamptz),
                        due_at = $3::timestamptz,
                        updated_at = $2::timestamptz
                    WHERE id = $1
                    ",
                    &[&invoice_id, &now, &due_at_rfc3339],
                )
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl InvoiceLineRepository for FileStorage {
    async fn add_line(&self, line: &InvoiceLine) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let line = line.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client
                .execute(
                    "
                    INSERT INTO invoice_lines (
                        id, invoice_id, line_type, description, amount_cents,
                        quantity, unit_price_cents, is_prorated,
                        period_start, period_end, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8,
                        $9, $10, $11, $12
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        invoice_id = EXCLUDED.invoice_id,
                        line_type = EXCLUDED.line_type,
                        description = EXCLUDED.description,
                        amount_cents = EXCLUDED.amount_cents,
                        quantity = EXCLUDED.quantity,
                        unit_price_cents = EXCLUDED.unit_price_cents,
                        is_prorated = EXCLUDED.is_prorated,
                        period_start = EXCLUDED.period_start,
                        period_end = EXCLUDED.period_end,
                        created_at = EXCLUDED.created_at,
                        updated_at = EXCLUDED.updated_at
                    ",
                    &[
                        &line.id,
                        &line.invoice_id,
                        &Self::invoice_line_type_to_db(&line.line_type),
                        &line.description,
                        &line.amount_cents,
                        &(line.quantity as i32),
                        &line.unit_price_cents,
                        &line.is_prorated,
                        &line.period_start,
                        &line.period_end,
                        &line.created_at,
                        &line.updated_at,
                    ],
                )
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_lines_for_invoice(&self, invoice_id: &str) -> Result<Vec<InvoiceLine>, String> {
        let postgres_url = self.postgres_url.clone();
        let invoice_id = invoice_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<InvoiceLine>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, invoice_id, line_type, description, amount_cents,
                           quantity, unit_price_cents, is_prorated,
                           period_start,
                           period_end,
                           created_at,
                           updated_at
                    FROM invoice_lines
                    WHERE invoice_id = $1
                    ORDER BY created_at ASC
                    ",
                    &[&invoice_id],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_invoice_line)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn delete_line(&self, line_id: &str) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let line_id = line_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client
                .execute("DELETE FROM invoice_lines WHERE id = $1", &[&line_id])
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn sum_invoice_lines(&self, invoice_id: &str) -> Result<i64, String> {
        let postgres_url = self.postgres_url.clone();
        let invoice_id = invoice_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<i64, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_one(
                    "
                    SELECT COALESCE(SUM(amount_cents), 0)::BIGINT AS total
                    FROM invoice_lines
                    WHERE invoice_id = $1
                    ",
                    &[&invoice_id],
                )
                .map_err(|err| err.to_string())?;
            Ok(row.get::<_, i64>("total"))
        })
        .await
        .map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl PaymentIntentRepository for FileStorage {
    async fn create_payment_intent(&self, pi: &PaymentIntent) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let pi = pi.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client.execute(
                "
                INSERT INTO payment_intents (
                    id, account_id, invoice_id, status, amount_cents,
                    idempotency_key, payment_method_id, gateway_payment_intent_id,
                    authorize_error, authorized_at, captured_at, canceled_at,
                    attempt_count, next_retry_at, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8,
                    $9, $10, $11, $12,
                    $13, $14, $15, $16
                )
                ON CONFLICT (id) DO UPDATE SET
                    account_id = EXCLUDED.account_id,
                    invoice_id = EXCLUDED.invoice_id,
                    status = EXCLUDED.status,
                    amount_cents = EXCLUDED.amount_cents,
                    idempotency_key = EXCLUDED.idempotency_key,
                    payment_method_id = EXCLUDED.payment_method_id,
                    gateway_payment_intent_id = EXCLUDED.gateway_payment_intent_id,
                    authorize_error = EXCLUDED.authorize_error,
                    authorized_at = EXCLUDED.authorized_at,
                    captured_at = EXCLUDED.captured_at,
                    canceled_at = EXCLUDED.canceled_at,
                    attempt_count = EXCLUDED.attempt_count,
                    next_retry_at = EXCLUDED.next_retry_at,
                    updated_at = EXCLUDED.updated_at
                ",
                &[
                    &pi.id,
                    &pi.account_id,
                    &pi.invoice_id,
                    &Self::payment_intent_status_to_db(&pi.status),
                    &pi.amount_cents,
                    &pi.idempotency_key,
                    &pi.payment_method_id,
                    &pi.gateway_payment_intent_id,
                    &pi.authorize_error,
                    &pi.authorized_at,
                    &pi.captured_at,
                    &pi.canceled_at,
                    &(pi.attempt_count as i32),
                    &pi.next_retry_at,
                    &pi.created_at,
                    &pi.updated_at,
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_payment_intent(&self, pi_id: &str) -> Result<Option<PaymentIntent>, String> {
        let postgres_url = self.postgres_url.clone();
        let pi_id = pi_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<PaymentIntent>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, invoice_id, status, amount_cents,
                           idempotency_key, payment_method_id, gateway_payment_intent_id,
                           authorize_error,
                           authorized_at,
                           captured_at,
                           canceled_at,
                           attempt_count,
                           next_retry_at,
                           created_at,
                           updated_at
                    FROM payment_intents
                    WHERE id = $1
                    ",
                    &[&pi_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_payment_intent).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_payment_intent_by_invoice_id(
        &self,
        invoice_id: &str,
    ) -> Result<Option<PaymentIntent>, String> {
        let postgres_url = self.postgres_url.clone();
        let invoice_id = invoice_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<PaymentIntent>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, invoice_id, status, amount_cents,
                           idempotency_key, payment_method_id, gateway_payment_intent_id,
                           authorize_error,
                           authorized_at,
                           captured_at,
                           canceled_at,
                           attempt_count,
                           next_retry_at,
                           created_at,
                           updated_at
                    FROM payment_intents
                    WHERE invoice_id = $1
                    ",
                    &[&invoice_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_payment_intent).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn update_payment_intent_status(
        &self,
        pi_id: &str,
        status: PaymentIntentStatus,
    ) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let pi_id = pi_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client
                .execute(
                    "UPDATE payment_intents SET status = $2, updated_at = $3::timestamptz WHERE id = $1",
                    &[&pi_id, &Self::payment_intent_status_to_db(&status), &Utc::now()],
                )
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_retryable_payment_intents(
        &self,
        now_rfc3339: &str,
    ) -> Result<Vec<PaymentIntent>, String> {
        let postgres_url = self.postgres_url.clone();
        let now_rfc3339 = now_rfc3339.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<PaymentIntent>, String> {
            let now_dt = now_rfc3339
                .parse::<chrono::DateTime<chrono::Utc>>()
                .map_err(|err| err.to_string())?;
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, invoice_id, status, amount_cents,
                           idempotency_key, payment_method_id, gateway_payment_intent_id,
                           authorize_error,
                           authorized_at,
                           captured_at,
                           canceled_at,
                           attempt_count,
                           next_retry_at,
                           created_at,
                           updated_at
                    FROM payment_intents
                    WHERE status IN ('pending', 'failed')
                      AND next_retry_at IS NOT NULL
                      AND next_retry_at <= $1
                    ORDER BY next_retry_at ASC
                    ",
                    &[&now_dt],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_payment_intent)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl DunningCaseRepository for FileStorage {
    async fn create_dunning_case(&self, dc: &DunningCase) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let dc = dc.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let attempt_schedule_json =
                serde_json::to_string(&dc.attempt_schedule).map_err(|err| err.to_string())?;
            client.execute(
                "
                INSERT INTO dunning_cases (
                    id, account_id, invoice_id, payment_intent_id, status,
                    attempt_schedule_json, grace_period_end, final_attempt_at,
                    created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8,
                    $9, $10
                )
                ON CONFLICT (id) DO UPDATE SET
                    account_id = EXCLUDED.account_id,
                    invoice_id = EXCLUDED.invoice_id,
                    payment_intent_id = EXCLUDED.payment_intent_id,
                    status = EXCLUDED.status,
                    attempt_schedule_json = EXCLUDED.attempt_schedule_json,
                    grace_period_end = EXCLUDED.grace_period_end,
                    final_attempt_at = EXCLUDED.final_attempt_at,
                    updated_at = EXCLUDED.updated_at
                ",
                &[
                    &dc.id,
                    &dc.account_id,
                    &dc.invoice_id,
                    &dc.payment_intent_id,
                    &Self::dunning_status_to_db(&dc.status),
                    &attempt_schedule_json,
                    &dc.grace_period_end,
                    &dc.final_attempt_at,
                    &dc.created_at,
                    &dc.updated_at,
                ],
            ).map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_dunning_case(&self, dc_id: &str) -> Result<Option<DunningCase>, String> {
        let postgres_url = self.postgres_url.clone();
        let dc_id = dc_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<DunningCase>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, invoice_id, payment_intent_id, status,
                           attempt_schedule_json,
                           grace_period_end,
                           final_attempt_at,
                           created_at,
                           updated_at
                    FROM dunning_cases
                    WHERE id = $1
                    ",
                    &[&dc_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_dunning_case).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_dunning_case_by_invoice_id(
        &self,
        invoice_id: &str,
    ) -> Result<Option<DunningCase>, String> {
        let postgres_url = self.postgres_url.clone();
        let invoice_id = invoice_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<DunningCase>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, account_id, invoice_id, payment_intent_id, status,
                           attempt_schedule_json,
                           grace_period_end,
                           final_attempt_at,
                           created_at,
                           updated_at
                    FROM dunning_cases
                    WHERE invoice_id = $1
                    ",
                    &[&invoice_id],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_dunning_case).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_active_dunning_cases(&self) -> Result<Vec<DunningCase>, String> {
        let postgres_url = self.postgres_url.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<DunningCase>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, invoice_id, payment_intent_id, status,
                           attempt_schedule_json,
                           grace_period_end,
                           final_attempt_at,
                           created_at,
                           updated_at
                    FROM dunning_cases
                    WHERE status = 'active'
                    ORDER BY updated_at DESC
                    ",
                    &[],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter().map(Self::postgres_row_to_dunning_case).collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn update_dunning_case_status(
        &self,
        dc_id: &str,
        status: DunningStatus,
    ) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let dc_id = dc_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client
                .execute(
                    "UPDATE dunning_cases SET status = $2, updated_at = $3::timestamptz WHERE id = $1",
                    &[&dc_id, &Self::dunning_status_to_db(&status), &Utc::now()],
                )
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn append_retry_attempt(
        &self,
        dc_id: &str,
        attempt: RetryAttempt,
    ) -> Result<(), String> {
        let mut case_item = self
            .get_dunning_case(dc_id)
            .await?
            .ok_or_else(|| format!("dunning case `{dc_id}` not found"))?;
        case_item.attempt_schedule.push(attempt);
        case_item.updated_at = Utc::now();
        self.create_dunning_case(&case_item).await
    }
}

#[async_trait]
impl WebhookEventRepository for FileStorage {
    async fn create_webhook_event(&self, event: &WebhookEvent) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let event = event.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client
                .execute(
                    "
                    INSERT INTO webhook_events (
                        id, event_identifier, event_type, payload_json, processed_at, created_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6
                    )
                    ON CONFLICT (event_identifier) DO NOTHING
                    ",
                    &[
                        &event.id,
                        &event.event_identifier,
                        &event.event_type,
                        &serde_json::to_string(&event.payload).map_err(|err| err.to_string())?,
                        &event.processed_at,
                        &event.created_at,
                    ],
                )
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn get_webhook_event(
        &self,
        event_identifier: &str,
    ) -> Result<Option<WebhookEvent>, String> {
        let postgres_url = self.postgres_url.clone();
        let event_identifier = event_identifier.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<WebhookEvent>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let row = client
                .query_opt(
                    "
                    SELECT id, event_identifier, event_type,
                           payload_json,
                           processed_at,
                           created_at
                    FROM webhook_events
                    WHERE event_identifier = $1
                    ",
                    &[&event_identifier],
                )
                .map_err(|err| err.to_string())?;
            row.map(Self::postgres_row_to_webhook_event).transpose()
        })
        .await
        .map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl FinancialAuditRepository for FileStorage {
    async fn log_event(&self, audit: &FinancialAuditLog) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let audit = audit.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            client
                .execute(
                    "
                    INSERT INTO financial_audit_logs (
                        id, account_id, event_type, entity_type, entity_id,
                        actor, before_state_json, after_state_json, created_at
                    ) VALUES (
                        $1, $2, $3, $4, $5,
                        $6, $7, $8, $9
                    )
                    ON CONFLICT (id) DO NOTHING
                    ",
                    &[
                        &audit.id,
                        &audit.account_id,
                        &audit.event_type,
                        &audit.entity_type,
                        &audit.entity_id,
                        &audit.actor,
                        &serde_json::to_string(&audit.before_state).map_err(|err| err.to_string())?,
                        &serde_json::to_string(&audit.after_state).map_err(|err| err.to_string())?,
                        &audit.created_at,
                    ],
                )
                .map_err(|err| err.to_string())?;
            Ok(())
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_logs_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<FinancialAuditLog>, String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        let sql_limit = i64::try_from(limit).map_err(|_| "limit exceeds i64".to_string())?;
        tokio::task::spawn_blocking(move || -> Result<Vec<FinancialAuditLog>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, event_type, entity_type, entity_id, actor,
                           before_state_json, after_state_json,
                           created_at
                    FROM financial_audit_logs
                    WHERE account_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                    ",
                    &[&account_id, &sql_limit],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_financial_audit_log)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }

    async fn list_all_audit_logs(&self, limit: usize) -> Result<Vec<FinancialAuditLog>, String> {
        let postgres_url = self.postgres_url.clone();
        let sql_limit = i64::try_from(limit).map_err(|_| "limit exceeds i64".to_string())?;
        tokio::task::spawn_blocking(move || -> Result<Vec<FinancialAuditLog>, String> {
            let mut client =
                get_pg_client(&postgres_url).map_err(|err| err.to_string())?;
            let rows = client
                .query(
                    "
                    SELECT id, account_id, event_type, entity_type, entity_id, actor,
                           before_state_json, after_state_json,
                           created_at
                    FROM financial_audit_logs
                    ORDER BY created_at DESC
                    LIMIT $1
                    ",
                    &[&sql_limit],
                )
                .map_err(|err| err.to_string())?;
            rows.into_iter()
                .map(Self::postgres_row_to_financial_audit_log)
                .collect()
        })
        .await
        .map_err(|err| err.to_string())?

    }
}

#[async_trait]
impl SchoolRepository for FileStorage {
    async fn save_school(&self, school: &ai_tutor_domain::school::School) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let school = school.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            // Ensure new columns exist (safe to run every time)
            let _ = client.execute(
                "ALTER TABLE schools ADD COLUMN IF NOT EXISTS institution_type TEXT NOT NULL DEFAULT 'school'",
                &[],
            );
            let _ = client.execute(
                "ALTER TABLE schools ADD COLUMN IF NOT EXISTS description TEXT",
                &[],
            );
            client.execute(
                "INSERT INTO schools (id, name, operator_email, institution_type, description, plan, credit_pool, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (id) DO UPDATE SET
                     name = EXCLUDED.name,
                     operator_email = EXCLUDED.operator_email,
                     institution_type = EXCLUDED.institution_type,
                     description = EXCLUDED.description,
                     plan = EXCLUDED.plan,
                     credit_pool = EXCLUDED.credit_pool,
                     updated_at = EXCLUDED.updated_at",
                &[&school.id, &school.name, &school.operator_email,
                  &school.institution_type, &school.description,
                  &school.plan, &school.credit_pool, &school.created_at, &school.updated_at],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).await.map_err(|e| e.to_string())?

    }

    async fn get_school(&self, id: &str) -> Result<Option<ai_tutor_domain::school::School>, String> {
        let postgres_url = self.postgres_url.clone();
        let id = id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<ai_tutor_domain::school::School>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            let row = client.query_opt(
                "SELECT id, name, operator_email, plan, credit_pool, created_at, updated_at FROM schools WHERE id = $1",
                &[&id],
            ).map_err(|e| e.to_string())?;
            row.map(Self::postgres_row_to_school).transpose()
        }).await.map_err(|e| e.to_string())?

    }

    async fn list_schools(&self, limit: usize) -> Result<Vec<ai_tutor_domain::school::School>, String> {
        let postgres_url = self.postgres_url.clone();
        let sql_limit = i64::try_from(limit).map_err(|_| "limit overflow".to_string())?;
        tokio::task::spawn_blocking(move || -> Result<Vec<ai_tutor_domain::school::School>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            let rows = client.query(
                "SELECT id, name, operator_email, plan, credit_pool, created_at, updated_at FROM schools ORDER BY created_at DESC LIMIT $1",
                &[&sql_limit],
            ).map_err(|e| e.to_string())?;
            rows.into_iter().map(Self::postgres_row_to_school).collect()
        }).await.map_err(|e| e.to_string())?

    }

    async fn set_user_school(&self, account_id: &str, school_id: Option<&str>) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let account_id = account_id.to_string();
        let school_id = school_id.map(|s| s.to_string());
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            client.execute(
                "UPDATE tutor_accounts SET school_id = $1, updated_at = NOW() WHERE id = $2",
                &[&school_id, &account_id],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).await.map_err(|e| e.to_string())?

    }

    async fn list_school_members(&self, school_id: &str) -> Result<Vec<ai_tutor_domain::auth::TutorAccount>, String> {
        let postgres_url = self.postgres_url.clone();
        let school_id = school_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<ai_tutor_domain::auth::TutorAccount>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            let rows = client.query(
                "SELECT id, email, google_id, phone_number, phone_verified, status, school_id, created_at, updated_at
                 FROM tutor_accounts WHERE school_id = $1 ORDER BY created_at DESC",
                &[&school_id],
            ).map_err(|e| e.to_string())?;
            rows.into_iter().map(Self::postgres_row_to_tutor_account).collect()
        }).await.map_err(|e| e.to_string())?

    }

    async fn save_school_invoice(&self, invoice: &ai_tutor_domain::school::SchoolInvoice) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let invoice = invoice.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            let status_str = match invoice.status {
                ai_tutor_domain::school::SchoolInvoiceStatus::Pending => "pending",
                ai_tutor_domain::school::SchoolInvoiceStatus::Paid => "paid",
                ai_tutor_domain::school::SchoolInvoiceStatus::Overdue => "overdue",
                ai_tutor_domain::school::SchoolInvoiceStatus::Cancelled => "cancelled",
            };
            client.execute(
                "INSERT INTO school_invoices (id, school_id, amount_cents, payment_link, status, due_at, created_at, paid_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (id) DO UPDATE SET
                     status = EXCLUDED.status,
                     payment_link = EXCLUDED.payment_link,
                     paid_at = EXCLUDED.paid_at",
                &[&invoice.id, &invoice.school_id, &invoice.amount_cents, &invoice.payment_link,
                  &status_str, &invoice.due_at, &invoice.created_at, &invoice.paid_at],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).await.map_err(|e| e.to_string())?

    }

    async fn get_school_invoice(&self, id: &str) -> Result<Option<ai_tutor_domain::school::SchoolInvoice>, String> {
        let postgres_url = self.postgres_url.clone();
        let id = id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Option<ai_tutor_domain::school::SchoolInvoice>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            let row = client.query_opt(
                "SELECT id, school_id, amount_cents, payment_link, status, due_at, created_at, paid_at FROM school_invoices WHERE id = $1",
                &[&id],
            ).map_err(|e| e.to_string())?;
            row.map(Self::postgres_row_to_school_invoice).transpose()
        }).await.map_err(|e| e.to_string())?

    }

    async fn list_school_invoices(&self, school_id: &str) -> Result<Vec<ai_tutor_domain::school::SchoolInvoice>, String> {
        let postgres_url = self.postgres_url.clone();
        let school_id = school_id.to_string();
        tokio::task::spawn_blocking(move || -> Result<Vec<ai_tutor_domain::school::SchoolInvoice>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            let rows = client.query(
                "SELECT id, school_id, amount_cents, payment_link, status, due_at, created_at, paid_at
                 FROM school_invoices WHERE school_id = $1 ORDER BY created_at DESC",
                &[&school_id],
            ).map_err(|e| e.to_string())?;
            rows.into_iter().map(Self::postgres_row_to_school_invoice).collect()
        }).await.map_err(|e| e.to_string())?

    }
}

// ── Operator Email methods (inherent) ────────────────────────────────────
impl FileStorage {
    pub async fn list_operator_emails(&self) -> Result<Vec<String>, String> {
        let postgres_url = self.postgres_url.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            let rows = client.query(
                "SELECT email FROM operator_emails ORDER BY email ASC",
                &[],
            ).map_err(|e| e.to_string())?;
            Ok(rows.iter().map(|r| r.get::<_, String>("email")).collect())
        }).await.map_err(|e| e.to_string())?
    }

    pub async fn add_operator_email(&self, email: &str) -> Result<bool, String> {
        let postgres_url = self.postgres_url.clone();
        let email = email.trim().to_ascii_lowercase();
        tokio::task::spawn_blocking(move || -> Result<bool, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            let now = chrono::Utc::now();
            let result = client.execute(
                "INSERT INTO operator_emails (email, created_at, updated_at) VALUES ($1, $2, $3)
                 ON CONFLICT (email) DO UPDATE SET updated_at = EXCLUDED.updated_at",
                &[&email, &now, &now],
            ).map_err(|e| e.to_string())?;
            Ok(result > 0)
        }).await.map_err(|e| e.to_string())?
    }

    pub async fn remove_operator_email(&self, email: &str) -> Result<bool, String> {
        let postgres_url = self.postgres_url.clone();
        let email = email.trim().to_ascii_lowercase();
        tokio::task::spawn_blocking(move || -> Result<bool, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            Self::run_postgres_migrations(&mut client).map_err(|e| e.to_string())?;
            let result = client.execute(
                "DELETE FROM operator_emails WHERE email = $1",
                &[&email],
            ).map_err(|e| e.to_string())?;
            Ok(result > 0)
        }).await.map_err(|e| e.to_string())?
    }

    pub async fn get_system_metrics(&self) -> Result<SystemMetricsResponse, String> {
        let postgres_url = self.postgres_url.clone();
        tokio::task::spawn_blocking(move || -> Result<SystemMetricsResponse, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;

            let db_name: String = client.query_opt(
                "SELECT current_database()",
                &[],
            ).map_err(|e| e.to_string())?
            .map(|row| row.get(0))
            .unwrap_or_default();

            let size_bytes: i64 = client.query_one(
                "SELECT pg_database_size(current_database())",
                &[],
            ).map_err(|e| e.to_string())?
            .get(0);

            let size_human = if size_bytes >= 1_073_741_824 {
                format!("{:.1} GB", size_bytes as f64 / 1_073_741_824.0)
            } else if size_bytes >= 1_048_576 {
                format!("{:.1} MB", size_bytes as f64 / 1_048_576.0)
            } else if size_bytes >= 1_024 {
                format!("{:.1} KB", size_bytes as f64 / 1_024.0)
            } else {
                format!("{} B", size_bytes)
            };

            let table_rows = client.query(
                "SELECT relname, n_live_tup
                 FROM pg_stat_user_tables
                 WHERE schemaname = 'public'
                 ORDER BY n_live_tup DESC",
                &[],
            ).map_err(|e| e.to_string())?;
            let tables: Vec<TableMetrics> = table_rows.iter().map(|row| {
                TableMetrics {
                    table_name: row.get(0),
                    row_count: row.get(1),
                }
            }).collect();

            let conn_row = client.query_one(
                "SELECT
                    COUNT(*)::int8 AS total,
                    COUNT(*) FILTER (WHERE state = 'active')::int8 AS active,
                    COUNT(*) FILTER (WHERE state = 'idle')::int8 AS idle,
                    COUNT(*) FILTER (WHERE state = 'idle in transaction')::int8 AS idle_in_transaction,
                    COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL)::int8 AS waiting
                 FROM pg_stat_activity
                 WHERE datname = $1",
                &[&db_name],
            ).map_err(|e| e.to_string())?;

            let max_connections: i64 = client.query_one(
                "SELECT setting::int8 FROM pg_settings WHERE name = 'max_connections'",
                &[],
            ).map_err(|e| e.to_string())?.get(0);

            Ok(SystemMetricsResponse {
                database: DatabaseMetrics {
                    size_bytes,
                    size_human,
                },
                tables,
                connections: ConnectionMetrics {
                    total: conn_row.get(0),
                    active: conn_row.get(1),
                    idle: conn_row.get(2),
                    idle_in_transaction: conn_row.get(3),
                    waiting: conn_row.get(4),
                    max_connections,
                },
            })
        }).await.map_err(|e| e.to_string())?
    }
}

#[async_trait]
impl crate::repositories::ApiUsageRepository for FileStorage {
    async fn insert_api_usage_record(
        &self,
        record: &ai_tutor_domain::billing::ApiUsageRecord,
    ) -> Result<(), String> {
        let postgres_url = self.postgres_url.clone();
        let record = record.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            // CREATE TABLE IF NOT EXISTS — avoids requiring a migration on existing deployments.
            client.execute(
                "CREATE TABLE IF NOT EXISTS api_usage_records (
                    id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    component TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    input_tokens BIGINT NOT NULL DEFAULT 0,
                    output_tokens BIGINT NOT NULL DEFAULT 0,
                    cost_usd_millicents BIGINT NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )",
                &[],
            ).map_err(|e| e.to_string())?;
            client.execute(
                "INSERT INTO api_usage_records
                    (id, account_id, component, provider, model_id, input_tokens, output_tokens, cost_usd_millicents, created_at, lesson_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                &[
                    &record.id,
                    &record.account_id,
                    &record.component,
                    &record.provider,
                    &record.model_id,
                    &record.input_tokens,
                    &record.output_tokens,
                    &record.cost_usd_millicents,
                    &record.created_at,
                    &record.lesson_id,
                ],
            ).map_err(|e| e.to_string())?;
            Ok(())

        }).await.map_err(|e| e.to_string())?
    }

    async fn insert_api_usage_records_batch(
        &self,
        records: &[ai_tutor_domain::billing::ApiUsageRecord],
    ) -> Result<(), String> {
        if records.is_empty() {
            return Ok(());
        }
        let postgres_url = self.postgres_url.clone();
        let batch = records.to_vec();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            let mut tx = client.transaction().map_err(|e| e.to_string())?;
            for record in &batch {
                tx.execute(
                    "INSERT INTO api_usage_records
                        (id, account_id, component, provider, model_id, input_tokens, output_tokens, cost_usd_millicents, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     ON CONFLICT (id) DO NOTHING",
                    &[
                        &record.id,
                        &record.account_id,
                        &record.component,
                        &record.provider,
                        &record.model_id,
                        &record.input_tokens,
                        &record.output_tokens,
                        &record.cost_usd_millicents,
                        &record.created_at,
                    ],
                ).map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    async fn list_api_usage_records_since(
        &self,
        since: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<ai_tutor_domain::billing::ApiUsageRecord>, String> {
        let postgres_url = self.postgres_url.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<ai_tutor_domain::billing::ApiUsageRecord>, String> {
            let mut client = get_pg_client(&postgres_url).map_err(|e| e.to_string())?;
            // Return empty if table doesn't exist yet
            let table_exists: bool = client.query_one(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_usage_records')",
                &[],
            ).map(|row| row.get::<_, bool>(0)).unwrap_or(false);

            if !table_exists {
                return Ok(vec![]);
            }

            let rows = client.query(
                "SELECT id, account_id, component, provider, model_id,
                        input_tokens, output_tokens, cost_usd_millicents, created_at,
                        lesson_id
                 FROM api_usage_records
                 WHERE created_at >= $1
                 ORDER BY created_at DESC
                 LIMIT 50000",
                &[&since],
            ).map_err(|e| e.to_string())?;

            rows.into_iter().map(|row| {
                Ok(ai_tutor_domain::billing::ApiUsageRecord {
                    id:                  row.get(0),
                    account_id:          row.get(1),
                    component:           row.get(2),
                    provider:            row.get(3),
                    model_id:            row.get(4),
                    input_tokens:        row.get(5),
                    output_tokens:       row.get(6),
                    cost_usd_millicents: row.get(7),
                    created_at:          row.get(8),
                    lesson_id:           row.get(9),
                })
            }).collect()
        })
        .await
        .map_err(|e| e.to_string())?

    }
}


#[cfg(test)]
mod tests {
    use PathBuf;

    use chrono::{Duration as ChronoDuration, Utc};
    use tokio::runtime::Runtime;

    use ai_tutor_domain::{
        auth::{TutorAccount, TutorAccountStatus},
        billing::{BillingInterval, Subscription, SubscriptionStatus},
        credits::{CreditEntryKind, CreditLedgerEntry},
        generation::{AgentMode, Language, LessonGenerationRequest, UserRequirements},
        job::{
            LessonGenerationJob, LessonGenerationJobInputSummary, LessonGenerationJobStatus,
            LessonGenerationStep, QueuedLessonJobSnapshot,
        },
        lesson::Lesson,
        runtime::{DirectorState, RuntimeActionExecutionRecord, RuntimeActionExecutionStatus},
        scene::Stage,
    };

    use super::FileStorage;
    use crate::repositories::{
        CreditLedgerRepository, LessonJobRepository, LessonRepository,
        RuntimeActionExecutionRepository, RuntimeSessionRepository, SubscriptionRepository,
        TutorAccountRepository,
    };

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-tutor-storage-test-{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn saves_and_reads_lesson() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let now = Utc::now();
            let lesson = Lesson {
                id: "lesson-1".to_string(),
                account_id: None,
                school_id: None,
                title: "Gravity".to_string(),
                language: "en-US".to_string(),
                description: Some("Physics lesson".to_string()),
                stage: Some(Stage {
                    id: "stage-1".to_string(),
                    name: "Gravity".to_string(),
                    description: None,
                    created_at: now.timestamp_millis(),
                    updated_at: now.timestamp_millis(),
                    language: Some("en-US".to_string()),
                    style: Some("interactive".to_string()),
                    whiteboard: vec![],
                    agent_ids: vec![],
                    generated_agent_configs: vec![],
                }),
                scenes: vec![],
                style: Some("interactive".to_string()),
                agent_ids: vec![],
                created_at: now,
                updated_at: now,
            };

            storage.save_lesson(&lesson).await.unwrap();
            let loaded = storage.get_lesson("lesson-1").await.unwrap().unwrap();
            assert_eq!(loaded.id, lesson.id);
            assert_eq!(loaded.title, lesson.title);
        });
    }

    #[test]
    fn saves_and_reads_lesson_from_sqlite() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let root = temp_root();
            let db_path = root.join("runtime").join("lessons.db");
            let storage = FileStorage::with_lesson_db(&root, &db_path);
            let now = Utc::now();
            let lesson = Lesson {
                id: "lesson-sqlite-1".to_string(),
                account_id: None,
                school_id: None,
                title: "Fractions".to_string(),
                language: "en-US".to_string(),
                description: Some("Understand fractions".to_string()),
                stage: None,
                scenes: vec![],
                style: Some("interactive".to_string()),
                agent_ids: vec![],
                created_at: now,
                updated_at: now,
            };

            storage.save_lesson(&lesson).await.unwrap();
            let loaded = storage
                .get_lesson("lesson-sqlite-1")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.id, lesson.id);
            assert_eq!(loaded.title, lesson.title);
            assert!(db_path.exists());
        });
    }

    #[test]
    fn marks_stale_running_job_as_failed_on_read() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let req = LessonGenerationRequest {
                requirements: UserRequirements {
                    requirement: "Teach me fractions".to_string(),
                    language: Language::EnUs,
                    user_nickname: None,
                    user_bio: None,

                },
                pdf_content: None,

                enable_image_generation: false,
                enable_video_generation: false,
                enable_tts: false,
                agent_mode: AgentMode::Default,
                account_id: None,
                school_id: None,
                quality_mode: None,
                learning_mode: None,
                precharged_credits: None,
            };
            let stale_time = Utc::now() - ChronoDuration::minutes(31);
            let job = LessonGenerationJob {
                id: "job-1".to_string(),
                account_id: None,
                school_id: None,
                status: LessonGenerationJobStatus::Running,
                step: LessonGenerationStep::GeneratingScenes,
                progress: 70,
                message: "Generating".to_string(),
                created_at: stale_time,
                updated_at: stale_time,
                started_at: Some(stale_time),
                completed_at: None,
                input_summary: LessonGenerationJobInputSummary::from(&req),
                scenes_generated: 2,
                total_scenes: Some(5),
                result: None,
                error: None,
            };

            storage.create_job(&job).await.unwrap();
            let loaded = storage.get_job("job-1").await.unwrap().unwrap();
            assert!(matches!(loaded.status, LessonGenerationJobStatus::Failed));
            assert!(matches!(loaded.step, LessonGenerationStep::Failed));
        });
    }

    #[test]
    fn saves_and_reads_runtime_session_state() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let state = DirectorState {
                turn_count: 2,
                agent_responses: vec![],
                whiteboard_ledger: vec![],
                whiteboard_state: None,
            };

            storage
                .save_runtime_session("session-1", &state)
                .await
                .unwrap();
            let loaded = storage
                .get_runtime_session("session-1")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.turn_count, 2);
        });
    }

    #[test]
    fn saves_and_reads_runtime_session_state_from_sqlite() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let root = temp_root();
            let db_path = root.join("runtime").join("runtime-sessions.db");
            let storage = FileStorage::with_runtime_db(&root, &db_path);
            let state = DirectorState {
                turn_count: 3,
                agent_responses: vec![],
                whiteboard_ledger: vec![],
                whiteboard_state: None,
            };

            storage
                .save_runtime_session("session-sqlite", &state)
                .await
                .unwrap();
            let loaded = storage
                .get_runtime_session("session-sqlite")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.turn_count, 3);
            assert!(!storage.runtime_session_path("session-sqlite").exists());
            assert!(db_path.exists());
        });
    }

    #[test]
    fn saves_and_reads_runtime_action_execution_state() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let record = RuntimeActionExecutionRecord {
                session_id: "session-1".to_string(),
                runtime_session_mode: "stateless_client_state".to_string(),
                execution_id: "exec-1".to_string(),
                action_name: "wb_open".to_string(),
                status: RuntimeActionExecutionStatus::Pending,
                created_at_unix_ms: 1_700_000_000_000,
                updated_at_unix_ms: 1_700_000_000_000,
                timeout_at_unix_ms: 1_700_000_015_000,
                last_error: None,
            };

            storage
                .save_runtime_action_execution(&record)
                .await
                .unwrap();
            let loaded = storage
                .get_runtime_action_execution("exec-1")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.execution_id, "exec-1");
            assert_eq!(loaded.session_id, "session-1");
            let listed = storage
                .list_runtime_action_executions_for_session("session-1")
                .await
                .unwrap();
            assert_eq!(listed.len(), 1);
        });
    }

    #[test]
    fn saves_and_reads_runtime_action_execution_state_from_sqlite() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let root = temp_root();
            let db_path = root.join("runtime").join("runtime-actions.db");
            let storage = FileStorage::with_runtime_db(&root, &db_path);
            let record = RuntimeActionExecutionRecord {
                session_id: "session-sqlite".to_string(),
                runtime_session_mode: "managed_runtime_session".to_string(),
                execution_id: "exec-sqlite".to_string(),
                action_name: "wb_draw_text".to_string(),
                status: RuntimeActionExecutionStatus::Accepted,
                created_at_unix_ms: 1_700_000_000_000,
                updated_at_unix_ms: 1_700_000_000_500,
                timeout_at_unix_ms: 1_700_000_015_000,
                last_error: None,
            };

            storage
                .save_runtime_action_execution(&record)
                .await
                .unwrap();
            let loaded = storage
                .get_runtime_action_execution("exec-sqlite")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.action_name, "wb_draw_text");
            let listed = storage
                .list_runtime_action_executions_for_session("session-sqlite")
                .await
                .unwrap();
            assert_eq!(listed.len(), 1);
            assert!(db_path.exists());
        });
    }

    #[test]
    fn saves_and_reads_job_from_sqlite() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let root = temp_root();
            let db_path = root.join("runtime").join("lesson-jobs.db");
            let storage = FileStorage::with_job_db(&root, &db_path);
            let req = LessonGenerationRequest {
                requirements: UserRequirements {
                    requirement: "Teach percentages".to_string(),
                    language: Language::EnUs,
                    user_nickname: None,
                    user_bio: None,

                },
                pdf_content: None,

                enable_image_generation: false,
                enable_video_generation: false,
                enable_tts: false,
                agent_mode: AgentMode::Default,
                account_id: None,
                school_id: None,
                quality_mode: None,
                learning_mode: None,
                precharged_credits: None,
            };
            let now = Utc::now();
            let job = LessonGenerationJob {
                id: "job-sqlite-1".to_string(),
                account_id: None,
                school_id: None,
                status: LessonGenerationJobStatus::Queued,
                step: LessonGenerationStep::Queued,
                progress: 0,
                message: "Queued".to_string(),
                created_at: now,
                updated_at: now,
                started_at: None,
                completed_at: None,
                input_summary: LessonGenerationJobInputSummary::from(&req),
                scenes_generated: 0,
                total_scenes: None,
                result: None,
                error: None,
            };

            storage.create_job(&job).await.unwrap();
            let loaded = storage.get_job("job-sqlite-1").await.unwrap().unwrap();
            assert_eq!(loaded.id, "job-sqlite-1");
            assert!(matches!(loaded.status, LessonGenerationJobStatus::Queued));
            assert!(db_path.exists());
        });
    }

    #[test]
    fn saves_and_reads_tutor_accounts_and_enforces_uniqueness() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let root = temp_root();
            let storage = FileStorage::new(&root);
            let now = Utc::now();

            let account = TutorAccount {
                id: "acct-1".to_string(),
                email: "learner@example.com".to_string(),
                google_id: "google-123".to_string(),
                phone_number: None,
                phone_verified: false,
                status: TutorAccountStatus::PartialAuth,
                school_id: None,
                created_at: now,
                updated_at: now,
            };

            storage.save_tutor_account(&account).await.unwrap();
            let loaded = storage
                .get_tutor_account_by_google_id("google-123")
                .await
                .unwrap()
                .expect("account should exist");
            assert_eq!(loaded.email, "learner@example.com");

            let conflicting = TutorAccount {
                id: "acct-2".to_string(),
                email: "other@example.com".to_string(),
                google_id: "google-123".to_string(),
                phone_number: Some("+15551234567".to_string()),
                phone_verified: true,
                status: TutorAccountStatus::Active,
                school_id: None,
                created_at: now,
                updated_at: now,
            };

            let err = storage.save_tutor_account(&conflicting).await.unwrap_err();
            assert!(err.contains("google account"));

            let conflicting_phone = TutorAccount {
                id: "acct-3".to_string(),
                email: "third@example.com".to_string(),
                google_id: "google-456".to_string(),
                phone_number: Some("+15551234567".to_string()),
                phone_verified: true,
                status: TutorAccountStatus::Active,
                school_id: None,
                created_at: now,
                updated_at: now,
            };

            storage
                .save_tutor_account(&conflicting_phone)
                .await
                .unwrap();
            let err = storage
                .save_tutor_account(&TutorAccount {
                    id: "acct-4".to_string(),
                    email: "fourth@example.com".to_string(),
                    google_id: "google-789".to_string(),
                    phone_number: Some("+15551234567".to_string()),
                    phone_verified: true,
                    status: TutorAccountStatus::Active,
                    school_id: None,
                    created_at: now,
                    updated_at: now,
                })
                .await
                .unwrap_err();
            assert!(err.contains("phone number"));
        });
    }

    #[test]
    fn applies_credit_entries_and_tracks_balance() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let now = Utc::now();
            let entry = CreditLedgerEntry {
                id: "credit-entry-1".to_string(),
                account_id: "acct-credits-1".to_string(),
                kind: CreditEntryKind::Grant,
                amount: 10.0,
                reason: "starter".to_string(),
                created_at: now,
            };

            let balance = storage.apply_credit_entry(&entry).await.unwrap();
            assert_eq!(balance.balance, 10.0);

            let debit = CreditLedgerEntry {
                id: "credit-entry-2".to_string(),
                account_id: "acct-credits-1".to_string(),
                kind: CreditEntryKind::Debit,
                amount: 2.5,
                reason: "lesson".to_string(),
                created_at: now,
            };
            let balance = storage.apply_credit_entry(&debit).await.unwrap();
            assert_eq!(balance.balance, 7.5);

            let entries = storage
                .list_credit_entries("acct-credits-1", 10)
                .await
                .unwrap();
            assert_eq!(entries.len(), 2);
        });
    }

    #[test]
    fn saves_and_reads_queued_job_snapshot() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let snapshot = QueuedLessonJobSnapshot {
                lesson_id: "lesson-queued-1".to_string(),
                request: LessonGenerationRequest {
                    requirements: UserRequirements {
                        requirement: "Teach decimals".to_string(),
                        language: Language::EnUs,
                        user_nickname: None,
                        user_bio: None,
    
                    },
                    pdf_content: None,
    
                    enable_image_generation: false,
                    enable_video_generation: false,
                    enable_tts: false,
                    agent_mode: AgentMode::Default,
                    account_id: None,
                    school_id: None,
                    quality_mode: None,
                    learning_mode: None,
                    precharged_credits: None,
                },
                model_string: Some("openai:gpt-4o-mini".to_string()),
                max_attempts: 3,
            };

            storage
                .save_queued_job_snapshot("job-snapshot-1", &snapshot)
                .await
                .unwrap();

            let loaded = storage
                .get_queued_job_snapshot("job-snapshot-1")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(loaded.lesson_id, "lesson-queued-1");
            assert_eq!(loaded.model_string.as_deref(), Some("openai:gpt-4o-mini"));
            assert_eq!(loaded.max_attempts, 3);
            assert_eq!(loaded.request.requirements.requirement, "Teach decimals");
        });
    }

    #[test]
    fn saves_and_queries_subscriptions() {
        let rt = Runtime::new().unwrap();
        rt.block_on(async {
            let storage = FileStorage::new(temp_root());
            let now = Utc::now();
            let renewal_due = now + ChronoDuration::days(1);
            let renewal_later = now + ChronoDuration::days(40);

            let sub_due = Subscription {
                id: "sub-1".to_string(),
                account_id: "acct-sub-1".to_string(),
                plan_code: "plus_monthly".to_string(),
                gateway: "easebuzz".to_string(),
                gateway_subscription_id: Some("gw-sub-1".to_string()),
                status: SubscriptionStatus::Active,
                billing_interval: BillingInterval::Monthly,
                credits_per_cycle: 30.0,
                autopay_enabled: true,
                current_period_start: now,
                current_period_end: now + ChronoDuration::days(30),
                next_renewal_at: Some(renewal_due),
                grace_period_until: Some(renewal_due + ChronoDuration::days(3)),
                cancelled_at: None,
                last_payment_order_id: Some("order-1".to_string()),
                quality_mode: ai_tutor_domain::billing::QualityMode::Standard,
                allowed_learning_modes: vec![],
                created_at: now,
                updated_at: now,
            };

            let sub_later = Subscription {
                id: "sub-2".to_string(),
                account_id: "acct-sub-1".to_string(),
                plan_code: "pro_monthly".to_string(),
                gateway: "easebuzz".to_string(),
                gateway_subscription_id: Some("gw-sub-2".to_string()),
                status: SubscriptionStatus::PastDue,
                billing_interval: BillingInterval::Monthly,
                credits_per_cycle: 80.0,
                autopay_enabled: true,
                current_period_start: now,
                current_period_end: now + ChronoDuration::days(30),
                next_renewal_at: Some(renewal_later),
                grace_period_until: Some(renewal_later + ChronoDuration::days(5)),
                cancelled_at: None,
                last_payment_order_id: Some("order-2".to_string()),
                quality_mode: ai_tutor_domain::billing::QualityMode::Standard,
                allowed_learning_modes: vec![],
                created_at: now,
                updated_at: now + ChronoDuration::hours(1),
            };

            storage.save_subscription(&sub_due).await.unwrap();
            storage.save_subscription(&sub_later).await.unwrap();

            let loaded = storage
                .get_subscription_by_gateway_subscription_id("gw-sub-1")
                .await
                .unwrap()
                .expect("subscription should exist");
            assert_eq!(loaded.id, "sub-1");

            let account_subs = storage
                .list_subscriptions_for_account("acct-sub-1", 10)
                .await
                .unwrap();
            assert_eq!(account_subs.len(), 2);
            assert_eq!(account_subs[0].id, "sub-2");

            let renewal_cutoff = (now + ChronoDuration::days(2)).to_rfc3339();
            let due = storage
                .list_subscriptions_due_for_renewal(
                    &renewal_cutoff,
                    10,
                )
                .await
                .unwrap();
            assert_eq!(due.len(), 1);
            assert_eq!(due[0].id, "sub-1");
        });
    }
}
