# Build context: cloud-container/frontend/
#
# Two independent targets from one Dockerfile:
#   dev  - Vite dev server with hot-reload (what docker-compose.yml runs
#          while we're actively building pages)
#   prod - compiled static bundle served by nginx, with runtime config
#          injection (what actually ships - proves the AWS-mirroring path
#          builds, see docs/02-docker-foundations.md)

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]

FROM deps AS build
COPY . .
RUN npm run build

FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY config.template.json /usr/share/nginx/html/config.template.json
COPY inject-runtime-config.sh /docker-entrypoint.d/40-inject-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-inject-runtime-config.sh
EXPOSE 80
