use anyhow::Result;

use ai_tutor_domain::scene::GeneratedAgentConfig;


use super::*;
use crate::generation::helpers::*;

impl LlmGenerationPipeline {
pub(crate) async fn generate_agents(
        &self,
        topic: &str,
        scene_titles: &[String],
        language: &str,
    ) -> Result<Vec<GeneratedAgentConfig>> {
        let scene_list = scene_titles.iter().enumerate()
            .map(|(i, t)| format!("{}. {}", i + 1, t))
            .collect::<Vec<_>>()
            .join("\n");

        let system = "You are an expert instructional designer. Generate agent profiles for a multi-agent classroom simulation. Return ONLY valid JSON, no markdown or explanation.";
        let user = format!(
            "Generate 2-3 agent profiles for the following course:\n\
             Course topic: {topic}\n\
             Scene outline:\n{scenes}\n\
             Language for names and personas: {lang}\n\n\
             Requirements:\n\
             - Exactly 1 agent must have role \"teacher\" (priority: 10)\n\
             - 1-2 agents can be \"assistant\" (priority: 7) or \"student\" (priority: 5)\n\
             - Each agent needs: name, role, persona (2-3 sentences of teaching/learning style and personality)\n\
             - Teacher persona must describe their SUBJECT EXPERTISE, TEACHING STYLE (e.g. Socratic, direct, analogy-driven), and PERSONALITY TONE (warm, energetic, rigorous)\n\
             - All names and personas must be in the language: {lang}\n\n\
             Return JSON: {{\"agents\":[{{\"name\":\"...\",\"role\":\"teacher\",\"persona\":\"...\"}}]}}",
            topic = topic,
            scenes = scene_list,
            lang = language,
        );

        let (raw, _) = self
            .generate_with_retry_using(self.outlines_llm(), system, &user)
            .await?;

        #[derive(serde::Deserialize)]
        struct AgentsEnvelope { agents: Vec<AgentStub> }
        #[derive(serde::Deserialize)]
        struct AgentStub { name: String, role: String, persona: String, #[serde(default)] priority: Option<i32> }

        let parsed: AgentsEnvelope = parse_json_with_repair(&raw)
            .unwrap_or_else(|_| AgentsEnvelope { agents: vec![] });

        if parsed.agents.is_empty() {
            // Fallback: one generic teacher profile
            return Ok(vec![GeneratedAgentConfig {
                id: uuid::Uuid::new_v4().to_string(),
                name: "Teacher".to_string(),
                role: "teacher".to_string(),
                persona: format!("An expert teacher who specializes in {topic}. Uses clear analogies, engaging examples, and asks thought-provoking questions to deepen student understanding."),
                avatar: "teacher".to_string(),
                color: "#2563eb".to_string(),
                priority: 10,
            }]);
        }

        let agents = parsed.agents.into_iter().enumerate().map(|(i, a)| {
            let priority = a.priority.unwrap_or_else(|| {
                if a.role == "teacher" { 10 } else if a.role == "assistant" { 7 } else { 5 }
            });
            GeneratedAgentConfig {
                id: uuid::Uuid::new_v4().to_string(),
                name: a.name,
                role: a.role,
                persona: a.persona,
                avatar: format!("agent_{i}"),
                color: ["#2563eb", "#0f766e", "#7c3aed", "#b45309"][i % 4].to_string(),
                priority,
            }
        }).collect();

        Ok(agents)
    }

}
