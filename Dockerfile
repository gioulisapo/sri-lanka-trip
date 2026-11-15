FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node server.mjs worker.mjs storage.mjs ./
COPY --chown=node:node migrations ./migrations
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
