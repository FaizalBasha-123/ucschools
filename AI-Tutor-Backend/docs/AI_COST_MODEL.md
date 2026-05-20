# AI Tutor Cost & Credit Model

Credits are an abstraction layer between real currency and AI provider costs. They exist to decouple pricing from volatile provider rate changes, enable decimal-granularity charging, and provide a deterministic budget surface for both the platform and its users.

Deterministic pricing means every operation has a known cost before execution. No surprise bills, no hidden token explosions. Burn-rate control is enforced at the framework level through hard caps, prompt budgets, and scene limits. Lessons are constrained because unbounded generation destroys margins and degrades educational density -- longer content is not better content.

```
Educational quality per token > token quantity
```

---

# 1. Financial Philosophy

We optimize for five properties in priority order:

1.  **Predictable burn rate** -- provider costs must be estimable before any API call.
2.  **Affordable student pricing** -- education pricing, not enterprise SaaS pricing.
3.  **Sustainable gross margins** -- target 65% across the portfolio.
4.  **High perceived value** -- lessons feel expensive to produce, not cheap.
5.  **Low hidden cost spikes** -- no unbounded voice, no unbounded search.

```
Target gross margin: ~65%
```

```
Gross Margin
=
(Revenue - Provider Cost)
/ Revenue
```

Credits are abstraction units. One credit represents approximately $0.005 in blended provider cost at target margins.

```
1 credit ~ $0.005 provider cost
```

This gives us:
- Decimal charging (0.02 credits per minute of TTS instead of fractions of a cent)
- Flexible pricing (adjust multipliers without touching real currency amounts)
- Low-friction UX (students see integer-ish numbers, not micro-dollar amounts)

The per-credit provider cost is a blended estimate across all quality tiers and learning modes. Actual cost per credit varies by model used. The aggregate is what matters for margin calculation.

---

# 2. Providers & Resources

## Model Registry

All models are resolved at runtime through `crates/routing/src/routing_rules.rs`. Overrides can be applied via env vars without code changes.

| Resource | Provider | Model | Purpose |
|---|---|---|---|
| **TTS Basic** | OpenRouter | `hexgrad/kokoro-82m` | Text-to-speech, basic/standard tier |
| **TTS Standard** | OpenRouter | `hexgrad/kokoro-82m` | Text-to-speech, basic/standard tier |
| **TTS Premium** | ElevenLabs | `eleven_multilingual_v2` | Text-to-speech, premium tier |
| **ASR Basic** | Groq | `whisper-small` | Speech-to-text, basic tier |
| **ASR Standard** | Groq | `whisper-large-v3` | Speech-to-text, standard tier |
| **ASR Premium** | Groq | `whisper-large-v3` | Speech-to-text, premium tier |
| **Orchestrator Basic** | OpenRouter | `google/gemini-2.5-flash` | Lesson orchestration |
| **Orchestrator Standard** | OpenRouter | `google/gemini-2.5-flash` | Lesson orchestration |
| **Orchestrator Premium** | OpenRouter | `anthropic/claude-sonnet-4.6` | Lesson orchestration |
| **Outline Basic** | OpenRouter | `google/gemini-2.5-flash-lite` | Lesson outline generation |
| **Outline Standard** | OpenRouter | `google/gemini-2.5-flash` | Lesson outline generation |
| **Outline Premium** | OpenRouter | `anthropic/claude-sonnet-4.6` | Lesson outline generation |
| **Scene Content** | OpenRouter | `deepseek/deepseek-chat-v3-0324` | Scene content generation (all tiers) |
| **Scene Actions Basic** | OpenRouter | `meta-llama/llama-3.1-8b-instruct` | Scene action generation |
| **Scene Actions Std/Prem** | OpenRouter | `deepseek/deepseek-chat-v3-0324` | Scene action generation |
| **Actions Fallback** | OpenRouter | `google/gemini-2.5-flash` | Reliability fallback (all tiers) |
| **Quiz Grading** | OpenRouter | `meta-llama/llama-3.1-8b-instruct` | Multiple-choice grading (all tiers) |
| **Content Refinement** | OpenRouter | `anthropic/claude-sonnet-4.6` | Premium-only lesson polish |
| **PDF Parsing** | OpenRouter | `google/gemini-2.5-flash` | PDF text extraction (all tiers) |
| **Image Basic** | OpenRouter | `black-forest-labs/flux-schnell` | Image generation |
| **Image Standard** | OpenRouter | `black-forest-labs/flux-dev` | Image generation |
| **Image Premium** | OpenRouter | `black-forest-labs/flux-1.1-pro` | Image generation |
| **Video** | OpenAI | `gpt-video-1` | Video generation (all tiers) |
| **Search Enrichment** | Tavily | `tavily` | Web search for fact-heavy lessons |

