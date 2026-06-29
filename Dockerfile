# syntax=docker/dockerfile:1
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
# VITE_* vars are inlined into the bundle at build time, so they must be passed
# as build args (the runtime env_file does NOT affect them).
ARG VITE_API_BASE_URL=""
ARG VITE_ENABLE_PASSWORD_AUTH=""
ARG VITE_ORG=""
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_ENABLE_PASSWORD_AUTH=$VITE_ENABLE_PASSWORD_AUTH \
    VITE_ORG=$VITE_ORG \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production TZ=UTC
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
# The server reuses the shared validation-rules catalog from src/lib.
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
EXPOSE 3001
CMD ["bun", "run", "start"]
