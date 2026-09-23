FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Admin panel (React) — Express uni /admin/dist dan beradi
FROM node:22-alpine AS admin
WORKDIR /admin
COPY admin/package*.json ./
RUN npm ci
COPY admin ./
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=admin /admin/dist ./admin/dist
COPY package.json ./
# prisma CLI prod bog'liqliklarda yo'q — migratsiya uchun npx orqali olinadi
CMD ["sh", "-c", "npx -y prisma@6 migrate deploy && node dist/index.js"]
