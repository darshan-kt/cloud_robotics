#!/bin/sh
# Issues a per-device MQTT client certificate signed by the local dev CA,
# for mutual TLS (docs/security-findings.md F6/F7).
#
#   ./scripts/generate-dev-certs.sh          # once, creates the CA
#   ./scripts/issue-device-cert.sh turtlebot3_01
#
# The certificate's Common Name IS the robot_id, and the broker is
# configured with `use_identity_as_username true`, so the CN becomes the
# MQTT username the aclfile's %u pattern scopes on. That is what finally
# resolves F7 properly: the robot's identity is no longer asserted by
# sending a guessable string plus a shared password - it is proven by
# holding a private key that a CA vouched for, and it cannot be claimed by
# any other device.
#
# DEVELOPMENT certificates only - the CA key sits unprotected beside them
# and nothing rotates. A real deployment issues from a managed CA, which
# is also exactly what AWS IoT Core expects (docs/11-aws-migration.md).
set -eu

if [ $# -ne 1 ]; then
  echo "Usage: $0 <robot_id>" >&2
  echo "Example: $0 turtlebot3_01" >&2
  exit 1
fi

ROBOT_ID="$1"
CERT_DIR="$(dirname "$0")/../certs"
DAYS=825

# Reject anything that isn't a plain identifier: this string becomes both
# the certificate CN and - via use_identity_as_username - the MQTT username
# the ACL scopes topics on, so it must not be able to carry separators or
# wildcards.
case "$ROBOT_ID" in
  *[!A-Za-z0-9_-]*|"")
    echo "Invalid robot_id '$ROBOT_ID': use only letters, digits, underscore, hyphen." >&2
    exit 1
    ;;
esac

cd "$CERT_DIR" 2>/dev/null || {
  echo "No certs/ directory - run ./scripts/generate-dev-certs.sh first." >&2
  exit 1
}

if [ ! -f ca.crt ] || [ ! -f ca.key ]; then
  echo "No CA found in certs/ - run ./scripts/generate-dev-certs.sh first." >&2
  exit 1
fi

if [ -f "$ROBOT_ID.crt" ]; then
  echo "certs/$ROBOT_ID.crt already exists - delete it first to reissue."
  exit 0
fi

echo "==> Issuing client certificate for '$ROBOT_ID'..."
openssl req -new -nodes -newkey rsa:2048 \
  -keyout "$ROBOT_ID.key" -out "$ROBOT_ID.csr" \
  -subj "/CN=$ROBOT_ID" 2>/dev/null

# clientAuth, not serverAuth: this certificate proves who is CONNECTING.
cat > "$ROBOT_ID.ext" <<EOF
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -in "$ROBOT_ID.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out "$ROBOT_ID.crt" -days "$DAYS" -sha256 -extfile "$ROBOT_ID.ext" 2>/dev/null

rm -f "$ROBOT_ID.csr" "$ROBOT_ID.ext" ca.srl
chmod 644 "$ROBOT_ID.crt" "$ROBOT_ID.key"

echo
echo "Wrote certs/$ROBOT_ID.crt and certs/$ROBOT_ID.key (CN=$ROBOT_ID)"
echo
echo "To use it, set on that robot:"
echo "  MQTT_TLS_ENABLED=true"
echo "  MQTT_PORT=8883"
echo "  MQTT_TLS_CA_CERTS=/mosquitto/certs/ca.crt"
echo "  MQTT_TLS_CERTFILE=/mosquitto/certs/$ROBOT_ID.crt"
echo "  MQTT_TLS_KEYFILE=/mosquitto/certs/$ROBOT_ID.key"
echo
echo "And on the broker, to REQUIRE certificates and derive the username"
echo "from the CN (so the aclfile's %u scoping still applies):"
echo "  MQTT_MUTUAL_TLS=true"
