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

# --- Robot credentials (docs/security-findings.md F7) ---
# The robot's MQTT username IS its robot_id (the aclfile's %u pattern
# scopes each robot to its own topic namespace from that username), so
# every robot_id is effectively public - it appears in topics, REST URLs,
# and the fleet dashboard.
#
# That is only safe if each robot has its OWN password. With one shared
# MQTT_ROBOT_PASSWORD across a fleet, knowing another robot's id - which
# is free - is enough to authenticate as it and forge its telemetry or
# intercept its commands. Physical robots in schools are student-accessible,
# so assume one will be opened.
#
# MQTT_ROBOT_CREDENTIALS is the multi-robot form: a comma- or
# newline-separated list of robot_id:password pairs.
#   MQTT_ROBOT_CREDENTIALS="turtlebot3_01:s3cret1,turtlebot3_02:s3cret2"
# When unset, the single-robot ROBOT_ID/MQTT_ROBOT_PASSWORD pair is used,
# which keeps `docker compose up` zero-config for local development.
if [ -n "${MQTT_ROBOT_CREDENTIALS:-}" ]; then
  echo "$MQTT_ROBOT_CREDENTIALS" | tr ',' '\n' | while IFS= read -r entry; do
    entry=$(echo "$entry" | tr -d '[:space:]')
    [ -z "$entry" ] && continue
    robot="${entry%%:*}"
    secret="${entry#*:}"
    if [ -z "$robot" ] || [ -z "$secret" ] || [ "$robot" = "$entry" ]; then
      echo "Malformed MQTT_ROBOT_CREDENTIALS entry (expected robot_id:password): '$entry'" >&2
      exit 1
    fi
    mosquitto_passwd -b "$PW_FILE" "$robot" "$secret"
    echo "Provisioned MQTT credential for robot '$robot'"
  done
else
  mosquitto_passwd -b "$PW_FILE" "$ROBOT_ID" "$MQTT_ROBOT_PASSWORD"
  echo "Provisioned MQTT credential for robot '$ROBOT_ID' (single-robot mode)"
fi

# mosquitto_passwd creates the file 0600 root:root. The daemon drops
# privileges to the "mosquitto" user before reading it (see mosquitto.conf),
# so without this it can authenticate no one - the file holds salted
# hashes, not plaintext, so world-readable inside the container is fine.
chmod 644 "$PW_FILE"
# Ownership matters beyond permissions: current Mosquitto only WARNS that
# "future versions will refuse to load this file" when it isn't owned by
# the mosquitto user, but a version bump that starts enforcing it would
# take out the two files that carry all of this broker's authentication
# and per-robot topic scoping. Fixing it now costs nothing; discovering it
# during an upgrade would not. See docs/security-findings.md F7.
chown mosquitto:mosquitto "$PW_FILE" 2>/dev/null || true

# --- Optional TLS listener (docs/security-findings.md F6) ---
# Appended at runtime rather than committed into mosquitto.conf because
# mosquitto REFUSES TO START if a listener references certificate files
# that don't exist - which would break every zero-config `docker compose
# up` on a machine that never ran scripts/generate-dev-certs.sh. Presence
# of the mounted certs is therefore the switch.
CERT_DIR=/mosquitto/certs
RUNTIME_CONF=/tmp/mosquitto.runtime.conf
RUNTIME_ACL=/tmp/aclfile
cp /mosquitto/config/mosquitto.conf "$RUNTIME_CONF"

# The ACL file is bind-mounted read-only from the host, so it can't be
# chown'd in place - copy it somewhere writable, fix ownership there, and
# point the runtime config at the copy. Same forward-compatibility reason
# as the password file above; this is the file that keeps each robot inside
# its own topic namespace, so it is the last one you want silently
# unreadable after an image upgrade.
cp /mosquitto/config/aclfile "$RUNTIME_ACL"
chown mosquitto:mosquitto "$RUNTIME_ACL" 2>/dev/null || true
chmod 644 "$RUNTIME_ACL"
sed -i "s|^acl_file .*|acl_file $RUNTIME_ACL|" "$RUNTIME_CONF"

if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ] && [ -f "$CERT_DIR/ca.crt" ]; then
  echo "TLS certificates found - enabling MQTT over TLS on :8883"
  cat >> "$RUNTIME_CONF" <<EOF

listener 8883
protocol mqtt
cafile $CERT_DIR/ca.crt
certfile $CERT_DIR/server.crt
keyfile $CERT_DIR/server.key
EOF

  # --- Mutual TLS (docs/security-findings.md F6/F7) ---
  # Opt-in because it is a breaking change for any client that only has a
  # password: with require_certificate on, a client without a valid client
  # cert cannot connect to this listener at all.
  #
  # use_identity_as_username makes the certificate's CN the MQTT username,
  # which is what keeps the aclfile's %u pattern working unchanged - and
  # is the real resolution of F7. The robot no longer *asserts* an identity
  # (a public robot_id plus a shared password); it *proves* one by holding
  # a key a CA vouched for. There is no password left to share, and no
  # other device can claim that identity.
  #
  # password_file stays configured for the backend, which still uses one -
  # mosquitto applies certificate identity only on this listener.
  if [ "${MQTT_MUTUAL_TLS:-false}" = "true" ]; then
    echo "Mutual TLS ENABLED on :8883 - clients must present a CA-signed certificate"
    cat >> "$RUNTIME_CONF" <<EOF
require_certificate true
use_identity_as_username true
EOF
  else
    cat >> "$RUNTIME_CONF" <<EOF
# Clients authenticate with username/password over the TLS channel.
# Set MQTT_MUTUAL_TLS=true to require per-device client certificates
# instead - see scripts/issue-device-cert.sh.
require_certificate false
EOF
  fi
else
  echo "No TLS certificates at $CERT_DIR - plaintext listener only (run scripts/generate-dev-certs.sh to enable TLS)"
fi

exec /docker-entrypoint.sh /usr/sbin/mosquitto -c "$RUNTIME_CONF"
