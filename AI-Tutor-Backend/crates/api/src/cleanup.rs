use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use tracing::{error, info};

#[derive(Debug, Clone, Copy)]
pub struct CleanupConfig {
    pub asset_ttl_hours: u64,
    pub job_ttl_hours: u64,
    pub lesson_ttl_hours: u64,
    pub cleanup_interval_minutes: u64,
}

impl CleanupConfig {
    pub fn from_env() -> Self {
        Self {
            asset_ttl_hours: read_u64_env("AI_TUTOR_ASSET_TTL_HOURS", 24),
            job_ttl_hours: read_u64_env("AI_TUTOR_JOB_TTL_HOURS", 24),
            lesson_ttl_hours: read_u64_env("AI_TUTOR_LESSON_TTL_HOURS", 168),
            cleanup_interval_minutes: read_u64_env("AI_TUTOR_CLEANUP_INTERVAL_MINUTES", 60),
        }
    }

    pub fn interval(&self) -> Duration {
        Duration::from_secs(self.cleanup_interval_minutes.max(1) * 60)
    }

    pub fn asset_ttl(&self) -> Duration {
        Duration::from_secs(self.asset_ttl_hours.saturating_mul(3600))
    }

    pub fn job_ttl(&self) -> Duration {
        Duration::from_secs(self.job_ttl_hours.saturating_mul(3600))
    }

    pub fn lesson_ttl(&self) -> Duration {
        Duration::from_secs(self.lesson_ttl_hours.saturating_mul(3600))
    }
}

#[derive(Default)]
struct CleanupStats {
    deleted_assets: usize,
    deleted_jobs: usize,
    deleted_lessons: usize,
    deleted_dirs: usize,
}

pub async fn run_cleanup_loop(storage_root: PathBuf, cfg: CleanupConfig) {
    info!(
        storage_root = %storage_root.display(),
        asset_ttl_hours = cfg.asset_ttl_hours,
        job_ttl_hours = cfg.job_ttl_hours,
        lesson_ttl_hours = cfg.lesson_ttl_hours,
        cleanup_interval_minutes = cfg.cleanup_interval_minutes,
        "storage cleanup scheduler enabled"
    );

    loop {
        if let Err(err) = run_cleanup_once(storage_root.clone(), cfg).await {
            error!(error = %err, "storage cleanup run failed");
        }
        tokio::time::sleep(cfg.interval()).await;
    }
}

pub async fn run_cleanup_once(storage_root: PathBuf, cfg: CleanupConfig) -> io::Result<()> {
    let stats = tokio::task::spawn_blocking(move || cleanup_sync(&storage_root, cfg))
        .await
        .map_err(|err| io::Error::other(format!("cleanup task join error: {err}")))??;

    info!(
        deleted_assets = stats.deleted_assets,
        deleted_jobs = stats.deleted_jobs,
        deleted_lessons = stats.deleted_lessons,
        deleted_dirs = stats.deleted_dirs,
        "storage cleanup run finished"
    );

    Ok(())
}

fn cleanup_sync(storage_root: &Path, cfg: CleanupConfig) -> io::Result<CleanupStats> {
    let mut stats = CleanupStats::default();

    cleanup_dir_files_older_than(
        &storage_root.join("assets"),
        cfg.asset_ttl(),
        true,
        &mut stats,
        FileType::Asset,
    )?;
    cleanup_dir_files_older_than(
        &storage_root.join("lesson-jobs"),
        cfg.job_ttl(),
        false,
        &mut stats,
        FileType::Job,
    )?;
    cleanup_dir_files_older_than(
        &storage_root.join("lessons"),
        cfg.lesson_ttl(),
        false,
        &mut stats,
        FileType::Lesson,
    )?;

    Ok(stats)
}

enum FileType {
    Asset,
    Job,
    Lesson,
}

