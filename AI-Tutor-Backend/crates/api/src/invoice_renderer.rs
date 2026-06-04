/// Invoice PDF renderer using Typst embedded as a Rust library.
///
/// ## Why Typst instead of Lago's Gotenberg approach
///
/// Lago: Slim template → HTML → HTTP POST to Gotenberg (headless Chromium sidecar) → PDF
///   - Requires a separate Docker container running Gotenberg
///   - Network round-trip for every PDF
///   - Chromium memory usage: ~200MB per render
///
/// Our approach: Typst embedded library → PDF bytes — all in-process
///   - Zero system dependencies (no Chromium, no Docker)
///   - Millisecond compilation (~5–30ms for a 1-page invoice)
///   - Fonts embedded at compile time (no filesystem reads)
///   - 40MB binary impact vs ~200MB for Chromium
///
/// ## comemo eviction
/// Typst uses the `comemo` crate for incremental compilation memoization.
/// In a long-running server, the comemo cache grows unboundedly.
/// We call `comemo::evict(30)` every 50 renders to prune stale cache entries.
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;

use anyhow::{anyhow, Result};
use chrono::{Datelike, Utc};
use serde_json::json;
use tracing::{debug, warn};

use ai_tutor_domain::{
    auth::TutorAccount,
    billing::{Invoice, InvoiceLine, Subscription},
};
use crate::billing_catalog::BillingProductDefinition;

// ── Typst world implementation ────────────────────────────────────────────────
// We use typst and typst-pdf as library crates.
// The World trait is implemented by InvoiceWorld below.
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime};
use typst::syntax::{FileId, Source, VirtualPath};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt};
use typst_kit::fonts::{FontSearcher, FontSlot};

// ── Static font storage (loaded once per process) ────────────────────────────
struct StaticFonts {
    book: LazyHash<FontBook>,
    fonts: Vec<FontSlot>,
}

static FONTS: OnceLock<StaticFonts> = OnceLock::new();

fn get_static_fonts() -> &'static StaticFonts {
    FONTS.get_or_init(|| {
        let searched = FontSearcher::new()
            .include_system_fonts(false) // embedded fonts only — no filesystem reads
            .search();
        StaticFonts {
            book: LazyHash::new(searched.book),
            fonts: searched.fonts,
        }
    })
}

// ── Typst invoice template (embedded at compile time) ─────────────────────────
const INVOICE_TEMPLATE: &str = include_str!("invoice_template.typ");

// ── comemo eviction counter ───────────────────────────────────────────────────
static RENDER_COUNT: AtomicUsize = AtomicUsize::new(0);
const EVICT_EVERY: usize = 50;

// ── InvoiceWorld: Typst World implementation ──────────────────────────────────

/// A minimal Typst World implementation for invoice compilation.
///
/// Data is injected via a virtual `/invoice_data.json` file.
/// The template reads it with: `#let d = json("/invoice_data.json")`
///
/// No filesystem access, no network calls, no external processes.
struct InvoiceWorld {
    library: LazyHash<Library>,
    source: Source,
    main_id: FileId,
    json_data: Vec<u8>,
}

impl InvoiceWorld {
    fn new(json_data: Vec<u8>) -> Self {
        // VirtualPath::new expects a path without leading slash in some Typst versions.
        // We use a stable virtual path name for the main template.
        let main_id = FileId::new(None, VirtualPath::new("invoice.typ"));
        let library = LazyHash::new(Library::builder().build());
        let source = Source::new(main_id, INVOICE_TEMPLATE.to_owned());

        Self {
            library,
            source,
            main_id,
            json_data,
        }
    }
}

