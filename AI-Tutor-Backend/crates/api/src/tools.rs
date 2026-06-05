use axum::{
    extract::{Multipart, State},
    Json,
};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::env;

use ai_tutor_domain::routing::QualityTier;
use ai_tutor_routing::routing_rules;

use crate::app::{ApiError, AppState};
use crate::telemetry::UsageEvent;

#[derive(Deserialize)]
pub struct WebSearchRequest {
    pub query: String,
    #[serde(default, rename = "pdfText")]
    pub pdf_text: Option<String>,
}

#[derive(Serialize)]
pub struct WebSearchResponse {
    pub success: bool,
    pub answer: String,
    pub sources: Vec<TavilySource>,
    pub context: String,
    pub query: String,
    #[serde(rename = "responseTime")]
    pub response_time: u64,
}

#[derive(Deserialize)]
struct TavilySearchResponse {
    #[serde(default)]
    answer: String,
    #[serde(default)]
    results: Vec<TavilySource>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TavilySource {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default, alias = "content")]
    pub content: String,
}

#[derive(Deserialize)]
struct SearchQueryRewriteEnvelope {
    query: String,
}

const BRAVE_SOFT_MAX_QUERY_LENGTH: usize = 350;

fn normalize_search_requirement(requirement: &str) -> String {
    requirement.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub async fn web_search(
    State(state): State<AppState>,
    Json(payload): Json<WebSearchRequest>,
) -> Result<Json<WebSearchResponse>, ApiError> {
    let api_key = env::var("AI_TUTOR_TAVILY_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "Tavily API key is not configured on the backend.".to_string(),
        });
    }

    let raw_requirement = normalize_search_requirement(&payload.query);
    if raw_requirement.is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "Query is required.".to_string(),
        });
    }

    let pdf_excerpt = payload.pdf_text.unwrap_or_default();
    // Only rewrite the query when it is itself too long to be a useful Tavily search term.
    // Presence of a PDF context alone does NOT justify an extra LLM round-trip — the query
    // may already be perfectly focused. Rewriting just because pdfText is non-empty was
    // burning an unnecessary LLM call on every PDF-attached search request.
    let needs_rewrite = raw_requirement.len() > 400;
    let mut final_query = raw_requirement.clone();

    if needs_rewrite {
        let rewrite_system = "Rewrite lesson requirements into a focused web-search query. Return strict JSON only.";
        let rewrite_user = format!(
            "Requirement:\n{}\n\nPDF excerpt (optional):\n{}\n\nReturn JSON with shape {{\"query\":\"...\"}} and keep it concise.",
            raw_requirement,
            if pdf_excerpt.is_empty() { "None" } else { &pdf_excerpt }
        );

        let scaffold_model = routing_rules::resolve_chat_scaffold_model(QualityTier::Standard)
            .replace("openrouter:", "");

        let openrouter_key = env::var("OPENROUTER_API_KEY").unwrap_or_default();
        if !openrouter_key.is_empty() {
            let client = Client::new();
            if let Ok(res) = client
                .post("https://openrouter.ai/api/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", openrouter_key))
                .json(&serde_json::json!({
                    "model": scaffold_model,
                    "messages": [
                        { "role": "system", "content": rewrite_system },
                        { "role": "user", "content": rewrite_user }
                    ],
                    "response_format": { "type": "json_object" }
                }))
                .send()
                .await
            {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
                        if let Ok(parsed) = serde_json::from_str::<SearchQueryRewriteEnvelope>(content) {
                            let rewritten = normalize_search_requirement(&parsed.query);
                            if !rewritten.is_empty() {
                                final_query = rewritten;
                            }
                        }
                    }
                }
            }
        }
    }

    final_query = final_query.chars().take(BRAVE_SOFT_MAX_QUERY_LENGTH).collect();
    
    let base_url = env::var("AI_TUTOR_TAVILY_BASE_URL").unwrap_or_else(|_| "https://api.tavily.com/search".to_string());
    
    let start_time = std::time::Instant::now();
    let client = Client::new();
    let res = client
        .post(&base_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "query": final_query,
            "search_depth": "basic",
            "max_results": 5,
            "include_answer": "basic",
        }))
        .send()
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("Failed to call Tavily: {}", e),
        })?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(ApiError {
            status,
            message: format!("Tavily search failed: {}", body),
        });
    }

    let result: TavilySearchResponse = res.json().await.map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("Failed to parse Tavily response: {}", e),
    })?;

    let mut context_parts = Vec::new();
    for r in &result.results {
        context_parts.push(format!("Source: {}\nURL: {}\nContent:\n{}\n---", r.title, r.url, r.content));
    }

    // Record Tavily usage cost (flat $0.005 per query)
    let event = UsageEvent {
        account_id: "system".into(),
        request_id: uuid::Uuid::new_v4().to_string(),
        component: "web_search".into(),
        provider_id: "tavily".into(),
        model_id: "tavily-search".into(),
        input_tokens: 0,
        output_tokens: 0,
        lesson_id: None,
    };
    let _ = state.service.record_api_usage(event).await;

    Ok(Json(WebSearchResponse {
        success: true,
        answer: result.answer,
        sources: result.results,
        context: context_parts.join("\n"),
        query: final_query,
        response_time: start_time.elapsed().as_millis() as u64,
    }))
}

