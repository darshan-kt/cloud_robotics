#!/bin/sh
# Prints a fresh, strong value for every credential this project reads
# from .env - for anyone standing this up outside pure local dev, where
# the shipped dev defaults (deliberately obvious - see .env.example) are
# not acceptable. See docs/12-security-hardening.md.
#
# Usage: ./scripts/generate-secrets.sh >> .env
# (then hand-edit .env to remove the now-duplicated old lines, or just
# paste the ones you need over the matching dev-default lines).
set -eu

echo "# --- Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/generate-secrets.sh ---"
echo "ENVIRONMENT=production"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "OPERATOR_PASSWORD=$(openssl rand -base64 24)"
echo "MQTT_BACKEND_PASSWORD=$(openssl rand -base64 24)"
echo "MQTT_ROBOT_PASSWORD=$(openssl rand -base64 24)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
echo "REDIS_PASSWORD=$(openssl rand -base64 24)"
echo "TURN_PASSWORD=$(openssl rand -base64 24)"
echo "# OPERATOR_USERNAME, POSTGRES_USER, TURN_USERNAME, MQTT_BACKEND_USERNAME:"
echo "# not secrets, keep or change independently."
