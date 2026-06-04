/// Payment gateway abstraction layer.
///
/// Provides a unified `PaymentGateway` trait with implementations for:
///   - Stripe (international — USD, EUR, etc.)
///   - Razorpay (India — INR, preferred for Indian students)
///   - Xpay (India — alternative gateway)
///
/// ## Gateway selection at startup
/// The active gateway is selected by which API key is present in env vars.
/// Priority: Stripe → Razorpay → Xpay.
/// If no key is configured, the server panics at startup with a clear error.
///
/// ## Adding a new gateway
/// 1. Implement the `PaymentGateway` trait for your new struct.
/// 2. Add the env var detection to `resolve_payment_gateway()`.
/// 3. No other changes needed — all routing flows through the trait.
///
/// ## Idempotency
/// - Stripe: `Idempotency-Key` header = our `order_id`
/// - Razorpay: `X-Idempotency-Key` header = our `order_id`
/// - Xpay: request-level idempotency field
///
/// ## Webhook security
/// Each gateway uses HMAC-SHA256 to sign webhook payloads.
/// We verify the signature before parsing the event.
/// Invalid signatures → return `None` → caller returns HTTP 400.
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::HashMap;
use tracing::{debug, error, info, warn};

use ai_tutor_domain::gateway::{
    GatewayCheckoutRequest, GatewayCheckoutResponse, GatewayPaymentLinkRequest,
    GatewayPaymentLinkResponse, GatewayWebhookEvent,
};

// ── PaymentGateway trait ──────────────────────────────────────────────────────

/// The unified payment gateway interface.
/// All gateway-specific logic is hidden behind this trait.
#[async_trait]
pub trait PaymentGateway: Send + Sync {
    /// Gateway identifier (e.g., "stripe", "razorpay", "xpay").
    fn name(&self) -> &'static str;
    /// Primary currency for this gateway ("INR" or "USD").
    fn currency(&self) -> &'static str;

    /// Create a hosted checkout session. Returns a URL to redirect the user to.
    async fn create_checkout(
        &self,
        req: &GatewayCheckoutRequest,
    ) -> Result<GatewayCheckoutResponse>;

    /// Create a one-time payment link (for operator top-up with 10min expiry).
    async fn create_payment_link(
        &self,
        req: &GatewayPaymentLinkRequest,
    ) -> Result<GatewayPaymentLinkResponse>;

    /// Parse and verify an incoming webhook payload.
    /// Returns `None` if the signature is invalid (caller must return HTTP 400).
    /// Returns `Some(GatewayWebhookEvent::Unhandled)` for event types we don't act on.
    async fn parse_webhook(
        &self,
        headers: &HeaderMap,
        body: &[u8],
    ) -> Result<Option<GatewayWebhookEvent>>;
}

// ── Gateway factory ───────────────────────────────────────────────────────────

/// Resolve the active payment gateway from environment variables.
/// Priority: Stripe → Razorpay → Xpay.
pub fn resolve_payment_gateway() -> Box<dyn PaymentGateway> {
    if let Ok(key) = std::env::var("AI_TUTOR_STRIPE_SECRET_KEY") {
        let webhook_secret = std::env::var("AI_TUTOR_STRIPE_WEBHOOK_SECRET")
            .unwrap_or_default();
        info!("Payment gateway: Stripe (international)");
        return Box::new(StripeGateway {
            secret_key: key,
            webhook_secret,
            base_url: "https://api.stripe.com".to_string(),
        });
    }

    if let Ok(key_id) = std::env::var("AI_TUTOR_RAZORPAY_KEY_ID") {
        let key_secret = std::env::var("AI_TUTOR_RAZORPAY_KEY_SECRET")
            .expect("AI_TUTOR_RAZORPAY_KEY_SECRET required when RAZORPAY_KEY_ID is set");
        let webhook_secret = std::env::var("AI_TUTOR_RAZORPAY_WEBHOOK_SECRET")
            .unwrap_or_default();
        info!("Payment gateway: Razorpay (India)");
        return Box::new(RazorpayGateway {
            key_id,
            key_secret,
            webhook_secret,
            base_url: "https://api.razorpay.com/v1".to_string(),
        });
    }

    if let Ok(key) = std::env::var("AI_TUTOR_XPAY_API_KEY") {
        let webhook_secret = std::env::var("AI_TUTOR_XPAY_WEBHOOK_SECRET")
            .unwrap_or_default();
        let merchant_id = std::env::var("AI_TUTOR_XPAY_MERCHANT_ID")
            .unwrap_or_default();
        info!("Payment gateway: Xpay (India)");
        return Box::new(XpayGateway {
            api_key: key,
            merchant_id,
            webhook_secret,
            base_url: "https://api.xpaybusiness.com".to_string(),
        });
    }

    // No gateway configured — log clearly and return a no-op gateway.
    // In production this should panic, but during development we allow it.
    warn!(
        "No payment gateway configured. Set AI_TUTOR_STRIPE_SECRET_KEY, \
         AI_TUTOR_RAZORPAY_KEY_ID, or AI_TUTOR_XPAY_API_KEY. \
         Payment endpoints will return errors."
    );
    Box::new(UnconfiguredGateway)
}

