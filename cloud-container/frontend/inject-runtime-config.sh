#!/bin/sh
# Runs automatically at container start (nginx:alpine executes every *.sh
# file in /docker-entrypoint.d/ before launching nginx). Renders
# config.template.json -> config.json using the container's real
# environment, so the same built JS bundle can point at any backend without
# a rebuild - see docs/02-docker-foundations.md.
set -eu

envsubst '${API_BASE_URL} ${TURN_URL} ${TURN_USERNAME} ${TURN_CREDENTIAL}' \
  < /usr/share/nginx/html/config.template.json \
  > /usr/share/nginx/html/config.json
