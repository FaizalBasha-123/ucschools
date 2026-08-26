# AI-Tutor Complete Tree Map

> Generated 2026-08-25 from `find` over the working tree.
> Excludes `node_modules/`, `.next/`, `target/`, `.git/`, `pnpm-lock.yaml`.
> Counts: backend 222 source/config/doc files; frontend ~400 (incl. assets).
> Use this as the orientation index before editing. Symbols live in
> `docs/backend/ARCHITECTURE.md` and `docs/frontend/ARCHITECTURE.md`.

Legend: `★` = entrypoint / load-bearing. `⚠` = scratch/orphaned (not in build).

## AI-Tutor-Backend (Rust workspace)

### Workspace root
```
AI-Tutor-Backend/
├── Cargo.toml                  ★ workspace: 10 crates, edition 2021
├── Cargo.lock
├── rust-toolchain.toml
├── Dockerfile                  ★ cargo-chef → debian:bookworm-slim; builds -p ai_tutor_api
├── render.yaml                ★ Render blueprint (free web + keyvalue)
├── model-overrides.json        routing model overrides (consumed by routing/overrides.rs)
├── scripts/migrate.sh
├── .dockerignore
├── README.md  QUICK_REFERENCE.md  DEPLOYMENT.md  ENVIRONMENT_VARIABLES.md
├── PEDAGOGY_ROUTING.md  PRODUCTION_*.md (7 sign-off/runbook docs)
└── docs/  (see Backend docs below)
```

### crates/ (the real code)
```
crates/api/src/                ★ HTTP server
  main.rs                      ★ bin entry; startup readiness; build_router
  lib.rs                       module decl + re-exports (billing_scheduler, invoice_renderer, payment_gateway)
  app.rs                       ★ MEGAFILE (18,957 lines): router + auth + 110 DTOs +
                               LessonAppService trait + PBL agents + ~90 handlers + 65 tests.
                               Decomposition plan: docs/backend/APP_RS_REFACTOR_PLAN.md (not executed)
  llm_proxy.rs                 ★ /api/generate/{llm,llm/stream,profiles} router
  queue.rs queue_postgres.rs queue_redis.rs   LessonQueue (PG + Redis backends)
  billing_catalog.rs billing_event_queue.rs billing_processor.rs
  billing_scheduler.rs subscription_scheduler.rs   credit/invoice/subscription/dunning
  payment_gateway.rs           resolve_payment_gateway
  invoice_renderer.rs invoice_template.typ     Typst invoice PDF
  notifications.rs             email notifications
  redis_balance_cache.rs redis_storage.rs     Redis balance + runtime session
  telemetry.rs telemetry_provider.rs          usage events + per-provider usage
  alerting.rs cleanup.rs env_helpers.rs startup_readiness.rs tools.rs
  tests/ e2e_verification.rs  oauth_e2e_stability.rs
  lib.rs.backup                ⚠ backup
crates/api/templates/         cost_alert.html grace_period_warning.html operator_otp.html
                               payment_failed.html payment_success.html service_restricted.html

crates/common/src/             error.rs ids.rs lib.rs
crates/domain/src/             ★ pure types: action auth billing billing_entities credits gateway
                               generation job lesson lesson_adaptive lesson_shelf lib provider
                               routing runtime scene school wallet
crates/gateway/src/            main.rs  (alternate binary; not in default Docker build — confirm role)
crates/media/src/              lib.rs storage.rs (LocalFileAssetStore, R2AssetStore, DynAssetStore)
                               pdf_processor.rs tasks.rs (media/tts collect+apply+persist)
crates/orchestrator/src/       ★ generation pipeline + live director
  lib.rs engine.rs pipeline.rs (★ LessonGenerationOrchestrator)
  generation/ actions agents dtos helpers interactive outlines project quiz slide tests mod.rs
                actions_validation.patch ⚠
  prompts.rs prompts_generated.rs prompt_builder.rs
  prompts/ index.ts loader.ts types.ts README.md build_prompts.sh
            snippets/ (11 .md: action/element/image/json-output/media/speech/video/whiteboard)
            templates/ (20+ .md: agent-system*, code/diagram/game/interactive/pbl/quiz/slide/
                        simulation/task-engine/visualization3d/web-search/widget-teacher content+actions)
  graph.rs workflow.rs planner.rs router.rs placement.rs context.rs complexity.rs
  cost_guard.rs state.rs validator.rs response_parser.rs telemetry.rs
  live_director.rs whiteboard_doubt.rs
crates/providers/src/          ★ AI provider impls behind traits
  traits.rs (★ LlmProvider/TtsProvider/AsrProvider/ImageProvider/VideoProvider + streaming)
  factory.rs (Default*ProviderFactory) config.rs request_params.rs
  openai.rs anthropic.rs google.rs openrouter.rs elevenlabs.rs whisper.rs
  resilient.rs (retry/circuit breaker) resolve.rs registry.rs
crates/routing/src/            model_router.rs capabilities.rs model_registry.rs
                               routing_rules.rs provider_strategy.rs overrides.rs operator_emails.rs
crates/runtime/src/            session.rs (lesson_playback_events, PlaybackEvent, TutorStreamEvent)
                               whiteboard.rs (WhiteboardDoubtSession)
crates/storage/src/            repositories.rs (★ traits) filesystem.rs (★ PG impl + embedded schema, ~5407 lines)
                               postgres.rs (sqlx PgStorage subset) lib.rs
                               filesystem.rs.cleanup.py ⚠
```