#[derive(Serialize)]
pub struct ParsePdfResponse {
    pub success: bool,
    pub data: ParsedPdfData,
}

#[derive(Serialize)]
pub struct ParsedPdfData {
    pub text: String,
    pub images: Vec<String>,
    pub metadata: PdfMetadata,
}

#[derive(Serialize)]
pub struct PdfMetadata {
    #[serde(rename = "pageCount")]
    pub page_count: usize,
    pub parser: String,
    pub model: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "fileSize")]
    pub file_size: usize,
    #[serde(rename = "processingTime")]
    pub processing_time: u64,
}

pub async fn parse_pdf(
    mut multipart: Multipart,
) -> Result<Json<ParsePdfResponse>, ApiError> {
    let mut pdf_buffer = Vec::new();
    let mut file_name = String::from("unknown.pdf");

    while let Some(field) = multipart.next_field().await.unwrap_or(None) {
        let name = field.name().unwrap_or("").to_string();
        if name == "pdf" {
            if let Some(fn_name) = field.file_name() {
                file_name = fn_name.to_string();
            }
            if let Ok(bytes) = field.bytes().await {
                pdf_buffer = bytes.to_vec();
            }
        }
    }

    if pdf_buffer.is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "No document file provided".to_string(),
        });
    }

    let file_size = pdf_buffer.len();
    let start_time = std::time::Instant::now();

    // 1. Create a temporary file to store the document for markitdown
    let temp_dir = std::env::temp_dir();
    let temp_file_path = temp_dir.join(format!("{}.{}", uuid::Uuid::new_v4(), file_name.split('.').last().unwrap_or("pdf")));
    
    tokio::fs::write(&temp_file_path, &pdf_buffer).await.map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("Failed to write temp file: {}", e),
    })?;

    // 2. Use markitdown to convert the document locally
    let converter_path = temp_file_path.clone();
    let conversion_result = tokio::task::spawn_blocking(move || {
        let mut md = markitdown::MarkItDown::new();
        // convert expects &str for the path
        let path_str = converter_path.to_str().unwrap_or("");
        md.convert(path_str, None)
    })
    .await
    .map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("Conversion task panicked: {}", e),
    })?;

    // 3. Clean up the temp file
    let _ = tokio::fs::remove_file(&temp_file_path).await;

    // conversion_result is Result<Option<DocumentConverterResult>, MarkitdownError>
    if let Ok(Some(result)) = conversion_result {
        Ok(Json(ParsePdfResponse {
            success: true,
            data: ParsedPdfData {
                text: result.text_content,
                images: vec![], // markitdown-rs describes images inline in text
                metadata: PdfMetadata {
                    page_count: 0, // markitdown doesn't always provide page count
                    parser: "markitdown-rs".to_string(),
                    model: "local-cpu".to_string(),
                    file_name,
                    file_size,
                    processing_time: start_time.elapsed().as_millis() as u64,
                },
            },
        }))
    } else {
        Err(ApiError {
            status: StatusCode::UNSUPPORTED_MEDIA_TYPE,
            message: "Failed to convert document or unsupported format".to_string(),
        })
    }
}
