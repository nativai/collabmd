FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=1234

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/public ./public
COPY --from=build /app/src ./src
COPY --from=build /app/bin ./bin

# Default vault directory — mount a volume here
VOLUME ["/data"]
ENV COLLABMD_VAULT_DIR=/data

EXPOSE 1234

CMD ["node", "bin/collabmd.js", "--no-tunnel", "/data"]
