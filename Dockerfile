FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

RUN apk add --no-cache su-exec \
  && mkdir -p /app/data/uploads

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
