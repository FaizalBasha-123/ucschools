# AI-Tutor OpenRouter Model Selection Plan

Last updated: 2026-04-14

## Objective

Pick the cheapest reliable model per AI-Tutor feature while keeping student-facing quality high and preserving profit margin.

## Pricing Notes

- Base price: model listed price on OpenRouter.
- Weighted price: effective routed price across providers (better for budgeting).
- Weighted rates can change over time; monitor weekly.

## Updated Recommended Feature-to-Model Table

| Feature | Primary model | Fallback model | Base price | Weighted price | Estimated cost | Why this wins |
|---|---|---|---|---|---|---|
| Lesson generation (single-pass default) | openai/gpt-4o-mini | google/gemini-3.1-flash-lite-preview | 0.15 in / 0.60 out per 1M | 0.121 in / 0.596 out per 1M | ~0.00622 per lesson (12k in, 8k out) | One-pass quality is strong enough for production, minimal latency, lower complexity |
| Lesson polish (exception only, not default) | openai/gpt-4o-mini | google/gemini-3.1-flash-lite-preview | 0.15 / 0.60 | 0.121 / 0.596 | ~0.00126 per polish pass | Run only if QA/rubric fails, to avoid unnecessary extra calls |
| Live tutor chat (default) | openai/gpt-4o-mini | google/gemini-3.1-flash-lite-preview | 0.15 / 0.60 | 0.121 / 0.596 | ~0.00060 per turn | Cheapest reliable student-facing interactive quality |
| Hard reasoning escalation only | google/gemini-3.1-pro-preview | deepseek/deepseek-r1 | 2 / 12 and 0.70 / 2.50 | 1.08 / 12.04 and 0.746 / 2.60 | Invoke only for hard/failing cases | Premium reasoning spend stays low by gating usage |
| Research/search synthesis | google/gemini-3.1-flash-lite-preview | deepseek/deepseek-chat-v3.1 | 0.25 / 1.50 and 0.15 / 0.75 | 0.189 / 1.50 and 0.325 / 1.17 | ~0.0013 to ~0.0014 per typical turn | Good retrieval/ranking/translation quality at low cost |
| Image generation/editing | openai/gpt-5-image-mini | google/gemini-2.5-flash-image | 2.50 / 2 and 0.30 / 2.50 | 2.50 / 5.94 and 0.300 / 29.69 | ~0.018 vs ~0.089 per image (assume 3k out tokens) | Lower effective output economics than Gemini image weighted rates |
| Video generation | openai/sora-2-pro | google/veo-3.1 | Per second: 0.30 at 720p, 0.50 at 1024p/1080p | Same unit (provider-priced) | 10s at 720p about 3.00 | Lower entry cost per second than Veo starting at 0.40/s |
| TTS narration | openai/gpt-audio-mini | openai/gpt-audio | 0.60 / 2.40 and 2.50 / 10 | 0.598 / 2.40 and 14.87 / 13.32 | ~0.0011 per short response | Large cost advantage while keeping natural speech quality |
| ASR / voice input transcription | google/gemini-3.1-flash-lite-preview (audio input) | google/gemini-3-flash-preview | 0.25 / 1.50 and 0.50 / 3 | 0.189 / 1.50 and 0.344 / 3 | Very low per utterance | Practical ASR path on OpenRouter where classic whisper-like slugs are unavailable |
| Embeddings for RAG | openai/text-embedding-3-small | google/gemini-embedding-001 | 0.02 input only and 0.15 input only | 0.019 input and 0.149 input | About 7.8x cheaper than Gemini embedding | Best embedding economics for large corpus indexing |
| Reranking retrieved chunks | cohere/rerank-v3.5 | cohere/rerank-4-fast | 0.001 per search | Effective token weighted not populated | 0.001 per rerank call | Very cheap relevance boost for RAG quality |

## Why Single-Pass GPT-4o-mini is the Default

- GPT-4o-mini is not a low-quality drafting model; it is a strong quality/cost model.
- Mandatory two-stage draft plus polish gives negligible savings in our current assumptions.
- One-pass flow is faster, simpler, and operationally safer.

## Routing Rules

### Default

- Use `openai/gpt-4o-mini` for lesson generation and live tutor turns.

### Conditional Escalation

Escalate to `google/gemini-3.1-pro-preview` only if one or more conditions are true:

- rubric score below threshold
- complex multi-step reasoning prompt (math/proof-heavy/coding-heavy)
- repeated user dissatisfaction in same thread
- safety/compliance checker asks for higher-confidence answer

### Conditional Polish

Run optional polish pass only when:

- output schema is invalid
- readability/age-level score fails target
- teacher/admin explicitly requests refinement

## Cost Guardrails

- Keep premium reasoning share under 5% of total requests.
- Cap video duration per lesson by plan tier.
- Track weighted price drift weekly and refresh this plan monthly.

## Source Snapshot

Prices and weighted rates were taken from OpenRouter model pricing pages on 2026-04-14.