impl typst::World for InvoiceWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &get_static_fonts().book
    }

    fn main(&self) -> FileId {
        self.main_id
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main_id {
            Ok(self.source.clone())
        } else {
            Err(FileError::NotFound(id.vpath().as_rootless_path().into()))
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        let path = id.vpath().as_rootless_path();
        // Serve the injected JSON data when the template requests it.
        if path == Path::new("invoice_data.json")
            || path == Path::new("/invoice_data.json")
        {
            Ok(Bytes::new(self.json_data.clone()))
        } else {
            Err(FileError::NotFound(path.into()))
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        get_static_fonts().fonts.get(index)?.get()
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        let now = Utc::now();
        let naive = match offset {
            None => now.naive_utc(),
            Some(h) => now.naive_utc() + chrono::Duration::hours(h),
        };
        Datetime::from_ymd(
            naive.year(),
            naive.month() as u8,
            naive.day() as u8,
        )
    }
}

// ── InvoiceRenderer ──────────────────────────────────────────────────────────

/// Thread-safe invoice PDF renderer.
/// Wraps the Typst compilation pipeline.
/// Instances are cheaply cloned (Arc<InvoiceRenderer> pattern).
#[derive(Clone)]
pub struct InvoiceRenderer;

impl InvoiceRenderer {
    pub fn new() -> Self {
        Self
    }

    /// Render an invoice to PDF bytes.
    ///
    /// **Must be called from `tokio::task::spawn_blocking`** — Typst compilation is CPU-bound
    /// and synchronous. Calling from an async context directly will block the runtime.
    pub fn render_invoice(
        &self,
        invoice: &Invoice,
        lines: &[InvoiceLine],
        account: &TutorAccount,
        subscription: Option<&Subscription>,
        product: Option<&BillingProductDefinition>,
    ) -> Result<Vec<u8>> {
        let json_data = build_invoice_json(invoice, lines, account, subscription, product)?;
        let json_bytes = serde_json::to_vec(&json_data)
            .map_err(|e| anyhow!("serialize invoice JSON: {}", e))?;

        let pdf_bytes = compile_typst_pdf(json_bytes)?;

        // Evict comemo cache periodically to prevent unbounded memory growth.
        let count = RENDER_COUNT.fetch_add(1, Ordering::Relaxed);
        if count % EVICT_EVERY == 0 {
            comemo::evict(30);
            debug!(render_count = count, "comemo cache evicted");
        }

        Ok(pdf_bytes)
    }
}

/// Compile the invoice template with the given JSON data to PDF bytes.
/// This is the core Lago-equivalent PDF generation — pure Rust, in-process.
fn compile_typst_pdf(json_bytes: Vec<u8>) -> Result<Vec<u8>> {
    use typst::layout::PagedDocument;
    use typst_pdf::{pdf, PdfOptions};

    let world = InvoiceWorld::new(json_bytes);
    let result = typst::compile::<PagedDocument>(&world);

    // Log warnings (non-fatal).
    for warning in &result.warnings {
        warn!(message = ?warning.message, "typst compilation warning");
    }

    let document = result
        .output
        .map_err(|errors| {
            let msg = errors
                .iter()
                .map(|e| format!("{}", e.message))
                .collect::<Vec<_>>()
                .join("; ");
            anyhow!("typst compilation errors: {}", msg)
        })?;

    let pdf_bytes = pdf(&document, &PdfOptions::default())
        .map_err(|e| anyhow!("typst PDF export: {:?}", e))?;

    Ok(pdf_bytes)
}

/// Build the JSON data structure that the Typst template consumes.
fn build_invoice_json(
    invoice: &Invoice,
    lines: &[InvoiceLine],
    account: &TutorAccount,
    subscription: Option<&Subscription>,
    product: Option<&BillingProductDefinition>,
) -> Result<serde_json::Value> {
    let status_str = match invoice.status {
        ai_tutor_domain::billing::InvoiceStatus::Paid => "paid",
        ai_tutor_domain::billing::InvoiceStatus::Open
        | ai_tutor_domain::billing::InvoiceStatus::Finalized => "open",
        ai_tutor_domain::billing::InvoiceStatus::Overdue => "overdue",
        _ => "pending",
    };

    // Shorten the invoice ID for display (first 16 chars + …).
    let display_id = if invoice.id.len() > 16 {
        format!("{}…", &invoice.id[..16])
    } else {
        invoice.id.clone()
    };

    let billing_period = format!(
        "{} – {}",
        invoice.billing_cycle_start.format("%d %b %Y"),
        invoice.billing_cycle_end.format("%d %b %Y"),
    );

    // Compute GST if INR.
    let subtotal = invoice.amount_cents;
    let (gst_cents, total_cents) = if product.map(|p| p.currency.as_str()) == Some("INR") {
        let gst = (subtotal as f64 * 0.18).round() as i64;
        (gst, subtotal + gst)
    } else {
        (0i64, subtotal)
    };

    // Build line items JSON array.
    let line_items: Vec<serde_json::Value> = lines
        .iter()
        .map(|line| {
            let note = format!(
                "Billing period: {} – {}",
                line.period_start.format("%d %b %Y"),
                line.period_end.format("%d %b %Y"),
            );
            json!({
                "description": line.description,
                "quantity": line.quantity,
                "unit_price_cents": line.unit_price_cents,
                "amount_cents": line.amount_cents,
                "note": if line.is_prorated { format!("{} (prorated)", note) } else { note },
            })
        })
        .collect();

    let credits_granted = subscription
        .map(|s| s.credits_per_cycle)
        .or_else(|| product.map(|p| p.credits))
        .unwrap_or(0.0);

    let currency = product
        .map(|p| p.currency.clone())
        .unwrap_or_else(|| "INR".to_string());

    let customer_plan = subscription
        .map(|s| {
            let code = s.plan_code.replace('_', " ");
            let mut c = code.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .or_else(|| product.map(|p| p.title.clone()))
        .unwrap_or_default();

    Ok(json!({
        "invoice_number": display_id,
        "invoice_date": Utc::now().format("%d %b %Y").to_string(),
        "billing_period": billing_period,
        "status": status_str,
        "currency": currency,
        "customer_name": account.email.split('@').next().unwrap_or("Customer").to_string(),
        "customer_email": account.email,
        "customer_phone": account.phone_number.clone().unwrap_or_default(),
        "customer_plan": customer_plan,
        "line_items": line_items,
        "subtotal_cents": subtotal,
        "gst_cents": gst_cents,
        "total_cents": total_cents,
        "credits_granted": credits_granted,
    }))
}

// ── upload_invoice_pdf — storage helper ──────────────────────────────────────

/// Extension trait on FileStorage to upload invoice PDFs.
/// Returns the public URL (R2 presigned or local filesystem path).
pub async fn upload_invoice_pdf_to_storage(
    storage: &ai_tutor_storage::filesystem::FileStorage,
    invoice_id: &str,
    account_id: &str,
    pdf_bytes: Vec<u8>,
) -> Result<String> {
    use tokio::fs;

    // Use the publicly accessible root_dir() method.
    let invoice_dir = storage.root_dir().join("invoices").join(account_id);
    fs::create_dir_all(&invoice_dir)
        .await
        .map_err(|e| anyhow!("create invoice dir: {}", e))?;

    let file_name = format!("{}.pdf", invoice_id);
    let file_path = invoice_dir.join(&file_name);

    fs::write(&file_path, &pdf_bytes)
        .await
        .map_err(|e| anyhow!("write invoice PDF: {}", e))?;

    // Return a relative URL (frontend serves via /api/billing/invoices/:id/pdf).
    // In production with R2, this would be a presigned URL.
    let url = format!("/invoices/{}/{}", account_id, file_name);
    Ok(url)
}

/// Read a stored invoice PDF by invoice_id and account_id.
pub async fn read_invoice_pdf_from_storage(
    storage: &ai_tutor_storage::filesystem::FileStorage,
    invoice_id: &str,
    account_id: &str,
) -> Result<Vec<u8>> {
    use tokio::fs;
    let file_path = storage.root_dir()
        .join("invoices")
        .join(account_id)
        .join(format!("{}.pdf", invoice_id));

    fs::read(&file_path)
        .await
        .map_err(|e| anyhow!("read invoice PDF {}: {}", invoice_id, e))
}
