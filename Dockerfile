FROM node:22-bookworm-slim AS base

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 4111

CMD ["npm", "run", "dev"]