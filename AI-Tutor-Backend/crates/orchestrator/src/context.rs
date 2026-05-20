use ai_tutor_domain::generation::LessonGenerationRequest;
use ai_tutor_domain::routing::{
    tier_limits, DifficultyLevel, LearningState, QualityTier, TopicComplexity,
};
use ai_tutor_domain::scene::SceneOutline;

/// Detect topic complexity on a 5-level ladder using deterministic heuristics.
///
/// No LLM call — purely keyword + length based for deterministic budgeting.
/// Scores range from Low (simple, single-concept topics) to Extreme
/// (multi-system, multi-requirement topics).
pub fn detect_complexity(topic: &str) -> TopicComplexity {
    let lower = topic.to_ascii_lowercase();
    let word_count = lower.split_whitespace().count();

    // Level 1 signals: connective/multi-concept indicators (moderate weight)
    let connective_signals = [
        " and ", " vs ", " versus ", "between", "relationship",
        "compare", "interaction", "integration",
    ];

    // Level 2 signals: deep/complex topic indicators (higher weight)
    let depth_signals = [
        "system", "mechanism", "process", "theory", "architecture",
        "pipeline", "framework", "protocol", "algorithm", "infrastructure",
    ];

    // Level 3 signals: multi-component / cross-domain (highest weight)
    let cross_domain_signals = [
        "multiple", "comprehensive", "end-to-end", "full stack",
        "distributed", "concurrent", "parallel", "hierarchical",
        "multivariate", "multidimensional",
    ];

    let connective_count = connective_signals
        .iter()
        .filter(|&&sig| lower.contains(sig))
        .count();

    let depth_count = depth_signals
        .iter()
        .filter(|&&sig| lower.contains(sig))
        .count();

    let cross_count = cross_domain_signals
        .iter()
        .filter(|&&sig| lower.contains(sig))
        .count();

    let has_abbreviation = topic
        .split_whitespace()
        .any(|w| w.len() >= 2 && w.chars().all(|c| c.is_uppercase() || c.is_numeric()));

    // Weighted score: abbreviations count as 1 depth signal
    let total_score = connective_count + depth_count * 2 + cross_count * 3
        + if has_abbreviation { 2 } else { 0 };

    // Multi-requirement detection: semicolons, numbered lists, bullet markers
    let has_multi_requirement = lower.contains(';')
        || lower.contains("1.") || lower.contains("2.")
        || lower.contains('\n');

    match (word_count, total_score, has_multi_requirement) {
        // Extreme: very long + high signal count + multi-requirement
        (wc, ts, true) if wc > 40 && ts >= 8 => TopicComplexity::Extreme,
        // VeryHigh: long + moderate signals, or high signal count alone
        (wc, ts, _) if wc > 30 && ts >= 5 => TopicComplexity::VeryHigh,
        (_, ts, _) if ts >= 8 => TopicComplexity::VeryHigh,
        // High: moderate length + signals, or multi-requirement + some signals
        (wc, ts, true) if wc > 15 && ts >= 3 => TopicComplexity::High,
        (_, ts, _) if ts >= 4 => TopicComplexity::High,
        // Normal: short topic with few signals
        (wc, ts, _) if wc > 8 || ts >= 1 => TopicComplexity::Normal,
        // Low: very short, no signals
        _ => TopicComplexity::Low,
    }
}

/// Compressed context — the ONLY thing that should be sent to LLMs.
///
/// Instead of dumping raw PDF text or full conversation state, we distil
/// everything into a small, structured payload.
#[derive(Debug, Clone)]
pub struct CompressedContext {
    /// Concise summary of what the lesson is about.
    pub topic_summary: String,
    /// Current progress indicator, e.g. "Scene 3/5: Newton's Second Law".
    pub current_step: String,
    /// Inferred learner comprehension level (drives prompt adaptation).
    pub learning_state: LearningState,
    /// Content complexity target.
    pub difficulty: DifficultyLevel,
    /// Hard constraints expressed as human-readable strings for prompt injection.
    pub key_constraints: Vec<String>,
    /// Compressed PDF extract (if a PDF was attached).
    pub pdf_excerpt: Option<String>,
}

