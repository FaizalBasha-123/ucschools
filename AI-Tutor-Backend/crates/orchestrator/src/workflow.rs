use anyhow::{anyhow, Result};
use async_trait::async_trait;
use std::collections::HashMap;

#[async_trait]
pub trait Node<State>: Send + Sync {
    /// Executes the node logic and mutates the state.
    /// Returns the name of the next node to transition to, or empty if using predefined edges.
    async fn execute(&self, state: &mut State) -> Result<()>;
}

/// A lightweight, GraphBit-inspired workflow execution engine.
/// It models directed graphs where conditional edges dictate the next node.
pub struct Workflow<State> {
    nodes: HashMap<String, Box<dyn Node<State>>>,
    entry_point: String,
    conditional_edges: HashMap<String, Box<dyn Fn(&State) -> String + Send + Sync>>,
    normal_edges: HashMap<String, String>,
}

impl<State> Workflow<State> {
    pub fn new(entry_point: &str) -> Self {
        Self {
            nodes: HashMap::new(),
            entry_point: entry_point.to_string(),
            conditional_edges: HashMap::new(),
            normal_edges: HashMap::new(),
        }
    }

    pub fn add_node(&mut self, name: &str, node: Box<dyn Node<State>>) {
        self.nodes.insert(name.to_string(), node);
    }

    pub fn add_edge(&mut self, from: &str, to: &str) {
        self.normal_edges.insert(from.to_string(), to.to_string());
    }

    pub fn add_conditional_edges<F>(&mut self, from: &str, routing_fn: F)
    where
        F: Fn(&State) -> String + Send + Sync + 'static,
    {
        self.conditional_edges
            .insert(from.to_string(), Box::new(routing_fn));
    }

    pub async fn execute(&self, state: &mut State) -> Result<()> {
        let mut current_node = self.entry_point.clone();

        loop {
            if current_node == "END" {
                break;
            }

            let node = self.nodes.get(&current_node).ok_or_else(|| {
                anyhow!("Workflow error: Node '{}' not found in graph", current_node)
            })?;

            // Execute the node
            node.execute(state).await?;

            // Determine the next step
            if let Some(routing_fn) = self.conditional_edges.get(&current_node) {
                current_node = routing_fn(state);
            } else if let Some(next_node) = self.normal_edges.get(&current_node) {
                current_node = next_node.clone();
            } else {
                // No outgoing edges mean workflow is complete
                break;
            }
        }

        Ok(())
    }
}