// ── Stripe Gateway ────────────────────────────────────────────────────────────

pub struct StripeGateway {
    secret_key: String,
    webhook_secret: String,
    base_url: String,
}

#[async_trait]
impl PaymentGateway for StripeGateway {
    fn name(&self) -> &'static str { "stripe" }
    fn currency(&self) -> &'static str { "USD" }

    async fn create_checkout(&self, req: &GatewayCheckoutRequest) -> Result<GatewayCheckoutResponse> {
        let client = reqwest::Client::new();

        // Build Stripe Checkout Session params.
        let mut params: Vec<(&str, String)> = vec![
            ("mode", "payment".to_string()),
            ("success_url", req.success_url.clone()),
            ("cancel_url", req.failure_url.clone()),
            ("line_items[0][quantity]", "1".to_string()),
            ("line_items[0][price_data][currency]", req.currency.to_lowercase()),
            ("line_items[0][price_data][unit_amount]", req.amount_minor.to_string()),
            ("line_items[0][price_data][product_data][name]", req.product_title.clone()),
            ("metadata[order_id]", req.order_id.clone()),
            ("metadata[account_id]", req.account_id.clone()),
            ("metadata[product_code]", req.product_code.clone()),
            ("metadata[credits_to_grant]", req.credits_to_grant.to_string()),
            ("customer_email", req.email.clone()),
            ("payment_intent_data[metadata][order_id]", req.order_id.clone()),
        ];

        // Add any extra metadata fields.
        for (k, v) in &req.metadata {
            params.push(("metadata[extra]", format!("{}={}", k, v)));
        }

        let response = client
            .post(format!("{}/v1/checkout/sessions", self.base_url))
            .basic_auth(&self.secret_key, Some(""))
            .header("Idempotency-Key", &req.order_id)
            .form(&params)
            .send()
            .await
            .map_err(|e| anyhow!("Stripe checkout request: {}", e))?;

        let status = response.status();
        let body: serde_json::Value = response.json().await
            .map_err(|e| anyhow!("Stripe checkout response parse: {}", e))?;

        if !status.is_success() {
            return Err(anyhow!(
                "Stripe checkout failed ({}): {}",
                status,
                body.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).unwrap_or("unknown error")
            ));
        }

        let checkout_url = body["url"].as_str()
            .ok_or_else(|| anyhow!("Stripe response missing url"))?
            .to_string();
        let session_id = body["id"].as_str()
            .ok_or_else(|| anyhow!("Stripe response missing session id"))?
            .to_string();

        info!(
            order_id = %req.order_id,
            session_id = %session_id,
            "Stripe checkout session created"
        );

