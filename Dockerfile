# syntax=docker/dockerfile:1
# Production image: kichik, root emas, migratsiya alohida (docker compose run --rm migrate).

# ---------- Backend: bog'liqliklar (dev ham — build va prisma CLI uchun) ----------
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

# ---------- Backend: TypeScript build ----------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- Migratsiya: qotirilgan prisma CLI (package-lock dagi versiya), internetsiz ----------
FROM deps AS migrate
ENV NODE_ENV=production
USER node
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]

# ---------- Faqat production bog'liqliklar (+ generatsiya qilingan Prisma client) ----------
FROM deps AS prod-deps
RUN npm prune --omit=dev

# ---------- Admin panel (React) ----------
FROM node:22-alpine AS admin
WORKDIR /admin
COPY admin/package*.json ./
RUN npm ci
COPY admin ./
RUN npm run build

# ---------- Runtime ----------
FROM node:22-alpine AS runtime
# tini — PID 1: SIGTERM ni node ga uzatadi (graceful shutdown), zombie jarayonlarni yig'adi
RUN apk add --no-cache openssl tini
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=deps /app/prisma ./prisma
COPY --chown=node:node --from=admin /admin/dist ./admin/dist
COPY --chown=node:node package.json ./
# Root emas: kod va fayllar o'zgartirilmaydi, faqat o'qiladi
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
