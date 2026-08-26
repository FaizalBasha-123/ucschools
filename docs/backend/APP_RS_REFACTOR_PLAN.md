# Refactor Plan: Decompose `crates/api/src/app.rs`

> Status: PLAN ONLY — no code changes yet. Execute only with explicit approval.
> Last verified against source: 2026-08-25
> Source: `AI-Tutor-Backend/crates/api/src/app.rs` (713 KB, 18,957 lines)

## Why

`app.rs` is a 18,957-line, 713 KB megafile: 138 structs/enums, 253 named
functions, 491 async fns, 65 inline tests. It mixes five distinct concerns in
one flat file, which makes navigation, targeted edits, and test isolation
painful. The build graph and behavior are correct; the problem is purely
maintainability and agent navigability.

This plan decomposes it into focused submodules **without changing any
behavior or public API**. `build_router_with_auth` stays the single route
table; it just imports handlers from modules instead of defining them inline.

## Verified structural map (the basis for the split)

Line ranges are approximate but measured from the real file:

| Region | Lines | What's there | Count |
|--------|-------|--------------|-------|
| Core types + auth config | 1–204 | `AppState`, `AuthenticatedAccountContext`, `ApiRole`, `ApiAuthConfig`, role parsing, CORS | ~10 types |
| Auth + role helpers | 205–404 | `parse_api_role`, `build_cors_layer`, `session_auth_required`, `required_role_for_request`, `parse_bearer_token`, `request_is_https` | 6 fns |
| `auth_middleware` | 405–563 | the axum middleware (account context, operator cookie, HTTPS gate, role check, CSRF) | 1 fn (~160 lines) |
| **DTO structs/enums** | 564–1673 | request/response payloads: `GenerateLessonPayload`, `GoogleAuth*`, `Operator*`, `School*`, `Billing*`, `Credit*`, `PaymentOrder*`, `Easebuzz*`, `PblRuntime*`, `AuthSession*`, etc. | **~110 types** |
| `LessonAppService` trait | 1674–1803+ | the service interface the handlers call through (impl lives in `main.rs` as `LiveLessonAppService`) | 1 trait (~60 methods) |
| PBL runtime agents + prompts | ~7800–8071 | `resolve_pbl_runtime_agent`, `build_role/question/judge_agent`, `build_pbl_runtime_system_prompt`, `progress_pbl_workspace`, etc. | ~10 fns |
| **`build_router` / `build_router_with_auth`** | 8072–8198 | THE route table — single seam registering every handler | 2 fns |
| `add_security_headers` | 8199–8240 | security header middleware | 1 fn |
| HTTP handlers | 8257–12969 | auth/google/phone, operator otp, billing/checkout/webhooks/invoices/topup, credits, operator stats/admin/emails/schools, lesson generate/preview/shelf/jobs, runtime/pbl-chat/transcribe, lesson get/export/grade/events, asset serving | ~90 fns |
| Helpers (billing math, easebuzz/stripe, credit estimation, token issue/verify, ops gate) | interleaved 11004–12969 | `easebuzz_*`, `sha512_hex`, `issue_*_token`, `verify_jwt_with_jwks`, `calculate_credit_usage`, `derive_ops_gate`, `parse_provider_type`, etc. | ~60 fns |
| **Inline test module** | 13004–18957 | `#[cfg(test)] mod tests` — 65 tests + fixtures | ~5,950 lines (31% of file) |

Key coupling facts:
- `build_router_with_auth` references every handler by bare name → handlers
  must be in scope where the router lives (via `use` or same module).
- Handlers reference DTO structs and `LessonAppService` trait methods →
  DTOs and the trait must be visible to handler modules.
- `auth_middleware` + helpers reference `ApiAuthConfig`, `ApiRole`,
  `AuthenticatedAccountContext`, `AppState` → these core types are shared.
- `LiveLessonAppService` (in `main.rs`) implements `LessonAppService` and is
  constructed there; the trait stays in the api crate.

## Target module structure

