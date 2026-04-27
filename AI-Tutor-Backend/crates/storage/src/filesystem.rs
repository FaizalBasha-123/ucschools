use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    sync::Arc,
    time::{Duration, SystemTime},
};

use chrono::Utc;
use anyhow::Result as AnyResult;
use async_trait::async_trait;
use native_tls::TlsConnector;
use postgres::{Client, NoTls};
use postgres_native_tls::MakeTlsConnector;
use rusqlite::{params, Connection, OptionalExtension};
use tokio::{fs, sync::Mutex};

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
    PromoCodeRepository, RuntimeActionExecutionRepository, RuntimeSessionRepository, SubscriptionRepository,
    TutorAccountRepository, WebhookEventRepository,
};

const STALE_JOB_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone)]
pub struct FileStorage {
    root: PathBuf,
    lesson_db_path: Option<PathBuf>,
    runtime_db_path: Option<PathBuf>,
    job_db_path: Option<PathBuf>,
    postgres_url: Option<String>,
    postgres_ready: Arc<AtomicBool>,
    job_lock: Arc<Mutex<()>>,
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
];

impl FileStorage {
    fn tutor_account_status_to_db(status: &TutorAccountStatus) -> &'static str {
        match status {
            TutorAccountStatus::PartialAuth => "partial_auth",
            TutorAccountStatus::Active => "active",
        }
    }

    fn tutor_account_status_from_db(value: &str) -> Result<TutorAccountStatus, String> {
        match value {
            "partial_auth" => Ok(TutorAccountStatus::PartialAuth),
            "active" => Ok(TutorAccountStatus::Active),
            other => Err(format!("unsupported tutor account status `{other}`")),
        }
    }

    fn postgres_row_to_tutor_account(row: postgres::Row) -> Result<TutorAccount, String> {
        let status = Self::tutor_account_status_from_db(row.get::<_, String>("status").as_str())?;
        let created_at: chrono::DateTime<Utc> = row.get("created_at");
        let updated_at: chrono::DateTime<Utc> = row.get("updated_at");

        Ok(TutorAccount {
            id: row.get("id"),
            email: row.get("email"),
            google_id: row.get("google_id"),
            phone_number: row.get("phone_number"),
            phone_verified: row.get("phone_verified"),
            status,
            created_at,
            updated_at,
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

        Ok(CreditLedgerEntry {
            id: row.get("id"),
            account_id: row.get("account_id"),
            kind,
            amount: row.get("amount"),
            reason: row.get("reason"),
            created_at,
        })
    }

    fn connect_postgres(url: &str) -> AnyResult<Client> {
        if url.contains("sslmode=require") || url.contains("sslmode=verify-full") {
            let tls = TlsConnector::builder().build()?;
            let connector = MakeTlsConnector::new(tls);
            return Client::connect(url, connector).map_err(Into::into);
        }

        Client::connect(url, NoTls).map_err(Into::into)
    }

    fn run_postgres_migrations(client: &mut Client) -> AnyResult<()> {
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
        Ok(())
    }

    fn stable_path_key(value: &str) -> String {
        let mut encoded = String::with_capacity(value.len() * 2);
        for byte in value.as_bytes() {
            use std::fmt::Write as _;
            let _ = write!(&mut encoded, "{byte:02x}");
        }
        encoded
    }

    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lesson_db_path: None,
            runtime_db_path: None,
            job_db_path: None,
            postgres_url: None,
            postgres_ready: Arc::new(AtomicBool::new(false)),
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_runtime_db(root: impl Into<PathBuf>, runtime_db_path: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lesson_db_path: None,
            runtime_db_path: Some(runtime_db_path.into()),
            job_db_path: None,
            postgres_url: None,
            postgres_ready: Arc::new(AtomicBool::new(false)),
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_job_db(root: impl Into<PathBuf>, job_db_path: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lesson_db_path: None,
            runtime_db_path: None,
            job_db_path: Some(job_db_path.into()),
            postgres_url: None,
            postgres_ready: Arc::new(AtomicBool::new(false)),
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_lesson_db(root: impl Into<PathBuf>, lesson_db_path: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lesson_db_path: Some(lesson_db_path.into()),
            runtime_db_path: None,
            job_db_path: None,
            postgres_url: None,
            postgres_ready: Arc::new(AtomicBool::new(false)),
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_databases(
        root: impl Into<PathBuf>,
        lesson_db_path: Option<PathBuf>,
        runtime_db_path: Option<PathBuf>,
        job_db_path: Option<PathBuf>,
        postgres_url: Option<String>,
    ) -> Self {
        Self {
            root: root.into(),
            lesson_db_path,
            runtime_db_path,
            job_db_path,
            postgres_url,
            postgres_ready: Arc::new(AtomicBool::new(false)),
            job_lock: Arc::new(Mutex::new(())),
        }
    }

    fn ensure_postgres_ready_blocking(
        postgres_url: &str,
        postgres_ready: &AtomicBool,
    ) -> Result<(), String> {
        if postgres_ready.load(Ordering::Acquire) {
            return Ok(());
        }

        let mut client = Self::connect_postgres(postgres_url).map_err(|err| err.to_string())?;
        Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
        postgres_ready.store(true, Ordering::Release);
        Ok(())
    }

    pub async fn ensure_postgres_ready(&self) -> Result<(), String> {
        let Some(postgres_url) = self.postgres_url.clone() else {
            return Ok(());
        };
        let postgres_ready = Arc::clone(&self.postgres_ready);
        tokio::task::spawn_blocking(move || {
            Self::ensure_postgres_ready_blocking(&postgres_url, postgres_ready.as_ref())
        })
        .await
        .map_err(|err| err.to_string())?
    }

    pub fn root_dir(&self) -> &Path {
        &self.root
    }

    pub fn runtime_session_backend(&self) -> &'static str {
        if self.runtime_db_path.is_some() {
            "sqlite"
        } else {
            "file"
        }
    }

    pub fn lesson_backend(&self) -> &'static str {
        if self.lesson_db_path.is_some() {
            "sqlite"
        } else {
            "file"
        }
    }

    pub fn job_backend(&self) -> &'static str {
        if self.job_db_path.is_some() {
            "sqlite"
        } else {
            "file"
        }
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

    pub fn runtime_action_executions_dir(&self) -> PathBuf {
        self.root.join("runtime-action-executions")
    }

    pub fn lesson_adaptive_dir(&self) -> PathBuf {
        self.root.join("lesson-adaptive")
    }

    pub fn lesson_shelf_dir(&self) -> PathBuf {
        self.root.join("lesson-shelf")
    }

    pub fn queued_job_snapshots_dir(&self) -> PathBuf {
        self.root.join("queued-job-snapshots")
    }

    pub fn tutor_accounts_dir(&self) -> PathBuf {
        self.root.join("tutor-accounts")
    }

    pub fn credit_entries_dir(&self) -> PathBuf {
        self.root.join("credits").join("entries")
    }

    pub fn credit_balances_dir(&self) -> PathBuf {
        self.root.join("credits").join("balances")
    }

    pub fn payment_orders_dir(&self) -> PathBuf {
        self.root.join("payment-orders")
    }

    pub fn subscriptions_dir(&self) -> PathBuf {
        self.root.join("subscriptions")
    }

    pub fn invoices_dir(&self) -> PathBuf {
        self.root.join("invoices")
    }

    pub fn invoice_lines_dir(&self) -> PathBuf {
        self.root.join("invoice-lines")
    }

    pub fn payment_intents_dir(&self) -> PathBuf {
        self.root.join("payment-intents")
    }

    pub fn dunning_cases_dir(&self) -> PathBuf {
        self.root.join("dunning-cases")
    }

    pub fn webhook_events_dir(&self) -> PathBuf {
        self.root.join("webhook-events")
    }

    pub fn financial_audit_logs_dir(&self) -> PathBuf {
        self.root.join("financial-audit-logs")
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

    fn lesson_path(&self, lesson_id: &str) -> PathBuf {
        self.lessons_dir().join(format!("{lesson_id}.json"))
    }

    fn job_path(&self, job_id: &str) -> PathBuf {
        self.jobs_dir().join(format!("{job_id}.json"))
    }

    fn runtime_session_path(&self, session_id: &str) -> PathBuf {
        self.runtime_sessions_dir()
            .join(format!("{session_id}.json"))
    }

    fn runtime_action_execution_path(&self, execution_id: &str) -> PathBuf {
        self.runtime_action_executions_dir()
            .join(format!("{}.json", Self::stable_path_key(execution_id)))
    }

    fn lesson_adaptive_path(&self, lesson_id: &str) -> PathBuf {
        self.lesson_adaptive_dir()
            .join(format!("{}.json", Self::stable_path_key(lesson_id)))
    }

    fn lesson_shelf_path(&self, item_id: &str) -> PathBuf {
        self.lesson_shelf_dir().join(format!("{item_id}.json"))
    }

    fn queued_job_snapshot_path(&self, job_id: &str) -> PathBuf {
        self.queued_job_snapshots_dir()
            .join(format!("{job_id}.json"))
    }

    fn tutor_account_path(&self, account_id: &str) -> PathBuf {
        self.tutor_accounts_dir().join(format!("{account_id}.json"))
    }

    fn credit_entry_path(&self, entry_id: &str) -> PathBuf {
        self.credit_entries_dir().join(format!("{entry_id}.json"))
    }

    fn credit_balance_path(&self, account_id: &str) -> PathBuf {
        self.credit_balances_dir()
            .join(format!("{account_id}.json"))
    }

    fn payment_order_path(&self, order_id: &str) -> PathBuf {
        self.payment_orders_dir().join(format!("{order_id}.json"))
    }

    fn subscription_path(&self, subscription_id: &str) -> PathBuf {
        self.subscriptions_dir()
            .join(format!("{subscription_id}.json"))
    }

    fn invoice_path(&self, invoice_id: &str) -> PathBuf {
        self.invoices_dir().join(format!("{invoice_id}.json"))
    }

    fn invoice_line_path(&self, line_id: &str) -> PathBuf {
        self.invoice_lines_dir().join(format!("{line_id}.json"))
    }

    fn payment_intent_path(&self, intent_id: &str) -> PathBuf {
        self.payment_intents_dir().join(format!("{intent_id}.json"))
    }

    fn dunning_case_path(&self, case_id: &str) -> PathBuf {
        self.dunning_cases_dir().join(format!("{case_id}.json"))
    }

    fn webhook_event_path(&self, event_identifier: &str) -> PathBuf {
        self.webhook_events_dir()
            .join(format!("{}.json", Self::stable_path_key(event_identifier)))
    }

    fn financial_audit_log_path(&self, audit_id: &str) -> PathBuf {
        self.financial_audit_logs_dir()
            .join(format!("{audit_id}.json"))
    }

    async fn list_tutor_accounts(&self) -> Result<Vec<TutorAccount>, String> {
        let dir = self.tutor_accounts_dir();
        Self::ensure_dir(&dir)
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(&dir).await.map_err(|err| err.to_string())?;
        let mut accounts = Vec::new();

        while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(account) = Self::read_json::<TutorAccount>(&path)
                .await
                .map_err(|err| err.to_string())?
            {
                accounts.push(account);
            }
        }

        Ok(accounts)
    }

    async fn list_payment_orders(&self) -> Result<Vec<PaymentOrder>, String> {
        let dir = self.payment_orders_dir();
        Self::ensure_dir(&dir)
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(&dir).await.map_err(|err| err.to_string())?;
        let mut orders = Vec::new();

        while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(order) = Self::read_json::<PaymentOrder>(&path)
                .await
                .map_err(|err| err.to_string())?
            {
                orders.push(order);
            }
        }

        Ok(orders)
    }

    async fn list_subscriptions(&self) -> Result<Vec<Subscription>, String> {
        let dir = self.subscriptions_dir();
        Self::ensure_dir(&dir)
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(&dir).await.map_err(|err| err.to_string())?;
        let mut subscriptions = Vec::new();

        while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(subscription) = Self::read_json::<Subscription>(&path)
                .await
                .map_err(|err| err.to_string())?
            {
                subscriptions.push(subscription);
            }
        }

        Ok(subscriptions)
    }

    async fn list_invoices(&self) -> Result<Vec<Invoice>, String> {
        let dir = self.invoices_dir();
        Self::ensure_dir(&dir)
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(&dir).await.map_err(|err| err.to_string())?;
        let mut invoices = Vec::new();

        while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(invoice) = Self::read_json::<Invoice>(&path)
                .await
                .map_err(|err| err.to_string())?
            {
                invoices.push(invoice);
            }
        }

        Ok(invoices)
    }

    async fn list_invoice_lines(&self) -> Result<Vec<InvoiceLine>, String> {
        let dir = self.invoice_lines_dir();
        Self::ensure_dir(&dir)
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(&dir).await.map_err(|err| err.to_string())?;
        let mut lines = Vec::new();

        while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(line) = Self::read_json::<InvoiceLine>(&path)
                .await
                .map_err(|err| err.to_string())?
            {
                lines.push(line);
            }
        }

        Ok(lines)
    }

    async fn list_payment_intents(&self) -> Result<Vec<PaymentIntent>, String> {
        let dir = self.payment_intents_dir();
        Self::ensure_dir(&dir)
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(&dir).await.map_err(|err| err.to_string())?;
        let mut intents = Vec::new();

        while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(intent) = Self::read_json::<PaymentIntent>(&path)
                .await
                .map_err(|err| err.to_string())?
            {
                intents.push(intent);
            }
        }

        Ok(intents)
    }

    async fn list_dunning_cases(&self) -> Result<Vec<DunningCase>, String> {
        let dir = self.dunning_cases_dir();
        Self::ensure_dir(&dir)
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(&dir).await.map_err(|err| err.to_string())?;
        let mut cases = Vec::new();

        while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(case_item) = Self::read_json::<DunningCase>(&path)
                .await
                .map_err(|err| err.to_string())?
            {
                cases.push(case_item);
            }
        }

        Ok(cases)
    }

    async fn list_financial_audit_logs(&self) -> Result<Vec<FinancialAuditLog>, String> {
        let dir = self.financial_audit_logs_dir();
        Self::ensure_dir(&dir)
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(&dir).await.map_err(|err| err.to_string())?;
        let mut logs = Vec::new();

        while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(log) = Self::read_json::<FinancialAuditLog>(&path)
                .await
                .map_err(|err| err.to_string())?
            {
                logs.push(log);
            }
        }

        Ok(logs)
    }

    async fn list_lesson_shelf_items(&self) -> Result<Vec<LessonShelfItem>, String> {
        let dir = self.lesson_shelf_dir();
        Self::ensure_dir(&dir)
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = fs::read_dir(&dir).await.map_err(|err| err.to_string())?;
        let mut items = Vec::new();

        while let Some(entry) = entries.next_entry().await.map_err(|err| err.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Some(item) = Self::read_json::<LessonShelfItem>(&path)
                .await
                .map_err(|err| err.to_string())?
            {
                items.push(item);
            }
        }

        Ok(items)
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
            credits_to_grant: row.get("credits_to_grant"),
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

    async fn save_runtime_session_sqlite(
        db_path: PathBuf,
        session_id: String,
        director_state: DirectorState,
    ) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        let payload = serde_json::to_string_pretty(&director_state)?;
        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_sessions (
                    session_id TEXT PRIMARY KEY,
                    director_state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;
            connection.execute(
                "INSERT INTO runtime_sessions (session_id, director_state_json, updated_at)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(session_id) DO UPDATE SET
                    director_state_json = excluded.director_state_json,
                    updated_at = CURRENT_TIMESTAMP;",
                params![session_id, payload],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_runtime_session_sqlite(
        db_path: PathBuf,
        session_id: String,
    ) -> AnyResult<Option<DirectorState>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<DirectorState>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_sessions (
                    session_id TEXT PRIMARY KEY,
                    director_state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;

            let mut statement = connection.prepare(
                "SELECT director_state_json
                 FROM runtime_sessions
                 WHERE session_id = ?1",
            )?;
            let mut rows = statement.query(params![session_id])?;
            if let Some(row) = rows.next()? {
                let json: String = row.get(0)?;
                let value = serde_json::from_str::<DirectorState>(&json)?;
                Ok(Some(value))
            } else {
                Ok(None)
            }
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn save_job_sqlite(db_path: PathBuf, job: LessonGenerationJob) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        let payload = serde_json::to_string_pretty(&job)?;
        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lesson_jobs (
                    job_id TEXT PRIMARY KEY,
                    job_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;
            connection.execute(
                "INSERT INTO lesson_jobs (job_id, job_json, updated_at)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(job_id) DO UPDATE SET
                    job_json = excluded.job_json,
                    updated_at = CURRENT_TIMESTAMP;",
                params![job.id, payload],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_job_sqlite(
        db_path: PathBuf,
        job_id: String,
    ) -> AnyResult<Option<LessonGenerationJob>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<LessonGenerationJob>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lesson_jobs (
                    job_id TEXT PRIMARY KEY,
                    job_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;

            let json: Option<String> = connection
                .query_row(
                    "SELECT job_json FROM lesson_jobs WHERE job_id = ?1",
                    params![job_id],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(json) = json else {
                return Ok(None);
            };

            let mut job = serde_json::from_str::<LessonGenerationJob>(&json)?;
            let now = chrono::Utc::now();
            if job.status == LessonGenerationJobStatus::Running {
                let updated_age = now
                    .signed_duration_since(job.updated_at)
                    .to_std()
                    .unwrap_or_default();
                if updated_age > STALE_JOB_TIMEOUT {
                    job.status = LessonGenerationJobStatus::Failed;
                    job.step = LessonGenerationStep::Failed;
                    job.message =
                        "Job appears stale (no progress update for 30 minutes)".to_string();
                    job.error =
                        Some("Stale job: process may have restarted during generation".to_string());
                    job.updated_at = now;
                    job.completed_at = Some(now);

                    let payload = serde_json::to_string_pretty(&job)?;
                    connection.execute(
                        "UPDATE lesson_jobs
                         SET job_json = ?2, updated_at = CURRENT_TIMESTAMP
                         WHERE job_id = ?1",
                        params![job.id, payload],
                    )?;
                }
            }

            Ok(Some(job))
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn save_lesson_sqlite(db_path: PathBuf, lesson: Lesson) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        let payload = serde_json::to_string_pretty(&lesson)?;
        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lessons (
                    lesson_id TEXT PRIMARY KEY,
                    lesson_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;
            connection.execute(
                "INSERT INTO lessons (lesson_id, lesson_json, updated_at)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(lesson_id) DO UPDATE SET
                    lesson_json = excluded.lesson_json,
                    updated_at = CURRENT_TIMESTAMP;",
                params![lesson.id, payload],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_lesson_sqlite(db_path: PathBuf, lesson_id: String) -> AnyResult<Option<Lesson>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<Lesson>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lessons (
                    lesson_id TEXT PRIMARY KEY,
                    lesson_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;

            let json: Option<String> = connection
                .query_row(
                    "SELECT lesson_json FROM lessons WHERE lesson_id = ?1",
                    params![lesson_id],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(json) = json else {
                return Ok(None);
            };

            let lesson = serde_json::from_str::<Lesson>(&json)?;
            Ok(Some(lesson))
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn save_lesson_adaptive_state_sqlite(
        db_path: PathBuf,
        state: LessonAdaptiveState,
    ) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        let payload = serde_json::to_string_pretty(&state)?;
        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lesson_adaptive_state (
                    lesson_id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;
            connection.execute(
                "INSERT INTO lesson_adaptive_state (lesson_id, state_json, updated_at)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(lesson_id) DO UPDATE SET
                    state_json = excluded.state_json,
                    updated_at = CURRENT_TIMESTAMP;",
                params![state.lesson_id, payload],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_lesson_adaptive_state_sqlite(
        db_path: PathBuf,
        lesson_id: String,
    ) -> AnyResult<Option<LessonAdaptiveState>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<LessonAdaptiveState>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lesson_adaptive_state (
                    lesson_id TEXT PRIMARY KEY,
                    state_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );",
            )?;

            let json: Option<String> = connection
                .query_row(
                    "SELECT state_json FROM lesson_adaptive_state WHERE lesson_id = ?1",
                    params![lesson_id],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(json) = json else {
                return Ok(None);
            };

            let state = serde_json::from_str::<LessonAdaptiveState>(&json)?;
            Ok(Some(state))
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn save_lesson_shelf_item_sqlite(
        db_path: PathBuf,
        item: LessonShelfItem,
    ) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        let payload = serde_json::to_string_pretty(&item)?;
        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lesson_shelf_items (
                    item_id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    item_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_lesson_shelf_items_account_id
                    ON lesson_shelf_items(account_id);
                CREATE INDEX IF NOT EXISTS idx_lesson_shelf_items_account_status
                    ON lesson_shelf_items(account_id, status);",
            )?;
            connection.execute(
                "INSERT INTO lesson_shelf_items (item_id, account_id, status, item_json, updated_at)
                 VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
                 ON CONFLICT(item_id) DO UPDATE SET
                    account_id = excluded.account_id,
                    status = excluded.status,
                    item_json = excluded.item_json,
                    updated_at = CURRENT_TIMESTAMP;",
                params![
                    item.id,
                    item.account_id,
                    serde_json::to_string(&item.status)?,
                    payload
                ],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_lesson_shelf_item_sqlite(
        db_path: PathBuf,
        item_id: String,
    ) -> AnyResult<Option<LessonShelfItem>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<LessonShelfItem>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS lesson_shelf_items (
                    item_id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    item_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_lesson_shelf_items_account_id
                    ON lesson_shelf_items(account_id);
                CREATE INDEX IF NOT EXISTS idx_lesson_shelf_items_account_status
                    ON lesson_shelf_items(account_id, status);",
            )?;

            let json: Option<String> = connection
                .query_row(
                    "SELECT item_json FROM lesson_shelf_items WHERE item_id = ?1",
                    params![item_id],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(json) = json else {
                return Ok(None);
            };

            let item = serde_json::from_str::<LessonShelfItem>(&json)?;
            Ok(Some(item))
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn save_runtime_action_execution_sqlite(
        db_path: PathBuf,
        record: RuntimeActionExecutionRecord,
    ) -> AnyResult<()> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<()> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_action_executions (
                    execution_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    runtime_session_mode TEXT NOT NULL,
                    action_name TEXT NOT NULL,
                    status_json TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    updated_at_unix_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_action_executions_session_id
                    ON runtime_action_executions(session_id);",
            )?;
            let status_json = serde_json::to_string(&record.status)?;
            let record_json = serde_json::to_string_pretty(&record)?;
            connection.execute(
                "INSERT INTO runtime_action_executions (
                    execution_id, session_id, runtime_session_mode, action_name, status_json, record_json, updated_at_unix_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(execution_id) DO UPDATE SET
                    session_id = excluded.session_id,
                    runtime_session_mode = excluded.runtime_session_mode,
                    action_name = excluded.action_name,
                    status_json = excluded.status_json,
                    record_json = excluded.record_json,
                    updated_at_unix_ms = excluded.updated_at_unix_ms;",
                params![
                    record.execution_id,
                    record.session_id,
                    record.runtime_session_mode,
                    record.action_name,
                    status_json,
                    record_json,
                    record.updated_at_unix_ms
                ],
            )?;
            Ok(())
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn get_runtime_action_execution_sqlite(
        db_path: PathBuf,
        execution_id: String,
    ) -> AnyResult<Option<RuntimeActionExecutionRecord>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Option<RuntimeActionExecutionRecord>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_action_executions (
                    execution_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    runtime_session_mode TEXT NOT NULL,
                    action_name TEXT NOT NULL,
                    status_json TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    updated_at_unix_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_action_executions_session_id
                    ON runtime_action_executions(session_id);",
            )?;
            let payload = connection
                .query_row(
                    "SELECT record_json FROM runtime_action_executions WHERE execution_id = ?1",
                    params![execution_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            payload
                .map(|json| serde_json::from_str::<RuntimeActionExecutionRecord>(&json))
                .transpose()
                .map_err(Into::into)
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }

    async fn list_runtime_action_executions_for_session_sqlite(
        db_path: PathBuf,
        session_id: String,
    ) -> AnyResult<Vec<RuntimeActionExecutionRecord>> {
        if let Some(parent) = db_path.parent() {
            Self::ensure_dir(parent).await?;
        }

        tokio::task::spawn_blocking(move || -> AnyResult<Vec<RuntimeActionExecutionRecord>> {
            let connection = Connection::open(db_path)?;
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS runtime_action_executions (
                    execution_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    runtime_session_mode TEXT NOT NULL,
                    action_name TEXT NOT NULL,
                    status_json TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    updated_at_unix_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_action_executions_session_id
                    ON runtime_action_executions(session_id);",
            )?;
            let mut statement = connection.prepare(
                "SELECT record_json
                 FROM runtime_action_executions
                 WHERE session_id = ?1
                 ORDER BY updated_at_unix_ms ASC",
            )?;
            let rows = statement.query_map(params![session_id], |row| row.get::<_, String>(0))?;
            let mut records = Vec::new();
            for row in rows {
                records.push(serde_json::from_str::<RuntimeActionExecutionRecord>(&row?)?);
            }
            Ok(records)
        })
        .await
        .map_err(|err| anyhow::anyhow!(err))?
    }
}

#[async_trait]
impl LessonRepository for FileStorage {
    async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String> {
        if let Some(db_path) = self.lesson_db_path.clone() {
            Self::save_lesson_sqlite(db_path, lesson.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.lesson_path(&lesson.id), lesson)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn get_lesson(&self, lesson_id: &str) -> Result<Option<Lesson>, String> {
        if let Some(db_path) = self.lesson_db_path.clone() {
            Self::get_lesson_sqlite(db_path, lesson_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::read_json(&self.lesson_path(lesson_id))
                .await
                .map_err(|err| err.to_string())
        }
    }
}

#[async_trait]
impl LessonAdaptiveRepository for FileStorage {
    async fn save_lesson_adaptive_state(&self, state: &LessonAdaptiveState) -> Result<(), String> {
        if let Some(db_path) = self.lesson_db_path.clone() {
            Self::save_lesson_adaptive_state_sqlite(db_path, state.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.lesson_adaptive_path(&state.lesson_id), state)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn get_lesson_adaptive_state(
        &self,
        lesson_id: &str,
    ) -> Result<Option<LessonAdaptiveState>, String> {
        if let Some(db_path) = self.lesson_db_path.clone() {
            Self::get_lesson_adaptive_state_sqlite(db_path, lesson_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::read_json(&self.lesson_adaptive_path(lesson_id))
                .await
                .map_err(|err| err.to_string())
        }
    }
}

#[async_trait]
impl LessonShelfRepository for FileStorage {
    async fn upsert_lesson_shelf_item(&self, item: &LessonShelfItem) -> Result<(), String> {
        if let Some(db_path) = self.lesson_db_path.clone() {
            Self::save_lesson_shelf_item_sqlite(db_path, item.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.lesson_shelf_path(&item.id), item)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn get_lesson_shelf_item(&self, item_id: &str) -> Result<Option<LessonShelfItem>, String> {
        if let Some(db_path) = self.lesson_db_path.clone() {
            Self::get_lesson_shelf_item_sqlite(db_path, item_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::read_json(&self.lesson_shelf_path(item_id))
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn list_lesson_shelf_items_for_account(
        &self,
        account_id: &str,
        status: Option<LessonShelfStatus>,
        limit: usize,
    ) -> Result<Vec<LessonShelfItem>, String> {
        if let Some(db_path) = self.lesson_db_path.clone() {
            let account_id = account_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Vec<LessonShelfItem>, String> {
                let connection = Connection::open(db_path).map_err(|err| err.to_string())?;
                connection
                    .execute_batch(
                        "CREATE TABLE IF NOT EXISTS lesson_shelf_items (
                            item_id TEXT PRIMARY KEY,
                            account_id TEXT NOT NULL,
                            status TEXT NOT NULL,
                            item_json TEXT NOT NULL,
                            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                        );
                        CREATE INDEX IF NOT EXISTS idx_lesson_shelf_items_account_id
                            ON lesson_shelf_items(account_id);
                        CREATE INDEX IF NOT EXISTS idx_lesson_shelf_items_account_status
                            ON lesson_shelf_items(account_id, status);",
                    )
                    .map_err(|err| err.to_string())?;

                let mut items = Vec::new();
                if let Some(status) = status {
                    let mut statement = connection
                        .prepare(
                            "SELECT item_json
                             FROM lesson_shelf_items
                             WHERE account_id = ?1 AND status = ?2
                             ORDER BY updated_at DESC
                             LIMIT ?3",
                        )
                        .map_err(|err| err.to_string())?;
                    let rows = statement
                        .query_map(
                            params![
                                account_id,
                                serde_json::to_string(&status).map_err(|err| err.to_string())?,
                                limit as i64
                            ],
                            |row| row.get::<_, String>(0),
                        )
                        .map_err(|err| err.to_string())?;
                    for row in rows {
                        let json = row.map_err(|err| err.to_string())?;
                        items.push(
                            serde_json::from_str::<LessonShelfItem>(&json)
                                .map_err(|err| err.to_string())?,
                        );
                    }
                } else {
                    let mut statement = connection
                        .prepare(
                            "SELECT item_json
                             FROM lesson_shelf_items
                             WHERE account_id = ?1
                             ORDER BY updated_at DESC
                             LIMIT ?2",
                        )
                        .map_err(|err| err.to_string())?;
                    let rows = statement
                        .query_map(params![account_id, limit as i64], |row| row.get::<_, String>(0))
                        .map_err(|err| err.to_string())?;
                    for row in rows {
                        let json = row.map_err(|err| err.to_string())?;
                        items.push(
                            serde_json::from_str::<LessonShelfItem>(&json)
                                .map_err(|err| err.to_string())?,
                        );
                    }
                }

                Ok(items)
            })
            .await
            .map_err(|err| err.to_string())?;
        }

        let mut items = self.list_lesson_shelf_items().await?;
        items.retain(|item| {
            item.account_id == account_id
                && status
                    .as_ref()
                    .map_or(true, |wanted| item.status == *wanted)
        });
        items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        if items.len() > limit {
            items.truncate(limit);
        }
        Ok(items)
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
}

#[async_trait]
impl LessonJobRepository for FileStorage {
    async fn create_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let _guard = self.job_lock.lock().await;
        if let Some(db_path) = self.job_db_path.clone() {
            Self::save_job_sqlite(db_path, job.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.job_path(&job.id), job)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn update_job(&self, job: &LessonGenerationJob) -> Result<(), String> {
        let _guard = self.job_lock.lock().await;
        if let Some(db_path) = self.job_db_path.clone() {
            Self::save_job_sqlite(db_path, job.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.job_path(&job.id), job)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn get_job(&self, job_id: &str) -> Result<Option<LessonGenerationJob>, String> {
        let _guard = self.job_lock.lock().await;
        if let Some(db_path) = self.job_db_path.clone() {
            return Self::get_job_sqlite(db_path, job_id.to_string())
                .await
                .map_err(|err| err.to_string());
        }
        let Some(mut job) = Self::read_json::<LessonGenerationJob>(&self.job_path(job_id))
            .await
            .map_err(|err| err.to_string())?
        else {
            return Ok(None);
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
                job.error =
                    Some("Stale job: process may have restarted during generation".to_string());
                job.updated_at = now;
                job.completed_at = Some(now);
                Self::write_json_atomic(&self.job_path(job_id), &job)
                    .await
                    .map_err(|err| err.to_string())?;
            }
        }

        Ok(Some(job))
    }

    async fn list_all_jobs(&self, limit: usize) -> Result<Vec<LessonGenerationJob>, String> {
        let _guard = self.job_lock.lock().await;
        if let Some(db_path) = self.job_db_path.clone() {
            return tokio::task::spawn_blocking(move || -> Result<Vec<LessonGenerationJob>, String> {
                let connection = Connection::open(db_path).map_err(|err| err.to_string())?;
                let mut statement = connection.prepare(
                    "SELECT job_json FROM lesson_jobs ORDER BY updated_at DESC LIMIT ?1"
                ).map_err(|err| err.to_string())?;
                
                let rows = statement.query_map(params![limit as i64], |row| row.get::<_, String>(0))
                    .map_err(|err| err.to_string())?;
                
                let mut jobs = Vec::new();
                for row in rows {
                    if let Ok(json_str) = row {
                        if let Ok(job) = serde_json::from_str::<LessonGenerationJob>(&json_str) {
                            jobs.push(job);
                        }
                    }
                }
                Ok(jobs)
            }).await.map_err(|e| e.to_string())?;
        }
        
        Self::ensure_dir(&self.jobs_dir()).await.map_err(|e| e.to_string())?;
        let mut reader = fs::read_dir(self.jobs_dir()).await.map_err(|e| e.to_string())?;
        let mut jobs = Vec::new();
        while let Some(entry) = reader.next_entry().await.map_err(|e| e.to_string())? {
            if let Some(job) = Self::read_json::<LessonGenerationJob>(&entry.path()).await.unwrap_or(None) {
                jobs.push(job);
            }
        }
        jobs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        jobs.truncate(limit);
        Ok(jobs)
    }
}

#[async_trait]
impl RuntimeSessionRepository for FileStorage {
    async fn save_runtime_session(
        &self,
        session_id: &str,
        director_state: &DirectorState,
    ) -> Result<(), String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::save_runtime_session_sqlite(
                db_path,
                session_id.to_string(),
                director_state.clone(),
            )
            .await
            .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(&self.runtime_session_path(session_id), director_state)
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn get_runtime_session(&self, session_id: &str) -> Result<Option<DirectorState>, String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::get_runtime_session_sqlite(db_path, session_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::read_json(&self.runtime_session_path(session_id))
                .await
                .map_err(|err| err.to_string())
        }
    }
}

#[async_trait]
impl RuntimeActionExecutionRepository for FileStorage {
    async fn save_runtime_action_execution(
        &self,
        record: &RuntimeActionExecutionRecord,
    ) -> Result<(), String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::save_runtime_action_execution_sqlite(db_path, record.clone())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::write_json_atomic(
                &self.runtime_action_execution_path(&record.execution_id),
                record,
            )
            .await
            .map_err(|err| err.to_string())
        }
    }

    async fn get_runtime_action_execution(
        &self,
        execution_id: &str,
    ) -> Result<Option<RuntimeActionExecutionRecord>, String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::get_runtime_action_execution_sqlite(db_path, execution_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::read_json(&self.runtime_action_execution_path(execution_id))
                .await
                .map_err(|err| err.to_string())
        }
    }

    async fn list_runtime_action_executions_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<RuntimeActionExecutionRecord>, String> {
        if let Some(db_path) = self.runtime_db_path.clone() {
            Self::list_runtime_action_executions_for_session_sqlite(db_path, session_id.to_string())
                .await
                .map_err(|err| err.to_string())
        } else {
            Self::ensure_dir(&self.runtime_action_executions_dir())
                .await
                .map_err(|err| err.to_string())?;
            let mut reader = fs::read_dir(self.runtime_action_executions_dir())
                .await
                .map_err(|err| err.to_string())?;
            let mut records = Vec::new();
            while let Some(entry) = reader.next_entry().await.map_err(|err| err.to_string())? {
                if let Some(record) = Self::read_json::<RuntimeActionExecutionRecord>(&entry.path())
                    .await
                    .map_err(|err| err.to_string())?
                {
                    if record.session_id == session_id {
                        records.push(record);
                    }
                }
            }
            records.sort_by(|left, right| left.updated_at_unix_ms.cmp(&right.updated_at_unix_ms));
            Ok(records)
        }
    }
}

#[async_trait]
impl TutorAccountRepository for FileStorage {
    async fn save_tutor_account(&self, account: &TutorAccount) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let account = account.clone();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client = Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let existing_accounts = self.list_tutor_accounts().await?;
        for existing in existing_accounts {
            if existing.id == account.id {
                continue;
            }
            if existing.google_id == account.google_id {
                return Err(format!(
                    "google account {} is already linked to another tutor account",
                    account.google_id
                ));
            }
            if let (Some(existing_phone), Some(account_phone)) = (
                existing.phone_number.as_deref(),
                account.phone_number.as_deref(),
            ) {
                if existing_phone == account_phone {
                    return Err(format!(
                        "phone number {} is already linked to another tutor account",
                        account_phone
                    ));
                }
            }
        }

        Self::write_json_atomic(&self.tutor_account_path(&account.id), account)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_tutor_account_by_id(
        &self,
        account_id: &str,
    ) -> Result<Option<TutorAccount>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let account_id = account_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<TutorAccount>, String> {
                let mut client = Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::read_json(&self.tutor_account_path(account_id))
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_tutor_account_by_google_id(
        &self,
        google_id: &str,
    ) -> Result<Option<TutorAccount>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let google_id = google_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<TutorAccount>, String> {
                // Log masked URL so we can verify channel_binding is gone
                let masked = if postgres_url.len() > 40 {
                    format!("{}...{}", &postgres_url[..30], &postgres_url[postgres_url.len()-30..])
                } else {
                    "***".to_string()
                };
                eprintln!("[diag] connecting to postgres: {}", masked);

                let mut client = Self::connect_postgres(&postgres_url).map_err(|err| {
                    format!("connect_postgres failed: {}", err)
                })?;
                eprintln!("[diag] connected OK");

                Self::run_postgres_migrations(&mut client).map_err(|err| {
                    format!("run_postgres_migrations failed: {}", err)
                })?;
                eprintln!("[diag] migrations OK");

                // Test 1: simple query (no params)
                match client.query("SELECT 1 AS test", &[]) {
                    Ok(_) => eprintln!("[diag] simple query OK"),
                    Err(e) => eprintln!("[diag] simple query FAILED: {}", e),
                }

                // Test 2: parameterized query with a string
                match client.query("SELECT $1::TEXT AS echo", &[&google_id]) {
                    Ok(_) => eprintln!("[diag] param query OK"),
                    Err(e) => {
                        eprintln!("[diag] param query FAILED: {}", e);
                        return Err(format!("param query test failed: {}", e));
                    }
                }

                // Test 3: actual query
                let row = client
                    .query_opt(
                        "SELECT id, email, google_id, phone_number, phone_verified, status,
                                created_at,
                                updated_at
                         FROM tutor_accounts WHERE google_id = $1",
                        &[&google_id],
                    )
                    .map_err(|err| {
                        eprintln!("[diag] tutor_accounts query FAILED: {}", err);
                        err.to_string()
                    })?;
                eprintln!("[diag] tutor_accounts query OK, row={}", row.is_some());
                row.map(Self::postgres_row_to_tutor_account).transpose()
            })
            .await
            .map_err(|err| err.to_string())?;
        }

        let accounts = self.list_tutor_accounts().await?;
        Ok(accounts
            .into_iter()
            .find(|account| account.google_id == google_id))
    }

    async fn get_tutor_account_by_phone(
        &self,
        phone_number: &str,
    ) -> Result<Option<TutorAccount>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let phone_number = phone_number.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<TutorAccount>, String> {
                let mut client = Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let accounts = self.list_tutor_accounts().await?;
        Ok(accounts
            .into_iter()
            .find(|account| account.phone_number.as_deref() == Some(phone_number)))
    }

    async fn list_all_tutor_accounts(&self, limit: usize) -> Result<Vec<TutorAccount>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            return tokio::task::spawn_blocking(move || -> Result<Vec<TutorAccount>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut accounts = self.list_tutor_accounts().await?;
        accounts.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        accounts.truncate(limit);
        Ok(accounts)
    }
}

#[async_trait]
impl CreditLedgerRepository for FileStorage {
    async fn apply_credit_entry(&self, entry: &CreditLedgerEntry) -> Result<CreditBalance, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let entry = entry.clone();
            return tokio::task::spawn_blocking(move || -> Result<CreditBalance, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;

                let mut transaction = client.transaction().map_err(|err| err.to_string())?;
                transaction
                    .execute(
                        "
                        INSERT INTO credit_ledger (id, account_id, kind, amount, reason, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ",
                        &[
                            &entry.id,
                            &entry.account_id,
                            &Self::credit_entry_kind_to_db(&entry.kind),
                            &entry.amount,
                            &entry.reason,
                            &entry.created_at,
                        ],
                    )
                    .map_err(|err| {
                        if let Some(db_err) = err.as_db_error() {
                            if db_err.code().code() == "23505" {
                                return format!("credit entry {} already exists", entry.id);
                            }
                        }
                        err.to_string()
                    })?;

                let delta = match entry.kind {
                    CreditEntryKind::Debit => -entry.amount.abs(),
                    CreditEntryKind::Grant | CreditEntryKind::Refund => entry.amount.abs(),
                };
                let balance = transaction
                    .query_one(
                        "
                        INSERT INTO credit_balances (account_id, balance, updated_at)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (account_id) DO UPDATE SET
                            balance = credit_balances.balance + EXCLUDED.balance,
                            updated_at = EXCLUDED.updated_at
                        RETURNING account_id, balance, updated_at
                        ",
                        &[&entry.account_id, &delta, &entry.created_at],
                    )
                    .map_err(|err| err.to_string())?;
                transaction.commit().map_err(|err| err.to_string())?;

                let updated_at = balance
                    .get::<_, String>("updated_at")
                    .parse::<chrono::DateTime<Utc>>()
                    .map_err(|err| err.to_string())?;

                Ok(CreditBalance {
                    account_id: balance.get("account_id"),
                    balance: balance.get("balance"),
                    updated_at,
                })
            })
            .await
            .map_err(|err| err.to_string())?;
        }

        let entry_path = self.credit_entry_path(&entry.id);
        if entry_path.exists() {
            return Err(format!("credit entry {} already exists", entry.id));
        }

        Self::ensure_dir(&self.credit_entries_dir())
            .await
            .map_err(|err| err.to_string())?;
        Self::ensure_dir(&self.credit_balances_dir())
            .await
            .map_err(|err| err.to_string())?;

        let existing_balance =
            self.get_credit_balance(&entry.account_id)
                .await
                .unwrap_or(CreditBalance {
                    account_id: entry.account_id.clone(),
                    balance: 0.0,
                    updated_at: entry.created_at,
                });

        let mut new_balance = existing_balance.balance + entry.amount;
        if matches!(entry.kind, CreditEntryKind::Debit) && entry.amount > 0.0 {
            new_balance = existing_balance.balance - entry.amount.abs();
        }

        let balance_record = CreditBalance {
            account_id: entry.account_id.clone(),
            balance: new_balance,
            updated_at: entry.created_at,
        };

        Self::write_json_atomic(&entry_path, entry)
            .await
            .map_err(|err| err.to_string())?;
        Self::write_json_atomic(
            &self.credit_balance_path(&entry.account_id),
            &balance_record,
        )
        .await
        .map_err(|err| err.to_string())?;

        Ok(balance_record)
    }

    async fn get_credit_balance(&self, account_id: &str) -> Result<CreditBalance, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let account_id = account_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<CreditBalance, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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

                Ok(CreditBalance {
                    account_id: row.get("account_id"),
                    balance: row.get("balance"),
                    updated_at,
                })
            })
            .await
            .map_err(|err| err.to_string())?;
        }

        if let Some(balance) =
            Self::read_json::<CreditBalance>(&self.credit_balance_path(account_id))
                .await
                .map_err(|err| err.to_string())?
        {
            return Ok(balance);
        }

        Ok(CreditBalance {
            account_id: account_id.to_string(),
            balance: 0.0,
            updated_at: Utc::now(),
        })
    }

    async fn list_credit_entries(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<CreditLedgerEntry>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let account_id = account_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Vec<CreditLedgerEntry>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::ensure_dir(&self.credit_entries_dir())
            .await
            .map_err(|err| err.to_string())?;
        let mut reader = fs::read_dir(self.credit_entries_dir())
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = Vec::new();
        while let Some(entry) = reader.next_entry().await.map_err(|err| err.to_string())? {
            if let Some(record) = Self::read_json::<CreditLedgerEntry>(&entry.path())
                .await
                .map_err(|err| err.to_string())?
            {
                if record.account_id == account_id {
                    entries.push(record);
                }
            }
        }
        entries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        entries.truncate(limit);
        Ok(entries)
    }

    async fn list_all_credit_entries(&self, limit: usize) -> Result<Vec<CreditLedgerEntry>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            return tokio::task::spawn_blocking(move || -> Result<Vec<CreditLedgerEntry>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::ensure_dir(&self.credit_entries_dir())
            .await
            .map_err(|err| err.to_string())?;
        let mut reader = fs::read_dir(self.credit_entries_dir())
            .await
            .map_err(|err| err.to_string())?;
        let mut entries = Vec::new();
        while let Some(entry) = reader.next_entry().await.map_err(|err| err.to_string())? {
            if let Some(record) = Self::read_json::<CreditLedgerEntry>(&entry.path())
                .await
                .map_err(|err| err.to_string())?
            {
                entries.push(record);
            }
        }
        entries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        entries.truncate(limit);
        Ok(entries)
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
        
        // Add account to redeemed list if not already present
        if !promo.redeemed_by_accounts.contains(&account_id.to_string()) {
            promo.redeemed_by_accounts.push(account_id.to_string());
            promo.updated_at = Utc::now();
            self.save_promo_code(&promo).await?;
        }
        
        Ok(())
    }
}

#[async_trait]
impl PaymentOrderRepository for FileStorage {
    async fn save_payment_order(&self, order: &PaymentOrder) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let order = order.clone();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let order_path = if let Some(existing) = self
            .get_payment_order_by_gateway_txn_id(&order.gateway_txn_id)
            .await
            .map_err(|err| err.to_string())?
        {
            self.payment_order_path(&existing.id)
        } else {
            self.payment_order_path(&order.id)
        };

        Self::write_json_atomic(&order_path, order)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_payment_order_by_id(&self, order_id: &str) -> Result<Option<PaymentOrder>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let order_id = order_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<PaymentOrder>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::read_json(&self.payment_order_path(order_id))
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_payment_order_by_gateway_txn_id(
        &self,
        gateway_txn_id: &str,
    ) -> Result<Option<PaymentOrder>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let gateway_txn_id = gateway_txn_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<PaymentOrder>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let orders = self.list_payment_orders().await?;
        Ok(orders
            .into_iter()
            .find(|order| order.gateway_txn_id == gateway_txn_id))
    }

    async fn list_payment_orders_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<PaymentOrder>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let account_id = account_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Vec<PaymentOrder>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut orders = self
            .list_payment_orders()
            .await?
            .into_iter()
            .filter(|order| order.account_id == account_id)
            .collect::<Vec<_>>();
        orders.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        orders.truncate(limit);
        Ok(orders)
    }

    async fn list_all_payment_orders(&self, limit: usize) -> Result<Vec<PaymentOrder>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            return tokio::task::spawn_blocking(move || -> Result<Vec<PaymentOrder>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut orders = self.list_payment_orders().await?;
        orders.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        orders.truncate(limit);
        Ok(orders)
    }
}

#[async_trait]
impl SubscriptionRepository for FileStorage {
    async fn save_subscription(&self, subscription: &Subscription) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let subscription = subscription.clone();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let subscription_path = if let Some(gateway_subscription_id) = subscription
            .gateway_subscription_id
            .as_deref()
        {
            if let Some(existing) = self
                .get_subscription_by_gateway_subscription_id(gateway_subscription_id)
                .await
                .map_err(|err| err.to_string())?
            {
                self.subscription_path(&existing.id)
            } else {
                self.subscription_path(&subscription.id)
            }
        } else if let Some(existing) = self
            .get_subscription_by_id(&subscription.id)
            .await
            .map_err(|err| err.to_string())?
        {
            self.subscription_path(&existing.id)
        } else {
            self.subscription_path(&subscription.id)
        };

        Self::write_json_atomic(&subscription_path, subscription)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_subscription_by_id(
        &self,
        subscription_id: &str,
    ) -> Result<Option<Subscription>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let subscription_id = subscription_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<Subscription>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::read_json(&self.subscription_path(subscription_id))
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_subscription_by_gateway_subscription_id(
        &self,
        gateway_subscription_id: &str,
    ) -> Result<Option<Subscription>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let gateway_subscription_id = gateway_subscription_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<Subscription>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let subscriptions = self.list_subscriptions().await?;
        Ok(subscriptions
            .into_iter()
            .find(|subscription| {
                subscription
                    .gateway_subscription_id
                    .as_deref()
                    == Some(gateway_subscription_id)
            }))
    }

    async fn list_all_subscriptions(&self, limit: usize) -> Result<Vec<Subscription>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            return tokio::task::spawn_blocking(move || -> Result<Vec<Subscription>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut subscriptions = self.list_subscriptions().await?;
        subscriptions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        subscriptions.truncate(limit);
        Ok(subscriptions)
    }

    async fn list_subscriptions_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<Subscription>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let account_id = account_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Vec<Subscription>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut subscriptions = self
            .list_subscriptions()
            .await?
            .into_iter()
            .filter(|subscription| subscription.account_id == account_id)
            .collect::<Vec<_>>();
        subscriptions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        subscriptions.truncate(limit);
        Ok(subscriptions)
    }

    async fn list_subscriptions_due_for_renewal(
        &self,
        renewal_cutoff_rfc3339: &str,
        limit: usize,
    ) -> Result<Vec<Subscription>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let renewal_cutoff_rfc3339 = renewal_cutoff_rfc3339.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Vec<Subscription>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client)
                    .map_err(|err| err.to_string())?;
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
                          AND next_renewal_at <= $1::timestamptz
                          AND status IN ('active', 'past_due')
                        ORDER BY next_renewal_at ASC
                        LIMIT $2
                        ",
                        &[&renewal_cutoff_rfc3339, &(limit as i64)],
                    )
                    .map_err(|err| err.to_string())?;
                rows.into_iter()
                    .map(Self::postgres_row_to_subscription)
                    .collect()
            })
            .await
            .map_err(|err| err.to_string())?;
        }

        let cutoff = renewal_cutoff_rfc3339
            .parse::<chrono::DateTime<Utc>>()
            .map_err(|err| err.to_string())?;
        let mut subscriptions = self
            .list_subscriptions()
            .await?
            .into_iter()
            .filter(|subscription| {
                matches!(
                    subscription.status,
                    SubscriptionStatus::Active | SubscriptionStatus::PastDue
                ) && subscription
                    .next_renewal_at
                    .is_some_and(|next_renewal_at| next_renewal_at <= cutoff)
            })
            .collect::<Vec<_>>();
        subscriptions.sort_by(|left, right| left.next_renewal_at.cmp(&right.next_renewal_at));
        subscriptions.truncate(limit);
        Ok(subscriptions)
    }
}

#[async_trait]
impl InvoiceRepository for FileStorage {
    async fn create_invoice(&self, invoice: &Invoice) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let invoice = invoice.clone();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::write_json_atomic(&self.invoice_path(&invoice.id), invoice)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_invoice(&self, invoice_id: &str) -> Result<Option<Invoice>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let invoice_id = invoice_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<Invoice>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::read_json(&self.invoice_path(invoice_id))
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_invoice_for_update(&self, invoice_id: &str) -> Result<Option<Invoice>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let invoice_id = invoice_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<Invoice>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        self.get_invoice(invoice_id).await
    }

    async fn list_invoices_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<Invoice>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let account_id = account_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Vec<Invoice>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut invoices = self
            .list_invoices()
            .await?
            .into_iter()
            .filter(|invoice| invoice.account_id == account_id)
            .collect::<Vec<_>>();
        invoices.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        invoices.truncate(limit);
        Ok(invoices)
    }

    async fn get_unpaid_invoices_for_account(
        &self,
        account_id: &str,
    ) -> Result<Vec<Invoice>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let account_id = account_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Vec<Invoice>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut invoices = self
            .list_invoices()
            .await?
            .into_iter()
            .filter(|invoice| {
                invoice.account_id == account_id && !matches!(invoice.status, InvoiceStatus::Paid)
            })
            .collect::<Vec<_>>();
        invoices.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(invoices)
    }

    async fn update_invoice_status(
        &self,
        invoice_id: &str,
        status: InvoiceStatus,
    ) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let invoice_id = invoice_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut invoice = self
            .get_invoice(invoice_id)
            .await?
            .ok_or_else(|| format!("invoice `{invoice_id}` not found"))?;
        invoice.status = status;
        invoice.updated_at = Utc::now();
        Self::write_json_atomic(&self.invoice_path(invoice_id), &invoice)
            .await
            .map_err(|err| err.to_string())
    }

    async fn finalize_invoice(
        &self,
        invoice_id: &str,
        due_at_rfc3339: &str,
    ) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let invoice_id = invoice_id.to_string();
            let due_at_rfc3339 = due_at_rfc3339.to_string();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let due_at = due_at_rfc3339
            .parse::<chrono::DateTime<Utc>>()
            .map_err(|err| err.to_string())?;
        let mut invoice = self
            .get_invoice(invoice_id)
            .await?
            .ok_or_else(|| format!("invoice `{invoice_id}` not found"))?;
        let now = Utc::now();
        invoice.status = InvoiceStatus::Finalized;
        if invoice.finalized_at.is_none() {
            invoice.finalized_at = Some(now);
        }
        invoice.due_at = Some(due_at);
        invoice.updated_at = now;
        Self::write_json_atomic(&self.invoice_path(invoice_id), &invoice)
            .await
            .map_err(|err| err.to_string())
    }
}

#[async_trait]
impl InvoiceLineRepository for FileStorage {
    async fn add_line(&self, line: &InvoiceLine) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let line = line.clone();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::write_json_atomic(&self.invoice_line_path(&line.id), line)
            .await
            .map_err(|err| err.to_string())
    }

    async fn list_lines_for_invoice(&self, invoice_id: &str) -> Result<Vec<InvoiceLine>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let invoice_id = invoice_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Vec<InvoiceLine>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut lines = self
            .list_invoice_lines()
            .await?
            .into_iter()
            .filter(|line| line.invoice_id == invoice_id)
            .collect::<Vec<_>>();
        lines.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        Ok(lines)
    }

    async fn delete_line(&self, line_id: &str) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let line_id = line_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
                client
                    .execute("DELETE FROM invoice_lines WHERE id = $1", &[&line_id])
                    .map_err(|err| err.to_string())?;
                Ok(())
            })
            .await
            .map_err(|err| err.to_string())?;
        }

        let path = self.invoice_line_path(line_id);
        if let Err(err) = fs::remove_file(&path).await {
            if err.kind() != std::io::ErrorKind::NotFound {
                return Err(err.to_string());
            }
        }
        Ok(())
    }

    async fn sum_invoice_lines(&self, invoice_id: &str) -> Result<i64, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let invoice_id = invoice_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<i64, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let total = self
            .list_invoice_lines()
            .await?
            .into_iter()
            .filter(|line| line.invoice_id == invoice_id)
            .map(|line| line.amount_cents)
            .sum();
        Ok(total)
    }
}