### Backend data & migrations
```
data/ runtime.db queue.db backup-drill-seed.txt        dev-only local DBs
data-drill/ backup-20260415-021756/ restore-20260415-021756/   backup drill artifacts
migrations/ 20260613000000_initial.sql 20260613000001_queue.sql   ⚠ PARTIAL (real schema in filesystem.rs)
```

### Backend docs
```
docs/ AI_COST_MODEL.md DATABASE_SCHEMA.md (★ authoritative schema, 23 tables)
      model-selection-plan.md OPERATOR_GATEWAY_ROLLOUT.md production-ops-runbook.md
      system-design.md runbooks/ backup-restore-failure.md deploy-queue-worker.md nginx-pingora-gateway.conf
```

### Backend scratch/orphaned (⚠ NOT in build graph — do not assume they run)
```
fix_*.py (30)  patch*.py (20)  render_latex.py  rewrite_map.py
test.rs test_serde.rs katex_test.rs  libnull.rlib
```

---

## AI-Tutor-Frontend (pnpm monorepo)

### Workspace root
```
AI-Tutor-Frontend/
├── package.json             ★ root scripts; pnpm@10.28.0
├── pnpm-workspace.yaml      packages: apps/* packages/*
├── pnpm-lock.yaml           (excluded from this map)
├── tsconfig.json tsconfig.tsbuildinfo
├── vercel.json              ★ framework nextjs; build pnpm build; out apps/web/.next
├── Dockerfile               node:20; runs next dev :4040 (dev image)
├── components.json .dockerignore README.md
├── fix.js replace_colors.js replace_slate.py replace_slate_all.py   ⚠ one-off style scripts
└── scripts/ fix-shadowing.mjs migrate-backend-url.mjs migrate-backend-url-phase2.mjs   ⚠ migration scripts
```

