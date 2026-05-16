use ai_tutor_domain::routing::QualityTier;
use ai_tutor_domain::scene::{SceneContent, SlideElement};

#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub valid: bool,
    /// Quality score from 0.0 to 1.0. Used to decide whether to escalate to
    /// the refinement model on Premium tier.
    pub score: f32,
    pub issues: Vec<ValidationIssue>,
}

#[derive(Debug, Clone)]
pub enum ValidationIssue {
    SemanticFluffRemoved {
        phrase: String,
    },
    MissingExamples,
    ContentTooLong {
        element_id: String,
        got: usize,
        max: usize,
    },
    TooManyBullets {
        count: usize,
        max: usize,
    },
    BulletTooLong {
        element_id: String,
        got: usize,
        max: usize,
    },
    MalformedJson {
        error: String,
    },
    MissingRequiredField {
        field: String,
    },
}

/// Max bullets per slide by tier.
fn max_bullets_for_tier(tier: &QualityTier) -> usize {
    match tier {
        QualityTier::Basic => 3,
        QualityTier::Standard => 4,
        QualityTier::Premium => 5,
    }
}

/// Max characters per bullet by tier.
fn max_chars_per_bullet_for_tier(tier: &QualityTier) -> usize {
    match tier {
        QualityTier::Basic => 60,
        QualityTier::Standard => 70,
        QualityTier::Premium => 80,
    }
}

/// Known AI fluff phrases that hurt educational content quality.
const FLUFF_PHRASES: &[&str] = &[
    "In this lesson, we will learn about ",
    "In this lesson, we will ",
    "In this lesson ",
    "Let's dive in",
    "Let's get started",
    "Without further ado",
    "As we all know",
];

/// Maximum character length for a single text element before we flag it.
const MAX_TEXT_ELEMENT_CHARS: usize = 1000;

/// Structural and Semantic validation for scene content.
///
/// Performs **fix-in-place** operations (e.g. trimming fluff phrases) to save
/// tokens instead of triggering a full regeneration.
pub fn validate_content(content: &mut SceneContent, tier: &QualityTier) -> ValidationResult {
    let mut score: f32 = 1.0;
    let mut issues = Vec::new();

    match content {
        SceneContent::Slide { canvas } => {
            let mut has_example = false;
            let mut bullet_count: usize = 0;
            let max_bullets = max_bullets_for_tier(tier);
            let max_chars = max_chars_per_bullet_for_tier(tier);

            for element in &mut canvas.elements {
                // We only validate text elements for fluff / length.
                if let SlideElement::Text {
                    id, content: text, ..
                } = element
                {
                    // ── Fix-in-place: strip fluff phrases ────────────────
                    for phrase in FLUFF_PHRASES {
                        if text.contains(phrase) {
                            *text = text.replace(phrase, "");
                            issues.push(ValidationIssue::SemanticFluffRemoved {
                                phrase: phrase.to_string(),
                            });
                        }
                    }

                    // Trim any leading/trailing whitespace left after removal.
                    *text = text.trim().to_string();

                    // ── Semantic: look for example presence ──────────────
                    let lower = text.to_ascii_lowercase();
                    if lower.contains("example")
                        || lower.contains("for instance")
                        || lower.contains("e.g.")
                        || lower.contains("such as")
                    {
                        has_example = true;
                    }

                    // ── Structural: length guard ─────────────────────────
                    if text.len() > MAX_TEXT_ELEMENT_CHARS {
                        issues.push(ValidationIssue::ContentTooLong {
                            element_id: id.clone(),
                            got: text.len(),
                            max: MAX_TEXT_ELEMENT_CHARS,
                        });
                        score -= 0.2;
                    }

                    // ── Density: count content text elements as bullets ──
                    // Skip title elements (at the top, usually short)
                    let is_title = text.len() < 60 && !text.contains('\n');
                    if !is_title {
                        // Count lines within this text element as individual bullets
                        let lines: Vec<&str> = text.lines().collect();
                        for line in &lines {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                bullet_count += 1;
                                // ── Bullet length check ──────────────────
                                if trimmed.len() > max_chars {
                                    let bullet_id = format!("{}-bullet-{}", id, bullet_count);
                                    issues.push(ValidationIssue::BulletTooLong {
                                        element_id: bullet_id,
                                        got: trimmed.len(),
                                        max: max_chars,
                                    });
                                    score -= 0.1;
                                }
                            }
                        }
                    }
                }
            }

            // ── Density: enforce max bullet count ──────────────────────
            if bullet_count > max_bullets {
                issues.push(ValidationIssue::TooManyBullets {
                    count: bullet_count,
                    max: max_bullets,
                });
                score -= 0.2;
            }

            if !has_example {
                issues.push(ValidationIssue::MissingExamples);
                score -= 0.3;
            }
        }
        SceneContent::Quiz { questions } => {
            // Basic structural: every question must have options and at least
            // one answer.
            for q in questions {
                if q.options.as_ref().map_or(true, |opts| opts.is_empty()) {
                    issues.push(ValidationIssue::MissingRequiredField {
                        field: format!("quiz question '{}' has no options", q.id),
                    });
                    score -= 0.3;
                }
                if q.answer.as_ref().map_or(true, |ans| ans.is_empty()) {
                    issues.push(ValidationIssue::MissingRequiredField {
                        field: format!("quiz question '{}' has no answer", q.id),
                    });
                    score -= 0.3;
                }
            }
        }
        // Interactive / Project scenes don't have text-level fluff issues
        // worth blocking on — let them pass with base score.
        _ => {}
    }

    let score = score.max(0.0);
    let has_hard_failure = issues.iter().any(|i| {
        matches!(
            i,
            ValidationIssue::MalformedJson { .. } | ValidationIssue::MissingRequiredField { .. }
        )
    });

    ValidationResult {
        valid: score >= 0.7 && !has_hard_failure,
        score,
        issues,
    }
}

