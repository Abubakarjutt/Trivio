# syntax=docker/dockerfile:1

# ── Stage 1: install deps + build ─────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

RUN npx prisma generate

ARG NEXT_PUBLIC_APP_URL=https://app.trivio-ai.com
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

COPY . .
RUN npm run build

# ── Stage 2: lean production image ────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/server ./server
COPY --from=builder /app/lib ./lib

# Run as the built-in non-root `node` user (uid 1000). Storage is written at
# runtime (attachments), so it must be owned by that user.
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