/// Build a compressed context from the full request state.
pub fn compress_context(
    request: &LessonGenerationRequest,
    outline: Option<&SceneOutline>,
    pdf_context: Option<&str>,
    tier: &QualityTier,
) -> CompressedContext {
    let limits = tier_limits(*tier);

    let topic_summary = truncate(&request.requirements.requirement, topic_summary_limit(tier));

    let current_step = outline
        .map(|o| format!("Scene {}: {}", o.order, o.title))
        .unwrap_or_else(|| "Planning".to_string());

    let key_constraints = vec![
        format!("max_slides={}", limits.max_slides),
        format!("max_examples_per_slide={}", limits.max_examples_per_slide),
        format!("max_pdf_chars={}", limits.max_pdf_context_chars),
        format!("refinement_enabled={}", limits.enable_refinement),
    ];

    let pdf_excerpt = pdf_context.map(|raw| compress_pdf(raw, limits.max_pdf_context_chars));

    CompressedContext {
        topic_summary,
        current_step,
        learning_state: LearningState::default(),
        difficulty: DifficultyLevel::default(),
        key_constraints,
        pdf_excerpt,
    }
}

/// Topic summary character limits per tier.
///
/// These are intentionally generous compared to the original 200-char limit
/// to avoid losing critical context.
///   Basic    → 300 chars
///   Standard → 600 chars
///   Premium  → 1000 chars
fn topic_summary_limit(tier: &QualityTier) -> usize {
    match tier {
        QualityTier::Basic => 300,
        QualityTier::Standard => 600,
        QualityTier::Premium => 1000,
    }
}

/// PDF context compression.
///
/// Instead of naively truncating at N characters, we:
/// 1. Try to preserve section headings (lines starting with # or all-caps).
/// 2. Keep the first sentence of each paragraph.
/// 3. Hard-cap at `max_chars`.
pub fn compress_pdf(raw_pdf: &str, max_chars: usize) -> String {
    if raw_pdf.len() <= max_chars {
        return raw_pdf.to_string();
    }

    let mut output = String::with_capacity(max_chars);
    let mut chars_remaining = max_chars;

    for line in raw_pdf.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Keep headings (lines that look like section markers).
        let is_heading = trimmed.starts_with('#')
            || (trimmed.len() < 80
                && trimmed.chars().filter(|c| c.is_uppercase()).count() > trimmed.len() / 2);

        if is_heading {
            let to_add = format!("{}\n", trimmed);
            if to_add.len() > chars_remaining {
                break;
            }
            output.push_str(&to_add);
            chars_remaining -= to_add.len();
            continue;
        }

        // For body text, take only the first sentence.
        let first_sentence = first_sentence_of(trimmed);
        let to_add = format!("{}\n", first_sentence);
        if to_add.len() > chars_remaining {
            break;
        }
        output.push_str(&to_add);
        chars_remaining -= to_add.len();
    }

    if output.len() < raw_pdf.len() {
        output.push_str("...[COMPRESSED]");
    }

    output
}

fn first_sentence_of(text: &str) -> &str {
    // Find the end of the first sentence (period followed by space or end).
    if let Some(pos) = text.find(". ") {
        &text[..=pos]
    } else if text.ends_with('.') {
        text
    } else {
        // No period — take up to 120 chars.
        let end = text.len().min(120);
        // Don't break in the middle of a word.
        let end = text[..end].rfind(' ').unwrap_or(end);
        &text[..end]
    }
}

fn truncate(text: &str, max_chars: usize) -> String {
    if text.len() <= max_chars {
        return text.to_string();
    }
    // Don't break mid-word.
    let end = text[..max_chars].rfind(' ').unwrap_or(max_chars);
    format!("{}...", &text[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_respects_word_boundary() {
        let text = "Explain Newton's laws of motion in detail";
        let result = truncate(text, 20);
        assert!(result.len() <= 23); // 20 + "..."
        assert!(result.ends_with("..."));
        assert_eq!(result, "Explain Newton's..."); // breaks at word boundary before "laws"
    }

    #[test]
    fn compress_pdf_keeps_headings() {
        let raw = "# Introduction\nThis is a long introduction about physics. It goes on and on and on.\n# Methods\nWe used experiments.";
        let compressed = compress_pdf(raw, 200);
        assert!(compressed.contains("# Introduction"));
        assert!(compressed.contains("# Methods"));
    }

    #[test]
    fn compress_pdf_takes_first_sentence() {
        let raw = "Gravity is the force that pulls objects. It was discovered by Newton. He was sitting under an apple tree.";
        let compressed = compress_pdf(raw, 100);
        assert!(compressed.contains("Gravity is the force that pulls objects."));
        // The later sentences should not be fully present.
    }

    #[test]
    fn short_pdf_not_compressed() {
        let raw = "Short text.";
        let compressed = compress_pdf(raw, 1000);
        assert_eq!(compressed, raw);
    }
}
