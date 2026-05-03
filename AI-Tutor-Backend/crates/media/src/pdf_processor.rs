use anyhow::{anyhow, Result};

pub struct PdfProcessingResult {
    pub full_text: String,
    pub chunks: Vec<PdfChunk>,
}

#[derive(Debug, Clone)]
pub struct PdfChunk {
    pub index: usize,
    pub text: String,
    pub token_estimate: usize,
}

pub struct PdfProcessor;

impl PdfProcessor {
    pub fn extract_text_from_bytes(bytes: &[u8]) -> Result<String> {
        // Use a temporary file because pdf-extract often expects a path or File
        let temp_dir = std::env::temp_dir();
        let temp_file_path = temp_dir.join(format!("temp_pdf_{}.pdf", uuid::Uuid::new_v4()));
        std::fs::write(&temp_file_path, bytes)?;

        let text = pdf_extract::extract_text(&temp_file_path)
            .map_err(|err| anyhow!("Failed to extract text from PDF: {}", err))?;

        let _ = std::fs::remove_file(&temp_file_path);

        Ok(text)
    }

    pub fn chunk_text(text: &str, chunk_size_tokens: usize, overlap_tokens: usize) -> Vec<PdfChunk> {
        let words: Vec<&str> = text.split_whitespace().collect();
        let mut chunks = Vec::new();
        
        // Very rough estimation: 1 token ~= 0.75 words, so 1 word ~= 1.33 tokens
        // To be safe, let's say 1 word = 1.5 tokens
        let words_per_chunk = (chunk_size_tokens as f64 / 1.5) as usize;
        let words_overlap = (overlap_tokens as f64 / 1.5) as usize;

        if words.is_empty() {
            return vec![];
        }

        let mut start = 0;
        let mut index = 0;

        while start < words.len() {
            let end = (start + words_per_chunk).min(words.len());
            let chunk_words = &words[start..end];
            let chunk_text = chunk_words.join(" ");
            
            chunks.push(PdfChunk {
                index,
                token_estimate: (chunk_words.len() as f64 * 1.5) as usize,
                text: chunk_text,
            });

            index += 1;
            if end == words.len() {
                break;
            }
            start += words_per_chunk - words_overlap;
            if start >= end {
                start = end; // Avoid infinite loop
            }
        }

        chunks
    }

    pub fn process_pdf(bytes: &[u8]) -> Result<PdfProcessingResult> {
        let full_text = Self::extract_text_from_bytes(bytes)?;
        let chunks = Self::chunk_text(&full_text, 1000, 200);
        
        Ok(PdfProcessingResult {
            full_text,
            chunks,
        })
    }
}