## Model Selection Rationale

Each model is chosen for a specific cost-quality tradeoff:

- **DeepSeek V3** is the workhorse for structured generation (scene content, actions). It provides GPT-4-class quality at ~1/10th the cost of Claude. Used for most generation volume.
- **Gemini Flash series** handles orchestration, outlines, PDF parsing, and fallbacks. Fast, cheap, and competently structured.
- **Claude Sonnet 4.6** is reserved for premium orchestration and refinement where reasoning depth directly impacts perceived quality.
- **Llama 3.1 8B** handles low-stakes evaluation (quiz grading, lightweight actions) where precision is secondary to speed and cost.
- **Flux Schnell/Dev** is used instead of Midjourney or DALL-E because it provides adequate educational imagery at dramatically lower per-image cost.
- **Kokoro 82m** is used for TTS instead of ElevenLabs for basic/standard tiers because it is free via OpenRouter (or near-free). ElevenLabs is reserved for premium where voice quality is a differentiator.

Expensive models (Claude Opus, GPT-4o, Gemini Ultra) are deliberately avoided. They do not produce proportionally better educational content for this domain.

## Provider Cost Assumptions (as of writing)

These are rough-order-of-magnitude estimates used for margin calculations:

| Model | Est. Input Cost / 1M tok | Est. Output Cost / 1M tok |
|---|---|---|
| `gemini-2.5-flash-lite` | ~$0.08 | ~$0.30 |
| `gemini-2.5-flash` | ~$0.15 | ~$0.60 |
| `deepseek-chat-v3-0324` | ~$0.27 | ~$1.10 |
| `llama-3.1-8b-instruct` | ~$0.05 | ~$0.20 |
| `claude-3-5-haiku` | ~$0.80 | ~$4.00 |
| `claude-sonnet-4.6` | ~$3.00 | ~$15.00 |
| `flux-schnell` | ~$0.003/image | — |
| `flux-dev` | ~$0.025/image | — |
| `flux-1.1-pro` | ~$0.05/image | — |
| `kokoro-82m` | ~$0.00 (free) | — |
| `eleven_multilingual_v2` | ~$0.0002/char | — |
| `whisper-small` (Groq) | ~$0.00 (free tier) | — |
| `whisper-large-v3` (Groq) | ~$0.00 (free tier) | — |

**Note:** Actual provider costs change frequently. These estimates are used for margin planning only. Real costs are tracked via `api_usage_records.cost_usd_millicents`.

---

# 3. AI Quality Levels