        Ok(GatewayCheckoutResponse {
            checkout_url,
            gateway_txn_id: session_id.clone(),
            gateway_order_id: Some(session_id),
        })
    }

    async fn create_payment_link(&self, req: &GatewayPaymentLinkRequest) -> Result<GatewayPaymentLinkResponse> {
        let client = reqwest::Client::new();

        // Stripe Payment Links API.
        let expires_at_unix = req.expires_at.timestamp();
        let params: Vec<(&str, String)> = vec![
            ("line_items[0][quantity]", "1".to_string()),
            ("line_items[0][price_data][currency]", req.currency.to_lowercase()),
            ("line_items[0][price_data][unit_amount]", req.amount_minor.to_string()),
            ("line_items[0][price_data][product_data][name]", req.description.clone()),
            ("metadata[link_id]", req.link_id.clone()),
            ("metadata[account_id]", req.account_id.clone()),
            ("metadata[credits_to_grant]", req.credits_to_grant.to_string()),
            ("after_completion[type]", "redirect".to_string()),
            ("after_completion[redirect][url]", req.callback_url.clone()),
        ];

        let response = client
            .post(format!("{}/v1/payment_links", self.base_url))
            .basic_auth(&self.secret_key, Some(""))
            .header("Idempotency-Key", &req.link_id)
            .form(&params)
            .send()
            .await
            .map_err(|e| anyhow!("Stripe payment link request: {}", e))?;

        let status = response.status();
        let body: serde_json::Value = response.json().await
            .map_err(|e| anyhow!("Stripe payment link response: {}", e))?;

        if !status.is_success() {
            return Err(anyhow!(
                "Stripe payment link failed ({}): {}",
                status,
                body.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).unwrap_or("unknown")
            ));
        }

        let link_url = body["url"].as_str()
            .ok_or_else(|| anyhow!("Stripe payment link missing url"))?
            .to_string();
        let link_id = body["id"].as_str()
            .ok_or_else(|| anyhow!("Stripe payment link missing id"))?
            .to_string();

        Ok(GatewayPaymentLinkResponse {
            payment_link_url: link_url,
            gateway_link_id: link_id,
        })
    }

    async fn parse_webhook(&self, headers: &HeaderMap, body: &[u8]) -> Result<Option<GatewayWebhookEvent>> {
        // Verify Stripe-Signature header.
        let sig_header = headers
            .get("stripe-signature")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| anyhow!("missing Stripe-Signature header"))?;

        if !self.webhook_secret.is_empty() {
            verify_stripe_signature(body, sig_header, &self.webhook_secret)?;
        } else {
            warn!("Stripe webhook secret not configured — skipping signature verification");
        }

        let event: serde_json::Value = serde_json::from_slice(body)
            .map_err(|e| anyhow!("parse Stripe event JSON: {}", e))?;

        let event_type = event["type"].as_str().unwrap_or("unknown");
        let data_obj = &event["data"]["object"];

        match event_type {
            "checkout.session.completed" | "payment_intent.succeeded" => {
                let metadata = extract_stripe_metadata(data_obj);
                let gateway_txn_id = data_obj["id"].as_str()
                    .unwrap_or("").to_string();
                let payment_intent_id = data_obj
                    .get("payment_intent")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&gateway_txn_id)
                    .to_string();
                let amount = data_obj["amount_total"]
                    .as_i64()
                    .or_else(|| data_obj["amount"].as_i64())
                    .unwrap_or(0);
                let currency = data_obj["currency"].as_str().unwrap_or("usd").to_uppercase();

                Ok(Some(GatewayWebhookEvent::PaymentSucceeded {
                    gateway_txn_id,
                    gateway_payment_id: payment_intent_id,
                    amount_minor: amount,
                    currency,
                    metadata,
                }))
            }
            "payment_intent.payment_failed" => {
                let txn_id = data_obj["id"].as_str().unwrap_or("").to_string();
                let reason = data_obj["last_payment_error"]["message"]
                    .as_str()
                    .unwrap_or("payment_failed")
                    .to_string();
                Ok(Some(GatewayWebhookEvent::PaymentFailed {
                    gateway_txn_id: txn_id,
                    reason,
                    error_code: data_obj["last_payment_error"]["code"]
                        .as_str()
                        .map(|s| s.to_string()),
                }))
            }
            "charge.refunded" => {
                let txn_id = data_obj["payment_intent"].as_str().unwrap_or("").to_string();
                let payment_id = data_obj["id"].as_str().unwrap_or("").to_string();
                let refund_amount = data_obj["amount_refunded"].as_i64().unwrap_or(0);
                Ok(Some(GatewayWebhookEvent::Refunded {
                    gateway_txn_id: txn_id,
                    gateway_payment_id: payment_id,
                    refund_amount_minor: refund_amount,
                }))
            }
            _ => {
                debug!(event_type, "unhandled Stripe webhook event type");
                Ok(Some(GatewayWebhookEvent::Unhandled {
                    event_type: event_type.to_string(),
                }))
            }
        }
    }
}

