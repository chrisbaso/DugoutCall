FROM node:20-alpine AS build

WORKDIR /app

COPY server/package*.json ./server/
RUN npm ci --prefix server

COPY server ./server
COPY demo-web ./demo-web
RUN npm run build --prefix server
RUN npm prune --prefix server --omit=dev

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/server ./server
COPY --from=build /app/demo-web ./demo-web

EXPOSE 8787

CMD ["node", "server/dist/index.js"]
