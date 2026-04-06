# AI-Tutor-Backend

Rust monolith workspace for the OpenMAIC-to-Rust architecture translation project.

This backend is intended to own:

- lesson generation orchestration
- scene and action domain models
- provider abstraction for LLM/TTS/ASR/media/search
- job execution and checkpointing
- persistence and asset integration
- runtime session control for AI lesson playback

This folder is intentionally scaffolded as a real Rust workspace with explicit module boundaries.
It is not a finished implementation yet.

## Workspace Goals

- Preserve the OpenMAIC architecture pattern
- Rebuild the backend engine with Rust-native types and state machines
- Keep the frontend renderer separate and web-native
- Avoid fake adapters or placeholder architecture claims

## Planned Runtime Shape

- `crates/api`: HTTP/SSE/WebSocket entrypoints
- `crates/orchestrator`: graph-like lesson generation pipeline
- `crates/domain`: typed scene/action/lesson models
- `crates/providers`: provider traits and adapters
- `crates/runtime`: playback/session state machine
- `crates/storage`: repositories and persistence
- `crates/media`: media/TTS asset coordination
- `crates/common`: shared error/config/ids

## Current Status

- Rust workspace created
- crate boundaries defined
- initial system design documented
- implementation still pending
