FROM rust:1.87-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ crates/
RUN cargo build --release --bin ai_tutor_api --bin queue_worker

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/ai_tutor_api /usr/local/bin/
COPY --from=builder /app/target/release/queue_worker /usr/local/bin/
EXPOSE 10000
ENV AI_TUTOR_API_HOST=0.0.0.0
ENV AI_TUTOR_API_PORT=10000
ENV AI_TUTOR_STORAGE_ROOT=/data
ENV AI_TUTOR_LOG_FORMAT=json
CMD ["ai_tutor_api"]
