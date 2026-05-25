use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use async_trait::async_trait;
use rusty_s3::{Bucket, Credentials, S3Action as _, UrlStyle};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetKind {
    Audio,
    Media,
    /// Ephemeral whiteboard doubt session images (wb/{session_id}/). Hard-deleted on session stop.
    WhiteboardSession,
}

impl AssetKind {
    pub fn folder_name(self) -> &'static str {
        match self {
            Self::Audio => "audio",
            Self::Media => "media",
            Self::WhiteboardSession => "wb",
        }
    }
}

#[async_trait]
pub trait AssetStore: Send + Sync {
    async fn persist_asset(
        &self,
        kind: AssetKind,
        lesson_id: &str,
        file_name: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<String>;

    async fn get_asset(
        &self,
        kind: &str,
        lesson_id: &str,
        file_name: &str,
    ) -> Result<Option<Vec<u8>>>;

    /// Delete all assets for a given lesson (audio + media directories).
    async fn delete_lesson_assets(&self, lesson_id: &str) -> Result<()>;

    /// Delete all assets for a whiteboard doubt session (wb/{wb_session_id}/ prefix).
    /// Called immediately when the user clicks "Stop Session" — no archive, no delay.
    async fn delete_whiteboard_session_assets(&self, wb_session_id: &str) -> Result<()>;
}

pub type DynAssetStore = Arc<dyn AssetStore>;

pub struct LocalFileAssetStore {
    root: PathBuf,
    base_url: String,
}

impl LocalFileAssetStore {
    pub fn new(root: impl Into<PathBuf>, base_url: impl Into<String>) -> Self {
        Self {
            root: root.into(),
            base_url: base_url.into(),
        }
    }

