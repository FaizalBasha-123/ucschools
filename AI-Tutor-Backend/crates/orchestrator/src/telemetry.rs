use std::collections::HashMap;
use std::time::{Duration, Instant};

use tracing::info;

use crate::validator::ValidationIssue;

#[derive(Debug, Clone)]
pub struct PipelineTelemetry {
    pipeline_started_at: Instant,
    total_elapsed: Option<Duration>,
    pdf_processing_elapsed: Option<Duration>,
    outlines_generation_elapsed: Option<Duration>,
    per_scene_elapsed: Vec<(String, Duration)>,
    media_generation_elapsed: Option<Duration>,
    tts_generation_elapsed: Option<Duration>,
    original_outline_count: usize,
    final_outline_count: usize,
    cost_allow: usize,
    cost_compress: usize,
    cost_warn: usize,
    cost_deny: usize,
    validation_scores: Vec<f32>,
    validation_issues: HashMap<&'static str, usize>,
    image_success: usize,
    image_failure: usize,
    video_success: usize,
    video_failure: usize,
    tts_success: usize,
    tts_failure: usize,
    scene_actions_fallback_activated: bool,
}

impl PipelineTelemetry {
    pub fn new() -> Self {
        Self {
            pipeline_started_at: Instant::now(),
            total_elapsed: None,
            pdf_processing_elapsed: None,
            outlines_generation_elapsed: None,
            per_scene_elapsed: Vec::new(),
            media_generation_elapsed: None,
            tts_generation_elapsed: None,
            original_outline_count: 0,
            final_outline_count: 0,
            cost_allow: 0,
            cost_compress: 0,
            cost_warn: 0,
            cost_deny: 0,
            validation_scores: Vec::new(),
            validation_issues: HashMap::new(),
            image_success: 0,
            image_failure: 0,
            video_success: 0,
            video_failure: 0,
            tts_success: 0,
            tts_failure: 0,
            scene_actions_fallback_activated: false,
        }
    }

    pub fn record_outlines_timing(&mut self, elapsed: Duration) {
        self.outlines_generation_elapsed = Some(elapsed);
    }

    pub fn record_pdf_timing(&mut self, elapsed: Duration) {
        self.pdf_processing_elapsed = Some(elapsed);
    }

    pub fn record_media_timing(&mut self, elapsed: Duration) {
        self.media_generation_elapsed = Some(elapsed);
    }

    pub fn record_tts_timing(&mut self, elapsed: Duration) {
        self.tts_generation_elapsed = Some(elapsed);
    }

    pub fn record_scene_content_timing(&mut self, title: &str, elapsed: Duration) {
        self.per_scene_elapsed
            .push((title.to_string(), elapsed));
    }

    pub fn record_outline_truncation(&mut self, original: usize, final_count: usize) {
        self.original_outline_count = original;
        self.final_outline_count = final_count;
    }

    pub fn record_outlines(&mut self, count: usize) {
        self.original_outline_count = count;
        self.final_outline_count = count;
    }

    pub fn record_cost_decision(&mut self, decision: &str) {
        match decision {
            "Allow" => self.cost_allow += 1,
            "Compress" => self.cost_compress += 1,
            "Warn" => self.cost_warn += 1,
            "Deny" => self.cost_deny += 1,
            _ => {}
        }
    }

    pub fn record_validation(&mut self, score: f32, issues: &[ValidationIssue]) {
        self.validation_scores.push(score);
        for issue in issues {
            let label = issue_label(issue);
            *self.validation_issues.entry(label).or_insert(0) += 1;
        }
    }

    pub fn record_image_success(&mut self) {
        self.image_success += 1;
    }

    pub fn record_image_failure(&mut self) {
        self.image_failure += 1;
    }

    pub fn record_video_success(&mut self) {
        self.video_success += 1;
    }

    pub fn record_video_failure(&mut self) {
        self.video_failure += 1;
    }

    pub fn record_tts_success(&mut self) {
        self.tts_success += 1;
    }

    pub fn record_tts_failure(&mut self) {
        self.tts_failure += 1;
    }

    pub fn record_scene_actions_fallback(&mut self) {
        self.scene_actions_fallback_activated = true;
    }