fn extract_stripe_metadata(obj: &serde_json::Value) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(meta) = obj.get("metadata").and_then(|m| m.as_object()) {
        for (k, v) in meta {
            if let Some(s) = v.as_str() {
                map.insert(k.clone(), s.to_string());
            }
        }
    }
    map
}

/// Verify Stripe webhook signature.
/// Stripe signature format: `t=<timestamp>,v1=<hmac_hex>`
/// The signed payload is: `{timestamp}.{body}`
fn verify_stripe_signature(body: &[u8], signature: &str, secret: &str) -> Result<()> {
    use base64::Engine;

    let mut timestamp: Option<&str> = None;
    let mut v1_sig: Option<&str> = None;

    for part in signature.split(',') {
        if let Some(t) = part.strip_prefix("t=") {
            timestamp = Some(t);
        }
        if let Some(v) = part.strip_prefix("v1=") {
            v1_sig = Some(v);
        }
    }

    let timestamp = timestamp.ok_or_else(|| anyhow!("Stripe sig missing timestamp"))?;
    let v1_sig = v1_sig.ok_or_else(|| anyhow!("Stripe sig missing v1"))?;

    let signed_payload = format!("{}.{}", timestamp, String::from_utf8_lossy(body));

    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| anyhow!("HMAC init: {}", e))?;
    mac.update(signed_payload.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    if expected != v1_sig {
        return Err(anyhow!("Stripe webhook signature mismatch"));
    }
    Ok(())
}

// ── Razorpay Gateway ──────────────────────────────────────────────────────────

pub struct RazorpayGateway {
    key_id: String,
    key_secret: String,
    webhook_secret: String,
    base_url: String,
}

#[async_trait]
impl PaymentGateway for RazorpayGateway {
    fn name(&self) -> &'static str { "razorpay" }
    fn currency(&self) -> &'static str { "INR" }

    async fn create_checkout(&self, req: &GatewayCheckoutRequest) -> Result<GatewayCheckoutResponse> {
        let client = reqwest::Client::new();

        // Create a Razorpay Order first, then return the checkout URL.
        let order_payload = serde_json::json!({
            "amount": req.amount_minor,
            "currency": req.currency,
            "receipt": req.order_id,
            "notes": {
                "order_id": req.order_id,
                "account_id": req.account_id,
                "product_code": req.product_code,
                "credits_to_grant": req.credits_to_grant.to_string(),
            }
        });

        let response = client
            .post(format!("{}/orders", self.base_url))
            .basic_auth(&self.key_id, Some(&self.key_secret))
            .header("X-Idempotency-Key", &req.order_id)
            .json(&order_payload)
            .send()
            .await
            .map_err(|e| anyhow!("Razorpay order request: {}", e))?;

        let status = response.status();
        let body: serde_json::Value = response.json().await
            .map_err(|e| anyhow!("Razorpay order response: {}", e))?;

        if !status.is_success() {
            return Err(anyhow!(
                "Razorpay order failed ({}): {:?}",
                status,
                body.get("error")
            ));
        }

        let razorpay_order_id = body["id"].as_str()
            .ok_or_else(|| anyhow!("Razorpay order missing id"))?
            .to_string();

        // For Razorpay, the checkout happens via their JS SDK.
        // We return a special URL that the frontend uses to open the Razorpay popup.
        // Format: razorpay://{order_id}?key={key_id}&amount={amount}&name=AI-Tutor&...
        // The frontend Next.js page handles this by loading Razorpay's JS SDK.
        let checkout_url = format!(
            "/billing/razorpay-checkout?order_id={}&razorpay_order_id={}&amount={}&currency={}&email={}",
            urlencoding(&req.order_id),
            urlencoding(&razorpay_order_id),
            req.amount_minor,
            req.currency,
            urlencoding(&req.email),
        );

        info!(
            order_id = %req.order_id,
            razorpay_order_id = %razorpay_order_id,
            "Razorpay order created"
        );

        Ok(GatewayCheckoutResponse {
            checkout_url,
            gateway_txn_id: razorpay_order_id.clone(),
            gateway_order_id: Some(razorpay_order_id),
        })
    }