```
crates/api/src/
├── app.rs                  ← SHRUNK: build_router, build_router_with_auth,
│                             AppState, add_security_headers, mod decls, re-exports
├── state.rs                ← LessonAppService trait (moved from app.rs)
├── auth/
│   ├── mod.rs              ← pub use; ApiAuthConfig, ApiRole, AuthenticatedAccountContext,
│   │                         parse_api_role, required_role_for_request, session_auth_required
│   ├── middleware.rs       ← auth_middleware, add_security_headers, request_is_https,
│   │                         parse_bearer_token, parse_cookie
│   ├── tokens.rs           ← issue/verify session+partial+state tokens, JWT/JWKS, refresh,
│   │                         sha256_hex, cookie builders, TTLs
│   └── operator_otp.rs     ← operator OTP challenge/session, rate limit, lockout, Redis keys
├── dto.rs (or dto/)        ← the ~110 request/response structs (pure data, no logic)
├── pbl_runtime.rs          ← resolve_pbl_runtime_agent, build_*_agent,
│                             build_pbl_runtime_system_prompt, progress_pbl_workspace
├── handlers/
│   ├── mod.rs              ← pub use of all handler submodules
│   ├── auth.rs             ← google_login/callback/onetap, bind_phone, refresh_session_token
│   ├── operator.rs         ← operator otp, logout, settings, emails, jobs, audit, maintenance
│   ├── billing.rs          ← catalog, checkout, orders, dashboard, report, webhooks,
│   │                         invoices/pdf, topup, revenue-timeseries, subscriptions
│   ├── credits.rs          ← balance, ledger, redeem, debit
│   ├── schools.rs          ← list/create/members/assign/bulk/invoices, contact-enterprise
│   ├── lessons.rs          ← generate, generate-async, generate-stream, preview, shelf CRUD,
│   │                         jobs cancel/resume, get_job, get_lesson
│   ├── runtime.rs          ← pbl chat/chat-stream, transcribe, ack action, stream events,
│   │                         whiteboard doubt start/followup/stop
│   ├── assets.rs           ← get_audio_asset, get_media_asset, content-type helpers
│   ├── export.rs           ← export_lesson_html, export_lesson_video, html render, sse builder
│   └── system.rs           ← health, system/status, db-ready, ops-gate, system metrics
├── helpers/
│   ├── mod.rs
│   ├── billing.rs          ← easebuzz config/hash/verify, stripe enabled, payment_order mapping,
│   │                         billing windows, timezone, product kind/amount
│   ├── credits.rs          ← calculate_credit_usage, estimate_generation_credits,
│   │                         min_generation_credits, count_scene_images, has_tts_audio
│   ├── runtime.rs          ← map_provider_runtime_status, aggregate, derive_runtime_alerts,
│   │                         streaming selectors, ops gate derivation
│   └── env.rs              ← env_i64, read_csv_env, redis_url_from_env, queue_poll_ms,
│                             asset_backend_label, parse_provider_type
└── tests/
    └── app_tests.rs        ← the 65-test module moved out (kept #[cfg(test)])
```

`app.rs` after split: ~200 lines (router + state + module decls + re-exports).

## Execution phases (each phase ends with `cargo build` + `cargo test`)

### Phase 0 — Safety prep (no code moves)
1. Confirm clean `cargo build --release -p ai_tutor_api` + `cargo test -p ai_tutor_api` baseline.
2. Record the route table verbatim (lines 8076–8198) as the contract that must
   not change.
3. Decide `dto.rs` vs `dto/`: 110 flat structs fit one file; split only if a
   clear domain grouping is wanted. Recommend single `dto.rs` first.

### Phase 1 — Extract DTOs (lowest risk, highest payoff)
- Move the ~110 structs/enums (lines 564–1673) into `dto.rs`.
- Add `mod dto; pub use dto::*;` in `app.rs`.
- `cargo build` — expect zero behavior change; fix any `pub` visibility gaps.
- `cargo test` — all 65 tests still pass (they reference DTOs by name).

### Phase 2 — Extract `LessonAppService` trait into `state.rs`
- Move the trait (lines 1674–1803+) to `state.rs`.
- `app.rs`: `mod state; pub use state::LessonAppService;`.
- `main.rs` already imports `LiveLessonAppService` from `app` — re-export it
  or update the import to `ai_tutor_api::state::LessonAppService`. Keep
  `app::LiveLessonAppService` re-export for back-compat if main.rs relies on it.
- Build + test.

### Phase 3 — Extract auth into `auth/`
- Move `ApiAuthConfig`, `ApiRole`, `AuthenticatedAccountContext`,
  `parse_api_role`, `required_role_for_request`, `session_auth_required`,
  `build_cors_layer` → `auth/mod.rs`.