#[async_trait]
impl PaymentIntentRepository for FileStorage {
    async fn create_payment_intent(&self, pi: &PaymentIntent) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let pi = pi.clone();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::write_json_atomic(&self.payment_intent_path(&pi.id), pi)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_payment_intent(&self, pi_id: &str) -> Result<Option<PaymentIntent>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let pi_id = pi_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<PaymentIntent>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::read_json(&self.payment_intent_path(pi_id))
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_payment_intent_by_invoice_id(
        &self,
        invoice_id: &str,
    ) -> Result<Option<PaymentIntent>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let invoice_id = invoice_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<PaymentIntent>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Ok(self
            .list_payment_intents()
            .await?
            .into_iter()
            .find(|intent| intent.invoice_id == invoice_id))
    }

    async fn update_payment_intent_status(
        &self,
        pi_id: &str,
        status: PaymentIntentStatus,
    ) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let pi_id = pi_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
                client
                    .execute(
                        "UPDATE payment_intents SET status = $2, updated_at = $3::timestamptz WHERE id = $1",
                        &[&pi_id, &Self::payment_intent_status_to_db(&status), &Utc::now()],
                    )
                    .map_err(|err| err.to_string())?;
                Ok(())
            })
            .await
            .map_err(|err| err.to_string())?;
        }

        let mut intent = self
            .get_payment_intent(pi_id)
            .await?
            .ok_or_else(|| format!("payment intent `{pi_id}` not found"))?;
        intent.status = status;
        intent.updated_at = Utc::now();
        Self::write_json_atomic(&self.payment_intent_path(pi_id), &intent)
            .await
            .map_err(|err| err.to_string())
    }

    async fn list_retryable_payment_intents(
        &self,
        now_rfc3339: &str,
    ) -> Result<Vec<PaymentIntent>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let now_rfc3339 = now_rfc3339.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Vec<PaymentIntent>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
                          AND next_retry_at <= $1::timestamptz
                        ORDER BY next_retry_at ASC
                        ",
                        &[&now_rfc3339],
                    )
                    .map_err(|err| err.to_string())?;
                rows.into_iter()
                    .map(Self::postgres_row_to_payment_intent)
                    .collect()
            })
            .await
            .map_err(|err| err.to_string())?;
        }

        let now = now_rfc3339
            .parse::<chrono::DateTime<Utc>>()
            .map_err(|err| err.to_string())?;
        let mut intents = self
            .list_payment_intents()
            .await?
            .into_iter()
            .filter(|intent| {
                matches!(intent.status, PaymentIntentStatus::Pending | PaymentIntentStatus::Failed)
                    && intent
                        .next_retry_at
                        .is_some_and(|next_retry_at| next_retry_at <= now)
            })
            .collect::<Vec<_>>();
        intents.sort_by(|left, right| left.next_retry_at.cmp(&right.next_retry_at));
        Ok(intents)
    }
}

