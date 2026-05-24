use anyhow::{anyhow, Result};

pub struct PdfProcessingResult {
    pub full_text: String,
}

pub struct PdfProcessor;

impl PdfProcessor {
    pub fn extract_text_from_bytes(bytes: &[u8]) -> Result<String> {
        // Use a temporary file because pdf-extract requires a filesystem path.
        let temp_dir = std::env::temp_dir();
        let temp_file_path = temp_dir.join(format!("temp_pdf_{}.pdf", uuid::Uuid::new_v4()));
        std::fs::write(&temp_file_path, bytes)?;

        let text = pdf_extract::extract_text(&temp_file_path)
            .map_err(|err| anyhow!("Failed to extract text from PDF: {}", err))?;

        let _ = std::fs::remove_file(&temp_file_path);

        Ok(text)
    }

    pub fn process_pdf(bytes: &[u8]) -> Result<PdfProcessingResult> {
        let full_text = Self::extract_text_from_bytes(bytes)?;
        Ok(PdfProcessingResult { full_text })
    }
}

