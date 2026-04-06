use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("validation error: {0}")]
    Validation(String),
    #[error("not implemented: {0}")]
    NotImplemented(&'static str),
}