#[async_trait]
impl DunningCaseRepository for FileStorage {
    async fn create_dunning_case(&self, dc: &DunningCase) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let dc = dc.clone();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::write_json_atomic(&self.dunning_case_path(&dc.id), dc)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_dunning_case(&self, dc_id: &str) -> Result<Option<DunningCase>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let dc_id = dc_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<DunningCase>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::read_json(&self.dunning_case_path(dc_id))
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_dunning_case_by_invoice_id(
        &self,
        invoice_id: &str,
    ) -> Result<Option<DunningCase>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let invoice_id = invoice_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<DunningCase>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Ok(self
            .list_dunning_cases()
            .await?
            .into_iter()
            .find(|case_item| case_item.invoice_id == invoice_id))
    }

    async fn list_active_dunning_cases(&self) -> Result<Vec<DunningCase>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            return tokio::task::spawn_blocking(move || -> Result<Vec<DunningCase>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut cases = self
            .list_dunning_cases()
            .await?
            .into_iter()
            .filter(|case_item| matches!(case_item.status, DunningStatus::Active))
            .collect::<Vec<_>>();
        cases.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(cases)
    }

    async fn update_dunning_case_status(
        &self,
        dc_id: &str,
        status: DunningStatus,
    ) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let dc_id = dc_id.to_string();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
                client
                    .execute(
                        "UPDATE dunning_cases SET status = $2, updated_at = $3::timestamptz WHERE id = $1",
                        &[&dc_id, &Self::dunning_status_to_db(&status), &Utc::now()],
                    )
                    .map_err(|err| err.to_string())?;
                Ok(())
            })
            .await
            .map_err(|err| err.to_string())?;
        }

        let mut case_item = self
            .get_dunning_case(dc_id)
            .await?
            .ok_or_else(|| format!("dunning case `{dc_id}` not found"))?;
        case_item.status = status;
        case_item.updated_at = Utc::now();
        Self::write_json_atomic(&self.dunning_case_path(dc_id), &case_item)
            .await
            .map_err(|err| err.to_string())
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
        if let Some(postgres_url) = self.postgres_url.clone() {
            let event = event.clone();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::write_json_atomic(&self.webhook_event_path(&event.event_identifier), event)
            .await
            .map_err(|err| err.to_string())
    }

    async fn get_webhook_event(
        &self,
        event_identifier: &str,
    ) -> Result<Option<WebhookEvent>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let event_identifier = event_identifier.to_string();
            return tokio::task::spawn_blocking(move || -> Result<Option<WebhookEvent>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::read_json(&self.webhook_event_path(event_identifier))
            .await
            .map_err(|err| err.to_string())
    }
}

