use ai_tutor_domain::routing::QualityTier;

/// Quality Escalation Strategy.
/// Escalate to the refinement model ONLY when:
/// - We are on Premium tier, AND
/// - The validation score is below 0.85.
/// This is NOT a fallback — it's a quality upgrade path.
pub fn should_escalate(validation_score: f32, tier: &QualityTier) -> bool {
    *tier == QualityTier::Premium && validation_score < 0.85
}
