# AI Tutor Backend-First Roadmap

## Build Order

1. Analyze OpenMAIC backend layer by layer
2. Complete Rust domain models
3. Build provider abstraction
4. Build file-backed job/lesson persistence
5. Build generation orchestrator
6. Expose generation APIs
7. Add media/TTS enrichment
8. Add live tutor SSE orchestration
9. Only then build the dedicated tutor frontend around the real contracts

## Why This Order

- OpenMAIC’s frontend is driven by structured lesson and action payloads
- without backend contracts, frontend implementation becomes guesswork
- a backend-first path reduces expensive rewrites in the player UI

## Current Immediate Focus

Implement `AI-Tutor-Backend` Phase 1:
- complete domain layer
- capture OpenMAIC lesson, outline, scene, action, and job contracts in Rust