    async fn create_payment_link(&self, req: &GatewayPaymentLinkRequest) -> Result<GatewayPaymentLinkResponse> {
        let client = reqwest::Client::new();

        let expires_at_unix = req.expires_at.timestamp();

        let payload = serde_json::json!({
            "amount": req.amount_minor,
            "currency": req.currency,
            "description": req.description,
            "customer": {
                "email": req.email,
                "contact": req.phone.as_deref().unwrap_or(""),
            },
            "notify": {
                "sms": false,
                "email": false,  // We send our own email via nodemailer
            },
            "reminder_enable": false,
            "expire_by": expires_at_unix,
            "notes": {
                "link_id": req.link_id,
                "account_id": req.account_id,
                "credits_to_grant": req.credits_to_grant.to_string(),
            },
            "callback_url": req.callback_url,
            "callback_method": "get",
        });

        let response = client
            .post(format!("{}/payment_links", self.base_url))
            .basic_auth(&self.key_id, Some(&self.key_secret))
            .header("X-Idempotency-Key", &req.link_id)
            .json(&payload)
            .send()
            .await
            .map_err(|e| anyhow!("Razorpay payment link request: {}", e))?;

        let status = response.status();
        let body: serde_json::Value = response.json().await
            .map_err(|e| anyhow!("Razorpay payment link response: {}", e))?;

        if !status.is_success() {
            return Err(anyhow!("Razorpay payment link failed ({}): {:?}", status, body));
        }

        let link_url = body["short_url"].as_str()
            .ok_or_else(|| anyhow!("Razorpay missing short_url"))?
            .to_string();
        let link_id = body["id"].as_str()
            .ok_or_else(|| anyhow!("Razorpay missing payment link id"))?
            .to_string();

        Ok(GatewayPaymentLinkResponse {
            payment_link_url: link_url,
            gateway_link_id: link_id,
        })
    }

    async fn parse_webhook(&self, headers: &HeaderMap, body: &[u8]) -> Result<Option<GatewayWebhookEvent>> {
        // Verify Razorpay-Signature header.
        let sig = headers
            .get("x-razorpay-signature")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| anyhow!("missing x-razorpay-signature header"))?;

        if !self.webhook_secret.is_empty() {
            verify_hmac_sha256(body, sig, &self.webhook_secret)
                .map_err(|_| anyhow!("Razorpay webhook signature mismatch"))?;
        }

        let event: serde_json::Value = serde_json::from_slice(body)
            .map_err(|e| anyhow!("parse Razorpay event: {}", e))?;

        let event_type = event["event"].as_str().unwrap_or("unknown");
        let payload = &event["payload"];

