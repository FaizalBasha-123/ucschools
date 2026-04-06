use async_trait::async_trait;

use ai_tutor_domain::{
    job::LessonGenerationJob,
    lesson::Lesson,
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
