FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=1234

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/public ./public
COPY --from=build /app/src ./src

VOLUME ["/app/data"]

EXPOSE 1234

CMD ["npm", "run", "start:prod"]