Each tier has a base scene count that is then modulated by the detected topic complexity (see [Scene Budgets](#51-scene-budget-matrix) below). Scene counts are deterministic — calculated from tier + complexity, not LLM-decided.

## Basic

- **Goal:** Fast, cheap lessons for revision and quick study.
- **Expected behavior:** Shorter scenes, fewer interactions, lower model cost.
- **Base scene count:** 5 (varies by complexity: 3–8 target)
- **Interaction density:** 1-2 interactions per scene.
- **Reasoning depth:** Surface-level explanation. Bullet-point friendly.
- **Cost expectation:** Lowest per-lesson provider cost.

## Standard

- **Goal:** Balanced quality for regular study sessions.
- **Expected behavior:** Full scene structure with moderate depth.
- **Base scene count:** 8 (varies by complexity: 6–11 target)
- **Interaction density:** 3-5 interactions per scene.
- **Reasoning depth:** Moderate. Paragraph-level explanations with examples.
- **Cost expectation:** Moderate per-lesson cost.

## Premium

- **Goal:** Deep learning with rich reasoning, refinement, and media.
- **Expected behavior:** Dense reasoning, multiple quiz types, polished content.
- **Base scene count:** 15 (varies by complexity: 13–18 target)
- **Interaction density:** 5-8 interactions per scene.
- **Reasoning depth:** Deep. Multi-paragraph explanations, analogies, edge cases.
- **Cost expectation:** Highest per-lesson cost.

Premium does NOT mean longer lessons. Premium means denser reasoning, more interactions, refined content, and higher-quality media. A premium 6-scene lesson costs more than a standard 10-scene lesson.

## Budget Enforcement (code-enforced caps from `routing_rules.rs`)

Scene counts below are the **hard max** (upper bound across all complexity levels). Actual scene budgets are computed per-generation by `compute_scene_budget()` in `orchestrator/src/complexity.rs`.

| Constraint | Basic | Standard | Premium |
|---|---|---|---|
| Max scenes (hard cap, all complexities) | 10 | 16 | 30 |
| Max interactions per scene | 2 | 5 | 8 |
| Max visuals per lesson | 1 | 3 | 5 |
| Max tokens per scene | 512 | 1024 | 2048 |
| Max response tokens | 2048 | 4096 | 8192 |
| Max cost per request (est.) | $0.01 | $0.05 | $0.15 |
| Enable refinement pass | No | No | Yes |
| Max PDF context chars | 300 | 600 | 1000 |

---

# 4. Learning Styles

## Revision

- **Goal:** Quick review, memory triggers, bullet-point summaries.
- **Interaction behavior:** Minimal. 0-1 quiz questions. Rapid-fire format.
- **Complexity:** Low. Surface-level with memory anchors.
- **Expected duration:** 3-8 minutes of voice + reading.
- **Recommended scene count:** 3-5.

## Explain

- **Goal:** Deep, structured teaching with detailed explanations.
- **Interaction behavior:** Moderate. 2-4 quiz questions interspersed. Guided discovery.
- **Complexity:** Medium-high. Full pedagogical structure.
- **Expected duration:** 8-20 minutes of voice + reading.
- **Recommended scene count:** 5-8.

## Exam

- **Goal:** MCQ/short-answer practice with timer-friendly format.
- **Interaction behavior:** High. 5-10 quiz questions. Timed mode available.
- **Complexity:** Medium. Questions + detailed feedback on each answer.
- **Expected duration:** 5-15 minutes.
- **Recommended scene count:** 4-7.

## PlacementPrep

- **Goal:** Interview / aptitude / placement preparation.
- **Interaction behavior:** Very high. Simulated interview flow, adaptive questioning.
- **Complexity:** High. Multi-layered questions with follow-up depth.
- **Expected duration:** 10-30 minutes.
- **Recommended scene count:** 6-10.

---

# 5. Lesson Credit Economics

Lesson credit cost is a FIXED cost per lesson generation, NOT duration-based. The same lesson costs the same credits regardless of how long the student spends on it.

This fixed cost covers:
- Orchestration (planning the lesson structure)
- Outline generation
- Scene content generation
- Scene action generation (speech, quizzes, interactions)
- Reasoning and content depth
- Content refinement (premium only)
- Quiz/interaction generation

It does NOT include:
- Voice/TTS consumption (billed separately)
- Image generation (billed per image)
- PDF parsing (billed per page)
- Search enrichment (billed per query)

## Lesson Credit Matrix

| Learning Mode | Basic | Standard | Premium |
|---|---|---|---|
| Revision | 1.2 | 2.0 | 3.5 |
| Explain | 2.0 | 4.0 | 6.0 |
| Exam | 3.0 | 5.0 | 7.0 |
| PlacementPrep | 4.0 | 6.0 | 9.0 |

### Examples

A Basic Explain lesson:
```
2 credits
x $0.005/credit (blended provider cost)
= $0.01 estimated provider cost

At 65% margin:
Revenue = $0.01 / (1 - 0.65) = ~$0.029
Retail credit cost = 2 credits at plan rate
```

A Premium PlacementPrep lesson:
```
9 credits
x $0.005/credit
= $0.045 estimated provider cost

At 65% margin:
Revenue = $0.045 / 0.35 = ~$0.129
Retail credit cost = 9 credits at plan rate
```

### Provider Burn Assumptions (per lesson)

| Component | Est. Cost Range | Notes |
|---|---|---|
| Orchestration | $0.0005 - $0.003 | Gemini Flash vs Claude Sonnet |
| Outline | $0.0003 - $0.002 | Flash Lite vs Sonnet |
| Scene content (per scene) | $0.0005 - $0.003 | DeepSeek V3 (same across tiers) |
| Scene actions (per scene) | $0.0003 - $0.002 | Llama 8B vs DeepSeek |
| Refinement (premium only) | $0.001 - $0.005 | Claude Sonnet pass |
| Total blended | $0.005 - $0.05 | Wide range by tier and scene count |

The lesson credit matrix is priced to achieve ~65% gross margin at the median usage profile within each tier.

---

# 5.1 Scene Budget Matrix

Scene budgets are **deterministic** — calculated from the tier base count modulated by the detected topic complexity. The LLM does not decide how many scenes a lesson contains.

## Complexity Levels

Topic complexity is detected at generation time by `detect_complexity()` in `orchestrator/src/context.rs`. The detector uses keyword matching (not LLM calls) against three signal categories, plus topic length and multi-requirement heuristics.

## Signal Categories

Each category is a set of keywords detected via substring matching. The weighted count is the total number of matches multiplied by the category weight:

| Category | Keywords (examples) | Weight |
|---|---|---|
| **Connective reasoning** | "and", "vs", "versus", "between", "relationship", "compare", "interaction", "integration" | 1× |
| **Depth** | "system", "mechanism", "process", "theory", "architecture", "pipeline", "framework", "protocol", "algorithm", "infrastructure" | 2× |
| **Cross-domain** | "multiple", "comprehensive", "end-to-end", "full stack", "distributed", "concurrent", "parallel", "hierarchical", "multivariate", "multidimensional" | 3× |

Additionally, uppercase abbreviations of length ≥2 (e.g., "API", "DBMS") add a +2 bonus to the total score.

## Threshold Logic

Two additional dimensions modulate the final level:

- **`word_count`** — total whitespace-delimited words in the topic string
- **`has_multi_requirement`** — true if the topic contains semicolons, numbered lists (e.g., "1.", "2."), or newlines

The weighted score + modulators map to the 5-level ladder as follows:

```rust
match (word_count, total_score, has_multi_requirement) {
    (wc, ts, true) if wc > 40 && ts >= 8  => TopicComplexity::Extreme,
    (wc, ts, _)    if wc > 30 && ts >= 5  => TopicComplexity::VeryHigh,
    (_, ts, _)     if ts >= 8             => TopicComplexity::VeryHigh,
    (wc, ts, true) if wc > 15 && ts >= 3  => TopicComplexity::High,
    (_, ts, _)     if ts >= 4             => TopicComplexity::High,
    (wc, ts, _)    if wc > 8 || ts >= 1   => TopicComplexity::Normal,
    _                                      => TopicComplexity::Low,
}
```

| Conditions | Result |
|---|---|
| word_count > 40 AND score ≥ 8 AND multi-requirement | **Extreme** |
| word_count > 30 AND score ≥ 5 | **VeryHigh** |
| score ≥ 8 (any length) | **VeryHigh** |
| word_count > 15 AND score ≥ 3 AND multi-requirement | **High** |
| score ≥ 4 (any length) | **High** |
| word_count > 8 OR score ≥ 1 | **Normal** |
| Everything else (very short, no signals) | **Low** |

## Scene Budget Derivation

Each complexity level defines three values per tier:

- **Target scenes** (`base_scene_count`): the default scene count the system aims for
- **Hard max** (`hard_max_scenes`): absolute upper bound — scenes beyond this are truncated pre-generation
- **Extra scene allowance** (`extra_scene_allowance`): additional scenes available **only with user consent** (see [Extra Scene Pricing](#52-extra-scene-pricing))

### Per-Tier Scene Budgets

**Basic (base = 5):**

| Complexity | Target | Hard Max | Extra Allowance |
|---|---|---|---|
| Low | 3 | 5 | 0 |
| Normal | 5 | 5 | 0 |
| High | 6 | 7 | +1 |
| VeryHigh | 7 | 9 | +2 |
| Extreme | 8 | 10 | +3 |

**Standard (base = 8):**

| Complexity | Target | Hard Max | Extra Allowance |
|---|---|---|---|
| Low | 6 | 8 | 0 |
| Normal | 8 | 8 | 0 |
| High | 9 | 12 | +1 |
| VeryHigh | 10 | 14 | +2 |
| Extreme | 11 | 16 | +3 |

**Premium (base = 15):**

| Complexity | Target | Hard Max | Extra Allowance |
|---|---|---|---|
| Low | 13 | 15 | 0 |
| Normal | 15 | 15 | 0 |
| High | 16 | 21 | +1 |
| VeryHigh | 17 | 26 | +2 |
| Extreme | 18 | 30 | +3 |

### Scene Count Arithmetic (with consent)

When the user consents to extra scenes, the effective target becomes:

```
effective_target = min(target_scenes + extra_allowance, hard_max_scenes)
```

This ensures the upper bound is never exceeded, even with consent granted.

---

# 5.2 Extra Scene Pricing

Extra scenes (beyond the target count) are priced at a **reduced margin (~55%)** compared to the base lesson margin (~65%). This makes extra scenes ~22% cheaper per scene than the base per-scene rate.

## Formula

```rust
// In billing.rs
pub fn extra_scene_credits(
    quality: QualityMode,
    learning: LearningMode,
    target_scenes: usize,
    extra_count: usize,
) -> f64 {
    let base_credits = lesson_credits_fixed(quality, learning);
    if target_scenes == 0 { return 0.0; }
    let per_scene_cost = base_credits / target_scenes as f64;
    // 0.78 = (1 - 0.55) / (1 - 0.65) = reduced margin ratio
    let extra_cost_per_scene = per_scene_cost * 0.78;
    max(0.1 * extra_count as f64, extra_cost_per_scene * extra_count as f64)
}
```

The factor **0.78** comes from the margin ratio:

```
(1 - 0.55)       0.45
----------   =   ----   =   0.78
(1 - 0.65)       0.35
```

A floor of 0.1 credits per extra scene prevents sub-cent pricing for very cheap tiers.

## Extra Credit Cost by Tier, Complexity, and Learning Mode

### Basic Extra Costs

| Learning Mode | High (+1) | VeryHigh (+2) | Extreme (+3) |
|---|---|---|---|
| Revision (1.2) | +0.16 | +0.27 | +0.35 |
| Explain (2.0) | +0.26 | +0.45 | +0.59 |
| Exam (3.0) | +0.39 | +0.67 | +0.88 |
| PlacementPrep (4.0) | +0.52 | +0.89 | +1.17 |

### Standard Extra Costs

| Learning Mode | High (+1) | VeryHigh (+2) | Extreme (+3) |
|---|---|---|---|
| Revision (2.0) | +0.17 | +0.31 | +0.43 |
| Explain (4.0) | +0.35 | +0.62 | +0.85 |
| Exam (5.0) | +0.43 | +0.78 | +1.06 |
| PlacementPrep (6.0) | +0.52 | +0.94 | +1.28 |

### Premium Extra Costs

| Learning Mode | High (+1) | VeryHigh (+2) | Extreme (+3) |
|---|---|---|---|
| Revision (3.5) | +0.17 | +0.32 | +0.46 |
| Explain (6.0) | +0.29 | +0.55 | +0.78 |
| Exam (7.0) | +0.34 | +0.64 | +0.91 |
| PlacementPrep (9.0) | +0.44 | +0.83 | +1.17 |

## Consent Flow

1. **Preview request** — Client calls `POST /api/lessons/preview` before generation. Returns scene budget, base credits, extra credits (if applicable).
2. **Consent modal** — If `extra_allowance > 0`, frontend shows a consent dialog listing the additional scenes and credit cost.
3. **Generation** — If user consents, `extra_scenes_consented: true` is sent in the generation payload. Pipeline computes `effective_target = min(target + allowance, hard_max)`.
4. **No consent** — Lesson generates with `target_scenes` only. No extra scenes.
5. **Trusted re-use** — The consent decision is stored per-generation request, not as a persistent user preference. Each lesson with extra scenes requires fresh consent.

The preview endpoint is **deterministic** — no LLM calls, pure computation from tier + complexity + learning mode.

---

# 6. Voice Consumption Economics

Voice is a sticky feature that significantly increases perceived value. The goal is for voice to feel almost unlimited while keeping costs bounded through concise generation.

Voice is charged separately from lesson credits.

## Voice Credit Rates

| Feature | Tier | Credits per minute |
|---|---|---|
| TTS | Basic / Standard | 0.02 |
| TTS | Premium | 0.08 |
| ASR | All tiers | 0.01 |

### Why Premium TTS costs more

Premium TTS uses ElevenLabs `eleven_multilingual_v2` which is charged per character ($0.0002/char). At average speaking rate (~900 chars/min), this costs ~$0.18/min in provider fees. Basic/Standard TTS uses Kokoro-82m which is currently free via OpenRouter.

### Voice Generation Principles

- Voice guidance should be CONCISE. Not full slide narration.
- Slides contain information density (text, diagrams, code).
- Voice contains navigation guidance and explanatory highlights.
- Target voice duration: 30-60 seconds per scene, not the full reading time.
- This keeps voice costs at 10-20% of total lesson cost, not 80%.

### Usage Example

A Standard Explain lesson with 6 scenes, 45 seconds of TTS per scene:
```
6 scenes x 0.75 min x 0.02 credits/min
= 0.09 credits for TTS

ASR (student speaking answers):
~2 minutes student speech x 0.01 credits/min
= 0.02 credits for ASR

Total voice: ~0.11 credits per lesson session
```

---

# 7. PDF Cost Model

PDF parsing is an optional enrichment feature, not a core generation path.

## Strategy

1. **Text extraction first** -- attempt direct text extraction. Zero provider cost.
2. **Vision-based parsing** -- if text extraction yields <50% coverage, use Gemini Flash vision. Low cost.
3. **OCR confidence escalation** -- if layout is complex, use higher-resolution passes. Capped.

The goal is zero provider cost for 80%+ of PDFs. Most educational PDFs contain extractable text.

## Included Uploads Per Plan

| Plan | Included PDF uploads (per month) |
|---|---|
| Free | 0-1 |
| Starter | 5 |
| Pro | 25 |
| Power | 100 |

## Cost Recovery

Extra pages beyond plan limits are billed at the recommended rate:

```
0.03 - 0.05 credits per page
```

### Rationale

The `pdf_credits()` function in code computes `1.0 + (pages * 0.20)` as the actual provider cost estimate. The 0.03-0.05/page charge recovers this cost while keeping pricing accessible. At 0.05 credits/page and 1 credit = $0.005 provider cost, a 20-page PDF costs:
```
20 pages x 0.05 credits = 1.0 credit
Provider cost estimate: $0.005 (breaks even or slight profit)
```

---

# 8. Search / Tavily Economics

Search enrichment is optional and only activated for specific use cases:
- Fact-heavy lesson topics requiring verification
- Placement prep with industry-specific questions
- Enrichment of sparse curriculum topics
- Current events or rapidly-changing subject matter

## Constraints

- Search is limited to 1-2 queries per lesson generation.
- Each query is constrained to max 5 results (env: `AI_TUTOR_WEB_SEARCH_MAX_RESULTS=5`).
- Tavily cost is ~$0.50 per 1000 queries (developer tier).
- Search budget per lesson: ~$0.001 max.

Search costs are absorbed into the lesson credit cost and not billed separately. Uncontrolled query explosions are prevented by the fixed query budget per generation.

---

# 9. Plan Pricing (USD)

All pricing in USD. Regional pricing (INR) exists separately in the billing catalog with GST applied.

## Monthly Plans

| Plan | Price (USD/mo) | Credits | Est. Credits/cent | Cost per credit |
|---|---|---|---|---|
| Free | $0.00 | 20 | — | — |
| Starter | $5.99 | 180 | 30.1 | $0.033 |
| Pro | $11.99 | 650 | 54.2 | $0.018 |
| Power | $34.99 | 1800 | 51.4 | $0.019 |

## Credit Bundle Top-Ups

| Bundle | Price | Credits | Cost per credit |
|---|---|---|---|
| Small (150) | $2.00 | 150 | $0.013 |
| Best Value (500) | $5.00 | 500 | $0.010 |

## Pricing Psychology

Pricing is intentionally generous relative to provider costs:
- Starter pricing is near cost-recovery -- it builds habit and demonstrates value.
- Pro pricing is the margin engine -- highest volume, best unit economics.
- Power pricing provides headroom for heavy users without requiring usage-based billing.
- Bundles provide low-friction top-ups for Free/Starter users who hit limits.

Upgrade path: Free (taste) -> Starter (habit) -> Pro (value) -> Power (unlimited).

---

# 10. Estimated Lesson Capacity

Average lesson credit cost across all modes and tiers (base scenes only): ~3.5 credits. With extra scenes consented, averages shift +0.1–0.5 credits depending on complexity.

## Monthly Lesson Estimates (base scenes only)

| Plan | Credits | Est. Lessons (avg) | Range (min-max) |
|---|---|---|---|
| Free | 20 | ~5 | 2-16 |
| Starter | 180 | ~50 | 20-150 |
| Pro | 650 | ~185 | 72-540 |
| Power | 1800 | ~515 | 200-1500 |

### Calculation

- Low end: Premium PlacementPrep (9 credits/lesson, 13 scenes)
- High end: Basic Revision (1.2 credits/lesson, 3 scenes)
- Average: Standard Explain (4 credits/lesson) weighted by expected mode distribution

### With Extra Scenes

If a student consistently consents to extra scenes at the Extreme complexity level:

| Plan | Base lessons | With extras (max) | Credit overhead |
|---|---|---|---|
| Free (20cr) | ~5 | ~4 (Explain Basic + Extreme = 5.9cr) | +0.59cr/lesson |
| Starter (180cr) | ~50 | ~38 (Explain Std + Extreme = 4.85cr) | +0.85cr/lesson |
| Pro (650cr) | ~185 | ~155 | +0.85cr/lesson avg |

Extra scenes reduce lesson count by 15–24% at Extreme complexity. Most lessons are Normal complexity (no extra allowance), so real-world impact is lower.

Real usage varies significantly by learning style. A student doing only Premium PlacementPrep will consume credits 7.5x faster than one doing only Basic Revision.

---

# 11. Burn-Rate Protection Rules

The following protections are enforced at the framework level to prevent margin erosion:

| Rule | Enforcement | Location |
|---|---|---|---|
| Hard scene caps | Generation budget per tier | `routing_rules.rs` + `complexity.rs` |
| Scene budget enforcement | Two-phase outline reduction: priority truncation + similarity merging | `orchestrator/src/pipeline.rs` |
| Interaction limits | Max per scene | `routing_rules.rs` + `complexity.rs` |
| Token budgets | Per scene and per response | `routing_rules.rs` |
| Prompt constraints | Deliberately concise prompts + budget block in system prompt | `orchestrator/src/generation.rs` |
| Validation layer | Post-generation schema validation | `orchestrator/src/validation.rs` |
| Cost guard (outline-level) | Pre-generation cost check against outlines | `orchestrator/src/cost_guard.rs` |
| Cost guard (per-scene) | Cumulative cost tracking per scene, denies when over budget | `orchestrator/src/cost_guard.rs` |
| Extra scene consent gate | Preview → consent → generate; no auto-charge | `api/src/app.rs` + frontend |

## Rules

1. **No unlimited generation.** Every lesson has a hard budget enforced before any API call.
2. **No full regeneration.** When a fix-in-place is possible (e.g., regenerate one scene), the system does not regenerate the entire lesson.
3. **No unbounded retries.** Retry policy: max 2 attempts, 30s timeout.
4. **No unbounded voice.** Voice generation length is derived from scene text content, not free-form.
5. **No unbounded search.** Max 1-2 queries per lesson, 5 results per query.

### Scene Budget Enforcement (Two-Phase Reduction)

When the LLM generates more outlines than the hard max permits, the pipeline applies two-phase reduction in `orchestrator/src/pipeline.rs`:

**Phase 1 — Priority-aware truncation:** Outlines beyond the hard max are dropped from the end of the list. This preserves the introduction and early scenes (highest educational value) while cutting later content first.

**Phase 2 — Similarity merging:** If the remaining outlines still exceed the target scene count, `merge_similar_outlines()` merges adjacent outlines that share key-point word overlap into a single scene. Unmergeable excess scenes are dropped (lowest priority first). This is a last-resort fallback — it is false-positive safe (merging unrelated content is preferable to data loss).

### Cost Guard (`orchestrator/src/cost_guard.rs`)

Two independent enforcement points:

1. **Outline-level check** — Before scene generation begins, all outlines' estimated token cost is checked against `max_cost_usd_per_request`. If exceeded, the entire generation is denied with `CostDecision::Deny`. This is a coarse pre-filter.

2. **Per-scene cumulative tracker** — A `BudgetTracker` records each generated scene's estimated cost. When cumulative cost exceeds `max_cost_usd_per_request`, the scene is denied. This catches edge cases where the LLM produces verbose output beyond the outline estimates.

The `cost_per_token` function uses tier-specific pricing:
- **Basic:** $0.40 per 1M tokens (Gemini Flash rate)
- **Standard:** $0.70 per 1M tokens (DeepSeek V3 rate)
- **Premium:** $9.00 per 1M tokens (Claude Sonnet rate)

This ensures cost enforcement is proportional to actual provider burn rate across tiers.

These rules protect margins by ensuring that every dollar of provider cost maps to a fixed upper bound of educational value. They also protect quality -- constrained generation produces denser, more focused lessons.

---

# 12. Future Optimization Roadmap

| Initiative | Expected Impact | Priority |
|---|---|---|
| **Telemetry-driven routing** -- route to cheapest model that meets quality bar based on historical success rates | 15-25% cost reduction | High |
| **Provider benchmarking** -- periodic automated benchmarking of model quality/cost against a standardized lesson corpus | Better model selection data | Medium |
| **Smarter overrides** -- per-account, per-subject model overrides via env or admin API | Targeted optimization | Medium |
| **Cost-aware routing** -- dynamic model selection based on real-time provider pricing and latency | 5-15% cost reduction | Low |
| **Adaptive lesson budgeting** -- adjust scene count and depth based on user engagement patterns | Better margin per lesson | Low |
| **Prompt compression** -- shorter prompts through template optimization and context pruning | 10-20% token reduction | High |
| **Caching layer** -- cache common lesson structures, outlines, and search results | Recurring savings | Medium |

---

# 13. Versioning

```
Version: v2
Status: Internal
Owner: AI Tutor Backend
Last updated: 2026-05-20

## Changelog

- **v2** — 2026-05-20: Added scene budget matrix (5-level complexity × 3 tiers), extra scene pricing and consent flow, cost guard enforcement (outline + per-scene), two-phase outline reduction (priority truncation + similarity merging).
- **v1** — 2026-05-20: Initial cost model document.
```

This document is the single source of truth for AI cost and credit economics. All pricing changes, model swaps, or margin adjustments must update this document atomically with the code change.
