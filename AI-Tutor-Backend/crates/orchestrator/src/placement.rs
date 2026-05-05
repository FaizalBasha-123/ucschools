use serde::{Deserialize, Serialize};

/// Advanced Placement Engine
///
/// Placement mode requires a multi-phase interactive loop, not just static
/// generation. This module defines the phases and the state machine that
/// drives the diagnostic assessment.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlacementPhase {
    /// Phase 1: Identify baseline skill level from initial input.
    SkillDetection,
    /// Phase 2: Ask targeted diagnostic questions (adaptive difficulty).
    QuestionLoop,
    /// Phase 3: Evaluate aggregate responses to map proficiency.
    Evaluation,
    /// Phase 4: Probe weak areas with follow-up questions.
    FollowUp,
}

impl PlacementPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SkillDetection => "skill_detection",
            Self::QuestionLoop => "question_loop",
            Self::Evaluation => "evaluation",
            Self::FollowUp => "follow_up",
        }
    }

    /// Returns the next phase in the placement sequence, or `None` if we
    /// have reached the end.
    pub fn next(self) -> Option<Self> {
        match self {
            Self::SkillDetection => Some(Self::QuestionLoop),
            Self::QuestionLoop => Some(Self::Evaluation),
            Self::Evaluation => Some(Self::FollowUp),
            Self::FollowUp => None,
        }
    }
}

impl std::fmt::Display for PlacementPhase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Tracks state across the placement diagnostic loop.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacementState {
    /// Current phase of the diagnostic.
    pub phase: PlacementPhase,
    /// Number of questions asked so far.
    pub questions_asked: usize,
    /// Number of correct answers so far.
    pub correct_answers: usize,
    /// Identified sub-skills and whether they passed.
    pub skill_map: Vec<SkillAssessment>,
    /// Follow-up probes still pending.
    pub pending_probes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillAssessment {
    pub skill_name: String,
    pub tested: bool,
    pub passed: bool,
    pub difficulty_tested: String, // "beginner" | "intermediate" | "advanced"
}

impl PlacementState {
    /// Create a fresh placement session.
    pub fn new() -> Self {
        Self {
            phase: PlacementPhase::SkillDetection,
            questions_asked: 0,
            correct_answers: 0,
            skill_map: Vec::new(),
            pending_probes: Vec::new(),
        }
    }

    /// Record an answer and advance state.
    pub fn record_answer(&mut self, skill_name: &str, correct: bool, difficulty: &str) {
        self.questions_asked += 1;
        if correct {
            self.correct_answers += 1;
        }

        // Update or insert skill assessment.
        if let Some(existing) = self
            .skill_map
            .iter_mut()
            .find(|s| s.skill_name == skill_name)
        {
            existing.tested = true;
            existing.passed = correct;
            existing.difficulty_tested = difficulty.to_string();
        } else {
            self.skill_map.push(SkillAssessment {
                skill_name: skill_name.to_string(),
                tested: true,
                passed: correct,
                difficulty_tested: difficulty.to_string(),
            });
        }

        // If a skill was failed, queue it for a follow-up probe.
        if !correct && !self.pending_probes.contains(&skill_name.to_string()) {
            self.pending_probes.push(skill_name.to_string());
        }
    }

    /// Advance to the next phase, if appropriate.
    pub fn advance_phase(&mut self) -> bool {
        if let Some(next) = self.phase.next() {
            self.phase = next;
            true
        } else {
            false
        }
    }

    /// Overall proficiency score (0.0 - 1.0).
    pub fn proficiency_score(&self) -> f32 {
        if self.questions_asked == 0 {
            return 0.0;
        }
        self.correct_answers as f32 / self.questions_asked as f32
    }

    /// Determine the inferred difficulty level from placement results.
    pub fn inferred_difficulty(&self) -> &'static str {
        let score = self.proficiency_score();
        if score >= 0.8 {
            "advanced"
        } else if score >= 0.5 {
            "intermediate"
        } else {
            "beginner"
        }
    }

    /// Weak skills that need follow-up probing.
    pub fn weak_skills(&self) -> Vec<&str> {
        self.skill_map
            .iter()
            .filter(|s| s.tested && !s.passed)
            .map(|s| s.skill_name.as_str())
            .collect()
    }
}

impl Default for PlacementState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement_phase_sequence() {
        let mut phase = PlacementPhase::SkillDetection;
        assert_eq!(phase.next(), Some(PlacementPhase::QuestionLoop));
        phase = PlacementPhase::QuestionLoop;
        assert_eq!(phase.next(), Some(PlacementPhase::Evaluation));
        phase = PlacementPhase::FollowUp;
        assert_eq!(phase.next(), None);
    }

    #[test]
    fn placement_state_tracks_answers() {
        let mut state = PlacementState::new();
        state.record_answer("algebra", true, "intermediate");
        state.record_answer("calculus", false, "beginner");
        state.record_answer("geometry", true, "intermediate");

        assert_eq!(state.questions_asked, 3);
        assert_eq!(state.correct_answers, 2);
        assert!(state.proficiency_score() > 0.6);
        assert_eq!(state.weak_skills(), vec!["calculus"]);
        assert!(state.pending_probes.contains(&"calculus".to_string()));
    }

    #[test]
    fn inferred_difficulty_maps_correctly() {
        let mut state = PlacementState::new();
        // 4 out of 5 correct = 0.8 → advanced
        for i in 0..4 {
            state.record_answer(&format!("skill{}", i), true, "intermediate");
        }
        state.record_answer("skill4", false, "hard");
        assert_eq!(state.inferred_difficulty(), "advanced");
    }

    #[test]
    fn empty_state_has_zero_proficiency() {
        let state = PlacementState::new();
        assert_eq!(state.proficiency_score(), 0.0);
        assert_eq!(state.inferred_difficulty(), "beginner");
    }
}
