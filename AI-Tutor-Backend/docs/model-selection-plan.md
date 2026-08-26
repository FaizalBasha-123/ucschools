# AI-Tutor Model Selection Plan

Last updated: 2026-08-26

## Objective

Use Qwen 3.8-Max as the sole text LLM across all AI-Tutor features —
engineering, medical, and child-facing content — while keeping
specialized media models (image, video, TTS, ASR) on their dedicated
non-LLM providers.

## Single-Model Strategy

All text generation, chat, reasoning, outline, scene content, quiz
grading, PBL runtime, and PDF parsing routes through one model:

| Property | Value |
|---|---|
| Model | Qwen 3.8-Max |
| Route | `openrouter:qwen/qwen3.8-max` |
| Context window | 1,000,000 tokens (991K max input, 131K max output) |
| Reasoning ceiling | 262K tokens |
| Input price | $2.00 / 1M tokens (flat, no long-context surcharge) |
| Output price | $6.00 / 1M tokens |
| Cache read | $0.25 / 1M tokens |
| Modalities | Text + image + video input → text output |
| Protocols | OpenAI-compatible, Anthropic-compatible |
| Released | August 3, 2026 |

### Why single-model

- Eliminates routing complexity and per-tier model-selection logic.
- One context window (1M) covers every task from short chat to long
  lesson generation without tiered fallbacks.
- Flat pricing across the full context means no long-context penalty.
- Vision input is native, so the same model handles text and image
  analysis tasks.
- The 262K reasoning ceiling covers deep multi-step exam prep.

### Media models (unchanged, specialized)

Qwen 3.8-Max is a text LLM. It cannot generate images, video, or
speech. These specialized models remain on dedicated providers:

| Task | Model | Route |
|---|---|---|
| Image (basic) | FLUX Schnell | `openrouter:black-forest-labs/flux-schnell` |
| Image (standard) | FLUX Dev | `openrouter:black-forest-labs/flux-dev` |
| Image (premium) | FLUX 1.1 Pro | `openrouter:black-forest-labs/flux-1.1-pro` |
| Video | GPT Video 1 | `openai:gpt-video-1` |
| TTS (basic/standard) | Kokoro 82M | `openrouter:hexgrad/kokoro-82m` |
| TTS (premium) | Eleven Multilingual V2 | `elevenlabs:eleven_multilingual_v2` |
| ASR (basic) | Whisper Small | `groq:whisper-small` |
| ASR (standard/premium) | Whisper Large V3 | `groq:whisper-large-v3` |

## Routing Rules

### Text LLM (all tiers, all tasks)

Every quality tier (Basic, Standard, Premium) and every capability
(FastCheap, StructuredGeneration, PremiumReasoning, LongContext,
VisionAnalysis, LightweightEvaluation) resolves to Qwen 3.8-Max.

The quality-tier and capability enums are retained for budget
computation (slide counts, interaction limits, token budgets) but
no longer change the selected model.

### Media

Media models remain tier-dependent as shown in the table above.

## Medical Content Guardrail

Medical content must be grounded through the retrieval layer
(filesystem.rs / RAG pipeline), never pure parametric recall. This
is enforced at the routing/orchestrator level, not at model
selection — Qwen 3.8-Max handles the language, but medical facts
must come from retrieved context.

## Cost Guardrails

- No per-tier model cost variance — all text LLM spend is at the
  single $2/$6 rate.
- Premium reasoning share is no longer a cost concern since all
  tiers use the same model.
- Media spend remains tier-gated (FLUX Schnell vs FLUX 1.1 Pro,
  Kokoro vs ElevenLabs).
- Cap video duration per lesson by plan tier.

## Source Snapshot

Qwen 3.8-Max pricing and specs verified August 2026 from OpenRouter
(https://openrouter.ai/qwen/qwen3.8-max) and Alibaba DashScope
documentation.
