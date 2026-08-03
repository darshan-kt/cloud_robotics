#!/bin/sh
# Runs in place of the stock eclipse-mosquitto entrypoint (see the
# `entrypoint:` override on the mosquitto service in docker-compose.yml).
#
# Credentials are never committed to the repo, even hashed - this script
# (re)generates /mosquitto/config/passwordfile from environment variables
# on every container start, so rotating a password is "change the env var
# and restart the container", not "edit a file and remember to hash it".
# In the real AWS deployment this whole mechanism is replaced by
# certificate-based IoT Core auth - see docs/03-mqtt-layer.md.
set -eu

PW_FILE=/mosquitto/config/passwordfile

: "${MQTT_BACKEND_USERNAME:?MQTT_BACKEND_USERNAME is required}"
: "${MQTT_BACKEND_PASSWORD:?MQTT_BACKEND_PASSWORD is required}"
: "${ROBOT_ID:?ROBOT_ID is required}"
: "${MQTT_ROBOT_PASSWORD:?MQTT_ROBOT_PASSWORD is required}"

# mosquitto_passwd -c refuses to run if the file already exists (it does
# NOT overwrite, despite what older docs imply) - remove it first so this
# is safe to re-run on every container start/restart.
rm -f "$PW_FILE"
mosquitto_passwd -b -c "$PW_FILE" "$MQTT_BACKEND_USERNAME" "$MQTT_BACKEND_PASSWORD"
# The robot's MQTT username IS its robot_id - see aclfile's %u pattern.
mosquitto_passwd -b "$PW_FILE" "$ROBOT_ID" "$MQTT_ROBOT_PASSWORD"

# mosquitto_passwd creates the file 0600 root:root. The daemon drops
# privileges to the "mosquitto" user before reading it (see mosquitto.conf),
# so without this it can authenticate no one - the file holds salted
# hashes, not plaintext, so world-readable inside the container is fine.
chmod 644 "$PW_FILE"

exec /docker-entrypoint.sh /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
