#!/bin/sh
# Generates a throwaway local CA and a broker server certificate so MQTT
# over TLS (docs/security-findings.md F6) can be exercised for real on a
# dev machine, rather than merely being wired up and assumed to work.
#
#   ./scripts/generate-dev-certs.sh
#   # then set MQTT_TLS_ENABLED=true and MQTT_PORT=8883 in .env
#   make restart
#
# These are DEVELOPMENT certificates. They are written to certs/, which is
# gitignored, and they must never be used anywhere real:
#   - the CA private key sits unprotected next to the certs it signs
#   - the server cert is valid for "mosquitto"/"localhost" only
#   - nothing rotates them
# A real deployment issues per-device certificates from a managed CA - see
# docs/target-architecture.md D3, and AWS IoT Core's own certificate flow
# in docs/11-aws-migration.md.
set -eu

CERT_DIR="$(dirname "$0")/../certs"
DAYS=825   # ~27 months: the max most TLS stacks accept for a leaf cert

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

if [ -f ca.crt ] && [ -f server.crt ]; then
  echo "certs/ already contains ca.crt and server.crt - delete them first to regenerate."
  exit 0
fi

echo "==> Generating local CA..."
openssl req -x509 -new -nodes -newkey rsa:2048 \
  -keyout ca.key -out ca.crt -days "$DAYS" -sha256 \
  -subj "/CN=cloud-robotics-dev-ca" 2>/dev/null

echo "==> Generating broker server certificate..."
openssl req -new -nodes -newkey rsa:2048 \
  -keyout server.key -out server.csr \
  -subj "/CN=mosquitto" 2>/dev/null

# subjectAltName is not optional: modern TLS clients verify the hostname
# against SAN and ignore CN entirely, so a cert without it fails
# verification even when the CN looks right. Both names are listed because
# the broker is reached as "mosquitto" from inside the Docker network and
# as "localhost" from the host.
cat > server.ext <<EOF
subjectAltName = DNS:mosquitto, DNS:localhost, IP:127.0.0.1
extendedKeyUsage = serverAuth
EOF

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days "$DAYS" -sha256 -extfile server.ext 2>/dev/null

rm -f server.csr server.ext ca.srl
# The broker drops privileges to the "mosquitto" user and must still read
# its own key.
chmod 644 ca.crt server.crt
chmod 644 server.key

echo
echo "Wrote:"
echo "  certs/ca.crt      <- give this to clients (MQTT_TLS_CA_CERTS)"
echo "  certs/server.crt  <- broker certificate"
echo "  certs/server.key  <- broker private key"
echo
echo "Next:"
echo "  1. In .env:  MQTT_TLS_ENABLED=true   MQTT_PORT=8883"
echo "  2. make restart"
echo "  3. Verify:   make mqtt-tls-check"
