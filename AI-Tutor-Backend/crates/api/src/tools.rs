use axum::{
    extract::{Multipart, State},
    response::IntoResponse,
    Json,
};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::env;
use tracing::{error, info, warn};

use crate::app::{ApiError, AppState};

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
    #[serde(default)]
    query: String,
    #[serde(default)]
    response_time: f64,
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
    let rewrite_attempted = raw_requirement.len() > 400 || !pdf_excerpt.is_empty();
    let mut final_query = raw_requirement.clone();

    if rewrite_attempted {
        let rewrite_system = "Rewrite lesson requirements into a focused web-search query. Return strict JSON only.";
        let rewrite_user = format!(
            "Requirement:\n{}\n\nPDF excerpt (optional):\n{}\n\nReturn JSON with shape {{\"query\":\"...\"}} and keep it concise.",
            raw_requirement,
            if pdf_excerpt.is_empty() { "None" } else { &pdf_excerpt }
        );

        let scaffold_model = env::var("BALANCED_MODE_AI_TUTOR_CHAT_SCAFFOLD_MODEL")
            .unwrap_or_else(|_| "openrouter:google/gemini-2.5-flash".to_string())
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
            message: "No PDF file provided".to_string(),
        });
    }

    let file_size = pdf_buffer.len();
    
    let api_key = env::var("OPENROUTER_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "OPENROUTER_API_KEY is not configured on the backend.".to_string(),
        });
    }

    let model = env::var("BALANCED_MODE_AI_TUTOR_PDF_MODEL")
        .unwrap_or_else(|_| "openrouter:google/gemini-2.0-flash-001".to_string())
        .replace("openrouter:", "");

    let base_url = env::var("PDF_OPENROUTER_BASE_URL")
        .unwrap_or_else(|_| "https://openrouter.ai/api/v1".to_string());

    use base64::{engine::general_purpose, Engine as _};
    let base64_pdf = general_purpose::STANDARD.encode(&pdf_buffer);

    let start_time = std::time::Instant::now();
    let client = Client::new();
    let res = client
        .post(&format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Please parse this PDF and return its full content in Markdown format. Preserve the structure, including headings, tables, and lists. If there are images, describe them in place using ALT text style within the Markdown."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": format!("data:application/pdf;base64,{}", base64_pdf)
                            }
                        }
                    ]
                }
            ],
            "temperature": 0.1
        }))
        .send()
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("Failed to call OpenRouter for PDF: {}", e),
        })?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(ApiError {
            status,
            message: format!("OpenRouter PDF parsing failed: {}", body),
        });
    }

    let json: serde_json::Value = res.json().await.map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: format!("Failed to parse OpenRouter response: {}", e),
    })?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Ok(Json(ParsePdfResponse {
        success: true,
        data: ParsedPdfData {
            text: content,
            images: vec![],
            metadata: PdfMetadata {
                page_count: 0,
                parser: "gemini-openrouter".to_string(),
                model,
                file_name,
                file_size,
                processing_time: start_time.elapsed().as_millis() as u64,
            },
        },
    }))
}
