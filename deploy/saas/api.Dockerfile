FROM node:24-bookworm-slim
WORKDIR /app
COPY apps/saas-api/ ./apps/saas-api/
COPY packages/saas/ ./packages/saas/
COPY packages/remix/ ./packages/remix/
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production SAAS_HOST=0.0.0.0 SAAS_PORT=4320 SAAS_DATA_ROOT=/data SAAS_SERVE_WEB=false
USER node
EXPOSE 4320
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4320/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/saas-api/server.mjs"]