### apps/web (Next.js 16 app)
```
apps/web/
├── package.json next.config.ts tsconfig.json
├── next-env.d.ts eslint.config.mjs postcss.config.mjs vitest.config.ts components.json
├── app/
│   ├── layout.tsx            ★ Theme › I18n › Credits › DbStatus › ServerProvidersInit
│   ├── page.tsx              landing
│   ├── globals.css favicon.ico apple-icon.png
│   ├── classroom/page.tsx    ★ dashboard (shelf + generator)
│   ├── lessons/[id]/page.tsx classroom/lesson runtime
│   ├── generation-preview/   layout.tsx page.tsx types.ts components/visualizers.tsx
│   ├── operator/             page.tsx login/ billing/ health/ jobs/ promo/ schools/ settings/ users/
│   ├── billing/              page.tsx invoices/ payment/ topup/[token]/
│   ├── pricing/ check-billing/ auth/ (callback, page, verify-phone)
│   └── api/                  83 route.ts (see frontend ARCHITECTURE.md for full list)
│        auth/ azure-voices/ billing/ chat/ classroom-media/ credits/ generate/ generate-classroom/
│        health/ internal/ lesson-shelf/ lessons/ operator/ parse-pdf/ pbl/ proxy-media/
│        quiz-grade/ server-providers/ subscriptions/ system/ transcription/ verify-*-provider/
├── components/               (see frontend ARCHITECTURE.md)
│   ai-elements/ (30) audio/ auth/ canvas/ chat/ classroom/ generation/ landing/ layout/
│   lesson/ roundtable/ scene-renderers/ (+pbl/) settings/ slide-renderer/Editor/ +components/element/
│   stage/ (+scene-renderer, scene-sidebar) whiteboard/ ui/ (shadcn) + top-level stage.tsx header.tsx etc.
├── lib/                      (see frontend ARCHITECTURE.md)
│   action/ ai/ api/ audio/ auth/ buffer/ chat/ constants/ contexts/ export/ hooks/ i18n/
│   lesson/ logger.ts media/ orchestration/ pbl/ pdf/ playback/ prosemirror/ server/ storage/
│   store/ types/ utils/
├── configs/                  animation chart element font hotkey image-clip latex lines mime
│                             shapes storage symbol theme
├── assets/ public/ (avatars/, logos/) community/feishu.md skills/openmaic/ (SKILL.md + references/)
```

### packages/ (workspace libs)
```
packages/ui/        src/index.tsx package.json README.md          (@ai-tutor/ui re-export hub)
packages/types/     src/index.ts package.json README.md           (@ai-tutor/types hub)
packages/mathml2omml/ src/ (mathml/*, ooml/*, parse-stringify/*, walker.js, helpers.js, index.*)
                      rollup.config.js package.json LICENSE .gitignore
packages/pptxgenjs/  src/ (pptxgen, slide, gen-xml/objects/charts/tables/media/utils, core-enums/interfaces)
                     types/index.d.ts rollup.config.mjs tsconfig.json package.json .gitignore
```

## Cross-cutting navigation (where does X live?)

| You want to... | Go to |
|---|---|
| Add a backend HTTP route | `crates/api/src/app.rs` `build_router` + role table |
| Change a domain type | `crates/domain/src/<module>.rs` (shared vocabulary) |
| Alter generation phases | `crates/orchestrator/src/pipeline.rs` + `generation/` |
| Swap/add an LLM provider | `crates/providers/src/` impl + `factory.rs` + `routing/` |
| Change a DB table | `crates/storage/src/filesystem.rs` embedded migration + `docs/DATABASE_SCHEMA.md` |
| Add a frontend page | `apps/web/app/<route>/page.tsx` |
| Add a frontend API route | `apps/web/app/api/<route>/route.ts` (check if it proxies backend) |
| Edit Stage/Scene model | `apps/web/lib/types/stage.ts` + `lib/api/stage-api-*.ts` |
| Add a Zustand store | `apps/web/lib/store/` + export from `lib/store/index.ts` |
| Change a slide element | `apps/web/components/slide-renderer/components/element/<X>Element/` |
| Add a scene renderer | `apps/web/components/scene-renderers/` |
| Edit PBL MCP | `apps/web/lib/pbl/mcp/` |
| Export to PPTX | `apps/web/lib/export/use-export-pptx.ts` + `packages/pptxgenjs/` |
| Convert math | `packages/mathml2omml/` + `lib/export/latex-to-omml.ts` |
