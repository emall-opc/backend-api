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

CMD ["sh", "-c", "./node_modules/.bin/medusa db:migrate && node /app/packages/cli/dist/index.js start"]