    pub fn finish(&mut self) {
        self.total_elapsed = Some(self.pipeline_started_at.elapsed());
    }

    pub fn report(&self) {
        let total = self
            .total_elapsed
            .map(|d| format_duration(d))
            .unwrap_or_else(|| "N/A".to_string());
        let pdf = self
            .pdf_processing_elapsed
            .map(|d| format_duration(d));
        let outlines = self
            .outlines_generation_elapsed
            .map(|d| format_duration(d));
        let media = self
            .media_generation_elapsed
            .map(|d| format_duration(d));
        let tts = self.tts_generation_elapsed.map(|d| format_duration(d));

        let scenes_generated = self.per_scene_elapsed.len();
        let scenes_skipped = self.cost_deny;
        let avg_validation_score = if self.validation_scores.is_empty() {
            0.0
        } else {
            self.validation_scores.iter().sum::<f32>() / self.validation_scores.len() as f32
        };

        let truncation = if self.original_outline_count > self.final_outline_count {
            format!(
                "{} → {} (truncated {})",
                self.original_outline_count,
                self.final_outline_count,
                self.original_outline_count - self.final_outline_count
            )
        } else {
            format!("{}", self.final_outline_count)
        };

        let mut issue_lines = String::new();
        let mut sorted_issues: Vec<_> = self.validation_issues.iter().collect();
        sorted_issues.sort_by(|a, b| b.1.cmp(a.1));
        for (label, count) in &sorted_issues {
            if !issue_lines.is_empty() {
                issue_lines.push_str(", ");
            }
            issue_lines.push_str(&format!("{}={}", label, count));
        }
        if issue_lines.is_empty() {
            issue_lines = "none".to_string();
        }

        let fallback_str = if self.scene_actions_fallback_activated {
            "yes"
        } else {
            "no"
        };

        info!(
            target: "pipeline_telemetry",
            "\n╔══════════════════════════════════════╗\n\
             ║      Pipeline Telemetry Report        ║\n\
             ╚══════════════════════════════════════╝\n\
             Duration            │ {total}\n\
             PDF Processing      │ {pdf}\n\
             Outlines Generation │ {outlines}\n\
             Per-Scene Timing   │ {scenes_timing}\n\
             Media Generation    │ {media}\n\
             TTS Generation      │ {tts}\n\
             ──────────────────────────────────────\n\
             Outlines            │ {truncation}\n\
             Scenes Generated    │ {scenes_generated}\n\
             Scenes Skipped      │ {scenes_skipped} (cost-deny)\n\
             Avg Validation      │ {avg_validation_score:.2}\n\
             Validation Issues   │ {issue_lines}\n\
             CostGuard           │ Allow={allow} Warn={warn} Compress={compress} Deny={deny}\n\
             Image Gen           │ {image_success} ok, {image_failure} failed\n\
             Video Gen           │ {video_success} ok, {video_failure} failed\n\
             TTS                 │ {tts_success} ok, {tts_failure} failed\n\
             Actions Fallback    │ {fallback_str}",
            total = total,
            pdf = pdf.as_deref().unwrap_or("N/A"),
            outlines = outlines.as_deref().unwrap_or("N/A"),
            scenes_timing = self.format_scene_timings(),
            media = media.as_deref().unwrap_or("N/A"),
            tts = tts.as_deref().unwrap_or("N/A"),
            truncation = truncation,
            scenes_generated = scenes_generated,
            scenes_skipped = scenes_skipped,
            avg_validation_score = avg_validation_score,
            issue_lines = issue_lines,
            allow = self.cost_allow,
            warn = self.cost_warn,
            compress = self.cost_compress,
            deny = self.cost_deny,
            image_success = self.image_success,
            image_failure = self.image_failure,
            video_success = self.video_success,
            video_failure = self.video_failure,
            tts_success = self.tts_success,
            tts_failure = self.tts_failure,
            fallback_str = fallback_str,
        );
    }

