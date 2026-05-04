use std::process::{Command, Stdio};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use base64::Engine;
use chrono::{DateTime, Utc};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_native_tls::TlsConnector as TokioTlsConnector;
use tracing::{info, warn};

#[derive(Debug, Clone)]
pub struct PaymentSuccessNotification {
    pub account_email: String,
    pub account_name: String,
    pub order_id: String,
    pub amount_minor: i64,
    pub currency: String,
}

#[derive(Debug, Clone)]
pub struct PaymentFailedNotification {
    pub account_email: String,
    pub account_name: String,
    pub order_id: String,
    pub amount_minor: i64,
    pub currency: String,
    pub reason: String,
    pub next_retry_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct GracePeriodWarningNotification {
    pub account_email: String,
    pub account_name: String,
    pub grace_end_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ServiceRestrictedNotification {
    pub account_email: String,
    pub account_name: String,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct OperatorOtpNotification {
    pub operator_email: String,
    pub operator_name: String,
    pub otp_code: String,
    pub expires_in_minutes: i64,
}

#[derive(Debug, Clone)]
pub struct EnterpriseContactNotification {
    pub school_name: String,
    pub contact_name: String,
    pub contact_email: String,
    pub contact_phone: Option<String>,
    pub message: String,
}

#[async_trait]
pub trait NotificationService: Send + Sync {
    async fn send_payment_success_notification(
        &self,
        payload: PaymentSuccessNotification,
    ) -> Result<()>;

    async fn send_payment_failed_notification(
        &self,
        payload: PaymentFailedNotification,
    ) -> Result<()>;

    async fn send_grace_period_warning(&self, payload: GracePeriodWarningNotification)
        -> Result<()>;

    async fn send_service_restricted_alert(
        &self,
        payload: ServiceRestrictedNotification,
    ) -> Result<()>;

    async fn send_operator_otp(&self, payload: OperatorOtpNotification) -> Result<()>;

    async fn send_enterprise_contact(&self, payload: EnterpriseContactNotification) -> Result<()>;
}

#[derive(Debug, Default)]
pub struct NoopNotificationService;

#[async_trait]
impl NotificationService for NoopNotificationService {
    async fn send_payment_success_notification(
        &self,
        payload: PaymentSuccessNotification,
    ) -> Result<()> {
        info!(
            email = %payload.account_email,
            order_id = %payload.order_id,
            "Skipping payment success notification (noop service)"
        );
        Ok(())
    }

    async fn send_payment_failed_notification(
        &self,
        payload: PaymentFailedNotification,
    ) -> Result<()> {
        info!(
            email = %payload.account_email,
            order_id = %payload.order_id,
            reason = %payload.reason,
            "Skipping payment failed notification (noop service)"
        );
        Ok(())
    }

    async fn send_grace_period_warning(&self, payload: GracePeriodWarningNotification) -> Result<()> {
        info!(
            email = %payload.account_email,
            grace_end_at = %payload.grace_end_at,
            "Skipping grace period warning (noop service)"
        );
        Ok(())
    }

    async fn send_service_restricted_alert(
        &self,
        payload: ServiceRestrictedNotification,
    ) -> Result<()> {
        warn!(
            email = %payload.account_email,
            reason = %payload.reason,
            "Skipping service restricted alert (noop service)"
        );
        Ok(())
    }

    async fn send_operator_otp(&self, payload: OperatorOtpNotification) -> Result<()> {
        warn!(
            email = %payload.operator_email,
            "Skipping operator OTP notification (noop service)"
        );
        Ok(())
    }

    async fn send_enterprise_contact(&self, payload: EnterpriseContactNotification) -> Result<()> {
        info!(
            school = %payload.school_name,
            email = %payload.contact_email,
            "Skipping enterprise contact notification (noop service)"
        );
        Ok(())
    }
}

#[derive(Clone)]
pub struct SmtpNotificationService {
    from_email: String,
    billing_base_url: String,
    delivery_mode: MailDeliveryMode,
}

#[derive(Clone)]
enum MailDeliveryMode {
    SmtpAuth(SmtpAuthConfig),
    Sendmail { path: String },
}

#[derive(Clone)]
struct SmtpAuthConfig {
    host: String,
    port: u16,
    user: String,
    password: String,
    use_tls: bool,
}

impl SmtpNotificationService {
    pub fn from_env(billing_base_url: String) -> Result<Self> {
        let from_email = required_trimmed_env("AI_TUTOR_SMTP_FROM_EMAIL")?;
        let delivery_mode = if env_flag("AI_TUTOR_SMTP_USE_SENDMAIL") {
            let path = required_trimmed_env("AI_TUTOR_SMTP_SENDMAIL_PATH")?;
            MailDeliveryMode::Sendmail { path }
        } else {
            let host = required_trimmed_env("AI_TUTOR_SMTP_HOST")?;
            let port = required_u16_env("AI_TUTOR_SMTP_PORT", 587)?;
            let user = required_trimmed_env("AI_TUTOR_SMTP_USER")?;
            let password = required_trimmed_env("AI_TUTOR_SMTP_PASSWORD")?;
            let use_tls = env_flag_with_default("AI_TUTOR_SMTP_STARTTLS", true);
            MailDeliveryMode::SmtpAuth(SmtpAuthConfig {
                host,
                port,
                user,
                password,
                use_tls,
            })
        };

        Ok(Self {
            from_email,
            billing_base_url,
            delivery_mode,
        })
    }

    async fn send_html_email(
        &self,
        to_email: &str,
        subject: &str,
        html: String,
        text_fallback: String,
    ) -> Result<()> {
        match &self.delivery_mode {
            MailDeliveryMode::Sendmail { path } => {
                send_via_sendmail(path, &self.from_email, to_email, subject, &html, &text_fallback)
                    .await
            }
            MailDeliveryMode::SmtpAuth(config) => {
                send_via_smtp_auth(
                    config,
                    &self.from_email,
                    to_email,
                    subject,
                    &html,
                    &text_fallback,
                )
                .await
            }
        }
    }
}

#[async_trait]
impl NotificationService for SmtpNotificationService {
    async fn send_payment_success_notification(
        &self,
        payload: PaymentSuccessNotification,
    ) -> Result<()> {
        let amount = format_minor_amount(payload.amount_minor, &payload.currency);
        let html = render_template(
            include_str!("../templates/payment_success.html"),
            &[
                ("customer_name", payload.account_name.as_str()),
                ("amount", amount.as_str()),
                ("order_id", payload.order_id.as_str()),
                ("billing_url", self.billing_base_url.as_str()),
            ],
        );
        let text = format!(
            "Payment received. Order: {} Amount: {}",
            payload.order_id, amount
        );

        self.send_html_email(
            &payload.account_email,
            "Payment received",
            html,
            text,
        )
        .await
    }

    async fn send_payment_failed_notification(
        &self,
        payload: PaymentFailedNotification,
    ) -> Result<()> {
        let amount = format_minor_amount(payload.amount_minor, &payload.currency);
        let next_retry = payload
            .next_retry_at
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| "not scheduled".to_string());

        let html = render_template(
            include_str!("../templates/payment_failed.html"),
            &[
                ("customer_name", payload.account_name.as_str()),
                ("amount", amount.as_str()),
                ("order_id", payload.order_id.as_str()),
                ("error_message", payload.reason.as_str()),
                ("next_retry", next_retry.as_str()),
                ("billing_url", self.billing_base_url.as_str()),
            ],
        );
        let text = format!(
            "Payment failed. Order: {} Amount: {} Reason: {} Next retry: {}",
            payload.order_id, amount, payload.reason, next_retry
        );

        self.send_html_email(&payload.account_email, "Payment failed", html, text)
            .await
    }

    async fn send_grace_period_warning(
        &self,
        payload: GracePeriodWarningNotification,
    ) -> Result<()> {
        let grace_end = payload.grace_end_at.to_rfc3339();
        let html = render_template(
            include_str!("../templates/grace_period_warning.html"),
            &[
                ("customer_name", payload.account_name.as_str()),
                ("grace_end", grace_end.as_str()),
                ("billing_url", self.billing_base_url.as_str()),
            ],
        );
        let text = format!(
            "Grace period ends at {}. Update payment details to avoid service restrictions.",
            grace_end
        );

        self.send_html_email(
            &payload.account_email,
            "Grace period ending soon",
            html,
            text,
        )
        .await
    }

    async fn send_service_restricted_alert(
        &self,
        payload: ServiceRestrictedNotification,
    ) -> Result<()> {
        let html = render_template(
            include_str!("../templates/service_restricted.html"),
            &[
                ("customer_name", payload.account_name.as_str()),
                ("reason", payload.reason.as_str()),
                ("billing_url", self.billing_base_url.as_str()),
            ],
        );
        let text = format!(
            "Service restricted due to billing issue: {}. Visit {}",
            payload.reason, self.billing_base_url
        );

        self.send_html_email(
            &payload.account_email,
            "Service restricted",
            html,
            text,
        )
        .await
    }

    async fn send_operator_otp(&self, payload: OperatorOtpNotification) -> Result<()> {
        let expires = payload.expires_in_minutes.max(1);
        let expires_str = expires.to_string();
        let html = render_template(
            include_str!("../templates/operator_otp.html"),
            &[
                ("operator_name", payload.operator_name.as_str()),
                ("otp_code", payload.otp_code.as_str()),
                ("expires_in_minutes", expires_str.as_str()),
            ],
        );
        let text = format!(
            "Your operator login code is {}. It expires in {} minutes.",
            payload.otp_code, expires
        );

        self.send_html_email(
            &payload.operator_email,
            "Your AI-Tutor operator login code",
            html,
            text,
        )
        .await
    }

    async fn send_enterprise_contact(&self, payload: EnterpriseContactNotification) -> Result<()> {
        let phone = payload.contact_phone.unwrap_or_else(|| "Not provided".to_string());
        
        // We will just construct a simple HTML and Text body without needing a dedicated template file for now
        let html = format!(
            r#"
            <h2>New Enterprise Contact Request</h2>
            <p><strong>School Name:</strong> {}</p>
            <p><strong>Contact Name:</strong> {}</p>
            <p><strong>Email:</strong> {}</p>
            <p><strong>Phone:</strong> {}</p>
            <h3>Message</h3>
            <p>{}</p>
            "#,
            payload.school_name,
            payload.contact_name,
            payload.contact_email,
            phone,
            payload.message.replace("\n", "<br>")
        );
        
        let text = format!(
            "New Enterprise Contact Request\n\nSchool Name: {}\nContact Name: {}\nEmail: {}\nPhone: {}\n\nMessage:\n{}",
            payload.school_name, payload.contact_name, payload.contact_email, phone, payload.message
        );

        // Hardcode the destination email as per requirement
        self.send_html_email(
            "upcraft.consulting@gmail.com",
            &format!("Enterprise Lead: {}", payload.school_name),
            html,
            text,
        )
        .await
    }
}

pub fn notification_service_from_env(base_url: String) -> Arc<dyn NotificationService> {
    let enabled = env_flag("AI_TUTOR_SMTP_ENABLED");
    if !enabled {
        return Arc::new(NoopNotificationService);
    }

    match SmtpNotificationService::from_env(base_url) {
        Ok(service) => Arc::new(service),
        Err(err) => {
            warn!(error = %err, "SMTP enabled but initialization failed, falling back to noop notifications");
            Arc::new(NoopNotificationService)
        }
    }
}

async fn send_via_sendmail(
    sendmail_path: &str,
    from_email: &str,
    to_email: &str,
    subject: &str,
    html: &str,
    text_fallback: &str,
) -> Result<()> {
    let boundary = format!("boundary-{}", uuid::Uuid::new_v4());
    let body = format!(
        "From: {from}\nTo: {to}\nSubject: {subject}\nMIME-Version: 1.0\nContent-Type: multipart/alternative; boundary=\"{boundary}\"\n\n--{boundary}\nContent-Type: text/plain; charset=UTF-8\n\n{text}\n\n--{boundary}\nContent-Type: text/html; charset=UTF-8\n\n{html}\n\n--{boundary}--\n",
        from = from_email,
        to = to_email,
        subject = subject,
        boundary = boundary,
        text = text_fallback,
        html = html,
    );

    let sendmail_path = sendmail_path.to_string();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut child = Command::new(sendmail_path)
            .arg("-t")
            .arg("-i")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| anyhow!("failed to spawn sendmail process: {err}"))?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("sendmail stdin was not available"))?;
        std::io::Write::write_all(&mut stdin, body.as_bytes())
            .map_err(|err| anyhow!("failed writing to sendmail stdin: {err}"))?;
        drop(stdin);