fn cleanup_dir_files_older_than(
    root: &Path,
    ttl: Duration,
    recursive: bool,
    stats: &mut CleanupStats,
    file_type: FileType,
) -> io::Result<()> {
    if !root.exists() {
        return Ok(());
    }

    let now = SystemTime::now();
    walk_and_cleanup(root, ttl, recursive, now, stats, &file_type)?;

    if recursive {
        prune_empty_dirs(root, stats)?;
    }

    Ok(())
}

fn walk_and_cleanup(
    dir: &Path,
    ttl: Duration,
    recursive: bool,
    now: SystemTime,
    stats: &mut CleanupStats,
    file_type: &FileType,
) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err),
    };

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let meta = entry.metadata()?;

        if meta.is_dir() {
            if recursive {
                walk_and_cleanup(&path, ttl, true, now, stats, file_type)?;
            }
            continue;
        }

        if !meta.is_file() {
            continue;
        }

        let Some(modified_at) = extract_modified_time(&meta) else {
            continue;
        };

        let age = now.duration_since(modified_at).unwrap_or_default();
        if age < ttl {
            continue;
        }

        fs::remove_file(&path)?;
        match file_type {
            FileType::Asset => stats.deleted_assets += 1,
            FileType::Job => stats.deleted_jobs += 1,
            FileType::Lesson => stats.deleted_lessons += 1,
        }
    }

    Ok(())
}

fn extract_modified_time(meta: &fs::Metadata) -> Option<SystemTime> {
    meta.modified().ok().or_else(|| meta.created().ok())
}

fn prune_empty_dirs(dir: &Path, stats: &mut CleanupStats) -> io::Result<bool> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(true),
        Err(err) => return Err(err),
    };

    let mut is_empty = true;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let meta = entry.metadata()?;

        if meta.is_dir() {
            if !prune_empty_dirs(&path, stats)? {
                is_empty = false;
            }
        } else {
            is_empty = false;
        }
    }

    if is_empty {
        if fs::remove_dir(dir).is_ok() {
            stats.deleted_dirs += 1;
            return Ok(true);
        }
        return Ok(false);
    }

    Ok(false)
}

fn read_u64_env(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{Duration, SystemTime},
    };

    use filetime::FileTime;

    use super::{cleanup_sync, CleanupConfig};

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-tutor-cleanup-test-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn write_file_with_age(path: &PathBuf, age: Duration) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, b"x").unwrap();
        let now = FileTime::from_system_time(SystemTime::now());
        let then = FileTime::from_system_time(SystemTime::now() - age);
        filetime::set_file_times(path, now, then).unwrap();
    }

    #[test]
    fn cleanup_removes_only_expired_entries() {
        let root = temp_root();

        let old_asset = root.join("assets/audio/lesson-1/old.mp3");
        let new_asset = root.join("assets/audio/lesson-1/new.mp3");
        let old_job = root.join("lesson-jobs/job-old.json");
        let new_job = root.join("lesson-jobs/job-new.json");
        let old_lesson = root.join("lessons/lesson-old.json");
        let new_lesson = root.join("lessons/lesson-new.json");

        write_file_with_age(&old_asset, Duration::from_secs(48 * 3600));
        write_file_with_age(&new_asset, Duration::from_secs(3 * 3600));
        write_file_with_age(&old_job, Duration::from_secs(30 * 3600));
        write_file_with_age(&new_job, Duration::from_secs(2 * 3600));
        write_file_with_age(&old_lesson, Duration::from_secs(200 * 3600));
        write_file_with_age(&new_lesson, Duration::from_secs(10 * 3600));

        let cfg = CleanupConfig {
            asset_ttl_hours: 24,
            job_ttl_hours: 24,
            lesson_ttl_hours: 168,
            cleanup_interval_minutes: 60,
        };

        cleanup_sync(&root, cfg).unwrap();

        assert!(!old_asset.exists());
        assert!(new_asset.exists());
        assert!(!old_job.exists());
        assert!(new_job.exists());
        assert!(!old_lesson.exists());
        assert!(new_lesson.exists());

        let _ = fs::remove_dir_all(&root);
    }
}
