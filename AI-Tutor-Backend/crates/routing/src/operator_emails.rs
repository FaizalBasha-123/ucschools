use std::collections::HashSet;
use std::sync::{OnceLock, RwLock};

static OPERATOR_EMAILS: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();

/// Initialize the operator email set from a list of emails.
/// Called at startup from env var. The DB-backed list is synced separately
/// via `sync_from_db`.
pub fn init_emails(env_emails: &str) {
    let mut set = HashSet::new();
    for raw in env_emails.split(',').map(|s| s.trim().to_ascii_lowercase()) {
        if !raw.is_empty() {
            set.insert(raw);
        }
    }
    let _ = OPERATOR_EMAILS.set(RwLock::new(set));
}

/// Sync operator emails from a DB list into the global set.
/// Adds DB emails that aren't in the set, preserves env-var emails.
pub fn sync_from_db(db_emails: &[String]) {
    let Some(lock) = OPERATOR_EMAILS.get() else { return };
    let mut set = lock.write().expect("operator_emails lock");
    for email in db_emails {
        set.insert(email.trim().to_ascii_lowercase());
    }
}

/// Check if an email is in the allowed operator set.
pub fn is_allowed(email: &str) -> bool {
    let Some(lock) = OPERATOR_EMAILS.get() else {
        return false;
    };
    let set = lock.read().expect("operator_emails lock");
    set.contains(&email.to_ascii_lowercase())
}

/// Add an email to the allowed set.
pub fn add(email: &str) -> bool {
    let Some(lock) = OPERATOR_EMAILS.get() else {
        return false;
    };
    let mut set = lock.write().expect("operator_emails lock");
    set.insert(email.trim().to_ascii_lowercase())
}

/// Remove an email from the allowed set.
pub fn remove(email: &str) -> bool {
    let Some(lock) = OPERATOR_EMAILS.get() else {
        return false;
    };
    let mut set = lock.write().expect("operator_emails lock");
    set.remove(&email.trim().to_ascii_lowercase())
}

/// List all allowed operator emails (sorted).
pub fn list() -> Vec<String> {
    let Some(lock) = OPERATOR_EMAILS.get() else {
        return vec![];
    };
    let set = lock.read().expect("operator_emails lock");
    let mut emails: Vec<String> = set.iter().cloned().collect();
    emails.sort();
    emails
}