        let output = child
            .wait_with_output()
            .map_err(|err| anyhow!("failed waiting for sendmail process: {err}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("sendmail process failed: {stderr}"));
        }
        Ok(())
    })
    .await
    .map_err(|err| anyhow!("sendmail task failed: {err}"))??;

    Ok(())
}

async fn send_via_smtp_auth(
    config: &SmtpAuthConfig,
    from_email: &str,
    to_email: &str,
    subject: &str,
    html: &str,
    text_fallback: &str,
) -> Result<()> {
    tracing::info!("smtp: resolving dns for {}:{}", config.host, config.port);
    let address = format!("{}:{}", config.host, config.port);
    let addrs = tokio::net::lookup_host(&address).await
        .map_err(|err| anyhow!("smtp dns lookup failed: {err}"))?;
        
    let mut ipv4_addrs = Vec::new();
    let mut ipv6_addrs = Vec::new();
    for addr in addrs {
        if addr.is_ipv4() {
            ipv4_addrs.push(addr);
        } else {
            ipv6_addrs.push(addr);
        }
    }
    // Prioritize IPv4 to avoid IPv6 blackholes in some cloud environments
    ipv4_addrs.extend(ipv6_addrs);
    
    let mut stream = None;
    let mut last_err = None;
    for addr in ipv4_addrs {
        tracing::info!("smtp: attempting tcp connect to {}", addr);
        match tokio::time::timeout(std::time::Duration::from_secs(5), TcpStream::connect(addr)).await {
            Ok(Ok(s)) => {
                tracing::info!("smtp: successfully connected to {}", addr);
                stream = Some(s);
                break;
            }
            Ok(Err(e)) => {
                tracing::warn!("smtp: failed to connect to {}: {}", addr, e);
                last_err = Some(e.into());
            }
            Err(_) => {
                tracing::warn!("smtp: connection to {} timed out after 5s", addr);
                last_err = Some(anyhow!("connection timed out"));
            }
        }
    }
    
    let stream = stream.ok_or_else(|| anyhow!("smtp: all tcp connection attempts failed: {:?}", last_err))?;

    // Port 465 uses Implicit TLS. Others use STARTTLS.
    if config.port == 465 {
        tracing::info!("smtp: initiating implicit TLS handshake on port 465");
        let connector = native_tls::TlsConnector::builder()
            .build()
            .map_err(|err| anyhow!("smtp tls connector build failed: {err}"))?;
        let connector = TokioTlsConnector::from(connector);
        let tls_stream = connector
            .connect(&config.host, stream)
            .await
            .map_err(|err| anyhow!("smtp tls handshake failed: {err}"))?;
            
        tracing::info!("smtp: TLS handshake complete");
        let (read_half, mut write_half) = tokio::io::split(tls_stream);
        let mut reader = BufReader::new(read_half);

        tracing::info!("smtp: waiting for 220 banner");
        expect_smtp_code(&mut reader, 220).await?;
        tracing::info!("smtp: sending EHLO");
        send_smtp_command(&mut write_half, "EHLO ai-tutor.local").await?;
        expect_smtp_code(&mut reader, 250).await?;

        run_smtp_auth_and_send(
            &mut reader,
            &mut write_half,
            &config.user,
            &config.password,
            from_email,
            to_email,
            subject,
            html,
            text_fallback,
        )
        .await
    } else {
        tracing::info!("smtp: plain text connection established on port {}", config.port);
        let (read_half, mut write_half) = tokio::io::split(stream);
        let mut reader = BufReader::new(read_half);

        tracing::info!("smtp: waiting for 220 banner");
        expect_smtp_code(&mut reader, 220).await?;
        tracing::info!("smtp: sending EHLO");
        send_smtp_command(&mut write_half, "EHLO ai-tutor.local").await?;
        expect_smtp_code(&mut reader, 250).await?;

        if config.use_tls {
            tracing::info!("smtp: sending STARTTLS");
            send_smtp_command(&mut write_half, "STARTTLS").await?;
            expect_smtp_code(&mut reader, 220).await?;

            tracing::info!("smtp: upgrading connection to TLS");
            let stream = reader.into_inner().unsplit(write_half);
            
            let connector = native_tls::TlsConnector::builder()
                .build()
                .map_err(|err| anyhow!("smtp tls connector build failed: {err}"))?;
            let connector = TokioTlsConnector::from(connector);
            let tls_stream = connector
                .connect(&config.host, stream)
                .await
                .map_err(|err| anyhow!("smtp starttls handshake failed: {err}"))?;
                
            tracing::info!("smtp: STARTTLS handshake complete");
            let (read_half, mut write_half) = tokio::io::split(tls_stream);
            let mut reader = BufReader::new(read_half);

            tracing::info!("smtp: sending EHLO over TLS");
            send_smtp_command(&mut write_half, "EHLO ai-tutor.local").await?;
            expect_smtp_code(&mut reader, 250).await?;

            run_smtp_auth_and_send(
                &mut reader,
                &mut write_half,
                &config.user,
                &config.password,
                from_email,
                to_email,
                subject,
                html,
                text_fallback,
            )
            .await
        } else {
            tracing::info!("smtp: proceeding without TLS (STARTTLS disabled)");
            run_smtp_auth_and_send(
                &mut reader,
                &mut write_half,
                &config.user,
                &config.password,
                from_email,
                to_email,
                subject,
                html,
                text_fallback,
            )
            .await
        }
    }
}