/// Validate outlines count against tier limits.
pub fn validate_outline_count(count: usize, tier: &QualityTier) -> Option<ValidationIssue> {
    let limits = ai_tutor_domain::routing::tier_limits(*tier);
    if count > limits.max_slides {
        Some(ValidationIssue::ContentTooLong {
            element_id: "outlines".to_string(),
            got: count,
            max: limits.max_slides,
        })
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_tutor_domain::scene::*;

    fn make_slide_content(texts: Vec<(&str, &str)>) -> SceneContent {
        SceneContent::Slide {
            canvas: SlideCanvas {
                id: "canvas-1".to_string(),
                viewport_width: 960,
                viewport_height: 540,
                viewport_ratio: 16.0 / 9.0,
                theme: SlideTheme {
                    background_color: "#ffffff".to_string(),
                    theme_colors: vec![],
                    font_color: "#000000".to_string(),
                    font_name: "Inter".to_string(),
                },
                elements: texts
                    .into_iter()
                    .map(|(id, text)| SlideElement::Text {
                        id: id.to_string(),
                        left: 0.0,
                        top: 0.0,
                        width: 100.0,
                        height: 50.0,
                        content: text.to_string(),
                    })
                    .collect(),
                background: None,
            },
        }
    }

    #[test]
    fn fluff_is_removed_in_place() {
        let mut content = make_slide_content(vec![
            ("t1", "In this lesson, we will learn about gravity."),
            ("t2", "Gravity pulls objects toward Earth."),
        ]);
        let result = validate_content(&mut content, &QualityTier::Standard);
        // The fluff should be gone
        if let SceneContent::Slide { canvas } = &content {
            if let SlideElement::Text { content: text, .. } = &canvas.elements[0] {
                assert!(!text.contains("In this lesson"));
                assert!(text.contains("gravity"));
            }
        }
        assert!(result
            .issues
            .iter()
            .any(|i| matches!(i, ValidationIssue::SemanticFluffRemoved { .. })));
    }

    #[test]
    fn missing_examples_reduces_score() {
        let mut content = make_slide_content(vec![("t1", "Gravity is a force.")]);
        let result = validate_content(&mut content, &QualityTier::Basic);
        assert!(result.score < 1.0);
        assert!(result
            .issues
            .iter()
            .any(|i| matches!(i, ValidationIssue::MissingExamples)));
    }

    #[test]
    fn examples_present_keeps_score() {
        let mut content = make_slide_content(vec![(
            "t1",
            "For example, dropping a ball demonstrates gravity.",
        )]);
        let result = validate_content(&mut content, &QualityTier::Standard);
        assert!(!result
            .issues
            .iter()
            .any(|i| matches!(i, ValidationIssue::MissingExamples)));
    }
}
