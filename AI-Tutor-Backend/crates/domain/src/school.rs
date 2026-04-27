use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct School {
    pub id: String,
    pub name: String,
    pub admin_email: String,
    /// Plan code, e.g. "free", "pro", "enterprise"
    pub plan: String,
    /// Shared credit pool for all school members
    pub credit_pool: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SchoolInvoiceStatus {
    Pending,
    Paid,
    Overdue,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SchoolInvoice {
    pub id: String,
    pub school_id: String,
    pub amount_cents: i64,
    pub payment_link: Option<String>,
    pub status: SchoolInvoiceStatus,
    pub due_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub paid_at: Option<DateTime<Utc>>,
}
