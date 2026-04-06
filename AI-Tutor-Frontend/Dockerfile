FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN corepack enable && pnpm install --no-frozen-lockfile

COPY . .

EXPOSE 4040

CMD ["pnpm", "--filter", "ai-tutor-web", "exec", "next", "dev", "-H", "0.0.0.0", "-p", "4040"]