#[async_trait]
impl FinancialAuditRepository for FileStorage {
    async fn log_event(&self, audit: &FinancialAuditLog) -> Result<(), String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let audit = audit.clone();
            return tokio::task::spawn_blocking(move || -> Result<(), String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        Self::write_json_atomic(&self.financial_audit_log_path(&audit.id), audit)
            .await
            .map_err(|err| err.to_string())
    }

    async fn list_logs_for_account(
        &self,
        account_id: &str,
        limit: usize,
    ) -> Result<Vec<FinancialAuditLog>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let account_id = account_id.to_string();
            let sql_limit = i64::try_from(limit).map_err(|_| "limit exceeds i64".to_string())?;
            return tokio::task::spawn_blocking(move || -> Result<Vec<FinancialAuditLog>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut logs = self
            .list_financial_audit_logs()
            .await?
            .into_iter()
            .filter(|log| log.account_id == account_id)
            .collect::<Vec<_>>();
        logs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        logs.truncate(limit);
        Ok(logs)
    }

    async fn list_all_audit_logs(&self, limit: usize) -> Result<Vec<FinancialAuditLog>, String> {
        if let Some(postgres_url) = self.postgres_url.clone() {
            let sql_limit = i64::try_from(limit).map_err(|_| "limit exceeds i64".to_string())?;
            return tokio::task::spawn_blocking(move || -> Result<Vec<FinancialAuditLog>, String> {
                let mut client =
                    Self::connect_postgres(&postgres_url).map_err(|err| err.to_string())?;
                Self::run_postgres_migrations(&mut client).map_err(|err| err.to_string())?;
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
            .map_err(|err| err.to_string())?;
        }

        let mut logs = self.list_financial_audit_logs().await?;
        logs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        logs.truncate(limit);
        Ok(logs)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

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
            std::time::SystemTime::now()
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
                    web_search: None,
                },
                pdf_content: None,
                enable_web_search: false,
                enable_image_generation: false,
                enable_video_generation: false,
                enable_tts: false,
                agent_mode: AgentMode::Default,
                account_id: None,
            };
            let stale_time = Utc::now() - ChronoDuration::minutes(31);
            let job = LessonGenerationJob {
                id: "job-1".to_string(),
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
                    web_search: None,
                },
                pdf_content: None,
                enable_web_search: false,
                enable_image_generation: false,
                enable_video_generation: false,
                enable_tts: false,
                agent_mode: AgentMode::Default,
                account_id: None,
            };
            let now = Utc::now();
            let job = LessonGenerationJob {
                id: "job-sqlite-1".to_string(),
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
                        web_search: None,
                    },
                    pdf_content: None,
                    enable_web_search: false,
                    enable_image_generation: false,
                    enable_video_generation: false,
                    enable_tts: false,
                    agent_mode: AgentMode::Default,
                    account_id: None,
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

            let due = storage
                .list_subscriptions_due_for_renewal(
                    &(now + ChronoDuration::days(2)),
                    10,
                )
                .await
                .unwrap();
            assert_eq!(due.len(), 1);
            assert_eq!(due[0].id, "sub-1");
        });
    }
}
