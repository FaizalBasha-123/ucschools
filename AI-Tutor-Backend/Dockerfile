# 1. Dependency Recipe Stage
FROM rust:bookworm AS chef
USER root
RUN cargo install cargo-chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# 2. Dependency Caching Stage
FROM chef AS builder
WORKDIR /app
COPY --from=planner /app/recipe.json recipe.json
# Mitigate Render.com OOM errors during Rust compilation, but cache deps
ENV CARGO_BUILD_JOBS=1
ENV CARGO_PROFILE_RELEASE_LTO="false"
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=256
# Build dependencies - this is the cached layer!
RUN cargo chef cook --release --recipe-path recipe.json

# 3. Source Build Stage
COPY . .
RUN cargo build --release -p ai_tutor_api --bin ai_tutor_api

# 4. Runtime Stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/ai_tutor_api /usr/local/bin/
EXPOSE 10000
ENV AI_TUTOR_API_HOST=0.0.0.0
ENV AI_TUTOR_API_PORT=10000
ENV AI_TUTOR_STORAGE_ROOT=/data
ENV AI_TUTOR_LOG_FORMAT=json
CMD ["ai_tutor_api"]
