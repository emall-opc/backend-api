FROM oven/bun:1.3.11-alpine AS build

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile
RUN bun run build

FROM node:24-alpine AS runtime

WORKDIR /app

COPY --from=build /app /app

WORKDIR /app/apps/api

EXPOSE 9000

CMD ["sh", "-c", "./node_modules/.bin/medusa db:migrate && if [ -n \"$SEED_ADMIN_PASSWORD\" ] && [ -n \"$SEED_VENDOR_PASSWORD\" ]; then ./node_modules/.bin/medusa exec ./src/scripts/seed-accounts.ts; else echo 'Skipping account seed: SEED_ADMIN_PASSWORD and SEED_VENDOR_PASSWORD are required.'; fi && node /app/packages/cli/dist/index.js start"]