- Move `auth_middleware`, `add_security_headers`, `request_is_https`,
  `parse_bearer_token`, `parse_cookie` → `auth/middleware.rs`.
- Move token/JWT/cookie helpers → `auth/tokens.rs`.
- Move operator OTP challenge/session/Redis helpers → `auth/operator_otp.rs`.
- `app.rs` re-exports what the router and handlers need.
- Build + test. **Risk point:** `auth_middleware` is used by the router layer;
  ensure the `from_fn_with_state(auth, auth_middleware)` call still resolves.

### Phase 4 — Extract PBL runtime
- Move `resolve_pbl_runtime_agent`, `build_*_agent`,
  `build_pbl_runtime_system_prompt`, `progress_pbl_workspace`, and the PBL
  helper fns → `pbl_runtime.rs`.
- Build + test.

### Phase 5 — Extract handlers (the big one; do in sub-steps)
- Create `handlers/mod.rs` + submodules per the target tree.
- Move handlers in domain batches: auth → operator → billing → credits →
  schools → lessons → runtime → assets → export → system.
- After each batch: `cargo build` + `cargo test`.
- `build_router_with_auth` in `app.rs` switches from bare names to
  `handlers::auth::google_login` etc. (or `use handlers::*`).
- **Risk point:** handlers share helper fns (credit estimation, token issue,
  billing math). If a handler references a helper still in `app.rs`, either
  move the helper to `helpers/` first or re-export it. Recommend moving
  helpers BEFORE handlers (Phase 6 before Phase 5, or interleave).

### Phase 6 — Extract helpers into `helpers/`
- billing math, credits math, runtime status mapping, env readers → `helpers/*`.
- Build + test.

### Phase 7 — Extract tests
- Move the `#[cfg(test)] mod tests` block to `tests/app_tests.rs` (or keep as
  `#[cfg(test)] mod tests` in a new `app_tests.rs` included via
  `#[path = "tests/app_tests.rs"] mod tests;`).
- `cargo test` — all 65 must pass.

### Phase 8 — Final verification
- `cargo build --release -p ai_tutor_api` clean.
- `cargo test -p ai_tutor_api` 65/65 (or whatever the baseline count is).
- Diff the route table against Phase 0 record — must be byte-identical.
- Update `docs/backend/ARCHITECTURE.md` + `docs/TREE.md` to reflect new
  module structure; bump "Last verified" dates.

## Risks and how each is mitigated

| Risk | Mitigation |
|------|-----------|
| Broken `pub` visibility across modules | Each phase ends with `cargo build`; fix incrementally |
| `build_router_with_auth` loses a handler symbol | Keep route table in `app.rs`; use explicit `use handlers::...` not globs |
| Shared helpers referenced by both handlers and router | Move helpers to `helpers/` before handlers (or interleave) |
| `auth_middleware` state typing breaks | Phase 3 is the critical auth phase; run the 5 auth/RBAC/HTTPS tests first |
| Test fixtures reference moved types | Tests move last (Phase 7); they use the same `use` paths as production |
| `main.rs` import path changes | Re-export `LessonAppService` + `LiveLessonAppService` from `app` for back-compat |
| Behavior drift | Route table is the contract; byte-diff it in Phase 8. No logic changes, only moves. |

## What this is NOT
- Not a rewrite of any handler logic.
- Not a change to the HTTP surface, auth model, or `LessonAppService` contract.
- Not a test rewrite — tests move, they don't change.
- Not a reason to touch `main.rs` beyond possibly one import path (re-exported).

## Estimated effort
- Phase 1 (DTOs): ~30 min, low risk.
- Phase 2 (trait): ~10 min, low risk.
- Phase 3 (auth): ~1 hr, medium risk (the critical phase).
- Phase 4 (PBL): ~20 min, low risk.
- Phase 5 (handlers): ~2–3 hrs, medium risk (largest, but mechanical).
- Phase 6 (helpers): ~45 min, low risk.
- Phase 7 (tests): ~30 min, low risk.
- Phase 8 (verify + docs): ~30 min.

Total: ~5–6 hrs of focused work, each phase independently shippable.

## Decision needed before executing
- Confirm Phase 1 (DTOs) is a safe first step to validate the approach, or
  request a different phase order.
- Confirm `dto.rs` as a single file vs `dto/` subfolder (recommend single file
  first; split later if desired).
- Confirm whether to update `docs/` after each phase or only at Phase 8
  (recommend Phase 8 only, to avoid churn).
