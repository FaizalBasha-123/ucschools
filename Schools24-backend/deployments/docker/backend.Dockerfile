# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o backend ./cmd/server/main.go

# Final stage
FROM alpine:3.19

WORKDIR /app

COPY --from=builder /app/backend .

EXPOSE 8081

CMD ["./backend"]
