FROM rust:1.87-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ crates/
COPY migrations/ migrations/
# Mitigate Render.com OOM errors during Rust compilation
ENV CARGO_BUILD_JOBS=1
ENV CARGO_PROFILE_RELEASE_LTO="false"
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=256
RUN cargo build --release -p ai_tutor_api --bin ai_tutor_api

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/ai_tutor_api /usr/local/bin/
EXPOSE 10000
ENV AI_TUTOR_API_HOST=0.0.0.0
ENV AI_TUTOR_API_PORT=10000
ENV AI_TUTOR_STORAGE_ROOT=/data
ENV AI_TUTOR_LOG_FORMAT=json
CMD ["ai_tutor_api"]
