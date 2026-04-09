use async_trait::async_trait;

use ai_tutor_domain::{
    job::LessonGenerationJob,
    lesson::Lesson,
    runtime::{DirectorState, RuntimeActionExecutionRecord},
};

#[async_trait]
pub trait LessonRepository: Send + Sync {
    async fn save_lesson(&self, lesson: &Lesson) -> Result<(), String>;
    async fn get_lesson(&self, lesson_id: &str) -> Result<Option<Lesson>, String>;
}

#[async_trait]
pub trait LessonJobRepository: Send + Sync {
    async fn create_job(&self, job: &LessonGenerationJob) -> Result<(), String>;
    async fn update_job(&self, job: &LessonGenerationJob) -> Result<(), String>;
    async fn get_job(&self, job_id: &str) -> Result<Option<LessonGenerationJob>, String>;
}

#[async_trait]
pub trait RuntimeSessionRepository: Send + Sync {
    async fn save_runtime_session(
        &self,
        session_id: &str,
        director_state: &DirectorState,
    ) -> Result<(), String>;
    async fn get_runtime_session(&self, session_id: &str) -> Result<Option<DirectorState>, String>;
}

#[async_trait]
pub trait RuntimeActionExecutionRepository: Send + Sync {
    async fn save_runtime_action_execution(
        &self,
        record: &RuntimeActionExecutionRecord,
    ) -> Result<(), String>;
    async fn get_runtime_action_execution(
        &self,
        execution_id: &str,
    ) -> Result<Option<RuntimeActionExecutionRecord>, String>;
    async fn list_runtime_action_executions_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<RuntimeActionExecutionRecord>, String>;
}