    fn format_scene_timings(&self) -> String {
        if self.per_scene_elapsed.is_empty() {
            return "N/A".to_string();
        }
        let total: Duration = self
            .per_scene_elapsed
            .iter()
            .map(|(_, d)| *d)
            .sum();
        if self.per_scene_elapsed.len() == 1 {
            return format!("1 scene ({})", format_duration(total));
        }
        format!(
            "{} scenes, total {} (avg {})",
            self.per_scene_elapsed.len(),
            format_duration(total),
            format_duration(total / self.per_scene_elapsed.len() as u32)
        )
    }
}

fn issue_label(issue: &ValidationIssue) -> &'static str {
    match issue {
        ValidationIssue::SemanticFluffRemoved { .. } => "FluffRemoved",
        ValidationIssue::MissingExamples => "MissingExamples",
        ValidationIssue::ContentTooLong { .. } => "ContentTooLong",
        ValidationIssue::TooManyBullets { .. } => "TooManyBullets",
        ValidationIssue::BulletTooLong { .. } => "BulletTooLong",
        ValidationIssue::MalformedJson { .. } => "MalformedJson",
        ValidationIssue::MissingRequiredField { .. } => "MissingRequiredField",
        ValidationIssue::TooManyInteractions { .. } => "TooManyInteractions",
        ValidationIssue::TooManyVisuals { .. } => "TooManyVisuals",
        ValidationIssue::BulletTruncated { .. } => "BulletTruncated",
    }
}

fn format_duration(d: Duration) -> String {
    let total_ms = d.as_millis();
    if total_ms < 1000 {
        format!("{}ms", total_ms)
    } else if total_ms < 60_000 {
        let secs = total_ms as f64 / 1000.0;
        format!("{:.1}s", secs)
    } else {
        let secs = total_ms as f64 / 1000.0;
        let mins = (secs / 60.0).floor();
        let remaining_secs = secs - (mins * 60.0);
        format!("{}m {:.0}s", mins, remaining_secs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telemetry_tracks_outline_truncation() {
        let mut t = PipelineTelemetry::new();
        t.record_outline_truncation(15, 10);
        assert_eq!(t.original_outline_count, 15);
        assert_eq!(t.final_outline_count, 10);
    }

    #[test]
    fn telemetry_tracks_cost_decisions() {
        let mut t = PipelineTelemetry::new();
        t.record_cost_decision("Allow");
        t.record_cost_decision("Allow");
        t.record_cost_decision("Deny");
        t.record_cost_decision("Compress");
        t.record_cost_decision("Warn");
        assert_eq!(t.cost_allow, 2);
        assert_eq!(t.cost_deny, 1);
        assert_eq!(t.cost_compress, 1);
        assert_eq!(t.cost_warn, 1);
    }

    #[test]
    fn telemetry_tracks_validation() {
        let mut t = PipelineTelemetry::new();
        t.record_validation(
            0.8,
            &[
                ValidationIssue::MissingExamples,
                ValidationIssue::BulletTooLong {
                    element_id: "e1".into(),
                    got: 100,
                    max: 80,
                },
            ],
        );
        assert_eq!(t.validation_scores.len(), 1);
        assert_eq!(t.validation_scores[0], 0.8);
        assert_eq!(*t.validation_issues.get("MissingExamples").unwrap(), 1);
        assert_eq!(*t.validation_issues.get("BulletTooLong").unwrap(), 1);
    }

    #[test]
    fn telemetry_tracks_media() {
        let mut t = PipelineTelemetry::new();
        t.record_image_success();
        t.record_image_success();
        t.record_image_failure();
        t.record_video_success();
        t.record_video_failure();
        assert_eq!(t.image_success, 2);
        assert_eq!(t.image_failure, 1);
        assert_eq!(t.video_success, 1);
        assert_eq!(t.video_failure, 1);
    }

    #[test]
    fn telemetry_report_does_not_panic() {
        let mut t = PipelineTelemetry::new();
        t.record_outlines(10);
        t.record_cost_decision("Allow");
        t.record_cost_decision("Deny");
        t.record_validation(
            0.9,
            &[ValidationIssue::MissingExamples],
        );
        t.record_scene_content_timing("Intro", Duration::from_millis(1500));
        t.record_image_success();
        t.finish();
        t.report();
    }
}