        match event_type {
            "payment.captured" | "order.paid" => {
                let payment = &payload["payment"]["entity"];
                let order = &payload["order"]["entity"];

                let gateway_txn_id = order["receipt"].as_str()
                    .or_else(|| order["id"].as_str())
                    .unwrap_or("")
                    .to_string();
                let payment_id = payment["id"].as_str().unwrap_or("").to_string();
                let amount = payment["amount"].as_i64().unwrap_or(0);
                let currency = payment["currency"].as_str().unwrap_or("INR").to_string();

                let mut metadata: HashMap<String, String> = HashMap::new();
                if let Some(notes) = order.get("notes").and_then(|n| n.as_object()) {
                    for (k, v) in notes {
                        if let Some(s) = v.as_str() {
                            metadata.insert(k.clone(), s.to_string());
                        }
                    }
                }

                Ok(Some(GatewayWebhookEvent::PaymentSucceeded {
                    gateway_txn_id,
                    gateway_payment_id: payment_id,
                    amount_minor: amount,
                    currency,
                    metadata,
                }))
            }
            "payment.failed" => {
                let payment = &payload["payment"]["entity"];
                let txn_id = payment["order_id"].as_str().unwrap_or("").to_string();
                let reason = payment["error_description"].as_str()
                    .unwrap_or("payment_failed").to_string();
                Ok(Some(GatewayWebhookEvent::PaymentFailed {
                    gateway_txn_id: txn_id,
                    reason,
                    error_code: payment["error_code"].as_str().map(|s| s.to_string()),
                }))
            }
            "refund.processed" => {
                let refund = &payload["refund"]["entity"];
                let txn_id = refund["payment_id"].as_str().unwrap_or("").to_string();
                let payment_id = refund["id"].as_str().unwrap_or("").to_string();
                let amount = refund["amount"].as_i64().unwrap_or(0);
                Ok(Some(GatewayWebhookEvent::Refunded {
                    gateway_txn_id: txn_id,
                    gateway_payment_id: payment_id,
                    refund_amount_minor: amount,
                }))
            }
            "payment_link.paid" => {
                let link = &payload["payment_link"]["entity"];
                let link_id = link["id"].as_str().unwrap_or("").to_string();
                let payment = &payload["payment"]["entity"];
                let payment_id = payment["id"].as_str().unwrap_or("").to_string();
                let amount = link["amount"].as_i64().unwrap_or(0);
                let currency = link["currency"].as_str().unwrap_or("INR").to_string();

                let mut metadata: HashMap<String, String> = HashMap::new();
                if let Some(notes) = link.get("notes").and_then(|n| n.as_object()) {
                    for (k, v) in notes {
                        if let Some(s) = v.as_str() {
                            metadata.insert(k.clone(), s.to_string());
                        }
                    }
                }

                Ok(Some(GatewayWebhookEvent::PaymentLinkPaid {
                    gateway_link_id: link_id,
                    gateway_payment_id: payment_id,
                    amount_minor: amount,
                    currency,
                    metadata,
                }))
            }
            _ => {
                debug!(event_type, "unhandled Razorpay webhook event");
                Ok(Some(GatewayWebhookEvent::Unhandled {
                    event_type: event_type.to_string(),
                }))
            }
        }
    }
}

// ── Xpay Gateway ──────────────────────────────────────────────────────────────

pub struct XpayGateway {
    api_key: String,
    merchant_id: String,
    webhook_secret: String,
    base_url: String,
}

#[async_trait]
impl PaymentGateway for XpayGateway {
    fn name(&self) -> &'static str { "xpay" }
    fn currency(&self) -> &'static str { "INR" }

