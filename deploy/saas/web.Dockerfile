FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY scripts/build-saas-web.mjs ./scripts/
COPY apps/saas-web/ ./apps/saas-web/
COPY apps/web/ ./apps/web/
RUN node scripts/build-saas-web.mjs
FROM caddy:2-alpine
COPY --from=build /app/dist/saas-web/ /srv/
COPY deploy/saas/Caddyfile /etc/caddy/Caddyfile