    fn asset_dir(&self, kind: AssetKind, lesson_id: &str) -> PathBuf {
        self.root
            .join(kind.folder_name())
            .join(lesson_id)
    }
}

#[async_trait]
impl AssetStore for LocalFileAssetStore {
    async fn persist_asset(
        &self,
        kind: AssetKind,
        lesson_id: &str,
        file_name: &str,
        _content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<String> {
        let dir = self.asset_dir(kind, lesson_id);
        tokio::fs::create_dir_all(&dir).await?;
        tokio::fs::write(dir.join(file_name), bytes).await?;
        Ok(format!(
            "{}/api/assets/{}/{}/{}",
            self.base_url.trim_end_matches('/'),
            kind.folder_name(),
            lesson_id,
            file_name
        ))
    }

    async fn get_asset(
        &self,
        kind: &str,
        lesson_id: &str,
        file_name: &str,
    ) -> Result<Option<Vec<u8>>> {
        let path = self
            .root
            .join(kind)
            .join(lesson_id)
            .join(file_name);

        match tokio::fs::read(path).await {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    async fn delete_lesson_assets(&self, lesson_id: &str) -> Result<()> {
        for kind in [AssetKind::Audio, AssetKind::Media] {
            let dir = self.asset_dir(kind, lesson_id);
            let _ = tokio::fs::remove_dir_all(dir).await;
        }
        Ok(())
    }

    async fn delete_whiteboard_session_assets(&self, wb_session_id: &str) -> Result<()> {
        let dir = self.root.join(AssetKind::WhiteboardSession.folder_name()).join(wb_session_id);
        let _ = tokio::fs::remove_dir_all(dir).await;
        Ok(())
    }
}

pub struct R2AssetStore {
    client: reqwest::Client,
    bucket: Bucket,
    credentials: Credentials,
    key_prefix: String,
    public_base_url: String,
}

impl R2AssetStore {
    pub async fn new(
        endpoint: impl AsRef<str>,
        bucket: impl Into<String>,
        access_key_id: impl AsRef<str>,
        secret_access_key: impl AsRef<str>,
        public_base_url: impl Into<String>,
        key_prefix: impl Into<String>,
    ) -> Result<Self> {
        let bucket_name = bucket.into();
        let endpoint = endpoint.as_ref().parse()?;
        let bucket = Bucket::new(endpoint, UrlStyle::Path, bucket_name, "auto")?;
        Ok(Self {
            client: reqwest::Client::new(),
            bucket,
            credentials: Credentials::new(access_key_id.as_ref(), secret_access_key.as_ref()),
            key_prefix: normalize_prefix(key_prefix.into()),
            public_base_url: public_base_url.into(),
        })
    }

    fn asset_key(&self, kind: AssetKind, lesson_id: &str, file_name: &str) -> String {
        let lesson_id = sanitize_asset_segment(lesson_id, "lesson_id")
            .expect("lesson_id should be validated by persist_asset");
        let file_name = sanitize_asset_segment(file_name, "file_name")
            .expect("file_name should be validated by persist_asset");
        let base = format!("{}/{}/{}", kind.folder_name(), lesson_id, file_name);
        if self.key_prefix.is_empty() {
            base
        } else {
            format!("{}/{}", self.key_prefix, base)
        }
    }
}

#[async_trait]
impl AssetStore for R2AssetStore {
    async fn persist_asset(
        &self,
        kind: AssetKind,
        lesson_id: &str,
        file_name: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<String> {
        sanitize_asset_segment(lesson_id, "lesson_id")?;
        sanitize_asset_segment(file_name, "file_name")?;

        let key = self.asset_key(kind, lesson_id, file_name);
        let action = self
            .bucket
            .put_object(Some(&self.credentials), key.as_str());
        let signed_url = action.sign(Duration::from_secs(60 * 15));

        self.client
            .put(signed_url.to_string())
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(bytes)
            .send()
            .await?
            .error_for_status()?;

        Ok(format!(
            "{}/{}",
            self.public_base_url.trim_end_matches('/'),
            key
        ))
    }

    async fn get_asset(
        &self,
        kind: &str,
        lesson_id: &str,
        file_name: &str,
    ) -> Result<Option<Vec<u8>>> {
        let key = format!("{}/{}/{}", kind, lesson_id, file_name);
        let key = if self.key_prefix.is_empty() {
            key
        } else {
            format!("{}/{}", self.key_prefix, key)
        };

        let action = self.bucket.get_object(Some(&self.credentials), &key);
        let signed_url = action.sign(Duration::from_secs(60 * 15));

        let response = self.client.get(signed_url.to_string()).send().await?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        let bytes = response.error_for_status()?.bytes().await?;
        Ok(Some(bytes.to_vec()))
    }

    async fn delete_lesson_assets(&self, lesson_id: &str) -> Result<()> {
        for kind in [AssetKind::Audio, AssetKind::Media] {
            let prefix = if self.key_prefix.is_empty() {
                format!("{}/{}/", kind.folder_name(), lesson_id)
            } else {
                format!("{}/{}/{}/", self.key_prefix, kind.folder_name(), lesson_id)
            };
            self.delete_r2_prefix(&prefix).await;
        }
        Ok(())
    }

    async fn delete_whiteboard_session_assets(&self, wb_session_id: &str) -> Result<()> {
        let prefix = if self.key_prefix.is_empty() {
            format!("wb/{}/", wb_session_id)
        } else {
            format!("{}/wb/{}/", self.key_prefix, wb_session_id)
        };
        self.delete_r2_prefix(&prefix).await;
        Ok(())
    }
}

impl R2AssetStore {
    /// List and hard-delete every object under an R2 prefix. Ignores errors per object.
    async fn delete_r2_prefix(&self, prefix: &str) {
        let mut list = self.bucket.list_objects_v2(Some(&self.credentials));
        list.with_prefix(prefix.to_string());
        let signed_url = list.sign(Duration::from_secs(60));
        let resp = match self.client.get(signed_url.to_string()).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => return,
        };
        let body = match resp.bytes().await {
            Ok(b) => b,
            Err(_) => return,
        };
        let parsed = match rusty_s3::actions::ListObjectsV2::parse_response(&body) {
            Ok(p) => p,
            Err(_) => return,
        };
        for content in &parsed.contents {
            let del = self.bucket.delete_object(Some(&self.credentials), &content.key);
            let url = del.sign(Duration::from_secs(60));
            let _ = self.client.delete(url.to_string()).send().await;
        }
    }
}

fn sanitize_asset_segment(value: &str, label: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow::anyhow!("{} must not be empty", label));
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains("../") || trimmed.contains("..\\") {
        return Err(anyhow::anyhow!(
            "{} contains a disallowed path traversal segment",
            label
        ));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(anyhow::anyhow!(
            "{} must be a single path segment",
            label
        ));
    }
    if trimmed.chars().any(|ch| ch.is_control()) {
        return Err(anyhow::anyhow!(
            "{} must not contain control characters",
            label
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_prefix(prefix: String) -> String {
    prefix.trim().trim_matches('/').to_string()
}

pub fn infer_content_type(path: &Path, fallback: &str) -> String {
    match path.extension().and_then(|value| value.to_str()) {
        Some("mp3") => "audio/mpeg".to_string(),
        Some("wav") => "audio/wav".to_string(),
        Some("ogg") => "audio/ogg".to_string(),
        Some("png") => "image/png".to_string(),
        Some("jpg") | Some("jpeg") => "image/jpeg".to_string(),
        Some("gif") => "image/gif".to_string(),
        Some("webp") => "image/webp".to_string(),
        Some("mp4") => "video/mp4".to_string(),
        Some("webm") => "video/webm".to_string(),
        _ => fallback.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infer_content_type_prefers_extension() {
        assert_eq!(
            infer_content_type(
                Path::new("lesson/tts_action-1.mp3"),
                "application/octet-stream"
            ),
            "audio/mpeg"
        );
        assert_eq!(
            infer_content_type(Path::new("lesson/image-1.png"), "application/octet-stream"),
            "image/png"
        );
    }

    #[test]
    fn normalize_prefix_trims_slashes() {
        assert_eq!(
            normalize_prefix("/school/assets/".to_string()),
            "school/assets"
        );
        assert_eq!(normalize_prefix("".to_string()), "");
    }

    #[test]
    fn sanitize_asset_segment_rejects_traversal_and_nested_paths() {
        assert!(sanitize_asset_segment("../x", "file_name").is_err());
        assert!(sanitize_asset_segment("..\\x", "file_name").is_err());
        assert!(sanitize_asset_segment("nested/path", "file_name").is_err());
        assert!(sanitize_asset_segment("nested\\path", "file_name").is_err());
    }

    #[test]
    fn sanitize_asset_segment_accepts_safe_values() {
        let safe = sanitize_asset_segment("lesson-01", "lesson_id").unwrap();
        assert_eq!(safe, "lesson-01");
    }
}
