# OpenMAIC Backend Layer Analysis

## Purpose

This note breaks OpenMAIC's backend into architectural layers so the `AI-Tutor-Backend` Rust translation can preserve the real system shape instead of copying route files blindly.

## OpenMAIC Backend Is Not a Traditional Monolith

OpenMAIC uses Next.js API routes as thin entrypoints. Most real backend behavior lives in `lib/`.

The main backend layers observed are:

1. API route layer
2. server orchestration layer
3. generation pipeline layer
4. provider/model layer
5. multi-agent orchestration layer
6. media/TTS layer
7. persistence/job layer

## Layer 1: API Route Layer

Primary root:
- `OpenMAIC/app/api/`

Observed endpoint groups:
- `generate-classroom`
- `generate/scene-content`
- `generate/scene-actions`
- `generate/scene-outlines-stream`
- `chat`
- `classroom`
- `classroom-media`
- `parse-pdf`
- `transcription`
- `quiz-grade`
- provider verification endpoints

### Architectural character

- routes are thin
- request validation happens here
- model resolution is delegated
- orchestration lives below
- SSE is used for streaming flows

## Layer 2: Server Orchestration Layer

Primary root:
- `OpenMAIC/lib/server/`

Key files:
- `classroom-generation.ts`
- `classroom-job-runner.ts`
- `classroom-job-store.ts`
- `classroom-storage.ts`
- `classroom-media-generation.ts`
- `provider-config.ts`
- `resolve-model.ts`

### Responsibilities

- create and track generation jobs
- run backend generation pipeline
- load provider configuration
- resolve provider credentials and model selection
- persist classrooms and job state
- generate and serve media/TTS assets

### Important reality

Persistence is file-based, not database-first:
- classrooms stored under `data/classrooms`
- jobs stored under `data/classroom-jobs`
- media stored per classroom on local disk

This is a key translation decision point for Rust:
- preserve file-backed persistence initially for parity
- later migrate to database/object storage if needed

## Layer 3: Generation Pipeline Layer

Primary root:
- `OpenMAIC/lib/generation/`

Key files examined:
- `outline-generator.ts`
- `scene-generator.ts`
- `scene-builder.ts`
- `generation-pipeline.ts`

### Real flow

#### Stage 1: outlines
- user requirement
- optional PDF text/images
- optional research context
- optional media-generation policy
- returns ordered `SceneOutline[]`

#### Stage 2A: scene content
- outline becomes content
- slide, quiz, interactive, or PBL content

#### Stage 2B: scene actions
- content plus outline/context become ordered action list

#### Stage 2C: scene assembly
- content + actions become complete `Scene`

### Important translation insight

OpenMAIC’s strongest backend idea is:
- structured scene content
- structured scene actions

This should be preserved exactly in Rust as domain-first contracts.

## Layer 4: Provider / Model Layer

Primary roots:
- `OpenMAIC/lib/server/provider-config.ts`
- `OpenMAIC/lib/server/resolve-model.ts`
- `OpenMAIC/lib/ai/llm.ts`

### Responsibilities

- merge YAML config and env vars
- resolve server-side provider credentials
- select model/provider/base URL/proxy
- provide a unified call layer for generate/stream operations
- inject reasoning/thinking options depending on provider

### Architectural value

This is a provider abstraction layer, not just helpers.

The Rust translation should preserve:
- provider registry
- per-provider capability metadata
- key/base URL resolution
- model parsing
- unified generate/stream interfaces

## Layer 5: Multi-Agent Orchestration Layer

Primary root:
- `OpenMAIC/lib/orchestration/`

Key file examined:
- `stateless-generate.ts`

### Responsibilities

- stateless chat turn generation
- LangGraph-based orchestration loop
- director-agent style turn selection
- SSE event streaming to frontend
- structured output parsing from streamed LLM text

### Translation insight

The real value is not “LangGraph because branding”.
The value is:
- graph/state-machine orchestration
- incremental streaming
- director state
- resumable per-turn metadata

Rust backend should preserve these semantics with native graph/state abstractions.

## Layer 6: Media and TTS Layer

Primary file:
- `OpenMAIC/lib/server/classroom-media-generation.ts`

### Responsibilities

- collect image/video generation requests from outlines
- call provider adapters
- download/write generated assets
- replace media placeholders in scenes
- generate TTS audio for speech actions
- attach generated audio URLs back to actions

### Architectural value

Media is post-processing after the core lesson structure exists.

Rust translation should preserve phase ordering:
1. outlines
2. scenes
3. media
4. TTS
5. persistence complete

## Layer 7: Persistence and Job Layer

Primary files:
- `classroom-storage.ts`
- `classroom-job-store.ts`

### Responsibilities

- atomic JSON writes
- simple job mutexing
- stale job detection
- classroom lookup and serving

### Translation insight

The job system is intentionally simple:
- queued
- running
- succeeded
- failed

This is a good first parity target for Rust before adding more advanced scheduling.

## Backend Translation Priorities

### Preserve first

- request -> outline -> content -> actions -> scene assembly flow
- provider abstraction
- job lifecycle
- stateless SSE chat orchestration contract
- media/TTS post-processing

### Improve later

- database persistence
- better checkpointing
- stronger event bus/runtime session storage
- production-grade object storage

## Summary

OpenMAIC backend is best understood as:

- thin HTTP layer
- orchestration-heavy application layer
- typed content/action generation pipeline
- provider abstraction layer
- SSE chat orchestration layer
- simple file-backed persistence layer

This is the architecture that `AI-Tutor-Backend` should translate into Rust.
