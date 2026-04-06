use anyhow::Result;
use async_trait::async_trait;

use crate::state::GenerationState;

#[async_trait]
pub trait OrchestrationNode: Send + Sync {
    fn name(&self) -> &'static str;
    async fn run(&self, state: &mut GenerationState) -> Result<()>;
}

pub struct SequentialGraph {
    nodes: Vec<Box<dyn OrchestrationNode>>,
}

impl SequentialGraph {
    pub fn new(nodes: Vec<Box<dyn OrchestrationNode>>) -> Self {
        Self { nodes }
    }

    pub async fn run(&self, state: &mut GenerationState) -> Result<()> {
        for node in &self.nodes {
            node.run(state).await?;
        }

        Ok(())
    }
}
