FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ai-agent.js sales-records.js doc-parser.js release-notice.js CHANGELOG.md ./
COPY db ./db
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV NODE_ENV=production PORT=4173 FTW_DATA_DIR=/app/data
EXPOSE 4173
CMD ["node", "server.js"]