async fn run_smtp_auth_and_send<R, W>(
    reader: &mut BufReader<R>,
    write_half: &mut W,
    user: &str,
    password: &str,
    from_email: &str,
    to_email: &str,
    subject: &str,
    html: &str,
    text_fallback: &str,
) -> Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    tracing::info!("smtp: sending AUTH LOGIN");
    send_smtp_command(write_half, "AUTH LOGIN").await?;
    expect_smtp_code(reader, 334).await?;

    let user_b64 = base64::engine::general_purpose::STANDARD.encode(user.as_bytes());
    tracing::info!("smtp: sending auth user");
    send_smtp_command(write_half, &user_b64).await?;
    expect_smtp_code(reader, 334).await?;

    let pass_b64 = base64::engine::general_purpose::STANDARD.encode(password.as_bytes());
    tracing::info!("smtp: sending auth pass");
    send_smtp_command(write_half, &pass_b64).await?;
    expect_smtp_code(reader, 235).await?;

    tracing::info!("smtp: sending MAIL FROM");
    send_smtp_command(write_half, &format!("MAIL FROM:<{}>", from_email)).await?;
    expect_smtp_code(reader, 250).await?;

    tracing::info!("smtp: sending RCPT TO");
    send_smtp_command(write_half, &format!("RCPT TO:<{}>", to_email)).await?;
    expect_smtp_code(reader, 250).await?;

    tracing::info!("smtp: sending DATA command");
    send_smtp_command(write_half, "DATA").await?;
    expect_smtp_code(reader, 354).await?;

    let boundary = format!("boundary-{}", uuid::Uuid::new_v4());
    let body = format!(
        "From: {from}\r\nTo: {to}\r\nSubject: {subject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"{boundary}\"\r\n\r\n--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{text}\r\n\r\n--{boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n{html}\r\n\r\n--{boundary}--\r\n",
        from = from_email,
        to = to_email,
        subject = subject,
        boundary = boundary,
        text = text_fallback,
        html = html,
    );

    tracing::info!("smtp: writing email body");
    write_half
        .write_all(body.as_bytes())
        .await
        .map_err(|err| anyhow!("smtp write message failed: {err}"))?;
    write_half
        .write_all(b"\r\n.\r\n")
        .await
        .map_err(|err| anyhow!("smtp finalize message failed: {err}"))?;
    write_half
        .flush()
        .await
        .map_err(|err| anyhow!("smtp flush failed: {err}"))?;
    expect_smtp_code(reader, 250).await?;

    tracing::info!("smtp: sending QUIT");
    send_smtp_command(write_half, "QUIT").await?;
    let _ = expect_smtp_code(reader, 221).await;

    tracing::info!("smtp: email sent successfully");
    Ok(())
}

