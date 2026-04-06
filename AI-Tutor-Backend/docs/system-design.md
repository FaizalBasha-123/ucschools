# AI Tutor Backend System Design

## Purpose

`AI-Tutor-Backend` is the Rust backend monolith that translates the OpenMAIC backend architecture into a Rust-native system while preserving the same major flow:

1. intake user learning request
2. plan lesson structure as scene outlines
3. generate scene content
4. generate teaching actions
5. persist lesson/stage/scenes/assets
6. drive runtime playback or live AI tutoring sessions

The goal is to preserve the architecture pattern, not to literally port the Next.js backend files one by one.

## Architectural Principles

- Domain-first: scenes, actions, stages, jobs, and providers are explicit Rust types
- Modular monolith: one deployable backend, many strongly separated internal modules
- Graph-like orchestration: LangGraph concepts are preserved as Rust orchestration primitives
- Provider-agnostic: OpenAI, Anthropic, Gemini, OpenClaw-facing integrations sit behind traits
- Checkpointable: every generation phase should be resumable
- Honest scope: media-heavy model inference is expected to remain external unless proven otherwise

## Translation of OpenMAIC Concepts

### OpenMAIC concept -> Rust backend concept

- generation job -> `LessonGenerationJob`
- outline generation -> orchestration node
- scene content generation -> orchestration node
- scene action generation -> orchestration node
- scene builder -> domain assembler
- action engine contract -> runtime event schema
- provider model resolution -> provider registry
- classroom persistence -> lesson repository + asset repository

## High-Level Runtime Flow

1. Client submits `CreateLessonRequest`
2. API creates a job and stores initial state
3. Orchestrator executes nodes:
   - normalize_request
   - optional_research
   - generate_outlines
   - validate_outlines
   - generate_scene_content
   - generate_scene_actions
   - generate_media
   - generate_tts
   - persist_lesson
4. API exposes job progress and final lesson payload
5. Runtime APIs support lesson playback and live tutor sessions

## LangGraph Translation Strategy

OpenMAIC uses LangGraph for stateful orchestration. The Rust backend should preserve those capabilities with native primitives:

- typed shared graph state
- node handlers
- conditional transitions
- checkpoint persistence
- resumable execution
- pause/resume for human-in-the-loop steps

This project should not pretend LangGraph exists in Rust. We are translating the orchestration model, not depending on the JS/Python library.

## Module Responsibilities

### `crates/api`

- public HTTP routes
- SSE/WebSocket streaming
- auth/session integration
- request validation
- mapping HTTP DTOs to domain commands

### `crates/domain`

- core entities
- enums for scene/action/content/provider concepts
- validation rules
- DTOs shared across the monolith

### `crates/orchestrator`

- lesson generation pipeline
- graph state
- node execution
- progress reporting
- retries and resumability

### `crates/providers`

- traits:
  - `LlmProvider`
  - `TtsProvider`
  - `AsrProvider`
  - `ImageProvider`
  - `VideoProvider`
  - `SearchProvider`
- provider registry
- request/response normalization

### `crates/runtime`

- AI lesson runtime state machine
- playback state
- live tutor session state
- event sequencing contracts for frontend consumption

### `crates/storage`

- repositories
- persistence boundary
- job checkpoint storage
- lesson/stage/scene/action persistence

### `crates/media`

- media task lifecycle
- TTS asset generation workflow
- placeholder resolution
- object storage coordination

### `crates/common`

- config
- ids
- errors
- shared utilities

## Initial Codebase Tree

```text
AI-Tutor-Backend/
├── Cargo.toml
├── README.md
├── rust-toolchain.toml
├── docs/
│   └── system-design.md
└── crates/
    ├── api/
    ├── common/
    ├── domain/
    ├── orchestrator/
    ├── providers/
    ├── runtime/
    ├── storage/
    └── media/
```

## Implementation Order

1. domain models
2. provider traits
3. orchestration state and node contracts
4. persistence interfaces
5. generation pipeline endpoints
6. runtime session APIs
7. frontend integration