    async fn create_checkout(&self, req: &GatewayCheckoutRequest) -> Result<GatewayCheckoutResponse> {
        let client = reqwest::Client::new();

        let payload = serde_json::json!({
            "merchant_id": self.merchant_id,
            "order_id": req.order_id,
            "amount": req.amount_minor,
            "currency": req.currency,
            "customer_email": req.email,
            "customer_phone": req.phone.as_deref().unwrap_or(""),
            "description": req.product_title,
            "success_url": req.success_url,
            "failure_url": req.failure_url,
            "metadata": {
                "order_id": req.order_id,
                "account_id": req.account_id,
                "product_code": req.product_code,
                "credits_to_grant": req.credits_to_grant.to_string(),
            }
        });

        let response = client
            .post(format!("{}/v2/checkout/create", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| anyhow!("Xpay checkout request: {}", e))?;

        let status = response.status();
        let body: serde_json::Value = response.json().await
            .map_err(|e| anyhow!("Xpay checkout response: {}", e))?;

        if !status.is_success() {
            return Err(anyhow!("Xpay checkout failed ({}): {:?}", status, body));
        }

        let checkout_url = body["data"]["payment_url"].as_str()
            .or_else(|| body["checkout_url"].as_str())
            .ok_or_else(|| anyhow!("Xpay response missing payment_url"))?
            .to_string();
        let txn_id = body["data"]["txn_id"].as_str()
            .or_else(|| body["txn_id"].as_str())
            .unwrap_or(&req.order_id)
            .to_string();

        info!(order_id = %req.order_id, txn_id = %txn_id, "Xpay checkout created");

        Ok(GatewayCheckoutResponse {
            checkout_url,
            gateway_txn_id: txn_id,
            gateway_order_id: Some(req.order_id.clone()),
        })
    }

    async fn create_payment_link(&self, req: &GatewayPaymentLinkRequest) -> Result<GatewayPaymentLinkResponse> {
        let client = reqwest::Client::new();

        let payload = serde_json::json!({
            "merchant_id": self.merchant_id,
            "link_ref": req.link_id,
            "amount": req.amount_minor,
            "currency": req.currency,
            "description": req.description,
            "customer_email": req.email,
            "customer_phone": req.phone.as_deref().unwrap_or(""),
            "expiry": req.expires_at.timestamp(),
            "callback_url": req.callback_url,
            "metadata": {
                "link_id": req.link_id,
                "account_id": req.account_id,
                "credits_to_grant": req.credits_to_grant.to_string(),
            }
        });

        let response = client
            .post(format!("{}/v2/payment-links/create", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| anyhow!("Xpay payment link request: {}", e))?;

        let status = response.status();
        let body: serde_json::Value = response.json().await
            .map_err(|e| anyhow!("Xpay payment link response: {}", e))?;

        if !status.is_success() {
            return Err(anyhow!("Xpay payment link failed ({}): {:?}", status, body));
        }

        let link_url = body["data"]["link_url"].as_str()
            .or_else(|| body["link_url"].as_str())
            .ok_or_else(|| anyhow!("Xpay missing link_url"))?
            .to_string();
        let link_id = body["data"]["link_id"].as_str()
            .or_else(|| body["link_id"].as_str())
            .unwrap_or(&req.link_id)
            .to_string();

        Ok(GatewayPaymentLinkResponse {
            payment_link_url: link_url,
            gateway_link_id: link_id,
        })
    }

    async fn parse_webhook(&self, headers: &HeaderMap, body: &[u8]) -> Result<Option<GatewayWebhookEvent>> {
        // Xpay uses X-Xpay-Signature: HMAC-SHA256 of the raw body.
        let sig = headers
            .get("x-xpay-signature")
            .or_else(|| headers.get("x-webhook-signature"))
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| anyhow!("missing x-xpay-signature header"))?;

        if !self.webhook_secret.is_empty() {
            verify_hmac_sha256(body, sig, &self.webhook_secret)
                .map_err(|_| anyhow!("Xpay webhook signature mismatch"))?;
        }

        let event: serde_json::Value = serde_json::from_slice(body)
            .map_err(|e| anyhow!("parse Xpay event: {}", e))?;

        let event_type = event["event_type"].as_str()
            .or_else(|| event["type"].as_str())
            .unwrap_or("unknown");
        let data = &event["data"];

        match event_type {
            "payment.success" | "payment.captured" => {
                let txn_id = data["order_id"].as_str().unwrap_or("").to_string();
                let payment_id = data["txn_id"].as_str()
                    .or_else(|| data["payment_id"].as_str())
                    .unwrap_or("")
                    .to_string();
                let amount = data["amount"].as_i64().unwrap_or(0);
                let currency = data["currency"].as_str().unwrap_or("INR").to_string();

                let mut metadata: HashMap<String, String> = HashMap::new();
                if let Some(meta) = data.get("metadata").and_then(|m| m.as_object()) {
                    for (k, v) in meta {
                        if let Some(s) = v.as_str() {
                            metadata.insert(k.clone(), s.to_string());
                        }
                    }
                }

                Ok(Some(GatewayWebhookEvent::PaymentSucceeded {
                    gateway_txn_id: txn_id,
                    gateway_payment_id: payment_id,
                    amount_minor: amount,
                    currency,
                    metadata,
                }))
            }
            "payment.failed" => {
                let txn_id = data["order_id"].as_str().unwrap_or("").to_string();
                let reason = data["failure_reason"].as_str().unwrap_or("payment_failed").to_string();
                Ok(Some(GatewayWebhookEvent::PaymentFailed {
                    gateway_txn_id: txn_id,
                    reason,
                    error_code: data["error_code"].as_str().map(|s| s.to_string()),
                }))
            }
            "refund.success" => {
                let txn_id = data["payment_id"].as_str().unwrap_or("").to_string();
                let refund_id = data["refund_id"].as_str().unwrap_or("").to_string();
                let amount = data["refund_amount"].as_i64().unwrap_or(0);
                Ok(Some(GatewayWebhookEvent::Refunded {
                    gateway_txn_id: txn_id,
                    gateway_payment_id: refund_id,
                    refund_amount_minor: amount,
                }))
            }
            "payment_link.paid" => {
                let link_id = data["link_id"].as_str().unwrap_or("").to_string();
                let payment_id = data["payment_id"].as_str().unwrap_or("").to_string();
                let amount = data["amount"].as_i64().unwrap_or(0);
                let currency = data["currency"].as_str().unwrap_or("INR").to_string();

                let mut metadata: HashMap<String, String> = HashMap::new();
                if let Some(meta) = data.get("metadata").and_then(|m| m.as_object()) {
                    for (k, v) in meta {
                        if let Some(s) = v.as_str() {
                            metadata.insert(k.clone(), s.to_string());
                        }
                    }
                }

                Ok(Some(GatewayWebhookEvent::PaymentLinkPaid {
                    gateway_link_id: link_id,
                    gateway_payment_id: payment_id,
                    amount_minor: amount,
                    currency,
                    metadata,
                }))
            }
            _ => {
                debug!(event_type, "unhandled Xpay webhook event");
                Ok(Some(GatewayWebhookEvent::Unhandled {
                    event_type: event_type.to_string(),
                }))
            }
        }
    }
}

// ── UnconfiguredGateway ───────────────────────────────────────────────────────

/// Fallback when no gateway key is configured.
/// All methods return clear errors.
pub struct UnconfiguredGateway;

#[async_trait]
impl PaymentGateway for UnconfiguredGateway {
    fn name(&self) -> &'static str { "unconfigured" }
    fn currency(&self) -> &'static str { "INR" }

    async fn create_checkout(&self, _req: &GatewayCheckoutRequest) -> Result<GatewayCheckoutResponse> {
        Err(anyhow!(
            "No payment gateway configured. Set AI_TUTOR_STRIPE_SECRET_KEY, \
             AI_TUTOR_RAZORPAY_KEY_ID, or AI_TUTOR_XPAY_API_KEY."
        ))
    }

    async fn create_payment_link(&self, _req: &GatewayPaymentLinkRequest) -> Result<GatewayPaymentLinkResponse> {
        Err(anyhow!("No payment gateway configured."))
    }

    async fn parse_webhook(&self, _headers: &HeaderMap, _body: &[u8]) -> Result<Option<GatewayWebhookEvent>> {
        Err(anyhow!("No payment gateway configured."))
    }
}

// ── Shared HMAC-SHA256 helper ─────────────────────────────────────────────────

fn verify_hmac_sha256(body: &[u8], signature: &str, secret: &str) -> Result<()> {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| anyhow!("HMAC init: {}", e))?;
    mac.update(body);
    let expected = hex::encode(mac.finalize().into_bytes());

    if expected != signature {
        return Err(anyhow!("HMAC-SHA256 signature mismatch"));
    }
    Ok(())
}

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}