async fn send_smtp_command<W>(writer: &mut W, command: &str) -> Result<()>
where
    W: AsyncWrite + Unpin,
{
    writer
        .write_all(command.as_bytes())
        .await
        .map_err(|err| anyhow!("smtp write command failed: {err}"))?;
    writer
        .write_all(b"\r\n")
        .await
        .map_err(|err| anyhow!("smtp write newline failed: {err}"))?;
    writer
        .flush()
        .await
        .map_err(|err| anyhow!("smtp flush command failed: {err}"))?;
    Ok(())
}

async fn expect_smtp_code<R>(reader: &mut R, expected: u16) -> Result<()>
where
    R: AsyncBufRead + Unpin,
{
    let (code, message) = read_smtp_response(reader).await?;
    if code != expected {
        return Err(anyhow!(
            "unexpected smtp response code: expected {}, got {} ({})",
            expected,
            code,
            message
        ));
    }
    Ok(())
}

async fn read_smtp_response<R>(reader: &mut R) -> Result<(u16, String)>
where
    R: AsyncBufRead + Unpin,
{
    let mut lines = Vec::new();

    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .await
            .map_err(|err| anyhow!("smtp read failed: {err}"))?;
        if read == 0 {
            return Err(anyhow!("smtp connection closed unexpectedly"));
        }

        let trimmed = line.trim_end().to_string();
        lines.push(trimmed.clone());

        if trimmed.len() >= 4 {
            let continuation = trimmed.as_bytes()[3] == b'-';
            if !continuation {
                let code = trimmed[0..3]
                    .parse::<u16>()
                    .map_err(|err| anyhow!("invalid smtp response code: {err}"))?;
                return Ok((code, lines.join(" | ")));
            }
        }
    }
}

fn required_trimmed_env(key: &str) -> Result<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("{key} is required"))
}

fn env_flag(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| value.to_ascii_lowercase())
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
}

fn env_flag_with_default(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| value.to_ascii_lowercase())
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(default)
}

fn required_u16_env(key: &str, default: u16) -> Result<u16> {
    match std::env::var(key) {
        Ok(raw) => raw
            .trim()
            .parse::<u16>()
            .map_err(|err| anyhow!("{key} must be a valid u16 port: {err}")),
        Err(_) => Ok(default),
    }
}

fn format_minor_amount(amount_minor: i64, currency: &str) -> String {
    format!("{} {:.2}", currency.to_ascii_uppercase(), amount_minor as f64 / 100.0)
}

fn render_template(template: &str, replacements: &[(&str, &str)]) -> String {
    let mut rendered = template.to_string();
    for (key, value) in replacements {
        let token = format!("{{{{{key}}}}}");
        rendered = rendered.replace(&token, value);
    }
    rendered
}
