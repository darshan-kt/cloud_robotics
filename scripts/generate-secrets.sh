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

# Base64 can contain '/' and '+', which are fine in a value but awkward to
# paste through shells; -hex avoids that for the ones most likely to be
# copied by hand.
rand() { openssl rand -hex 24; }

echo "# --- Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/generate-secrets.sh ---"
echo "ENVIRONMENT=production"
echo
echo "# --- Application secrets ---"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "OPERATOR_PASSWORD=$(rand)"
echo "MQTT_BACKEND_PASSWORD=$(rand)"
echo "POSTGRES_PASSWORD=$(rand)"
echo "REDIS_PASSWORD=$(rand)"
echo "TURN_PASSWORD=$(rand)"
echo
echo "# --- Robot health endpoint (docs/security-findings.md F1) ---"
echo "# Guards /metrics and /status, which expose robot_id - also the MQTT username."
echo "ROBOT_HEALTH_TOKEN=$(openssl rand -hex 32)"
echo
echo "# --- Per-robot MQTT credentials (docs/security-findings.md F7) ---"
echo "# One password per robot. A shared password means any robot that is"
echo "# opened can impersonate every other robot in the fleet."
echo "MQTT_ROBOT_PASSWORD=$(rand)   # single-robot fallback"
echo "# Multi-robot: extend this list, one entry per robot."
echo "MQTT_ROBOT_CREDENTIALS=${ROBOT_ID:-turtlebot3_01}:$(rand)"
echo
echo "# --- Transport security (docs/security-findings.md F6) ---"
echo "# The production guard REFUSES to start with TLS off - see"
echo "# app/config.py's assert_production_safe(). Issue real certificates"
echo "# from a real CA; scripts/generate-dev-certs.sh is for local use only."
echo "MQTT_TLS_ENABLED=true"
echo "MQTT_PORT=8883"
echo "MQTT_TLS_CA_CERTS=/mosquitto/certs/ca.crt"
echo "MQTT_TLS_INSECURE=false"
echo
echo "# --- Must be set to real values, not generated ---"
echo "# CORS_ALLOWED_ORIGINS=https://console.your-domain  # the guard rejects localhost"
echo "# OPERATOR_USERNAME, POSTGRES_USER, TURN_USERNAME, MQTT_BACKEND_USERNAME:"
echo "# not secrets, keep or change independently."
