/// Payment gateway domain types.
///
/// These are the pure domain structs shared between the gateway implementations
/// and the billing logic. No HTTP, no SDK types — only serializable domain data.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Checkout ─────────────────────────────────────────────────────────────────

/// Request to create a hosted payment checkout session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayCheckoutRequest {
    /// Our internal order ID (used as the idempotency key).
    pub order_id: String,
    pub account_id: String,
    pub email: String,
    pub phone: Option<String>,
    pub product_code: String,
    pub product_title: String,
    /// Amount in smallest currency unit (paise for INR, cents for USD).
    pub amount_minor: i64,
    /// ISO-4217 currency code: "INR" or "USD".
    pub currency: String,
    /// Credits to grant after successful payment (for bookkeeping metadata only).
    pub credits_to_grant: f64,
    /// Where the gateway should redirect after success.
    pub success_url: String,
    /// Where the gateway should redirect after failure or cancellation.
    pub failure_url: String,
    /// Extra key-value metadata passed to the gateway (stored in order for webhook lookup).
    pub metadata: HashMap<String, String>,
}

/// Response from creating a hosted checkout session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayCheckoutResponse {
    /// URL to redirect the user to complete payment.
    pub checkout_url: String,
    /// Gateway's transaction/order ID (stored as gateway_txn_id in payment_orders).
    pub gateway_txn_id: String,
    /// Gateway's own order ID (some gateways distinguish from txn ID).
    pub gateway_order_id: Option<String>,
}

// ── Payment Link (Operator Top-Up) ───────────────────────────────────────────

/// Request to create a one-time payment link (for operator-initiated top-ups).
/// The link expires after `expires_at` (typically 10 minutes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayPaymentLinkRequest {
    /// Our internal link/order ID.
    pub link_id: String,
    pub account_id: String,
    pub email: String,
    pub phone: Option<String>,
    /// Amount in smallest currency unit (paise for INR, cents for USD).
    pub amount_minor: i64,
    pub currency: String,
    /// Credits that will be granted after payment (for display and metadata).
    pub credits_to_grant: f64,
    /// Human-readable description shown on the payment page.
    pub description: String,
    /// When this link expires (gateway will reject payments after this time).
    pub expires_at: DateTime<Utc>,
    /// Webhook/callback URL for payment confirmation.
    pub callback_url: String,
}

/// Response from creating a payment link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayPaymentLinkResponse {
    /// The payment link URL to send to the student via email.
    pub payment_link_url: String,
    /// Gateway's own ID for this payment link.
    pub gateway_link_id: String,
}

// ── Webhook Events ────────────────────────────────────────────────────────────

/// A parsed, gateway-verified webhook event.
///
/// The gateway implementation is responsible for:
/// 1. Verifying the webhook signature (HMAC / RSA / gateway-specific).
/// 2. Parsing the raw payload into one of these variants.
/// 3. Returning None if the signature is invalid (caller returns 400).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_kind", rename_all = "snake_case")]
pub enum GatewayWebhookEvent {
    /// A payment was captured successfully.
    PaymentSucceeded {
        /// Gateway's transaction ID (matches gateway_txn_id in payment_orders).
        gateway_txn_id: String,
        /// Gateway's payment capture ID (stored as gateway_payment_id).
        gateway_payment_id: String,
        /// Amount captured, in smallest currency unit.
        amount_minor: i64,
        /// ISO-4217 currency code.
        currency: String,
        /// Metadata echoed back from the original checkout request.
        metadata: HashMap<String, String>,
    },
    /// A payment attempt failed (not retried by gateway).
    PaymentFailed {
        gateway_txn_id: String,
        /// Human-readable failure reason (e.g. "insufficient_funds").
        reason: String,
        /// Optional gateway error code.
        error_code: Option<String>,
    },
    /// A payment was refunded.
    Refunded {
        gateway_txn_id: String,
        gateway_payment_id: String,
        /// Amount refunded, in smallest currency unit.
        refund_amount_minor: i64,
    },
    /// A payment link was paid (for operator top-up links).
    PaymentLinkPaid {
        /// The gateway_link_id from the original GatewayPaymentLinkResponse.
        gateway_link_id: String,
        gateway_payment_id: String,
        amount_minor: i64,
        currency: String,
        metadata: HashMap<String, String>,
    },
    /// An event type we don't handle — logged and acknowledged without action.
    Unhandled {
        event_type: String,
    },
}

impl GatewayWebhookEvent {
    /// Returns the gateway transaction ID if this event has one.
    pub fn gateway_txn_id(&self) -> Option<&str> {
        match self {
            GatewayWebhookEvent::PaymentSucceeded { gateway_txn_id, .. } => Some(gateway_txn_id),
            GatewayWebhookEvent::PaymentFailed    { gateway_txn_id, .. } => Some(gateway_txn_id),
            GatewayWebhookEvent::Refunded         { gateway_txn_id, .. } => Some(gateway_txn_id),
            _ => None,
        }
    }

    /// Build the idempotency identifier for the webhook_events table.
    /// Format: "{gateway}:{event_id}"
    pub fn idempotency_key(&self, gateway_name: &str) -> String {
        match self {
            GatewayWebhookEvent::PaymentSucceeded { gateway_txn_id, gateway_payment_id, .. } =>
                format!("{}:{}:{}", gateway_name, gateway_txn_id, gateway_payment_id),
            GatewayWebhookEvent::PaymentFailed { gateway_txn_id, .. } =>
                format!("{}:failed:{}", gateway_name, gateway_txn_id),
            GatewayWebhookEvent::Refunded { gateway_txn_id, gateway_payment_id, .. } =>
                format!("{}:refund:{}:{}", gateway_name, gateway_txn_id, gateway_payment_id),
            GatewayWebhookEvent::PaymentLinkPaid { gateway_link_id, gateway_payment_id, .. } =>
                format!("{}:link:{}:{}", gateway_name, gateway_link_id, gateway_payment_id),
            GatewayWebhookEvent::Unhandled { event_type } =>
                format!("{}:unhandled:{}", gateway_name, event_type),
        }
    }
}

// ── Operator Top-Up Order ─────────────────────────────────────────────────────

/// An operator-initiated top-up order. Stored in the DB (payment_orders table
/// with product_kind = 'operator_topup') and in Redis as a signed token.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorTopupOrder {
    /// Matches payment_orders.id
    pub order_id: String,
    pub account_id: String,
    /// Credits to grant after payment.
    pub credits_to_grant: f64,
    /// Amount in paise (INR).
    pub price_minor: i64,
    /// Human-readable reason shown to student on the payment page.
    pub reason: String,
    /// When this top-up link expires (10 minutes from creation).
    pub expires_at: DateTime<Utc>,
    /// Gateway payment link URL (set after gateway.create_payment_link() call).
    pub payment_link_url: Option<String>,
    /// Gateway's link ID for webhook lookup.
    pub gateway_link_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl OperatorTopupOrder {
    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }
}

// ── Revenue Snapshot ─────────────────────────────────────────────────────────

/// Pre-aggregated revenue data per hour per gateway.
/// Written after each successful payment, read by the operator time-series chart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevenueSnapshot {
    pub id: String,
    /// The start of the hour this snapshot covers (truncated to the hour).
    pub hour: DateTime<Utc>,
    /// Gateway name: "stripe" | "razorpay" | "xpay" | "operator_topup".
    pub gateway: String,
    /// Total revenue in smallest currency unit (paise / cents).
    pub revenue_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    /// Number of successful orders in this hour.
    pub order_count: i32,
    pub created_at: DateTime<Utc>,
}
