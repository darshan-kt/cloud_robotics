# cloud-container/mosquitto/

**Purpose:** configuration for the Eclipse Mosquitto MQTT broker — the single channel through which the cloud backend and every robot communicate.

**Contains:** `mosquitto.conf` (listeners, persistence, auth/ACL directives), `aclfile` (per-role topic permissions, using Mosquitto's `%u` substitution so one rule set covers every robot), and `docker-entrypoint-wrapper.sh` (generates `passwordfile` from environment variables at container startup — no secrets are committed to this repo).

**AWS note:** this maps directly to AWS IoT Core in production (see [`docs/00-overview.md`](../../docs/00-overview.md)) — the `%u` ACL pattern here plays the same role as IoT Core policy variables like `${iot:Connection.Thing.ThingName}`.

**Filled in:** Milestone 3 — see [`docs/03-mqtt-layer.md`](../../docs/03-mqtt-layer.md) for the full topic contract and design reasoning.
