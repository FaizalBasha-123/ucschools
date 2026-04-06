# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache ca-certificates

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build with optimizations — use linux/amd64 for Render and most cloud providers
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o backend ./cmd/server/main.go

# Final stage - minimal image
FROM alpine:3.19

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apk add --no-cache ca-certificates wget

# Copy binary from builder
COPY --from=builder /app/backend .

# Copy SQL migrations (needed for tenant schema provisioning at runtime)
COPY --from=builder /app/migrations ./migrations

# Startup entrypoint script (optional pre-start migration)
COPY --from=builder /app/scripts/start.sh ./start.sh

# Copy static uploads (3D model GLBs, manifests, etc.)
COPY --from=builder /app/uploads ./uploads

# Non-root user for security
RUN adduser -D -g '' appuser && chmod +x /app/start.sh && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:${PORT:-8080}/health || exit 1

CMD ["./start.sh"]
