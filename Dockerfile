# Serves the website, the app and the API from one container.
FROM node:22-slim
WORKDIR /srv
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/pehla-kadam.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/server.js"]
