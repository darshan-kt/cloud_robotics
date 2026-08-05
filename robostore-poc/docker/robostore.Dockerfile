# Build context: robostore-poc/ (see ../../docker-compose.robostore.yml)
#
# Same two-target shape as cloud-container/docker/frontend.Dockerfile,
# deliberately - this is a different app, but not a different convention:
#   dev  - Vite dev server with hot-reload (what docker-compose.robostore.yml
#          runs by default while apps are still being built out one at a time)
#   prod - compiled static bundle served by nginx with SPA fallback (proves
#          this app is just as deployable as the real console, even though
#          nothing points a real deployment at it yet)
#
# No bind-mounted volumes for the dev target, matching frontend.Dockerfile -
# the source is COPY'd in at build time, so `docker compose up -d --build`
# (not a plain `up`) is how you pick up an edit. Simpler than a bind mount +
# anonymous node_modules volume, and consistent with how the rest of this
# repo already works.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3100
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3100"]

FROM deps AS build
COPY . .
# VITE_GATEWAY_URL is baked in at build time (Vite inlines import.meta.env.*
# at build, not at container start) - passed through as a build arg so the
# prod image can be built for a real gateway address without editing source.
ARG VITE_GATEWAY_URL=http://localhost:1717
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
RUN npm run build

FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
